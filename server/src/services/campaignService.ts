/**
 * Campaign Service
 * Manages bulk messaging campaigns with scheduling and event-based triggers
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from '../utils/database';
import { logger } from '../utils/logger';
import { campaignsConfig } from '../config';
import { contactService } from './contactService';
import type {
    Campaign,
    CreateCampaignData,
    UpdateCampaignData,
    CampaignTrigger,
    CreateCampaignTriggerData,
    UpdateCampaignTriggerData,
    CampaignRecipient,
    CreateCampaignRecipientData,
    CampaignStatus,
    CampaignRecipientStatus,
    Contact,
} from '../models/types';

// =====================================
// Campaign CRUD
// =====================================

/**
 * Create a new campaign
 */
export async function createCampaign(data: CreateCampaignData): Promise<Campaign> {
    const result = await db.query<Campaign>(
        `INSERT INTO campaigns (
            campaign_id, user_id, template_id, phone_number_id,
            name, description, recipient_filter
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *`,
        [
            data.campaign_id,
            data.user_id,
            data.template_id,
            data.phone_number_id,
            data.name,
            data.description,
            JSON.stringify(data.recipient_filter || {}),
        ]
    );

    logger.info('Campaign created', {
        campaignId: data.campaign_id,
        userId: data.user_id,
        name: data.name,
    });

    return result.rows[0]!;
}

/**
 * Get campaign by ID
 */
export async function getCampaignById(campaignId: string): Promise<Campaign | null> {
    const result = await db.query<Campaign>(
        'SELECT * FROM campaigns WHERE campaign_id = $1',
        [campaignId]
    );
    return result.rows[0] || null;
}

/**
 * Get campaigns by user ID
 */
export async function getCampaignsByUserId(
    userId: string,
    options?: { status?: CampaignStatus; limit?: number; offset?: number }
): Promise<{ campaigns: Campaign[]; total: number }> {
    let countQuery = 'SELECT COUNT(*) FROM campaigns WHERE user_id = $1';
    let query = 'SELECT * FROM campaigns WHERE user_id = $1';
    const params: unknown[] = [userId];
    let paramIndex = 2;

    if (options?.status) {
        countQuery += ` AND status = $${paramIndex}`;
        query += ` AND status = $${paramIndex}`;
        params.push(options.status);
        paramIndex++;
    }

    query += ' ORDER BY created_at DESC';

    if (options?.limit) {
        query += ` LIMIT $${paramIndex}`;
        params.push(options.limit);
        paramIndex++;
    }

    if (options?.offset) {
        query += ` OFFSET $${paramIndex}`;
        params.push(options.offset);
    }

    const countParams = options?.status ? [userId, options.status] : [userId];
    const [countResult, dataResult] = await Promise.all([
        db.query<{ count: string }>(countQuery, countParams),
        db.query<Campaign>(query, params),
    ]);

    return {
        campaigns: dataResult.rows,
        total: parseInt(countResult.rows[0]?.count || '0', 10),
    };
}

/**
 * Get all campaigns (admin)
 */
export async function getAllCampaigns(options?: {
    limit?: number;
    offset?: number;
    status?: CampaignStatus;
    userId?: string;
}): Promise<{ campaigns: Campaign[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (options?.status) {
        conditions.push(`status = $${paramIndex}`);
        params.push(options.status);
        paramIndex++;
    }

    if (options?.userId) {
        conditions.push(`user_id = $${paramIndex}`);
        params.push(options.userId);
        paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await db.query<{ count: string }>(
        `SELECT COUNT(*) FROM campaigns ${whereClause}`,
        params.slice(0, conditions.length)
    );

    let query = `SELECT * FROM campaigns ${whereClause} ORDER BY created_at DESC`;

    if (options?.limit) {
        query += ` LIMIT $${paramIndex}`;
        params.push(options.limit);
        paramIndex++;
    }

    if (options?.offset) {
        query += ` OFFSET $${paramIndex}`;
        params.push(options.offset);
    }

    const dataResult = await db.query<Campaign>(query, params);

    return {
        campaigns: dataResult.rows,
        total: parseInt(countResult.rows[0]?.count || '0', 10),
    };
}

/**
 * Update campaign
 */
export async function updateCampaign(campaignId: string, data: UpdateCampaignData): Promise<Campaign | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
            fields.push(`${key} = $${paramIndex}`);
            values.push(key === 'recipient_filter' ? JSON.stringify(value) : value);
            paramIndex++;
        }
    }

    if (fields.length === 0) {
        return getCampaignById(campaignId);
    }

    values.push(campaignId);

    const result = await db.query<Campaign>(
        `UPDATE campaigns SET ${fields.join(', ')} WHERE campaign_id = $${paramIndex} RETURNING *`,
        values
    );

    return result.rows[0] || null;
}

/**
 * Delete campaign
 */
export async function deleteCampaign(campaignId: string): Promise<boolean> {
    const result = await db.query(
        'DELETE FROM campaigns WHERE campaign_id = $1',
        [campaignId]
    );
    return (result.rowCount ?? 0) > 0;
}

// =====================================
// Campaign Lifecycle
// =====================================

/**
 * Start a campaign
 */
export async function startCampaign(campaignId: string): Promise<Campaign> {
    const campaign = await getCampaignById(campaignId);
    if (!campaign) {
        throw new Error('Campaign not found');
    }

    if (!['DRAFT', 'SCHEDULED', 'PAUSED'].includes(campaign.status)) {
        throw new Error(`Cannot start campaign with status ${campaign.status}`);
    }

    // Get recipients based on filter
    const contacts = await contactService.getContactsForCampaign(
        campaign.user_id,
        campaign.recipient_filter
    );

    if (contacts.length === 0) {
        throw new Error('No eligible recipients found for this campaign');
    }

    if (contacts.length > campaignsConfig.maxRecipientsPerCampaign) {
        throw new Error(`Too many recipients (${contacts.length}). Maximum allowed: ${campaignsConfig.maxRecipientsPerCampaign}`);
    }

    // Create recipient records
    await createRecipientsFromContacts(campaignId, contacts);

    // Update campaign status
    const updated = await updateCampaign(campaignId, {
        status: 'RUNNING',
        total_recipients: contacts.length,
        started_at: new Date(),
    });

    logger.info('Campaign started', {
        campaignId,
        totalRecipients: contacts.length,
    });

    return updated!;
}

/**
 * Start a campaign with specific contact IDs (used by external API)
 * This skips the filter-based recipient lookup
 * @param contactVariablesMap - Optional map of contactId to variable values
 */
export async function startCampaignWithContactIds(
    campaignId: string,
    contactIds: string[],
    contactVariablesMap?: Record<string, Record<string, string>>
): Promise<Campaign> {
    const campaign = await getCampaignById(campaignId);
    if (!campaign) {
        throw new Error('Campaign not found');
    }

    if (!['DRAFT', 'SCHEDULED'].includes(campaign.status)) {
        throw new Error(`Cannot start campaign with status ${campaign.status}`);
    }

    // Get contacts by IDs
    const contacts = await contactService.getContactsByIds(contactIds);
    
    // Filter out inactive or opted-out contacts
    const eligibleContacts = contacts.filter(c => c.is_active && !c.opted_out);

    if (eligibleContacts.length === 0) {
        throw new Error('No eligible recipients found');
    }

    // Create recipient records with per-contact variables
    await createRecipientsFromContactsWithVariables(campaignId, eligibleContacts, contactVariablesMap);

    // Update campaign status
    const updated = await updateCampaign(campaignId, {
        status: 'RUNNING',
        total_recipients: eligibleContacts.length,
        started_at: new Date(),
    });

    logger.info('Campaign started with contact IDs', {
        campaignId,
        totalRecipients: eligibleContacts.length,
        providedContacts: contactIds.length,
    });

    return updated!;
}

/**
 * Pause a running campaign
 */
export async function pauseCampaign(campaignId: string): Promise<Campaign> {
    const campaign = await getCampaignById(campaignId);
    if (!campaign) {
        throw new Error('Campaign not found');
    }

    if (campaign.status !== 'RUNNING') {
        throw new Error(`Cannot pause campaign with status ${campaign.status}`);
    }

    const updated = await updateCampaign(campaignId, {
        status: 'PAUSED',
        paused_at: new Date(),
    });

    logger.info('Campaign paused', { campaignId });

    return updated!;
}

/**
 * Resume a paused campaign
 */
export async function resumeCampaign(campaignId: string): Promise<Campaign> {
    const campaign = await getCampaignById(campaignId);
    if (!campaign) {
        throw new Error('Campaign not found');
    }

    if (campaign.status !== 'PAUSED') {
        throw new Error(`Cannot resume campaign with status ${campaign.status}`);
    }

    const updated = await updateCampaign(campaignId, {
        status: 'RUNNING',
        paused_at: undefined,
    });

    logger.info('Campaign resumed', { campaignId });

    return updated!;
}

/**
 * Cancel a campaign
 */
export async function cancelCampaign(campaignId: string): Promise<Campaign> {
    const campaign = await getCampaignById(campaignId);
    if (!campaign) {
        throw new Error('Campaign not found');
    }

    if (['COMPLETED', 'CANCELLED'].includes(campaign.status)) {
        throw new Error(`Cannot cancel campaign with status ${campaign.status}`);
    }

    const updated = await updateCampaign(campaignId, {
        status: 'CANCELLED',
        completed_at: new Date(),
    });

    logger.info('Campaign cancelled', { campaignId });

    return updated!;
}

/**
 * Mark campaign as completed
 */
export async function completeCampaign(campaignId: string): Promise<Campaign> {
    const updated = await updateCampaign(campaignId, {
        status: 'COMPLETED',
        completed_at: new Date(),
    });

    logger.info('Campaign completed', { campaignId });

    return updated!;
}

/**
 * Mark campaign as failed
 */
export async function failCampaign(campaignId: string, error: string): Promise<Campaign> {
    const updated = await updateCampaign(campaignId, {
        status: 'FAILED',
        completed_at: new Date(),
        last_error: error,
    });

    logger.error('Campaign failed', { campaignId, error });

    return updated!;
}

// =====================================
// Campaign Triggers
// =====================================

/**
 * Create campaign trigger
 */
export async function createTrigger(data: CreateCampaignTriggerData): Promise<CampaignTrigger> {
    const result = await db.query<CampaignTrigger>(
        `INSERT INTO campaign_triggers (
            trigger_id, campaign_id, trigger_type, scheduled_at,
            event_type, event_config
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *`,
        [
            data.trigger_id,
            data.campaign_id,
            data.trigger_type,
            data.scheduled_at,
            data.event_type,
            JSON.stringify(data.event_config || {}),
        ]
    );

    logger.info('Campaign trigger created', {
        triggerId: data.trigger_id,
        campaignId: data.campaign_id,
        triggerType: data.trigger_type,
    });

    return result.rows[0]!;
}

/**
 * Get triggers for campaign
 */
export async function getTriggersByCampaignId(campaignId: string): Promise<CampaignTrigger[]> {
    const result = await db.query<CampaignTrigger>(
        'SELECT * FROM campaign_triggers WHERE campaign_id = $1 ORDER BY created_at',
        [campaignId]
    );
    return result.rows;
}

/**
 * Get active triggers by event type
 */
export async function getActiveTriggersByEventType(eventType: string): Promise<CampaignTrigger[]> {
    const result = await db.query<CampaignTrigger>(
        `SELECT ct.* FROM campaign_triggers ct
         JOIN campaigns c ON ct.campaign_id = c.campaign_id
         WHERE ct.trigger_type = 'EVENT' 
         AND ct.event_type = $1 
         AND ct.is_active = true
         AND c.status IN ('SCHEDULED', 'RUNNING')`,
        [eventType]
    );
    return result.rows;
}

/**
 * Get scheduled triggers ready to run
 */
export async function getReadyScheduledTriggers(): Promise<CampaignTrigger[]> {
    const result = await db.query<CampaignTrigger>(
        `SELECT ct.* FROM campaign_triggers ct
         JOIN campaigns c ON ct.campaign_id = c.campaign_id
         WHERE ct.trigger_type = 'SCHEDULED'
         AND ct.scheduled_at <= CURRENT_TIMESTAMP
         AND ct.is_active = true
         AND c.status = 'SCHEDULED'`,
        []
    );
    return result.rows;
}

/**
 * Update trigger
 */
export async function updateTrigger(triggerId: string, data: UpdateCampaignTriggerData): Promise<CampaignTrigger | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
            fields.push(`${key} = $${paramIndex}`);
            values.push(key === 'event_config' ? JSON.stringify(value) : value);
            paramIndex++;
        }
    }

    if (fields.length === 0) {
        return null;
    }

    values.push(triggerId);

    const result = await db.query<CampaignTrigger>(
        `UPDATE campaign_triggers SET ${fields.join(', ')} WHERE trigger_id = $${paramIndex} RETURNING *`,
        values
    );

    return result.rows[0] || null;
}

/**
 * Mark trigger as executed
 */
export async function markTriggerExecuted(triggerId: string): Promise<CampaignTrigger | null> {
    const result = await db.query<CampaignTrigger>(
        `UPDATE campaign_triggers 
         SET last_triggered_at = CURRENT_TIMESTAMP, trigger_count = trigger_count + 1
         WHERE trigger_id = $1
         RETURNING *`,
        [triggerId]
    );
    return result.rows[0] || null;
}

/**
 * Delete trigger
 */
export async function deleteTrigger(triggerId: string): Promise<boolean> {
    const result = await db.query(
        'DELETE FROM campaign_triggers WHERE trigger_id = $1',
        [triggerId]
    );
    return (result.rowCount ?? 0) > 0;
}

// =====================================
// Campaign Recipients
// =====================================

/**
 * Create recipient record
 */
export async function createRecipient(data: CreateCampaignRecipientData): Promise<CampaignRecipient> {
    const result = await db.query<CampaignRecipient>(
        `INSERT INTO campaign_recipients (recipient_id, campaign_id, contact_id, variable_values)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (campaign_id, contact_id) DO NOTHING
         RETURNING *`,
        [data.recipient_id, data.campaign_id, data.contact_id, JSON.stringify(data.variable_values || {})]
    );
    return result.rows[0]!;
}

/**
 * Create recipients from contacts list
 */
async function createRecipientsFromContacts(campaignId: string, contacts: Contact[]): Promise<number> {
    let created = 0;

    for (const contact of contacts) {
        try {
            await createRecipient({
                recipient_id: uuidv4(),
                campaign_id: campaignId,
                contact_id: contact.contact_id,
            });
            created++;
        } catch {
            // Ignore duplicates
        }
    }

    return created;
}

/**
 * Create recipients from contacts list with per-contact variable values
 */
async function createRecipientsFromContactsWithVariables(
    campaignId: string, 
    contacts: Contact[],
    contactVariablesMap?: Record<string, Record<string, string>>
): Promise<number> {
    let created = 0;

    for (const contact of contacts) {
        try {
            const variableValues = contactVariablesMap?.[contact.contact_id] || {};
            await createRecipient({
                recipient_id: uuidv4(),
                campaign_id: campaignId,
                contact_id: contact.contact_id,
                variable_values: variableValues,
            });
            created++;
        } catch {
            // Ignore duplicates
        }
    }

    return created;
}

/**
 * Get pending recipients for campaign and atomically mark them as QUEUED
 * This prevents duplicate processing when worker runs multiple times
 */
export async function getPendingRecipients(
    campaignId: string,
    limit: number = campaignsConfig.batchSize
): Promise<Array<CampaignRecipient & { contact: Contact }>> {
    // Use a CTE to atomically claim recipients by marking them as QUEUED
    // FOR UPDATE SKIP LOCKED prevents race conditions
    const result = await db.query<CampaignRecipient & Contact>(
        `WITH claimed AS (
            UPDATE campaign_recipients
            SET status = 'QUEUED', queued_at = CURRENT_TIMESTAMP
            WHERE recipient_id IN (
                SELECT cr.recipient_id
                FROM campaign_recipients cr
                JOIN contacts c ON cr.contact_id = c.contact_id
                WHERE cr.campaign_id = $1 
                AND cr.status = 'PENDING'
                AND c.is_active = true
                AND c.opted_out = false
                ORDER BY cr.created_at
                LIMIT $2
                FOR UPDATE OF cr SKIP LOCKED
            )
            RETURNING *
        )
        SELECT claimed.*, c.phone, c.name, c.email, c.company, c.tags, 
               c.opted_out, c.is_active
        FROM claimed
        JOIN contacts c ON claimed.contact_id = c.contact_id`,
        [campaignId, limit]
    );

    return result.rows.map(row => ({
        recipient_id: row.recipient_id,
        campaign_id: row.campaign_id,
        contact_id: row.contact_id,
        template_send_id: row.template_send_id,
        status: row.status,
        skip_reason: row.skip_reason,
        error_message: row.error_message,
        variable_values: row.variable_values,  // Include per-recipient variables
        queued_at: row.queued_at,
        sent_at: row.sent_at,
        delivered_at: row.delivered_at,
        read_at: row.read_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        contact: {
            contact_id: row.contact_id,
            user_id: '', // Not selected
            phone: row.phone,
            name: row.name,
            email: row.email,
            company: row.company,
            tags: row.tags,
            source: 'MANUAL' as const,
            is_active: row.is_active,
            opted_out: row.opted_out,
            total_messages_sent: 0,
            total_messages_received: 0,
            created_at: row.created_at,
            updated_at: row.updated_at,
        },
    }));
}

/**
 * Update recipient status
 */
export async function updateRecipientStatus(
    recipientId: string,
    status: CampaignRecipientStatus,
    extra?: {
        template_send_id?: string;
        skip_reason?: string;
        error_message?: string;
    }
): Promise<CampaignRecipient | null> {
    const updates: string[] = ['status = $2'];
    const params: unknown[] = [recipientId, status];
    let paramIndex = 3;

    if (extra?.template_send_id) {
        updates.push(`template_send_id = $${paramIndex}`);
        params.push(extra.template_send_id);
        paramIndex++;
    }

    if (extra?.skip_reason) {
        updates.push(`skip_reason = $${paramIndex}`);
        params.push(extra.skip_reason);
        paramIndex++;
    }

    if (extra?.error_message) {
        updates.push(`error_message = $${paramIndex}`);
        params.push(extra.error_message);
        paramIndex++;
    }

    // Add timestamp based on status
    if (status === 'QUEUED') {
        updates.push('queued_at = CURRENT_TIMESTAMP');
    } else if (status === 'SENT') {
        updates.push('sent_at = CURRENT_TIMESTAMP');
    } else if (status === 'DELIVERED') {
        updates.push('delivered_at = CURRENT_TIMESTAMP');
    } else if (status === 'READ') {
        updates.push('read_at = CURRENT_TIMESTAMP');
    }

    const result = await db.query<CampaignRecipient>(
        `UPDATE campaign_recipients SET ${updates.join(', ')} WHERE recipient_id = $1 RETURNING *`,
        params
    );

    return result.rows[0] || null;
}

/**
 * Get recipient by contact and campaign
 */
export async function getRecipientByContactAndCampaign(
    campaignId: string,
    contactId: string
): Promise<CampaignRecipient | null> {
    const result = await db.query<CampaignRecipient>(
        `SELECT * FROM campaign_recipients WHERE campaign_id = $1 AND contact_id = $2`,
        [campaignId, contactId]
    );
    return result.rows[0] || null;
}

/**
 * Get recipient stats for campaign
 */
export async function getRecipientStats(campaignId: string): Promise<{
    total: number;
    pending: number;
    queued: number;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    skipped: number;
}> {
    const result = await db.query<{
        total: string;
        pending: string;
        queued: string;
        sent: string;
        delivered: string;
        read: string;
        failed: string;
        skipped: string;
    }>(
        `SELECT 
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'PENDING') as pending,
            COUNT(*) FILTER (WHERE status = 'QUEUED') as queued,
            COUNT(*) FILTER (WHERE status = 'SENT') as sent,
            COUNT(*) FILTER (WHERE status = 'DELIVERED') as delivered,
            COUNT(*) FILTER (WHERE status = 'READ') as read,
            COUNT(*) FILTER (WHERE status = 'FAILED') as failed,
            COUNT(*) FILTER (WHERE status = 'SKIPPED') as skipped
         FROM campaign_recipients 
         WHERE campaign_id = $1`,
        [campaignId]
    );

    const row = result.rows[0]!;
    return {
        total: parseInt(row.total, 10),
        pending: parseInt(row.pending, 10),
        queued: parseInt(row.queued, 10),
        sent: parseInt(row.sent, 10),
        delivered: parseInt(row.delivered, 10),
        read: parseInt(row.read, 10),
        failed: parseInt(row.failed, 10),
        skipped: parseInt(row.skipped, 10),
    };
}

/**
 * Update campaign stats from recipients
 */
export async function syncCampaignStats(campaignId: string): Promise<Campaign | null> {
    const stats = await getRecipientStats(campaignId);

    return updateCampaign(campaignId, {
        sent_count: stats.sent + stats.delivered + stats.read,
        delivered_count: stats.delivered + stats.read,
        read_count: stats.read,
        failed_count: stats.failed,
    });
}

/**
 * Check if campaign is complete
 */
export async function checkCampaignComplete(campaignId: string): Promise<boolean> {
    const stats = await getRecipientStats(campaignId);
    return stats.pending === 0 && stats.queued === 0;
}

export const campaignService = {
    // Campaign CRUD
    createCampaign,
    getCampaignById,
    getCampaignsByUserId,
    getAllCampaigns,
    updateCampaign,
    deleteCampaign,
    // Campaign lifecycle
    startCampaign,
    startCampaignWithContactIds,
    pauseCampaign,
    resumeCampaign,
    cancelCampaign,
    completeCampaign,
    failCampaign,
    // Triggers
    createTrigger,
    getTriggersByCampaignId,
    getActiveTriggersByEventType,
    getReadyScheduledTriggers,
    updateTrigger,
    markTriggerExecuted,
    deleteTrigger,
    // Recipients
    createRecipient,
    getPendingRecipients,
    updateRecipientStatus,
    getRecipientByContactAndCampaign,
    getRecipientStats,
    getCampaignRecipientStats: getRecipientStats, // Alias for external API
    syncCampaignStats,
    checkCampaignComplete,
};
