/**
 * Contact Service
 * Manages contacts with auto-sync from extractions and E.164 phone formatting
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from '../utils/database';
import { logger } from '../utils/logger';
import { toE164 } from '../utils/phoneFormatter';
import { appEventEmitter } from '../utils/eventEmitter';
import type {
    Contact,
    CreateContactData,
    UpdateContactData,
    ContactFilter,
} from '../models/types';

/**
 * Create a new contact
 */
export async function createContact(data: CreateContactData): Promise<Contact> {
    // Format phone to E.164
    const formattedPhone = toE164(data.phone);
    if (!formattedPhone) {
        throw new Error(`Invalid phone number format: ${data.phone}`);
    }

    const result = await db.query<Contact>(
        `INSERT INTO contacts (
            contact_id, user_id, phone, name, email, company,
            tags, source, extraction_id, conversation_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (user_id, phone) 
        DO UPDATE SET 
            name = COALESCE(EXCLUDED.name, contacts.name),
            email = COALESCE(EXCLUDED.email, contacts.email),
            company = COALESCE(EXCLUDED.company, contacts.company),
            extraction_id = COALESCE(EXCLUDED.extraction_id, contacts.extraction_id),
            conversation_id = COALESCE(EXCLUDED.conversation_id, contacts.conversation_id),
            updated_at = CURRENT_TIMESTAMP
        RETURNING *`,
        [
            data.contact_id,
            data.user_id,
            formattedPhone,
            data.name,
            data.email,
            data.company,
            data.tags || [],
            data.source || 'MANUAL',
            data.extraction_id,
            data.conversation_id,
        ]
    );

    logger.info('Contact created/updated', {
        contactId: result.rows[0]!.contact_id,
        userId: data.user_id,
        phone: formattedPhone,
    });

    return result.rows[0]!;
}

/**
 * Sync contact from extraction data
 */
export async function syncFromExtraction(
    userId: string,
    extractionId: string,
    conversationId: string,
    customerPhone: string,
    extractionData: {
        name?: string;
        email?: string;
        company?: string;
        lead_status_tag?: string;
    }
): Promise<Contact> {
    const formattedPhone = toE164(customerPhone);
    if (!formattedPhone) {
        throw new Error(`Invalid phone number for extraction sync: ${customerPhone}`);
    }

    // Check if contact exists
    const existing = await getContactByPhone(userId, formattedPhone);

    if (existing) {
        // Update existing contact
        const updated = await updateContact(existing.contact_id, {
            name: extractionData.name || existing.name,
            email: extractionData.email || existing.email,
            company: extractionData.company || existing.company,
        });

        logger.info('Contact synced from extraction (updated)', {
            contactId: existing.contact_id,
            extractionId,
        });

        return updated!;
    }

    // Create new contact
    const contact = await createContact({
        contact_id: uuidv4(),
        user_id: userId,
        phone: formattedPhone,
        name: extractionData.name,
        email: extractionData.email,
        company: extractionData.company,
        source: 'EXTRACTION',
        extraction_id: extractionId,
        conversation_id: conversationId,
    });

    logger.info('Contact synced from extraction (created)', {
        contactId: contact.contact_id,
        extractionId,
    });

    return contact;
}

/**
 * Get contact by ID
 */
export async function getContactById(contactId: string): Promise<Contact | null> {
    const result = await db.query<Contact>(
        'SELECT * FROM contacts WHERE contact_id = $1',
        [contactId]
    );
    return result.rows[0] || null;
}

/**
 * Get contact by phone (for a specific user)
 */
export async function getContactByPhone(userId: string, phone: string): Promise<Contact | null> {
    const formattedPhone = toE164(phone);
    if (!formattedPhone) {
        return null;
    }

    const result = await db.query<Contact>(
        'SELECT * FROM contacts WHERE user_id = $1 AND phone = $2',
        [userId, formattedPhone]
    );
    return result.rows[0] || null;
}

/**
 * Get contacts for user with optional filtering
 */
export async function getContactsByUserId(
    userId: string,
    filter?: ContactFilter,
    options?: { limit?: number; offset?: number }
): Promise<{ contacts: Contact[]; total: number }> {
    const conditions: string[] = ['user_id = $1'];
    const params: unknown[] = [userId];
    let paramIndex = 2;

    if (filter?.isActive !== undefined) {
        conditions.push(`is_active = $${paramIndex}`);
        params.push(filter.isActive);
        paramIndex++;
    }

    if (filter?.optedOut !== undefined) {
        conditions.push(`opted_out = $${paramIndex}`);
        params.push(filter.optedOut);
        paramIndex++;
    }

    if (filter?.source) {
        conditions.push(`source = $${paramIndex}`);
        params.push(filter.source);
        paramIndex++;
    }

    if (filter?.tags && filter.tags.length > 0) {
        conditions.push(`tags && $${paramIndex}`);
        params.push(filter.tags);
        paramIndex++;
    }

    if (filter?.excludeTags && filter.excludeTags.length > 0) {
        conditions.push(`NOT (tags && $${paramIndex})`);
        params.push(filter.excludeTags);
        paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const countResult = await db.query<{ count: string }>(
        `SELECT COUNT(*) FROM contacts WHERE ${whereClause}`,
        params
    );

    let query = `SELECT * FROM contacts WHERE ${whereClause} ORDER BY created_at DESC`;
    const queryParams = [...params];

    if (options?.limit) {
        query += ` LIMIT $${paramIndex}`;
        queryParams.push(options.limit);
        paramIndex++;
    }

    if (options?.offset) {
        query += ` OFFSET $${paramIndex}`;
        queryParams.push(options.offset);
        paramIndex++;
    }

    const result = await db.query<Contact>(query, queryParams);

    return {
        contacts: result.rows,
        total: parseInt(countResult.rows[0]?.count || '0', 10),
    };
}

/**
 * Get all contacts (admin)
 */
export async function getAllContacts(options?: {
    limit?: number;
    offset?: number;
    userId?: string;
}): Promise<{ contacts: Contact[]; total: number }> {
    let countQuery = 'SELECT COUNT(*) FROM contacts';
    let query = 'SELECT * FROM contacts';
    const params: unknown[] = [];
    let paramIndex = 1;

    if (options?.userId) {
        const whereClause = ` WHERE user_id = $${paramIndex}`;
        countQuery += whereClause;
        query += whereClause;
        params.push(options.userId);
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

    const [countResult, dataResult] = await Promise.all([
        db.query<{ count: string }>(countQuery, options?.userId ? [options.userId] : []),
        db.query<Contact>(query, params),
    ]);

    return {
        contacts: dataResult.rows,
        total: parseInt(countResult.rows[0]?.count || '0', 10),
    };
}

/**
 * Update contact
 */
export async function updateContact(contactId: string, data: UpdateContactData): Promise<Contact | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
            fields.push(`${key} = $${paramIndex}`);
            values.push(value);
            paramIndex++;
        }
    }

    if (fields.length === 0) {
        return getContactById(contactId);
    }

    values.push(contactId);

    const result = await db.query<Contact>(
        `UPDATE contacts SET ${fields.join(', ')} WHERE contact_id = $${paramIndex} RETURNING *`,
        values
    );

    return result.rows[0] || null;
}

/**
 * Delete contact
 */
export async function deleteContact(contactId: string): Promise<boolean> {
    const result = await db.query(
        'DELETE FROM contacts WHERE contact_id = $1',
        [contactId]
    );
    return (result.rowCount ?? 0) > 0;
}

/**
 * Add tags to contact
 */
export async function addTags(contactId: string, tags: string[]): Promise<Contact | null> {
    const contact = await getContactById(contactId);
    if (!contact) {
        return null;
    }

    const result = await db.query<Contact>(
        `UPDATE contacts 
         SET tags = array_cat(tags, $2::text[])
         WHERE contact_id = $1
         RETURNING *`,
        [contactId, tags.filter(t => !contact.tags.includes(t))]
    );

    const updatedContact = result.rows[0];
    if (!updatedContact) {
        return null;
    }

    // Emit events for campaign triggers
    for (const tag of tags) {
        if (!contact.tags.includes(tag)) {
            appEventEmitter.emitContactTagAdded({
                contactId,
                userId: updatedContact.user_id,
                tag,
                customerPhone: updatedContact.phone,
            });
        }
    }

    return updatedContact;
}

/**
 * Remove tags from contact
 */
export async function removeTags(contactId: string, tags: string[]): Promise<Contact | null> {
    const result = await db.query<Contact>(
        `UPDATE contacts 
         SET tags = array_remove(tags, unnest($2::text[]))
         WHERE contact_id = $1
         RETURNING *`,
        [contactId, tags]
    );

    // Alternative approach if above doesn't work in all PostgreSQL versions
    if (!result.rows[0]) {
        const contact = await getContactById(contactId);
        if (!contact) return null;

        const newTags = contact.tags.filter(t => !tags.includes(t));
        return updateContact(contactId, { tags: newTags });
    }

    return result.rows[0];
}

/**
 * Import contacts from CSV data
 */
export async function importFromCSV(
    userId: string,
    csvData: Array<{
        phone: string;
        name?: string;
        email?: string;
        company?: string;
        tags?: string;
    }>,
    defaultTags?: string[]
): Promise<{
    imported: number;
    skipped: number;
    errors: Array<{ row: number; phone: string; error: string }>;
}> {
    const result = {
        imported: 0,
        skipped: 0,
        errors: [] as Array<{ row: number; phone: string; error: string }>,
    };

    for (let i = 0; i < csvData.length; i++) {
        const row = csvData[i]!;
        const rowNum = i + 1;

        try {
            // Format phone
            const formattedPhone = toE164(row.phone);
            if (!formattedPhone) {
                result.errors.push({ row: rowNum, phone: row.phone, error: 'Invalid phone format' });
                result.skipped++;
                continue;
            }

            // Parse tags from CSV (comma-separated)
            let tags = defaultTags || [];
            if (row.tags) {
                const rowTags = row.tags.split(',').map(t => t.trim()).filter(Boolean);
                tags = [...new Set([...tags, ...rowTags])];
            }

            await createContact({
                contact_id: uuidv4(),
                user_id: userId,
                phone: formattedPhone,
                name: row.name?.trim(),
                email: row.email?.trim(),
                company: row.company?.trim(),
                tags,
                source: 'IMPORT',
            });

            result.imported++;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            result.errors.push({ row: rowNum, phone: row.phone, error: errorMessage });
            result.skipped++;
        }
    }

    logger.info('CSV import completed', {
        userId,
        imported: result.imported,
        skipped: result.skipped,
        errors: result.errors.length,
    });

    return result;
}

/**
 * Get contacts by tag
 */
export async function getContactsByTag(userId: string, tag: string): Promise<Contact[]> {
    const result = await db.query<Contact>(
        `SELECT * FROM contacts 
         WHERE user_id = $1 AND $2 = ANY(tags) AND is_active = true AND opted_out = false
         ORDER BY created_at DESC`,
        [userId, tag]
    );
    return result.rows;
}

/**
 * Mark contact as opted out
 */
export async function optOut(contactId: string): Promise<Contact | null> {
    const result = await db.query<Contact>(
        `UPDATE contacts 
         SET opted_out = true, opted_out_at = CURRENT_TIMESTAMP
         WHERE contact_id = $1
         RETURNING *`,
        [contactId]
    );
    return result.rows[0] || null;
}

/**
 * Update contact messaging stats
 */
export async function updateMessagingStats(
    contactId: string,
    type: 'sent' | 'received'
): Promise<void> {
    const field = type === 'sent' ? 'total_messages_sent' : 'total_messages_received';
    
    await db.query(
        `UPDATE contacts 
         SET ${field} = ${field} + 1, 
             last_contacted_at = CASE WHEN $2 = 'sent' THEN CURRENT_TIMESTAMP ELSE last_contacted_at END
         WHERE contact_id = $1`,
        [contactId, type]
    );
}

/**
 * Get contacts for campaign recipients
 * Supports both tag-based and contactIds-based filtering
 */
export async function getContactsForCampaign(
    userId: string,
    filter: ContactFilter & { contactIds?: string[] }
): Promise<Contact[]> {
    const conditions: string[] = [
        'user_id = $1',
        'is_active = true',
        'opted_out = false',
    ];
    const params: unknown[] = [userId];
    let paramIndex = 2;

    // If contactIds are specified, use them directly
    if (filter.contactIds && filter.contactIds.length > 0) {
        conditions.push(`contact_id = ANY($${paramIndex})`);
        params.push(filter.contactIds);
        paramIndex++;
    }

    if (filter.tags && filter.tags.length > 0) {
        conditions.push(`tags && $${paramIndex}`);
        params.push(filter.tags);
        paramIndex++;
    }

    if (filter.excludeTags && filter.excludeTags.length > 0) {
        conditions.push(`NOT (tags && $${paramIndex})`);
        params.push(filter.excludeTags);
        paramIndex++;
    }

    const result = await db.query<Contact>(
        `SELECT * FROM contacts WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
        params
    );

    return result.rows;
}

/**
 * Get contacts by their IDs
 */
export async function getContactsByIds(contactIds: string[]): Promise<Contact[]> {
    if (contactIds.length === 0) return [];
    
    const result = await db.query<Contact>(
        'SELECT * FROM contacts WHERE contact_id = ANY($1)',
        [contactIds]
    );
    
    return result.rows;
}

export const contactService = {
    createContact,
    syncFromExtraction,
    getContactById,
    getContactByPhone,
    getContactsByUserId,
    getContactsByIds,
    getAllContacts,
    updateContact,
    deleteContact,
    addTags,
    removeTags,
    importFromCSV,
    getContactsByTag,
    optOut,
    updateMessagingStats,
    getContactsForCampaign,
};
