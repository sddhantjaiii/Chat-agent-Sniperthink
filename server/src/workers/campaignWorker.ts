/**
 * Campaign Worker
 * Background processor for scheduled campaigns and event-based triggers
 */

import { logger } from '../utils/logger';
import { campaignService } from '../services/campaignService';
import { templateService } from '../services/templateService';
import { contactService } from '../services/contactService';
import { rateLimitService } from '../services/rateLimitService';
import { sendTemplateMessage } from '../services/messageService';
import { appEventEmitter } from '../utils/eventEmitter';
import { campaignsConfig } from '../config';
import type {
    Campaign,
    CampaignRecipient,
    Contact,
    ExtractionCompleteEvent,
    LeadStatusChangedEvent,
    ContactTagAddedEvent,
} from '../models/types';

const WORKER_INTERVAL_MS = 10000; // Check every 10 seconds
const BATCH_DELAY_MS = campaignsConfig.delayBetweenBatchesMs;
const BATCH_SIZE = campaignsConfig.batchSize;

let workerInterval: NodeJS.Timeout | null = null;
let isProcessing = false;
let isShuttingDown = false;

/**
 * Process a single recipient
 */
async function processRecipient(
    campaign: Campaign,
    recipient: CampaignRecipient,
    contact: Contact,
    _variables: Map<string, string>
): Promise<boolean> {
    const correlationId = `campaign_${campaign.campaign_id}_${Date.now()}`;
    
    try {
        // Check rate limit before sending
        const canSend = await rateLimitService.checkLimit(campaign.phone_number_id);
        if (!canSend) {
            logger.warn('Rate limit reached for phone number', {
                phoneNumberId: campaign.phone_number_id,
                campaignId: campaign.campaign_id,
                contactId: contact.contact_id,
            });
            await campaignService.updateRecipientStatus(
                recipient.recipient_id,
                'SKIPPED',
                { skip_reason: 'RATE_LIMITED' }
            );
            return false;
        }

        // Get template and substitute variables
        const template = await templateService.getTemplateById(campaign.template_id);
        if (!template || template.status !== 'APPROVED') {
            logger.error('Template not available or not approved', {
                templateId: campaign.template_id,
                campaignId: campaign.campaign_id,
            });
            await campaignService.updateRecipientStatus(
                recipient.recipient_id,
                'FAILED',
                { error_message: 'Template not available' }
            );
            return false;
        }

        // Build variable values from contact data
        const templateVariables = await templateService.getTemplateVariables(template.template_id);
        const variableValues: Record<string, string> = {};

        for (const templateVar of templateVariables) {
            // Check if contact has this field
            const contactField = templateVar.extraction_field;
            if (contactField) {
                const value = contact[contactField as keyof Contact];
                if (value !== undefined && value !== null) {
                    variableValues[templateVar.variable_name] = String(value);
                }
            }
            
            // If still no value, use default
            if (!variableValues[templateVar.variable_name] && templateVar.default_value) {
                variableValues[templateVar.variable_name] = templateVar.default_value;
            }
        }

        // Send the template message
        const result = await sendTemplateMessage(
            campaign.phone_number_id,
            contact.phone,
            template.name,
            template.language,
            variableValues,
            correlationId
        );

        if (result.success) {
            const sendId = `send_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            
            await campaignService.updateRecipientStatus(
                recipient.recipient_id,
                'SENT',
                { template_send_id: sendId }
            );
            await rateLimitService.incrementUsage(campaign.phone_number_id);
            
            // Track in template sends
            await templateService.createTemplateSend({
                send_id: sendId,
                template_id: template.template_id,
                campaign_id: campaign.campaign_id,
                customer_phone: contact.phone,
            });
            
            // Update status if we have platform message ID
            if (result.messageId) {
                await templateService.updateTemplateSendStatus(sendId, 'SENT', result.messageId);
            }

            logger.debug('Template message sent', {
                campaignId: campaign.campaign_id,
                contactId: contact.contact_id,
                phone: contact.phone,
            });

            return true;
        } else {
            const sendId = `send_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            
            await campaignService.updateRecipientStatus(
                recipient.recipient_id,
                'FAILED',
                { template_send_id: sendId, error_message: result.error ?? 'Send failed' }
            );

            await templateService.createTemplateSend({
                send_id: sendId,
                template_id: template.template_id,
                campaign_id: campaign.campaign_id,
                customer_phone: contact.phone,
            });
            
            // Update status with error
            await templateService.updateTemplateSendStatus(
                sendId, 
                'FAILED', 
                undefined, 
                undefined, 
                result.error ?? 'Send failed'
            );

            return false;
        }
    } catch (error) {
        logger.error('Error processing recipient', {
            campaignId: campaign.campaign_id,
            recipientId: recipient.recipient_id,
            error: error instanceof Error ? error.message : 'Unknown error',
        });

        await campaignService.updateRecipientStatus(
            recipient.recipient_id,
            'FAILED',
            { error_message: error instanceof Error ? error.message : 'Unknown error' }
        );

        return false;
    }
}

/**
 * Process a batch of recipients for a campaign
 */
async function processCampaignBatch(campaign: Campaign): Promise<void> {
    const pendingRecipients = await campaignService.getPendingRecipients(campaign.campaign_id, BATCH_SIZE);

    if (pendingRecipients.length === 0) {
        // No more pending recipients, complete the campaign
        await campaignService.completeCampaign(campaign.campaign_id);
        await campaignService.syncCampaignStats(campaign.campaign_id);
        logger.info('Campaign completed', { campaignId: campaign.campaign_id });
        return;
    }

    logger.info('Processing campaign batch', {
        campaignId: campaign.campaign_id,
        batchSize: pendingRecipients.length,
    });

    for (const recipientWithContact of pendingRecipients) {
        if (isShuttingDown) {
            logger.info('Worker shutting down, stopping batch processing');
            return;
        }

        // Refresh campaign status to check if it's been paused/cancelled
        const currentCampaign = await campaignService.getCampaignById(campaign.campaign_id);
        if (!currentCampaign || currentCampaign.status !== 'RUNNING') {
            logger.info('Campaign no longer running, stopping batch', {
                campaignId: campaign.campaign_id,
                status: currentCampaign?.status,
            });
            return;
        }

        const contact = recipientWithContact.contact;
        
        // Check if contact has opted out
        if (contact.opted_out) {
            await campaignService.updateRecipientStatus(
                recipientWithContact.recipient_id,
                'SKIPPED',
                { skip_reason: 'OPTED_OUT' }
            );
            continue;
        }

        // Process the recipient
        await processRecipient(campaign, recipientWithContact, contact, new Map());

        // Small delay between individual messages to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Sync stats after batch
    await campaignService.syncCampaignStats(campaign.campaign_id);

    // Add delay before next batch
    await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
}

/**
 * Process scheduled triggers
 */
async function processScheduledTriggers(): Promise<void> {
    const triggers = await campaignService.getReadyScheduledTriggers();

    for (const trigger of triggers) {
        if (isShuttingDown) return;

        try {
            const campaign = await campaignService.getCampaignById(trigger.campaign_id);
            if (!campaign || campaign.status !== 'DRAFT') {
                await campaignService.markTriggerExecuted(trigger.trigger_id);
                continue;
            }

            // Start the campaign
            logger.info('Starting scheduled campaign', {
                campaignId: campaign.campaign_id,
                triggerId: trigger.trigger_id,
            });

            await campaignService.startCampaign(campaign.campaign_id);
            await campaignService.markTriggerExecuted(trigger.trigger_id);
        } catch (error) {
            logger.error('Error processing scheduled trigger', {
                triggerId: trigger.trigger_id,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }
}

/**
 * Handle extraction complete event
 */
async function handleExtractionComplete(event: ExtractionCompleteEvent): Promise<void> {
    const { payload } = event;
    const triggers = await campaignService.getActiveTriggersByEventType('NEW_EXTRACTION');

    for (const trigger of triggers) {
        try {
            const campaign = await campaignService.getCampaignById(trigger.campaign_id);
            if (!campaign || campaign.user_id !== payload.userId) continue;

            // Get or create contact
            let contact = await contactService.getContactByPhone(payload.userId, payload.customerPhone);
            if (!contact) {
                // Try to sync from extraction
                contact = await contactService.syncFromExtraction(
                    payload.userId,
                    payload.extractionId,
                    payload.conversationId,
                    payload.customerPhone,
                    { lead_status_tag: payload.leadStatusTag }
                );
            }
            
            if (!contact) continue;

            // Add recipient to campaign if it matches filter
            const campaignContacts = await contactService.getContactsForCampaign(
                payload.userId,
                campaign.recipient_filter
            );

            const matchingContact = campaignContacts.find(
                (c: Contact) => c.phone === payload.customerPhone
            );
            
            if (matchingContact) {
                // Check if already in campaign
                const existingRecipient = await campaignService.getRecipientByContactAndCampaign(
                    campaign.campaign_id,
                    matchingContact.contact_id
                );

                if (!existingRecipient) {
                    await campaignService.createRecipient({
                        recipient_id: `rcpt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                        campaign_id: campaign.campaign_id,
                        contact_id: matchingContact.contact_id,
                    });

                    logger.info('Added contact to campaign from extraction event', {
                        campaignId: campaign.campaign_id,
                        contactId: matchingContact.contact_id,
                        extractionId: payload.extractionId,
                    });
                }
            }
        } catch (error) {
            logger.error('Error handling extraction complete event', {
                triggerId: trigger.trigger_id,
                extractionId: payload.extractionId,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }
}

/**
 * Handle lead status changed event
 */
async function handleLeadStatusChanged(event: LeadStatusChangedEvent): Promise<void> {
    const { payload } = event;
    
    // Map status to trigger event type
    const eventTypeMap: Record<string, string> = {
        Hot: 'LEAD_HOT',
        Warm: 'LEAD_WARM',
        Cold: 'LEAD_COLD',
    };

    const eventType = eventTypeMap[payload.newStatus];
    if (!eventType) return;

    const triggers = await campaignService.getActiveTriggersByEventType(eventType);

    for (const trigger of triggers) {
        try {
            const campaign = await campaignService.getCampaignById(trigger.campaign_id);
            if (!campaign || campaign.user_id !== payload.userId) continue;

            // Get contact
            const contact = await contactService.getContactByPhone(payload.userId, payload.customerPhone);
            if (!contact) continue;

            // Check if contact matches campaign filter
            const campaignContacts = await contactService.getContactsForCampaign(
                payload.userId,
                campaign.recipient_filter
            );

            const matchingContact = campaignContacts.find(
                (c: Contact) => c.contact_id === contact.contact_id
            );
            
            if (matchingContact) {
                // Check if already in campaign
                const existingRecipient = await campaignService.getRecipientByContactAndCampaign(
                    campaign.campaign_id,
                    contact.contact_id
                );

                if (!existingRecipient) {
                    await campaignService.createRecipient({
                        recipient_id: `rcpt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                        campaign_id: campaign.campaign_id,
                        contact_id: contact.contact_id,
                    });

                    logger.info('Added contact to campaign from lead status event', {
                        campaignId: campaign.campaign_id,
                        contactId: contact.contact_id,
                        newStatus: payload.newStatus,
                    });
                }
            }
        } catch (error) {
            logger.error('Error handling lead status changed event', {
                triggerId: trigger.trigger_id,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }
}

/**
 * Handle contact tag added event
 */
async function handleContactTagAdded(event: ContactTagAddedEvent): Promise<void> {
    const { payload } = event;
    const triggers = await campaignService.getActiveTriggersByEventType('TAG_ADDED');

    for (const trigger of triggers) {
        try {
            const campaign = await campaignService.getCampaignById(trigger.campaign_id);
            if (!campaign || campaign.user_id !== payload.userId) continue;

            // Check if the trigger is configured for this specific tag
            const triggerConfig = trigger.event_config as { tags?: string[] } | null;
            if (triggerConfig?.tags && !triggerConfig.tags.includes(payload.tag)) {
                continue;
            }

            // Get contact
            const contact = await contactService.getContactById(payload.contactId);
            if (!contact) continue;

            // Check if contact matches campaign filter
            const campaignContacts = await contactService.getContactsForCampaign(
                payload.userId,
                campaign.recipient_filter
            );

            const matchingContact = campaignContacts.find(
                (c: Contact) => c.contact_id === contact.contact_id
            );
            
            if (matchingContact) {
                // Check if already in campaign
                const existingRecipient = await campaignService.getRecipientByContactAndCampaign(
                    campaign.campaign_id,
                    contact.contact_id
                );

                if (!existingRecipient) {
                    await campaignService.createRecipient({
                        recipient_id: `rcpt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                        campaign_id: campaign.campaign_id,
                        contact_id: contact.contact_id,
                    });

                    logger.info('Added contact to campaign from tag event', {
                        campaignId: campaign.campaign_id,
                        contactId: contact.contact_id,
                        tag: payload.tag,
                    });
                }
            }
        } catch (error) {
            logger.error('Error handling contact tag added event', {
                triggerId: trigger.trigger_id,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }
}

/**
 * Main worker loop
 */
async function workerLoop(): Promise<void> {
    if (isProcessing || isShuttingDown) return;

    isProcessing = true;

    try {
        // Process scheduled triggers first
        await processScheduledTriggers();

        // Get running campaigns
        const { campaigns } = await campaignService.getAllCampaigns({
            status: 'RUNNING',
            limit: 100,
        });

        if (campaigns.length > 0) {
            logger.info('Found running campaigns to process', { count: campaigns.length });
        }

        // Process each running campaign
        for (const campaign of campaigns) {
            if (isShuttingDown) break;
            await processCampaignBatch(campaign);
        }

        // Reset daily rate limits at midnight UTC (only resets if needed)
        const now = new Date();
        if (now.getUTCHours() === 0 && now.getUTCMinutes() < 1) {
            await rateLimitService.resetAllDaily();
        }
    } catch (error) {
        logger.error('Campaign worker error', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    } finally {
        isProcessing = false;
    }
}

/**
 * Start the campaign worker
 */
export function startCampaignWorker(): void {
    if (workerInterval) {
        logger.warn('Campaign worker already running');
        return;
    }

    logger.info('Starting campaign worker', {
        interval: WORKER_INTERVAL_MS,
        batchSize: BATCH_SIZE,
        batchDelay: BATCH_DELAY_MS,
    });

    // Subscribe to events
    appEventEmitter.onExtractionComplete(handleExtractionComplete);
    appEventEmitter.onLeadStatusChanged(handleLeadStatusChanged);
    appEventEmitter.onContactTagAdded(handleContactTagAdded);

    // Start the worker loop
    workerInterval = setInterval(workerLoop, WORKER_INTERVAL_MS);

    // Run immediately
    workerLoop();
}

/**
 * Stop the campaign worker
 */
export function stopCampaignWorker(): void {
    if (!workerInterval) {
        logger.warn('Campaign worker not running');
        return;
    }

    logger.info('Stopping campaign worker');
    isShuttingDown = true;

    clearInterval(workerInterval);
    workerInterval = null;

    // Unsubscribe from events
    appEventEmitter.removeAllListeners('extraction.complete');
    appEventEmitter.removeAllListeners('lead.statusChanged');
    appEventEmitter.removeAllListeners('contact.tagAdded');
}

/**
 * Check if worker is running
 */
export function isWorkerRunning(): boolean {
    return workerInterval !== null;
}

export const campaignWorker = {
    start: startCampaignWorker,
    stop: stopCampaignWorker,
    isRunning: isWorkerRunning,
};
