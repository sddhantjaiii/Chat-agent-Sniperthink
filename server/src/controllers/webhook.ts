import { Request, Response } from 'express';
import { logger } from '../utils/logger';
import { enqueueMessage } from '../utils/messageQueue';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../utils/database';
import { 
    recordButtonClick, 
    findTemplateSendForButtonClick 
} from '../services/templateService';

/**
 * Normalize phone number to E.164 format with + prefix
 * WhatsApp sends phone numbers without + but we store with +
 */
function normalizePhoneNumber(phone: string): string {
    // Remove all non-digit characters except leading +
    let normalized = phone.replace(/[^\d+]/g, '');
    
    // Ensure it starts with +
    if (!normalized.startsWith('+')) {
        normalized = '+' + normalized;
    }
    
    return normalized;
}

/**
 * Interface for processed webhook message (matches QueuedMessage)
 */
interface ProcessedMessage {
    message_id: string;
    phone_number_id: string;
    customer_phone: string;
    message_text: string;
    timestamp: string;
    platform_type: 'whatsapp' | 'instagram' | 'webchat';
}

/**
 * Interface for template status update webhook
 * Meta sends these fields directly in change.value when field is 'message_template_status_update'
 */
interface TemplateStatusUpdate {
    event: 'APPROVED' | 'REJECTED' | 'PENDING_DELETION' | 'FLAGGED' | 'DISABLED' | 'REINSTATED' | 'PENDING';
    message_template_id: number;
    message_template_name: string;
    message_template_language: string;
    message_template_category?: string;
    reason?: string;
}

/**
 * WhatsApp webhook payload interfaces
 */
interface WhatsAppWebhookPayload {
    object: 'whatsapp_business_account';
    entry: Array<{
        id: string;
        changes: Array<{
            value: {
                messaging_product: 'whatsapp';
                metadata: {
                    display_phone_number: string;
                    phone_number_id: string;
                };
                contacts?: Array<{
                    profile: { name: string };
                    wa_id: string;
                }>;
                messages?: Array<{
                    from: string;
                    id: string;
                    timestamp: string;
                    type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'location' | 'contacts' | 'interactive' | 'button';
                    text?: { body: string };
                    image?: { mime_type: string; sha256: string; id: string };
                    audio?: { mime_type: string; sha256: string; id: string; voice: boolean };
                    video?: { mime_type: string; sha256: string; id: string };
                    document?: { mime_type: string; sha256: string; id: string; filename: string };
                    location?: { latitude: number; longitude: number; name?: string; address?: string };
                    contacts?: Array<any>;
                    // Interactive message (button reply from templates)
                    interactive?: {
                        type: 'button_reply' | 'list_reply';
                        button_reply?: {
                            id: string;      // The button payload/ID
                            title: string;   // The button text that was clicked
                        };
                        list_reply?: {
                            id: string;
                            title: string;
                            description?: string;
                        };
                    };
                    // Button message (quick reply from templates)
                    button?: {
                        payload: string;  // Button ID
                        text: string;     // Button text
                    };
                    // Context for reply messages (links to original template message)
                    context?: {
                        from: string;
                        id: string;   // ID of the message being replied to (template message)
                    };
                }>;
                statuses?: Array<{
                    id: string;
                    status: 'sent' | 'delivered' | 'read' | 'failed';
                    timestamp: string;
                    recipient_id: string;
                    errors?: Array<{ code: number; title: string; message: string }>;
                }>;
                // Template status update field
                message_template_status_update?: TemplateStatusUpdate;
            };
            field: 'messages' | 'message_template_status_update';
        }>;
    }>;
}

/**
 * Instagram webhook payload interfaces
 * Instagram can send messages in two formats:
 * 1. Messaging format (older): entry[].messaging[]
 * 2. Changes format (newer): entry[].changes[].value with sender/recipient at root
 */
interface InstagramWebhookPayload {
    object: 'instagram';
    entry: Array<{
        id: string;
        time: number;
        // Format 1: Messaging array (older format)
        messaging?: Array<{
            sender: { id: string };
            recipient: { id: string };
            timestamp: number;
            message?: {
                mid: string;
                text?: string;
                attachments?: Array<{
                    type: 'image' | 'video' | 'audio' | 'file';
                    payload: { url: string };
                }>;
            };
            postback?: {
                payload: string;
                title: string;
            };
        }>;
        // Format 2: Changes array (newer format)
        changes?: Array<{
            field: string;
            value: {
                sender?: { id: string };
                recipient?: { id: string };
                timestamp?: string | number;
                message?: {
                    mid: string;
                    text?: string;
                    attachments?: Array<{
                        type: 'image' | 'video' | 'audio' | 'file';
                        payload: { url: string };
                    }>;
                };
                postback?: {
                    payload: string;
                    title: string;
                };
            };
        }>;
    }>;
}

/**
 * Handle Meta webhook POST requests (WhatsApp and Instagram)
 */
export async function handleMetaWebhook(req: Request, res: Response): Promise<void> {
    const correlationId = req.get('x-correlation-id') || 'unknown';
    
    try {
        const payload = req.body;
        
        // DEBUG: Log the entire payload to see what Instagram is sending
        logger.info('📥 Webhook payload received', {
            payload: JSON.stringify(payload, null, 2),
            correlationId
        });
        
        if (!payload || !payload.object) {
            logger.warn('Invalid webhook payload structure', { correlationId });
            res.status(400).json({
                error: 'Invalid payload structure',
                correlationId,
                timestamp: new Date().toISOString()
            });
            return;
        }

        // Process based on platform type
        let processedMessages: ProcessedMessage[] = [];
        let templateStatusUpdates = 0;
        
        if (payload.object === 'whatsapp_business_account') {
            // Check for template status updates first
            const templateResult = await handleTemplateStatusUpdate(payload as WhatsAppWebhookPayload, correlationId);
            templateStatusUpdates = templateResult.updates;
            
            // Then parse regular messages
            processedMessages = parseWhatsAppPayload(payload as WhatsAppWebhookPayload, correlationId);
        } else if (payload.object === 'instagram') {
            processedMessages = parseInstagramPayload(payload as InstagramWebhookPayload, correlationId);
        } else {
            logger.warn('Unsupported webhook object type', { 
                object: payload.object, 
                correlationId 
            });
            res.status(400).json({
                error: 'Unsupported webhook object type',
                correlationId,
                timestamp: new Date().toISOString()
            });
            return;
        }

        // Enqueue messages for processing
        const enqueuePromises = processedMessages.map(message => 
            enqueueMessage(message).catch(error => {
                logger.error('Failed to enqueue message', {
                    message_id: message.message_id,
                    error: error instanceof Error ? error.message : 'Unknown error',
                    correlationId
                });
                return null;
            })
        );

        const results = await Promise.allSettled(enqueuePromises);
        const successCount = results.filter(result => result.status === 'fulfilled' && result.value !== null).length;
        const failureCount = results.length - successCount;

        if (failureCount > 0) {
            logger.warn('Some messages failed to enqueue', {
                totalMessages: processedMessages.length,
                successCount,
                failureCount,
                correlationId
            });
        }

        logger.info('Webhook processed successfully', {
            platform: payload.object,
            messagesProcessed: processedMessages.length,
            templateStatusUpdates,
            successCount,
            failureCount,
            correlationId
        });

        // Always return 200 to Meta to acknowledge receipt
        res.status(200).json({
            status: 'received',
            messagesProcessed: processedMessages.length,
            templateStatusUpdates,
            correlationId,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Error processing webhook', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
            correlationId
        });

        // Still return 200 to prevent Meta from retrying
        res.status(200).json({
            status: 'error',
            error: 'Internal processing error',
            correlationId,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Parse WhatsApp webhook payload and extract messages
 * Also handles interactive button replies and records button clicks
 */
function parseWhatsAppPayload(payload: WhatsAppWebhookPayload, correlationId: string): ProcessedMessage[] {
    const messages: ProcessedMessage[] = [];

    try {
        for (const entry of payload.entry) {
            for (const change of entry.changes) {
                // Handle delivery status updates
                if (change.field === 'messages' && change.value.statuses) {
                    for (const status of change.value.statuses) {
                        logger.info('📬 Message delivery status received', {
                            messageId: status.id,
                            status: status.status,
                            recipientId: status.recipient_id,
                            timestamp: status.timestamp,
                            errors: status.errors,
                            correlationId,
                        });
                        
                        // Update delivery status in database
                        handleMessageDeliveryStatus(status, correlationId).catch(error => {
                            logger.error('Failed to update message delivery status', {
                                messageId: status.id,
                                status: status.status,
                                error: error instanceof Error ? error.message : 'Unknown error',
                                correlationId,
                            });
                        });
                    }
                }
                
                if (change.field !== 'messages' || !change.value.messages) {
                    continue;
                }

                const { metadata } = change.value;
                const phoneNumberId = metadata.phone_number_id;

                for (const message of change.value.messages) {
                    let messageText = '';

                    // Extract text based on message type
                    switch (message.type) {
                        case 'text':
                            messageText = message.text?.body || '';
                            break;
                        case 'image':
                            messageText = '[Image received]';
                            break;
                        case 'audio':
                            messageText = message.audio?.voice ? '[Voice message]' : '[Audio file]';
                            break;
                        case 'video':
                            messageText = '[Video received]';
                            break;
                        case 'document':
                            messageText = `[Document: ${message.document?.filename || 'Unknown'}]`;
                            break;
                        case 'location':
                            messageText = `[Location: ${message.location?.name || 'Shared location'}]`;
                            break;
                        case 'contacts':
                            messageText = '[Contact shared]';
                            break;
                        case 'interactive':
                            // Handle button reply from template
                            if (message.interactive?.type === 'button_reply' && message.interactive.button_reply) {
                                const buttonReply = message.interactive.button_reply;
                                messageText = buttonReply.title;
                                
                                // Record the button click asynchronously (don't block message processing)
                                handleButtonClick({
                                    phoneNumberId,
                                    customerPhone: normalizePhoneNumber(message.from),
                                    buttonId: buttonReply.id,
                                    buttonText: buttonReply.title,
                                    messageId: message.id,
                                    originalMessageId: message.context?.id,
                                    correlationId,
                                }).catch(error => {
                                    logger.error('Failed to record button click', { error, correlationId });
                                });
                            } else if (message.interactive?.type === 'list_reply' && message.interactive.list_reply) {
                                messageText = message.interactive.list_reply.title;
                            }
                            break;
                        case 'button':
                            // Handle quick reply button (alternative format)
                            if (message.button) {
                                messageText = message.button.text;
                                
                                // Record the button click
                                handleButtonClick({
                                    phoneNumberId,
                                    customerPhone: normalizePhoneNumber(message.from),
                                    buttonId: message.button.payload,
                                    buttonText: message.button.text,
                                    messageId: message.id,
                                    originalMessageId: message.context?.id,
                                    correlationId,
                                }).catch(error => {
                                    logger.error('Failed to record button click', { error, correlationId });
                                });
                            }
                            break;
                        default:
                            messageText = `[Unsupported message type: ${message.type}]`;
                    }

                    if (messageText) {
                        messages.push({
                            message_id: message.id,
                            phone_number_id: phoneNumberId,
                            customer_phone: normalizePhoneNumber(message.from),
                            message_text: messageText,
                            timestamp: message.timestamp,
                            platform_type: 'whatsapp'
                        });

                        // Message parsed
                    }
                }
            }
        }
    } catch (error) {
        logger.error('Error parsing WhatsApp payload', {
            error: error instanceof Error ? error.message : 'Unknown error',
            correlationId
        });
    }

    return messages;
}

/**
 * Handle button click from WhatsApp webhook
 * Records the click in button_clicks table for analytics
 */
async function handleButtonClick(params: {
    phoneNumberId: string;
    customerPhone: string;
    buttonId: string;
    buttonText: string;
    messageId: string;
    originalMessageId?: string;
    correlationId: string;
}): Promise<void> {
    const { phoneNumberId, customerPhone, buttonId, buttonText, messageId, originalMessageId, correlationId } = params;

    try {
        logger.info('Processing button click', {
            phoneNumberId,
            customerPhone,
            buttonId,
            buttonText,
            correlationId,
        });

        // Get phone number details to find user_id and internal id
        const phoneResult = await db.query<{ id: string; user_id: string; waba_id: string }>(
            'SELECT id, user_id, waba_id FROM phone_numbers WHERE meta_phone_number_id = $1',
            [phoneNumberId]
        );
        
        if (phoneResult.rows.length === 0) {
            logger.warn('Phone number not found for button click', { phoneNumberId, correlationId });
            return;
        }

        const { id: internalPhoneNumberId, user_id, waba_id } = phoneResult.rows[0]!;

        // Try to find the template send that this button click relates to
        const sendContext = await findTemplateSendForButtonClick(customerPhone, buttonText, user_id);

        // Get contact_id if exists
        const contactResult = await db.query<{ contact_id: string }>(
            'SELECT contact_id FROM contacts WHERE phone = $1 AND user_id = $2',
            [customerPhone, user_id]
        );
        const contactId = contactResult.rows[0]?.contact_id;

        // Get conversation_id if exists
        const convResult = await db.query<{ conversation_id: string }>(
            `SELECT c.conversation_id FROM conversations c
             JOIN agents a ON c.agent_id = a.agent_id
             JOIN phone_numbers p ON a.phone_number_id = p.id
             WHERE c.customer_phone = $1 AND p.meta_phone_number_id = $2 AND c.is_active = true
             LIMIT 1`,
            [customerPhone, phoneNumberId]
        );
        const conversationId = convResult.rows[0]?.conversation_id;

        // Record the button click
        if (sendContext) {
            await recordButtonClick({
                click_id: uuidv4(),
                template_id: sendContext.template.template_id,
                template_send_id: sendContext.templateSend.send_id,
                button_id: buttonId,
                button_text: buttonText,
                button_payload: buttonId,
                customer_phone: customerPhone,
                contact_id: contactId,
                conversation_id: conversationId,
                waba_id: waba_id,
                phone_number_id: internalPhoneNumberId,
                user_id,
                message_id: messageId,
                original_message_id: originalMessageId || sendContext.templateSend.platform_message_id,
            });

            logger.info('Button click recorded with template context', {
                templateId: sendContext.template.template_id,
                templateName: sendContext.template.name,
                buttonText,
                customerPhone,
                correlationId,
            });
        } else {
            // Record click without template context (orphan click)
            // Try to find any template with this button - first check template_buttons table
            let templateResult = await db.query<{ template_id: string }>(
                `SELECT DISTINCT t.template_id FROM templates t
                 JOIN template_buttons tb ON tb.template_id = t.template_id
                 WHERE t.user_id = $1 
                   AND tb.button_text = $2
                 LIMIT 1`,
                [user_id, buttonText]
            );

            // Fallback: search in templates.components JSONB
            if (templateResult.rows.length === 0) {
                templateResult = await db.query<{ template_id: string }>(
                    `SELECT t.template_id FROM templates t
                     WHERE t.user_id = $1 
                       AND (
                         t.components::text LIKE $2
                         OR t.components::text LIKE $3
                       )
                     LIMIT 1`,
                    [user_id, `%"text":"${buttonText}"%`, `%"text": "${buttonText}"%`]
                );
            }

            if (templateResult.rows.length > 0) {
                await recordButtonClick({
                    click_id: uuidv4(),
                    template_id: templateResult.rows[0]!.template_id,
                    button_id: buttonId,
                    button_text: buttonText,
                    button_payload: buttonId,
                    customer_phone: customerPhone,
                    contact_id: contactId,
                    conversation_id: conversationId,
                    waba_id: waba_id,
                    phone_number_id: internalPhoneNumberId,
                    user_id,
                    message_id: messageId,
                    original_message_id: originalMessageId,
                });

                logger.info('Button click recorded (template found by button text)', {
                    templateId: templateResult.rows[0]!.template_id,
                    buttonText,
                    customerPhone,
                    correlationId,
                });
            } else {
                logger.warn('Could not find template for button click', {
                    buttonText,
                    buttonId,
                    customerPhone,
                    correlationId,
                });
            }
        }
    } catch (error) {
        logger.error('Error recording button click', {
            error: error instanceof Error ? error.message : 'Unknown error',
            phoneNumberId,
            customerPhone,
            buttonText,
            correlationId,
        });
    }
}

/**
 * Mark a contact as opted out when we receive error code 131050
 * This indicates the user has blocked marketing messages from the business
 */
async function markContactAsOptedOut(recipientPhone: string, correlationId: string): Promise<void> {
    try {
        // Normalize phone number to match our storage format
        const normalizedPhone = normalizePhoneNumber(recipientPhone);
        
        // Update all contacts with this phone number across all users
        // (A phone can exist in multiple users' contact lists)
        const result = await db.query(
            `UPDATE contacts 
             SET opted_out = true, opted_out_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE phone = $1 AND opted_out = false
             RETURNING contact_id, user_id`,
            [normalizedPhone]
        );

        if (result.rowCount && result.rowCount > 0) {
            logger.info('📵 Contact(s) marked as opted out due to error 131050', {
                phone: normalizedPhone,
                contactsUpdated: result.rowCount,
                contactIds: result.rows.map((r: { contact_id: string }) => r.contact_id),
                correlationId,
            });
        } else {
            logger.debug('No contact found to mark as opted out (may not exist in contacts table)', {
                phone: normalizedPhone,
                correlationId,
            });
        }
    } catch (error) {
        logger.error('Failed to mark contact as opted out', {
            recipientPhone,
            error: error instanceof Error ? error.message : 'Unknown error',
            correlationId,
        });
        // Don't throw - this is a non-critical operation
    }
}

/**
 * Handle message delivery status updates from WhatsApp
 * Updates the message status and template_sends status in database
 */
async function handleMessageDeliveryStatus(
    status: {
        id: string;
        status: 'sent' | 'delivered' | 'read' | 'failed';
        timestamp: string;
        recipient_id: string;
        errors?: Array<{ code: number; title: string; message: string }>;
    },
    correlationId: string
): Promise<void> {
    try {
        const { id: platformMessageId, status: deliveryStatus, errors } = status;
        
        // First, find our internal message_id using the platform_message_id
        // This is needed because message_delivery_status.message_id is FK to messages.message_id
        const messageResult = await db.query<{ message_id: string }>(
            `SELECT message_id FROM messages WHERE platform_message_id = $1`,
            [platformMessageId]
        );

        if (messageResult.rows.length > 0) {
            const internalMessageId = messageResult.rows[0]!.message_id;
            
            // Update message_delivery_status table (tracks full lifecycle: sent, delivered, read, failed)
            await db.query(
                `INSERT INTO message_delivery_status (message_id, platform_message_id, status, error_message, updated_at)
                 VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
                 ON CONFLICT (message_id) DO UPDATE SET
                    status = EXCLUDED.status,
                    error_message = EXCLUDED.error_message,
                    updated_at = CURRENT_TIMESTAMP`,
                [internalMessageId, platformMessageId, deliveryStatus, errors?.[0]?.message || null]
            );

            // Update messages table status only for states allowed by constraint ('sent', 'failed', 'pending')
            // 'delivered' and 'read' are tracked in message_delivery_status table only
            if (deliveryStatus === 'sent' || deliveryStatus === 'failed') {
                await db.query(
                    `UPDATE messages SET status = $1 WHERE message_id = $2`,
                    [deliveryStatus, internalMessageId]
                );
            }
            
            logger.debug('Message delivery status updated in database', {
                internalMessageId,
                platformMessageId,
                status: deliveryStatus,
                correlationId,
            });
        } else {
            logger.debug('Message not found in messages table, may be a template-only message', {
                platformMessageId,
                status: deliveryStatus,
                correlationId,
            });
        }

        // Update template_sends table if this is a template message
        const templateStatusMap: Record<string, string> = {
            'sent': 'SENT',
            'delivered': 'DELIVERED',
            'read': 'READ',
            'failed': 'FAILED'
        };
        
        const mappedStatus = templateStatusMap[deliveryStatus] || 'SENT';
        const errorMessage = errors?.[0]?.message || null;

        // Build dynamic update based on status
        let updateQuery: string;
        let updateParams: (string | null)[];
        
        if (deliveryStatus === 'delivered') {
            updateQuery = `UPDATE template_sends SET 
                status = $1,
                delivered_at = CURRENT_TIMESTAMP,
                error_message = $2,
                updated_at = CURRENT_TIMESTAMP
             WHERE platform_message_id = $3
             RETURNING send_id, template_id`;
            updateParams = [mappedStatus, errorMessage, platformMessageId];
        } else if (deliveryStatus === 'read') {
            updateQuery = `UPDATE template_sends SET 
                status = $1,
                read_at = CURRENT_TIMESTAMP,
                error_message = $2,
                updated_at = CURRENT_TIMESTAMP
             WHERE platform_message_id = $3
             RETURNING send_id, template_id`;
            updateParams = [mappedStatus, errorMessage, platformMessageId];
        } else {
            updateQuery = `UPDATE template_sends SET 
                status = $1,
                error_message = $2,
                updated_at = CURRENT_TIMESTAMP
             WHERE platform_message_id = $3
             RETURNING send_id, template_id`;
            updateParams = [mappedStatus, errorMessage, platformMessageId];
        }

        const templateSendUpdate = await db.query(updateQuery, updateParams);

        if (templateSendUpdate.rowCount && templateSendUpdate.rowCount > 0) {
            logger.info('Template send status updated', {
                sendId: templateSendUpdate.rows[0].send_id,
                templateId: templateSendUpdate.rows[0].template_id,
                newStatus: mappedStatus,
                correlationId,
            });
        }

        // Log specific error codes for debugging and auto-update contact opt-out status
        if (errors && errors.length > 0 && errors[0]) {
            const errorCode = errors[0].code;
            let errorHint = '';
            
            switch (errorCode) {
                case 131049:
                    errorHint = '❌ META PER-USER MARKETING LIMIT: This user has received too many marketing messages. Wait 24+ hours or use UTILITY template instead.';
                    break;
                case 131026:
                    errorHint = '❌ MESSAGE UNDELIVERABLE: Recipient may not be on WhatsApp, or hasn\'t accepted latest Terms.';
                    break;
                case 131047:
                    errorHint = '❌ 24-HOUR WINDOW EXPIRED: User hasn\'t replied in 24 hours. Only templates can be sent.';
                    break;
                case 131050:
                    errorHint = '❌ USER OPTED OUT: User has blocked marketing messages from your business.';
                    // Auto-update contact as opted out in database
                    await markContactAsOptedOut(status.recipient_id, correlationId);
                    break;
            }
            
            if (errorHint) {
                logger.warn(errorHint, {
                    correlationId,
                    platformMessageId,
                    recipientPhone: status.recipient_id,
                    errorCode,
                    errorDetails: errors[0],
                });
            }
        }
    } catch (error) {
        logger.error('Failed to handle message delivery status', {
            platformMessageId: status.id,
            status: status.status,
            error: error instanceof Error ? error.message : 'Unknown error',
            correlationId,
        });
        throw error;
    }
}

/**
 * Handle template status updates from Meta webhook
 * Maps Meta status events to our internal status values
 */
async function handleTemplateStatusUpdate(
    payload: WhatsAppWebhookPayload,
    correlationId: string
): Promise<{ processed: boolean; updates: number }> {
    let updates = 0;

    try {
        for (const entry of payload.entry) {
            const wabaId = entry.id; // WhatsApp Business Account ID
            
            for (const change of entry.changes) {
                if (change.field !== 'message_template_status_update') {
                    continue;
                }

                // Meta sends template status data directly in change.value when field is message_template_status_update
                // NOT in change.value.message_template_status_update
                const statusUpdate = (change.value as unknown as TemplateStatusUpdate);
                if (!statusUpdate || !statusUpdate.event) continue;

                // Map Meta events to our internal status
                const statusMap: Record<string, string> = {
                    'APPROVED': 'APPROVED',
                    'REJECTED': 'REJECTED',
                    'PENDING': 'PENDING',
                    'PENDING_DELETION': 'PENDING',
                    'FLAGGED': 'REJECTED',
                    'DISABLED': 'REJECTED',
                    'REINSTATED': 'APPROVED'
                };

                const internalStatus = statusMap[statusUpdate.event] || 'PENDING';

                logger.info('📋 Template status update received', {
                    templateName: statusUpdate.message_template_name,
                    templateId: statusUpdate.message_template_id,
                    event: statusUpdate.event,
                    internalStatus,
                    language: statusUpdate.message_template_language,
                    reason: statusUpdate.reason,
                    wabaId,
                    correlationId
                });

                // Update template in database using meta_template_id
                // Also set approved_at timestamp when status becomes APPROVED
                const result = await db.query(
                    `UPDATE templates 
                     SET status = $1, 
                         rejection_reason = $2,
                         approved_at = CASE WHEN $1 = 'APPROVED' THEN CURRENT_TIMESTAMP ELSE approved_at END,
                         updated_at = CURRENT_TIMESTAMP
                     WHERE meta_template_id = $3`,
                    [
                        internalStatus,
                        statusUpdate.reason || null,
                        statusUpdate.message_template_id.toString()
                    ]
                );

                if (result.rowCount && result.rowCount > 0) {
                    updates++;
                    logger.info('✅ Template status updated in database', {
                        templateId: statusUpdate.message_template_id,
                        templateName: statusUpdate.message_template_name,
                        newStatus: internalStatus,
                        correlationId
                    });
                } else {
                    // Try to find by name and WABA ID if meta_template_id not found
                    const phoneResult = await db.query(
                        `SELECT pn.id FROM phone_numbers pn 
                         WHERE pn.waba_id = $1`,
                        [wabaId]
                    );

                    if (phoneResult.rows.length > 0) {
                        const phoneNumberId = phoneResult.rows[0].id;
                        const updateResult = await db.query(
                            `UPDATE templates 
                             SET status = $1, 
                                 rejection_reason = $2,
                                 meta_template_id = $3,
                                 approved_at = CASE WHEN $1 = 'APPROVED' THEN CURRENT_TIMESTAMP ELSE approved_at END,
                                 updated_at = CURRENT_TIMESTAMP
                             WHERE name = $4 
                               AND phone_number_id = $5
                               AND language = $6`,
                            [
                                internalStatus,
                                statusUpdate.reason || null,
                                statusUpdate.message_template_id.toString(),
                                statusUpdate.message_template_name,
                                phoneNumberId,
                                statusUpdate.message_template_language
                            ]
                        );

                        if (updateResult.rowCount && updateResult.rowCount > 0) {
                            updates++;
                            logger.info('✅ Template status updated by name match', {
                                templateName: statusUpdate.message_template_name,
                                newStatus: internalStatus,
                                correlationId
                            });
                        } else {
                            logger.warn('⚠️ Template not found for status update', {
                                templateId: statusUpdate.message_template_id,
                                templateName: statusUpdate.message_template_name,
                                wabaId,
                                correlationId
                            });
                        }
                    }
                }
            }
        }

        return { processed: true, updates };
    } catch (error) {
        logger.error('Error handling template status update', {
            error: error instanceof Error ? error.message : 'Unknown error',
            correlationId
        });
        return { processed: false, updates };
    }
}

/**
 * Parse Instagram webhook payload and extract messages
 * Supports both messaging format and changes format
 */
function parseInstagramPayload(payload: InstagramWebhookPayload, correlationId: string): ProcessedMessage[] {
    const messages: ProcessedMessage[] = [];

    try {
        logger.info('📱 Parsing Instagram payload', {
            entryCount: payload.entry?.length || 0,
            correlationId
        });

        for (const entry of payload.entry) {
            const businessAccountId = entry.id;

            logger.info('📨 Processing Instagram entry', {
                entryId: entry.id,
                hasMessaging: !!entry.messaging,
                hasChanges: !!entry.changes,
                messagingCount: entry.messaging?.length || 0,
                changesCount: entry.changes?.length || 0,
                correlationId
            });

            // Format 1: Messaging array (older format)
            if (entry.messaging && entry.messaging.length > 0) {
                for (const messaging of entry.messaging) {
                    const parsedMessage = parseInstagramMessagingEvent(
                        messaging,
                        businessAccountId,
                        correlationId
                    );
                    if (parsedMessage) {
                        messages.push(parsedMessage);
                    }
                }
            }

            // Format 2: Changes array (newer format)
            if (entry.changes && entry.changes.length > 0) {
                for (const change of entry.changes) {
                    if (change.field === 'messages' && change.value) {
                        const parsedMessage = parseInstagramChangeEvent(
                            change.value,
                            businessAccountId,
                            correlationId
                        );
                        if (parsedMessage) {
                            messages.push(parsedMessage);
                        }
                    }
                }
            }

            // If neither format found, log warning
            if (!entry.messaging && !entry.changes) {
                logger.warn('⚠️ Instagram entry has neither messaging nor changes array', { 
                    entryId: entry.id,
                    entryKeys: Object.keys(entry),
                    correlationId 
                });
            }
        }
    } catch (error) {
        logger.error('Error parsing Instagram payload', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
            correlationId
        });
    }

    return messages;
}

/**
 * Parse Instagram messaging event (older format)
 */
function parseInstagramMessagingEvent(
    messaging: any,
    businessAccountId: string,
    correlationId: string
): ProcessedMessage | null {
    try {
        // Log what fields are present in the messaging object
        logger.info('🔍 Instagram messaging event fields', {
            hasMessage: !!messaging.message,
            hasMessageEdit: !!messaging.message_edit,
            hasPostback: !!messaging.postback,
            hasSender: !!messaging.sender,
            hasRecipient: !!messaging.recipient,
            allKeys: Object.keys(messaging),
            correlationId
        });

        let messageText = '';
        let messageId = '';
        let senderId = '';

        // Handle regular message
        if (messaging.message) {
            // Skip echo messages (messages sent by the bot itself)
            if (messaging.message.is_echo) {
                logger.debug('Skipping echo message', {
                    messageId: messaging.message.mid,
                    correlationId
                });
                return null;
            }

            messageId = messaging.message.mid;
            senderId = messaging.sender?.id || '';
            
            if (messaging.message.text) {
                messageText = messaging.message.text;
            } else if (messaging.message.attachments && messaging.message.attachments.length > 0) {
                const attachment = messaging.message.attachments[0];
                if (attachment) {
                    messageText = `[${attachment.type.charAt(0).toUpperCase() + attachment.type.slice(1)} received]`;
                }
            }
        } 
        // Handle message edit (Instagram sometimes sends edits for new messages)
        else if (messaging.message_edit) {
            messageId = messaging.message_edit.mid;
            senderId = messaging.sender?.id || '';
            // For edits, we need to fetch the actual message content
            // For now, just acknowledge it was edited
            messageText = '[Message edited - content not available in webhook]';
            
            logger.warn('⚠️ Received message_edit event', {
                messageId,
                numEdit: messaging.message_edit.num_edit,
                senderId,
                correlationId
            });
        }
        // Handle postback
        else if (messaging.postback) {
            messageId = uuidv4();
            senderId = messaging.sender?.id || '';
            messageText = messaging.postback.title || messaging.postback.payload;
        }

        if (messageText && messageId && senderId) {
            logger.info('✅ Instagram message parsed (messaging format)', {
                messageId,
                phoneNumberId: businessAccountId,
                customerPhone: senderId,
                messageText: messageText.substring(0, 50),
                correlationId
            });

            return {
                message_id: messageId,
                phone_number_id: businessAccountId,
                customer_phone: senderId,
                message_text: messageText,
                timestamp: messaging.timestamp.toString(),
                platform_type: 'instagram'
            };
        }

        logger.warn('⚠️ Could not parse Instagram messaging event', {
            hasMessage: !!messaging.message,
            hasMessageEdit: !!messaging.message_edit,
            hasPostback: !!messaging.postback,
            hasSender: !!messaging.sender,
            correlationId
        });

        return null;
    } catch (error) {
        logger.error('Error parsing Instagram messaging event', {
            error: error instanceof Error ? error.message : 'Unknown error',
            correlationId
        });
        return null;
    }
}

/**
 * Parse Instagram change event (newer format)
 */
function parseInstagramChangeEvent(
    value: any,
    businessAccountId: string,
    correlationId: string
): ProcessedMessage | null {
    try {
        let messageText = '';
        let messageId = '';

        if (value.message) {
            messageId = value.message.mid;
            
            if (value.message.text) {
                messageText = value.message.text;
            } else if (value.message.attachments && value.message.attachments.length > 0) {
                const attachment = value.message.attachments[0];
                if (attachment) {
                    messageText = `[${attachment.type.charAt(0).toUpperCase() + attachment.type.slice(1)} received]`;
                }
            }
        } else if (value.postback) {
            messageId = uuidv4();
            messageText = value.postback.title || value.postback.payload;
        }

        if (messageText && messageId && value.sender) {
            logger.info('✅ Instagram message parsed (changes format)', {
                messageId,
                phoneNumberId: businessAccountId,
                customerPhone: value.sender.id,
                messageText: messageText.substring(0, 50),
                correlationId
            });

            return {
                message_id: messageId,
                phone_number_id: businessAccountId,
                customer_phone: value.sender.id,
                message_text: messageText,
                timestamp: value.timestamp?.toString() || Date.now().toString(),
                platform_type: 'instagram'
            };
        }

        return null;
    } catch (error) {
        logger.error('Error parsing Instagram change event', {
            error: error instanceof Error ? error.message : 'Unknown error',
            correlationId
        });
        return null;
    }
}

/**
 * Handle webhook verification for Meta platforms
 */
export function handleWebhookVerification(req: Request, res: Response): void {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const correlationId = req.get('x-correlation-id') || 'unknown';

    logger.info('Webhook verification request received', {
        mode,
        token: token ? 'provided' : 'missing',
        challenge: challenge ? 'provided' : 'missing',
        correlationId
    });

    // Use WEBHOOK_VERIFY_TOKEN for verification (or fall back to WEBHOOK_SECRET for backward compatibility)
    const verifyToken = process.env['WEBHOOK_VERIFY_TOKEN'] || process.env['WEBHOOK_SECRET'];
    
    if (mode === 'subscribe' && token === verifyToken) {
        logger.info('Webhook verification successful', { correlationId });
        res.status(200).send(challenge);
    } else {
        logger.warn('Webhook verification failed', {
            mode,
            tokenMatch: token === verifyToken,
            correlationId
        });
        res.status(403).json({
            error: 'Forbidden',
            correlationId,
            timestamp: new Date().toISOString()
        });
    }
}