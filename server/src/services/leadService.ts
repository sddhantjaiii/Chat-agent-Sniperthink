/**
 * Lead Service
 * Aggregates leads from conversations and template_sends
 * Each unique customer_phone is treated as a separate lead
 */

import { db } from '../utils/database';
import { logger } from '../utils/logger';

// ============================================================
// Types
// ============================================================

export interface LeadFilter {
    platform?: string[];           // ['whatsapp', 'instagram', 'webchat']
    agent_id?: string;
    phone_number_id?: string;
    has_extraction?: boolean;
    lead_status?: string[];        // ['Hot', 'Warm', 'Cold']
    min_total_score?: number;
    max_total_score?: number;
    has_email?: boolean;
    has_conversation?: boolean;
    is_active?: boolean;           // conversation active status
    start_date?: string;           // ISO date
    end_date?: string;             // ISO date
    date?: string;                 // specific date
    days?: number;                 // last N days
    search?: string;               // search in name, email, company, phone
    customer_phone?: string;       // exact match
}

export interface LeadSortOptions {
    sort_by?: 'last_message_at' | 'created_at' | 'total_score' | 'name' | 'total_messages';
    sort_order?: 'asc' | 'desc';
}

export interface PaginationOptions {
    limit?: number;
    offset?: number;
}

export interface Lead {
    customer_phone: string;
    name: string | null;
    email: string | null;
    company: string | null;
    lead_status: string | null;
    total_score: number | null;
    intent_score: number | null;
    urgency_score: number | null;
    budget_score: number | null;
    fit_score: number | null;
    engagement_score: number | null;
    platforms: string[];
    conversation_count: number;
    total_messages: number;
    template_sends_count: number;
    last_message_at: Date | null;
    last_message_text: string | null;
    last_message_sender: string | null;
    first_contact_at: Date;
    has_extraction: boolean;
    extraction_id: string | null;
    conversations: ConversationSummary[];
}

export interface ConversationSummary {
    conversation_id: string;
    agent_id: string;
    agent_name: string;
    platform: string;
    phone_number_id: string;
    message_count: number;
    is_active: boolean;
    created_at: Date;
    last_message_at: Date;
}

export interface LeadsResponse {
    leads: Lead[];
    pagination: {
        total: number;
        limit: number;
        offset: number;
        hasMore: boolean;
    };
}

export interface LeadMessagesFilter {
    platform?: string[];
    conversation_id?: string;
    sender?: 'user' | 'agent';
    start_date?: string;
    end_date?: string;
    date?: string;
    days?: number;
}

export interface LeadMessage {
    message_id: string;
    conversation_id: string;
    agent_id: string;
    agent_name: string;
    platform: string;
    phone_number_id: string;
    sender: 'user' | 'agent';
    text: string;
    timestamp: Date;
    status: string;
    sequence_no: number;
}

export interface LeadMessagesResponse {
    customer_phone: string;
    lead_info: {
        name: string | null;
        email: string | null;
        company: string | null;
        lead_status: string | null;
        total_score: number | null;
    };
    messages: LeadMessage[];
    pagination: {
        total: number;
        limit: number;
        offset: number;
        hasMore: boolean;
    };
}

// ============================================================
// Lead Service Functions
// ============================================================

/**
 * Get all leads for a user with filtering, sorting, and pagination
 */
export async function getLeads(
    userId: string,
    filter: LeadFilter = {},
    sort: LeadSortOptions = {},
    pagination: PaginationOptions = {}
): Promise<LeadsResponse> {
    const correlationId = `get-leads-${userId}-${Date.now()}`;
    
    try {
        const limit = Math.min(pagination.limit || 50, 100);
        const offset = pagination.offset || 0;
        const sortBy = sort.sort_by || 'last_message_at';
        const sortOrder = sort.sort_order?.toUpperCase() || 'DESC';

        // Build the main query using CTE for better performance
        // This aggregates from conversations and optionally includes template-only recipients
        
        let query = `
            WITH conversation_leads AS (
                -- Get leads from conversations
                SELECT DISTINCT ON (c.customer_phone)
                    c.customer_phone,
                    c.customer_phone as lead_identifier,
                    'conversation' as source,
                    c.created_at as first_contact_at,
                    c.last_message_at,
                    c.conversation_id,
                    c.agent_id,
                    c.is_active,
                    a.phone_number_id,
                    pn.platform
                FROM conversations c
                JOIN agents a ON c.agent_id = a.agent_id
                JOIN phone_numbers pn ON a.phone_number_id = pn.id
                WHERE a.user_id = $1
                ORDER BY c.customer_phone, c.last_message_at DESC
            ),
            template_only_leads AS (
                -- Get leads who only received templates (no conversation)
                SELECT DISTINCT ON (ts.customer_phone)
                    ts.customer_phone,
                    ts.customer_phone as lead_identifier,
                    'template' as source,
                    ts.created_at as first_contact_at,
                    ts.sent_at as last_message_at,
                    NULL::varchar as conversation_id,
                    NULL::varchar as agent_id,
                    false as is_active,
                    t.phone_number_id,
                    pn.platform
                FROM template_sends ts
                JOIN templates t ON ts.template_id = t.template_id
                JOIN phone_numbers pn ON t.phone_number_id = pn.id
                WHERE t.user_id = $1
                AND NOT EXISTS (
                    SELECT 1 FROM conversations c2
                    JOIN agents a2 ON c2.agent_id = a2.agent_id
                    WHERE a2.user_id = $1 AND c2.customer_phone = ts.customer_phone
                )
                ORDER BY ts.customer_phone, ts.sent_at DESC
            ),
            all_leads AS (
                SELECT * FROM conversation_leads
                UNION ALL
                SELECT * FROM template_only_leads
            ),
            lead_aggregates AS (
                SELECT 
                    al.customer_phone,
                    MIN(al.first_contact_at) as first_contact_at,
                    MAX(al.last_message_at) as last_message_at,
                    array_agg(DISTINCT al.platform) FILTER (WHERE al.platform IS NOT NULL) as platforms,
                    COUNT(DISTINCT c.conversation_id) as conversation_count,
                    COALESCE(SUM(msg_counts.message_count), 0) as total_messages,
                    (
                        SELECT COUNT(*) FROM template_sends ts2
                        JOIN templates t2 ON ts2.template_id = t2.template_id
                        WHERE t2.user_id = $1 AND ts2.customer_phone = al.customer_phone
                    ) as template_sends_count
                FROM all_leads al
                LEFT JOIN conversations c ON c.customer_phone = al.customer_phone
                    AND EXISTS (
                        SELECT 1 FROM agents a3 WHERE a3.agent_id = c.agent_id AND a3.user_id = $1
                    )
                LEFT JOIN LATERAL (
                    SELECT COUNT(*) as message_count
                    FROM messages m WHERE m.conversation_id = c.conversation_id
                ) msg_counts ON true
                GROUP BY al.customer_phone
            ),
            lead_extractions AS (
                SELECT DISTINCT ON (e.customer_phone)
                    e.customer_phone,
                    e.extraction_id,
                    e.name,
                    e.email,
                    e.company,
                    e.lead_status_tag,
                    e.total_score,
                    e.intent_score,
                    e.urgency_score,
                    e.budget_score,
                    e.fit_score,
                    e.engagement_score
                FROM extractions e
                WHERE e.user_id = $1 AND e.is_latest = true
                ORDER BY e.customer_phone, e.extracted_at DESC
            ),
            lead_last_message AS (
                SELECT DISTINCT ON (c.customer_phone)
                    c.customer_phone,
                    m.text as last_message_text,
                    m.sender as last_message_sender
                FROM conversations c
                JOIN agents a ON c.agent_id = a.agent_id
                JOIN messages m ON m.conversation_id = c.conversation_id
                WHERE a.user_id = $1
                ORDER BY c.customer_phone, m.timestamp DESC
            ),
            contact_info AS (
                SELECT DISTINCT ON (ct.phone)
                    ct.phone as customer_phone,
                    ct.name as contact_name,
                    ct.email as contact_email,
                    ct.company as contact_company
                FROM contacts ct
                WHERE ct.user_id = $1
                ORDER BY ct.phone, ct.updated_at DESC
            )
            SELECT 
                la.customer_phone,
                COALESCE(le.name, ci.contact_name) as name,
                COALESCE(le.email, ci.contact_email) as email,
                COALESCE(le.company, ci.contact_company) as company,
                le.lead_status_tag as lead_status,
                le.total_score,
                le.intent_score,
                le.urgency_score,
                le.budget_score,
                le.fit_score,
                le.engagement_score,
                la.platforms,
                la.conversation_count,
                la.total_messages,
                la.template_sends_count,
                la.last_message_at,
                llm.last_message_text,
                llm.last_message_sender,
                la.first_contact_at,
                (le.extraction_id IS NOT NULL) as has_extraction,
                le.extraction_id
            FROM lead_aggregates la
            LEFT JOIN lead_extractions le ON le.customer_phone = la.customer_phone
            LEFT JOIN lead_last_message llm ON llm.customer_phone = la.customer_phone
            LEFT JOIN contact_info ci ON ci.customer_phone = la.customer_phone
            WHERE 1=1
        `;

        const queryParams: any[] = [userId];
        let paramIndex = 2;

        // Apply filters
        if (filter.platform && filter.platform.length > 0) {
            query += ` AND la.platforms::text[] && $${paramIndex}::text[]`;
            queryParams.push(filter.platform);
            paramIndex++;
        }

        if (filter.has_extraction !== undefined) {
            if (filter.has_extraction) {
                query += ` AND le.extraction_id IS NOT NULL`;
            } else {
                query += ` AND le.extraction_id IS NULL`;
            }
        }

        if (filter.lead_status && filter.lead_status.length > 0) {
            query += ` AND le.lead_status_tag = ANY($${paramIndex})`;
            queryParams.push(filter.lead_status);
            paramIndex++;
        }

        if (filter.min_total_score !== undefined) {
            query += ` AND le.total_score >= $${paramIndex}`;
            queryParams.push(filter.min_total_score);
            paramIndex++;
        }

        if (filter.max_total_score !== undefined) {
            query += ` AND le.total_score <= $${paramIndex}`;
            queryParams.push(filter.max_total_score);
            paramIndex++;
        }

        if (filter.has_email !== undefined) {
            if (filter.has_email) {
                query += ` AND (le.email IS NOT NULL AND le.email != '' OR ci.contact_email IS NOT NULL AND ci.contact_email != '')`;
            } else {
                query += ` AND (le.email IS NULL OR le.email = '') AND (ci.contact_email IS NULL OR ci.contact_email = '')`;
            }
        }

        if (filter.has_conversation !== undefined) {
            if (filter.has_conversation) {
                query += ` AND la.conversation_count > 0`;
            } else {
                query += ` AND la.conversation_count = 0`;
            }
        }

        if (filter.customer_phone) {
            query += ` AND la.customer_phone = $${paramIndex}`;
            queryParams.push(filter.customer_phone);
            paramIndex++;
        }

        if (filter.search) {
            const searchPattern = `%${filter.search}%`;
            query += ` AND (
                la.customer_phone ILIKE $${paramIndex}
                OR COALESCE(le.name, ci.contact_name) ILIKE $${paramIndex}
                OR COALESCE(le.email, ci.contact_email) ILIKE $${paramIndex}
                OR COALESCE(le.company, ci.contact_company) ILIKE $${paramIndex}
            )`;
            queryParams.push(searchPattern);
            paramIndex++;
        }

        // Date filters
        if (filter.date) {
            query += ` AND DATE(la.last_message_at) = $${paramIndex}`;
            queryParams.push(filter.date);
            paramIndex++;
        } else if (filter.days) {
            query += ` AND la.last_message_at >= NOW() - INTERVAL '${parseInt(String(filter.days))} days'`;
        } else {
            if (filter.start_date) {
                query += ` AND la.last_message_at >= $${paramIndex}`;
                queryParams.push(filter.start_date);
                paramIndex++;
            }
            if (filter.end_date) {
                query += ` AND la.last_message_at <= $${paramIndex}`;
                queryParams.push(filter.end_date);
                paramIndex++;
            }
        }

        // Get total count before pagination
        const countQuery = `SELECT COUNT(*) as total FROM (${query}) as leads_count`;
        const countResult = await db.query(countQuery, queryParams);
        const total = parseInt(countResult.rows[0]?.total || '0', 10);

        // Add sorting
        const sortColumnMap: Record<string, string> = {
            'last_message_at': 'la.last_message_at',
            'created_at': 'la.first_contact_at',
            'total_score': 'le.total_score',
            'name': 'COALESCE(le.name, ci.contact_name)',
            'total_messages': 'la.total_messages'
        };
        const sortColumn = sortColumnMap[sortBy] || 'la.last_message_at';
        query += ` ORDER BY ${sortColumn} ${sortOrder} NULLS LAST`;

        // Add pagination
        query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        queryParams.push(limit, offset);

        // Execute main query
        const result = await db.query(query, queryParams);

        // Get conversation details for each lead
        const leads: Lead[] = [];
        for (const row of result.rows) {
            const conversations = await getLeadConversations(userId, row.customer_phone);
            
            leads.push({
                customer_phone: row.customer_phone,
                name: row.name,
                email: row.email,
                company: row.company,
                lead_status: row.lead_status,
                total_score: row.total_score ? parseInt(row.total_score) : null,
                intent_score: row.intent_score ? parseInt(row.intent_score) : null,
                urgency_score: row.urgency_score ? parseInt(row.urgency_score) : null,
                budget_score: row.budget_score ? parseInt(row.budget_score) : null,
                fit_score: row.fit_score ? parseInt(row.fit_score) : null,
                engagement_score: row.engagement_score ? parseInt(row.engagement_score) : null,
                platforms: row.platforms || [],
                conversation_count: parseInt(row.conversation_count) || 0,
                total_messages: parseInt(row.total_messages) || 0,
                template_sends_count: parseInt(row.template_sends_count) || 0,
                last_message_at: row.last_message_at,
                last_message_text: row.last_message_text,
                last_message_sender: row.last_message_sender,
                first_contact_at: row.first_contact_at,
                has_extraction: row.has_extraction,
                extraction_id: row.extraction_id,
                conversations
            });
        }

        logger.info('Leads retrieved successfully', {
            correlationId,
            userId,
            count: leads.length,
            total,
            filters: filter
        });

        return {
            leads,
            pagination: {
                total,
                limit,
                offset,
                hasMore: offset + leads.length < total
            }
        };

    } catch (error) {
        logger.error('Failed to get leads', {
            correlationId,
            userId,
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
        });
        throw error;
    }
}

/**
 * Get conversation summaries for a lead
 */
async function getLeadConversations(userId: string, customerPhone: string): Promise<ConversationSummary[]> {
    const query = `
        SELECT 
            c.conversation_id,
            c.agent_id,
            a.name as agent_name,
            pn.platform,
            a.phone_number_id,
            c.is_active,
            c.created_at,
            c.last_message_at,
            (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.conversation_id) as message_count
        FROM conversations c
        JOIN agents a ON c.agent_id = a.agent_id
        JOIN phone_numbers pn ON a.phone_number_id = pn.id
        WHERE a.user_id = $1 AND c.customer_phone = $2
        ORDER BY c.last_message_at DESC
    `;

    const result = await db.query(query, [userId, customerPhone]);

    return result.rows.map(row => ({
        conversation_id: row.conversation_id,
        agent_id: row.agent_id,
        agent_name: row.agent_name,
        platform: row.platform,
        phone_number_id: row.phone_number_id,
        message_count: parseInt(row.message_count) || 0,
        is_active: row.is_active,
        created_at: row.created_at,
        last_message_at: row.last_message_at
    }));
}

/**
 * Get a single lead by customer phone
 */
export async function getLeadByPhone(
    userId: string,
    customerPhone: string
): Promise<Lead | null> {
    const result = await getLeads(userId, { customer_phone: customerPhone });
    return result.leads[0] || null;
}

/**
 * Get all messages for a lead across all conversations
 */
export async function getLeadMessages(
    userId: string,
    customerPhone: string,
    filter: LeadMessagesFilter = {},
    pagination: PaginationOptions = {}
): Promise<LeadMessagesResponse> {
    const correlationId = `get-lead-messages-${userId}-${customerPhone}-${Date.now()}`;

    try {
        const limit = Math.min(pagination.limit || 50, 200);
        const offset = pagination.offset || 0;

        // First, get lead info
        const lead = await getLeadByPhone(userId, customerPhone);

        // Build messages query
        let query = `
            SELECT 
                m.message_id,
                m.conversation_id,
                c.agent_id,
                a.name as agent_name,
                pn.platform,
                a.phone_number_id,
                m.sender,
                m.text,
                m.timestamp,
                m.status,
                m.sequence_no
            FROM messages m
            JOIN conversations c ON m.conversation_id = c.conversation_id
            JOIN agents a ON c.agent_id = a.agent_id
            JOIN phone_numbers pn ON a.phone_number_id = pn.id
            WHERE a.user_id = $1 AND c.customer_phone = $2
        `;

        const queryParams: any[] = [userId, customerPhone];
        let paramIndex = 3;

        // Apply filters
        if (filter.platform && filter.platform.length > 0) {
            query += ` AND pn.platform = ANY($${paramIndex})`;
            queryParams.push(filter.platform);
            paramIndex++;
        }

        if (filter.conversation_id) {
            query += ` AND c.conversation_id = $${paramIndex}`;
            queryParams.push(filter.conversation_id);
            paramIndex++;
        }

        if (filter.sender) {
            query += ` AND m.sender = $${paramIndex}`;
            queryParams.push(filter.sender);
            paramIndex++;
        }

        // Date filters
        if (filter.date) {
            query += ` AND DATE(m.timestamp) = $${paramIndex}`;
            queryParams.push(filter.date);
            paramIndex++;
        } else if (filter.days) {
            query += ` AND m.timestamp >= NOW() - INTERVAL '${parseInt(String(filter.days))} days'`;
        } else {
            if (filter.start_date) {
                query += ` AND m.timestamp >= $${paramIndex}`;
                queryParams.push(filter.start_date);
                paramIndex++;
            }
            if (filter.end_date) {
                query += ` AND m.timestamp <= $${paramIndex}`;
                queryParams.push(filter.end_date);
                paramIndex++;
            }
        }

        // Get total count
        const countQuery = `SELECT COUNT(*) as total FROM (${query}) as msgs_count`;
        const countResult = await db.query(countQuery, queryParams);
        const total = parseInt(countResult.rows[0]?.total || '0', 10);

        // Add sorting and pagination
        query += ` ORDER BY m.timestamp ASC`;
        query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        queryParams.push(limit, offset);

        // Execute query
        const result = await db.query(query, queryParams);

        const messages: LeadMessage[] = result.rows.map(row => ({
            message_id: row.message_id,
            conversation_id: row.conversation_id,
            agent_id: row.agent_id,
            agent_name: row.agent_name,
            platform: row.platform,
            phone_number_id: row.phone_number_id,
            sender: row.sender,
            text: row.text,
            timestamp: row.timestamp,
            status: row.status,
            sequence_no: row.sequence_no
        }));

        logger.info('Lead messages retrieved successfully', {
            correlationId,
            userId,
            customerPhone,
            count: messages.length,
            total
        });

        return {
            customer_phone: customerPhone,
            lead_info: {
                name: lead?.name || null,
                email: lead?.email || null,
                company: lead?.company || null,
                lead_status: lead?.lead_status || null,
                total_score: lead?.total_score || null
            },
            messages,
            pagination: {
                total,
                limit,
                offset,
                hasMore: offset + messages.length < total
            }
        };

    } catch (error) {
        logger.error('Failed to get lead messages', {
            correlationId,
            userId,
            customerPhone,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        throw error;
    }
}

/**
 * Get lead statistics for a user
 */
export async function getLeadStats(userId: string): Promise<{
    total_leads: number;
    leads_with_extraction: number;
    hot_leads: number;
    warm_leads: number;
    cold_leads: number;
    by_platform: Record<string, number>;
    leads_last_7_days: number;
    leads_last_30_days: number;
}> {
    const correlationId = `get-lead-stats-${userId}-${Date.now()}`;

    try {
        // Get total leads
        const totalResult = await getLeads(userId, {}, {}, { limit: 1 });
        const total_leads = totalResult.pagination.total;

        // Get leads with extraction
        const extractionResult = await getLeads(userId, { has_extraction: true }, {}, { limit: 1 });
        const leads_with_extraction = extractionResult.pagination.total;

        // Get by lead status
        const hotResult = await getLeads(userId, { lead_status: ['Hot'] }, {}, { limit: 1 });
        const warmResult = await getLeads(userId, { lead_status: ['Warm'] }, {}, { limit: 1 });
        const coldResult = await getLeads(userId, { lead_status: ['Cold'] }, {}, { limit: 1 });

        // Get by platform
        const whatsappResult = await getLeads(userId, { platform: ['whatsapp'] }, {}, { limit: 1 });
        const instagramResult = await getLeads(userId, { platform: ['instagram'] }, {}, { limit: 1 });
        const webchatResult = await getLeads(userId, { platform: ['webchat'] }, {}, { limit: 1 });

        // Get recent leads
        const last7DaysResult = await getLeads(userId, { days: 7 }, {}, { limit: 1 });
        const last30DaysResult = await getLeads(userId, { days: 30 }, {}, { limit: 1 });

        return {
            total_leads,
            leads_with_extraction,
            hot_leads: hotResult.pagination.total,
            warm_leads: warmResult.pagination.total,
            cold_leads: coldResult.pagination.total,
            by_platform: {
                whatsapp: whatsappResult.pagination.total,
                instagram: instagramResult.pagination.total,
                webchat: webchatResult.pagination.total
            },
            leads_last_7_days: last7DaysResult.pagination.total,
            leads_last_30_days: last30DaysResult.pagination.total
        };

    } catch (error) {
        logger.error('Failed to get lead stats', {
            correlationId,
            userId,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        throw error;
    }
}
