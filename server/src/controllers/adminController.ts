/**
 * Admin Controller
 * Full CRUD operations for super admin panel
 */

import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../utils/database';
import { logger } from '../utils/logger';
import { UserService } from '../services/userService';
import { AgentService } from '../services/agentService';
import { templateService } from '../services/templateService';
import { contactService } from '../services/contactService';
import { campaignService } from '../services/campaignService';
import { rateLimitService } from '../services/rateLimitService';
import type {
    User,
    PhoneNumberWithRateLimit,
    Agent,
    Conversation,
    Message,
    DashboardStats,
    TemplateComponents,
} from '../models/types';

// Initialize services with database pool
const userService = new UserService(db.pool);
const agentService = new AgentService(db.pool);

// Helper to get correlation ID
const getCorrelationId = (req: Request): string =>
    (req.headers['x-correlation-id'] as string) || uuidv4();

// =====================================
// Dashboard & Analytics
// =====================================

/**
 * GET /admin/dashboard
 * Get dashboard statistics
 */
export async function getDashboardStats(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);

    try {
        const [
            usersResult,
            phoneNumbersResult,
            agentsResult,
            conversationsResult,
            messagesResult,
            templatesResult,
            contactsResult,
            campaignsResult,
        ] = await Promise.all([
            db.query<{ count: string }>('SELECT COUNT(*) FROM users'),
            db.query<{ count: string }>('SELECT COUNT(*) FROM phone_numbers'),
            db.query<{ count: string }>('SELECT COUNT(*) FROM agents'),
            db.query<{ count: string; active: string }>(
                `SELECT COUNT(*) as count, 
                 COUNT(*) FILTER (WHERE is_active = true) as active 
                 FROM conversations`
            ),
            db.query<{ count: string }>('SELECT COUNT(*) FROM messages'),
            db.query<{ count: string; approved: string }>(
                `SELECT COUNT(*) as count,
                 COUNT(*) FILTER (WHERE status = 'APPROVED') as approved
                 FROM templates`
            ),
            db.query<{ count: string }>('SELECT COUNT(*) FROM contacts'),
            db.query<{ count: string; running: string }>(
                `SELECT COUNT(*) as count,
                 COUNT(*) FILTER (WHERE status = 'RUNNING') as running
                 FROM campaigns`
            ),
        ]);

        const stats: DashboardStats = {
            totalUsers: parseInt(usersResult.rows[0]?.count || '0', 10),
            totalPhoneNumbers: parseInt(phoneNumbersResult.rows[0]?.count || '0', 10),
            totalAgents: parseInt(agentsResult.rows[0]?.count || '0', 10),
            totalConversations: parseInt(conversationsResult.rows[0]?.count || '0', 10),
            totalMessages: parseInt(messagesResult.rows[0]?.count || '0', 10),
            totalTemplates: parseInt(templatesResult.rows[0]?.count || '0', 10),
            totalContacts: parseInt(contactsResult.rows[0]?.count || '0', 10),
            totalCampaigns: parseInt(campaignsResult.rows[0]?.count || '0', 10),
            activeConversations: parseInt(conversationsResult.rows[0]?.active || '0', 10),
            approvedTemplates: parseInt(templatesResult.rows[0]?.approved || '0', 10),
            runningCampaigns: parseInt(campaignsResult.rows[0]?.running || '0', 10),
        };

        res.status(200).json({
            success: true,
            data: stats,
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to get dashboard stats', { correlationId, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to get dashboard statistics',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

/**
 * GET /admin/rate-limits
 * Get rate limit stats for all phone numbers
 */
export async function getRateLimitStats(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);

    try {
        const stats = await rateLimitService.getAllStats();

        res.status(200).json({
            success: true,
            data: stats,
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to get rate limit stats', { correlationId, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to get rate limit statistics',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

/**
 * WhatsApp conversation analytics response from Meta API
 */
interface WhatsAppConversationAnalytics {
    business_initiated: number;
    user_initiated: number;
    referral_conversion: number;
    start: number;
    end: number;
}

/**
 * Meta Graph API analytics response structure
 */
interface MetaAnalyticsResponse {
    analytics?: {
        data_points?: WhatsAppConversationAnalytics[];
        phone_numbers?: string[];
    };
    id?: string;
    error?: {
        message: string;
        type: string;
        code: number;
    };
}

/**
 * Tier limits for WhatsApp Business API
 */
const WHATSAPP_TIER_LIMITS: Record<string, number> = {
    'TIER_1': 1000,
    'TIER_2': 10000,
    'TIER_3': 100000,
    'TIER_4': Infinity,
    'UNLIMITED': Infinity,
};

/**
 * GET /admin/phone-numbers/:phoneNumberId/conversation-analytics
 * Get WhatsApp business-initiated conversation usage and remaining limit
 * 
 * Queries Meta's Graph API to get real-time conversation analytics
 * for a specific phone number in a rolling 24-hour period.
 */
export async function getConversationAnalytics(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { phoneNumberId } = req.params;

    try {
        // Get phone number details including WABA ID and access token
        const phoneResult = await db.query<{
            id: string;
            meta_phone_number_id: string;
            waba_id: string | null;
            access_token: string;
            platform: string;
            display_name: string;
            daily_message_limit: number | null;
            tier: string | null;
        }>(
            `SELECT id, meta_phone_number_id, waba_id, access_token, platform, display_name, daily_message_limit, tier
             FROM phone_numbers WHERE id = $1`,
            [phoneNumberId]
        );

        if (phoneResult.rows.length === 0) {
            res.status(404).json({
                error: 'Not Found',
                message: 'Phone number not found',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        const phoneNumber = phoneResult.rows[0]!;

        // Only WhatsApp phone numbers have conversation analytics
        if (phoneNumber.platform !== 'whatsapp') {
            res.status(400).json({
                error: 'Bad Request',
                message: 'Conversation analytics are only available for WhatsApp phone numbers',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        // Check if WABA ID is configured
        if (!phoneNumber.waba_id) {
            res.status(400).json({
                error: 'Configuration Error',
                message: 'WABA ID (WhatsApp Business Account ID) is not configured for this phone number. Please update the phone number with the WABA ID.',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        // Calculate rolling 24-hour window (Unix timestamps)
        const now = new Date();
        const end = Math.floor(now.getTime() / 1000);
        const start = end - (24 * 60 * 60); // 24 hours ago

        // Query Meta Graph API for conversation analytics
        const analyticsUrl = new URL(`https://graph.facebook.com/v24.0/${phoneNumber.waba_id}`);
        analyticsUrl.searchParams.set('fields', 
            `analytics.start(${start}).end(${end}).granularity(DAY).phone_numbers([${phoneNumber.meta_phone_number_id}]).metric_types([CONVERSATION])`
        );

        logger.info('Fetching WhatsApp conversation analytics from Meta', {
            correlationId,
            phoneNumberId,
            wabaId: phoneNumber.waba_id,
            metaPhoneNumberId: phoneNumber.meta_phone_number_id,
            startTimestamp: start,
            endTimestamp: end,
        });

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        try {
            const response = await fetch(analyticsUrl.toString(), {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${phoneNumber.access_token}`,
                    'Content-Type': 'application/json',
                },
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            const responseText = await response.text();
            let data: MetaAnalyticsResponse;
            
            try {
                data = JSON.parse(responseText);
            } catch {
                logger.error('Failed to parse Meta analytics response', {
                    correlationId,
                    responseText: responseText.substring(0, 500),
                });
                throw new Error('Invalid response from Meta API');
            }

            if (!response.ok || data.error) {
                logger.error('Meta Analytics API error', {
                    correlationId,
                    statusCode: response.status,
                    error: data.error,
                });

                res.status(response.status === 401 ? 401 : 502).json({
                    error: response.status === 401 ? 'Unauthorized' : 'Meta API Error',
                    message: data.error?.message || 'Failed to fetch analytics from Meta',
                    meta_error_code: data.error?.code,
                    timestamp: new Date().toISOString(),
                    correlationId,
                });
                return;
            }

            // Extract analytics data
            const dataPoints = data.analytics?.data_points || [];
            const latestData = dataPoints[dataPoints.length - 1] || {
                business_initiated: 0,
                user_initiated: 0,
                referral_conversion: 0,
                start,
                end,
            };

            // Get tier limit
            const tier = phoneNumber.tier || 'TIER_1';
            const tierLimit = phoneNumber.daily_message_limit || WHATSAPP_TIER_LIMITS[tier] || 1000;
            const remaining = Math.max(0, tierLimit - latestData.business_initiated);

            const analyticsResponse = {
                phone_number_id: phoneNumber.id,
                meta_phone_number_id: phoneNumber.meta_phone_number_id,
                waba_id: phoneNumber.waba_id,
                display_name: phoneNumber.display_name,
                platform: phoneNumber.platform,
                tier,
                tier_limit: tierLimit === Infinity ? 'unlimited' : tierLimit,
                period: {
                    start: new Date(start * 1000).toISOString(),
                    end: new Date(end * 1000).toISOString(),
                    duration_hours: 24,
                },
                conversations: {
                    business_initiated: latestData.business_initiated,
                    user_initiated: latestData.user_initiated,
                    referral_conversion: latestData.referral_conversion || 0,
                    total: latestData.business_initiated + latestData.user_initiated,
                },
                limits: {
                    business_initiated_limit: tierLimit === Infinity ? 'unlimited' : tierLimit,
                    business_initiated_used: latestData.business_initiated,
                    business_initiated_remaining: tierLimit === Infinity ? 'unlimited' : remaining,
                    usage_percentage: tierLimit === Infinity ? 0 : Math.round((latestData.business_initiated / tierLimit) * 100),
                },
                raw_data_points: dataPoints,
            };

            logger.info('WhatsApp conversation analytics fetched successfully', {
                correlationId,
                phoneNumberId,
                businessInitiated: latestData.business_initiated,
                remaining,
                tier,
            });

            res.status(200).json({
                success: true,
                data: analyticsResponse,
                timestamp: new Date().toISOString(),
                correlationId,
            });

        } catch (fetchError) {
            clearTimeout(timeoutId);

            if (fetchError instanceof Error && fetchError.name === 'AbortError') {
                logger.error('Meta Analytics API timeout', { correlationId, phoneNumberId });
                res.status(504).json({
                    error: 'Gateway Timeout',
                    message: 'Meta API request timed out after 15 seconds',
                    timestamp: new Date().toISOString(),
                    correlationId,
                });
                return;
            }

            throw fetchError;
        }

    } catch (error) {
        logger.error('Failed to get conversation analytics', { correlationId, phoneNumberId, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to get conversation analytics',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

/**
 * GET /admin/conversation-analytics
 * Get conversation analytics for all WhatsApp phone numbers
 * 
 * Returns aggregated and per-phone-number conversation usage
 */
export async function getAllConversationAnalytics(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { userId } = req.query;

    try {
        // Get all WhatsApp phone numbers (optionally filtered by user)
        let query = `
            SELECT id, meta_phone_number_id, waba_id, access_token, platform, display_name, 
                   daily_message_limit, tier, user_id
            FROM phone_numbers 
            WHERE platform = 'whatsapp' AND waba_id IS NOT NULL
        `;
        const params: string[] = [];

        if (userId) {
            query += ' AND user_id = $1';
            params.push(userId as string);
        }

        query += ' ORDER BY created_at DESC';

        const phoneResult = await db.query<{
            id: string;
            meta_phone_number_id: string;
            waba_id: string;
            access_token: string;
            platform: string;
            display_name: string;
            daily_message_limit: number | null;
            tier: string | null;
            user_id: string;
        }>(query, params);

        if (phoneResult.rows.length === 0) {
            res.status(200).json({
                success: true,
                data: {
                    phone_numbers: [],
                    summary: {
                        total_phone_numbers: 0,
                        total_business_initiated: 0,
                        total_user_initiated: 0,
                    },
                },
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        // Calculate rolling 24-hour window
        const now = new Date();
        const end = Math.floor(now.getTime() / 1000);
        const start = end - (24 * 60 * 60);

        // Fetch analytics for each phone number in parallel (with rate limiting)
        const analyticsResults = await Promise.allSettled(
            phoneResult.rows.map(async (phone) => {
                const analyticsUrl = new URL(`https://graph.facebook.com/v24.0/${phone.waba_id}`);
                analyticsUrl.searchParams.set('fields',
                    `analytics.start(${start}).end(${end}).granularity(DAY).phone_numbers([${phone.meta_phone_number_id}]).metric_types([CONVERSATION])`
                );

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000);

                try {
                    const response = await fetch(analyticsUrl.toString(), {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${phone.access_token}`,
                        },
                        signal: controller.signal,
                    });

                    clearTimeout(timeoutId);

                    if (!response.ok) {
                        return {
                            phone_number_id: phone.id,
                            display_name: phone.display_name,
                            user_id: phone.user_id,
                            error: `Meta API returned ${response.status}`,
                            status: 'error' as const,
                        };
                    }

                    const data = (await response.json()) as MetaAnalyticsResponse;
                    const dataPoints = data.analytics?.data_points || [];
                    const latestData = dataPoints[dataPoints.length - 1] || {
                        business_initiated: 0,
                        user_initiated: 0,
                    };

                    const tier = phone.tier || 'TIER_1';
                    const tierLimit = phone.daily_message_limit || WHATSAPP_TIER_LIMITS[tier] || 1000;
                    const remaining = Math.max(0, tierLimit - latestData.business_initiated);

                    return {
                        phone_number_id: phone.id,
                        meta_phone_number_id: phone.meta_phone_number_id,
                        display_name: phone.display_name,
                        user_id: phone.user_id,
                        tier,
                        tier_limit: tierLimit === Infinity ? 'unlimited' : tierLimit,
                        business_initiated: latestData.business_initiated,
                        user_initiated: latestData.user_initiated,
                        remaining: tierLimit === Infinity ? 'unlimited' : remaining,
                        usage_percentage: tierLimit === Infinity ? 0 : Math.round((latestData.business_initiated / tierLimit) * 100),
                        status: 'success' as const,
                    };
                } catch (err) {
                    clearTimeout(timeoutId);
                    return {
                        phone_number_id: phone.id,
                        display_name: phone.display_name,
                        user_id: phone.user_id,
                        error: err instanceof Error ? err.message : 'Unknown error',
                        status: 'error' as const,
                    };
                }
            })
        );

        // Process results
        const phoneAnalytics = analyticsResults.map((result, index) => {
            if (result.status === 'fulfilled') {
                return result.value;
            }
            const phone = phoneResult.rows[index]!;
            return {
                phone_number_id: phone.id,
                display_name: phone.display_name,
                user_id: phone.user_id,
                error: result.reason?.message || 'Failed to fetch',
                status: 'error' as const,
            };
        });

        // Calculate summary
        const successfulResults = phoneAnalytics.filter(p => p.status === 'success');
        const summary = {
            total_phone_numbers: phoneResult.rows.length,
            successful_fetches: successfulResults.length,
            failed_fetches: phoneResult.rows.length - successfulResults.length,
            total_business_initiated: successfulResults.reduce((sum, p) => sum + ((p as any).business_initiated || 0), 0),
            total_user_initiated: successfulResults.reduce((sum, p) => sum + ((p as any).user_initiated || 0), 0),
            period: {
                start: new Date(start * 1000).toISOString(),
                end: new Date(end * 1000).toISOString(),
            },
        };

        logger.info('All conversation analytics fetched', {
            correlationId,
            totalPhones: phoneResult.rows.length,
            successful: successfulResults.length,
        });

        res.status(200).json({
            success: true,
            data: {
                phone_numbers: phoneAnalytics,
                summary,
            },
            timestamp: new Date().toISOString(),
            correlationId,
        });

    } catch (error) {
        logger.error('Failed to get all conversation analytics', { correlationId, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to get conversation analytics',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// =====================================
// Users
// =====================================

/**
 * GET /admin/users
 * List all users
 */
export async function listUsers(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;

    try {
        const [countResult, dataResult] = await Promise.all([
            db.query<{ count: string }>('SELECT COUNT(*) FROM users'),
            db.query<User>(
                'SELECT * FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2',
                [limit, offset]
            ),
        ]);

        res.status(200).json({
            success: true,
            data: dataResult.rows,
            pagination: {
                total: parseInt(countResult.rows[0]?.count || '0', 10),
                limit,
                offset,
            },
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to list users', { correlationId, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to list users',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

/**
 * GET /admin/users/:userId
 * Get user details
 */
export async function getUser(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { userId } = req.params;

    try {
        const user = await userService.getUserById(userId!);
        if (!user) {
            res.status(404).json({
                error: 'Not Found',
                message: 'User not found',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        // Get related data
        const [phoneNumbers, agents, credits] = await Promise.all([
            db.query<PhoneNumberWithRateLimit>(
                'SELECT * FROM phone_numbers WHERE user_id = $1',
                [userId]
            ),
            db.query<Agent>('SELECT * FROM agents WHERE user_id = $1', [userId]),
            db.query<{ remaining_credits: number }>(
                'SELECT remaining_credits FROM credits WHERE user_id = $1',
                [userId]
            ),
        ]);

        res.status(200).json({
            success: true,
            data: {
                user,
                phoneNumbers: phoneNumbers.rows,
                agents: agents.rows,
                remainingCredits: credits.rows[0]?.remaining_credits || 0,
            },
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to get user', { correlationId, userId, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to get user',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

/**
 * POST /admin/users
 * Create new user
 */
export async function createUser(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { user_id, email, initial_credits } = req.body;

    if (!user_id || !email) {
        res.status(400).json({
            error: 'Bad Request',
            message: 'user_id and email are required',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    try {
        // Check if user already exists
        const existingUser = await userService.getUserById(user_id);
        if (existingUser) {
            res.status(409).json({
                error: 'Conflict',
                message: 'User already exists',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        // Create user
        const result = await db.query<User>(
            'INSERT INTO users (user_id, email, created_at) VALUES ($1, $2, NOW()) RETURNING *',
            [user_id, email]
        );

        const user = result.rows[0];

        // Initialize credits if provided
        if (initial_credits && initial_credits > 0) {
            await db.query(
                'INSERT INTO credits (user_id, remaining_credits) VALUES ($1, $2)',
                [user_id, initial_credits]
            );
        } else {
            // Initialize with 0 credits
            await db.query(
                'INSERT INTO credits (user_id, remaining_credits) VALUES ($1, 0)',
                [user_id]
            );
        }

        logger.info('User created by admin', { correlationId, userId: user_id });

        res.status(201).json({
            success: true,
            data: {
                user,
                initial_credits: initial_credits || 0,
            },
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to create user', { correlationId, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to create user',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

/**
 * PATCH /admin/users/:userId
 * Update user details
 */
export async function updateUser(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { userId } = req.params;
    const { email } = req.body;

    try {
        const fields: string[] = [];
        const values: unknown[] = [];
        let paramIndex = 1;

        if (email !== undefined) {
            fields.push(`email = $${paramIndex}`);
            values.push(email);
            paramIndex++;
        }

        if (fields.length === 0) {
            res.status(400).json({
                error: 'Bad Request',
                message: 'No fields to update',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        values.push(userId);

        const result = await db.query<User>(
            `UPDATE users SET ${fields.join(', ')} WHERE user_id = $${paramIndex} RETURNING *`,
            values
        );

        if (!result.rows[0]) {
            res.status(404).json({
                error: 'Not Found',
                message: 'User not found',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        logger.info('User updated by admin', { correlationId, userId });

        res.status(200).json({
            success: true,
            data: result.rows[0],
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to update user', { correlationId, userId, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to update user',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

/**
 * DELETE /admin/users/:userId
 * Delete user
 */
export async function deleteUser(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { userId } = req.params;

    try {
        const deleted = await userService.deleteUser(userId!);
        if (!deleted) {
            res.status(404).json({
                error: 'Not Found',
                message: 'User not found',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        logger.info('User deleted by admin', { correlationId, userId });

        res.status(200).json({
            success: true,
            message: 'User deleted successfully',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to delete user', { correlationId, userId, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to delete user',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

/**
 * POST /admin/users/:userId/credits
 * Add credits to user
 */
export async function addUserCredits(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { userId } = req.params;
    const { amount } = req.body;

    if (!userId) {
        res.status(400).json({
            error: 'Bad Request',
            message: 'userId is required',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    if (!amount || amount <= 0) {
        res.status(400).json({
            error: 'Bad Request',
            message: 'amount must be a positive number',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    try {
        // Verify user exists
        const user = await userService.getUserById(userId);
        if (!user) {
            res.status(404).json({
                error: 'Not Found',
                message: 'User not found',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        // Add credits
        const result = await db.query<{ remaining_credits: number }>(
            `INSERT INTO credits (user_id, remaining_credits) 
             VALUES ($1, $2)
             ON CONFLICT (user_id) 
             DO UPDATE SET remaining_credits = credits.remaining_credits + EXCLUDED.remaining_credits
             RETURNING remaining_credits`,
            [userId, amount]
        );

        logger.info('Credits added by admin', { correlationId, userId, amount });

        res.status(200).json({
            success: true,
            data: {
                user_id: userId,
                credits_added: amount,
                remaining_credits: result.rows[0]?.remaining_credits || 0,
            },
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to add credits', { correlationId, userId, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to add credits',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// =====================================
// Phone Numbers
// =====================================

/**
 * GET /admin/phone-numbers
 * List all phone numbers with rate limit stats
 */
export async function listPhoneNumbers(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;

    try {
        const [countResult, dataResult] = await Promise.all([
            db.query<{ count: string }>('SELECT COUNT(*) FROM phone_numbers'),
            db.query<PhoneNumberWithRateLimit>(
                `SELECT pn.*, u.email as user_email 
                 FROM phone_numbers pn
                 LEFT JOIN users u ON pn.user_id = u.user_id
                 ORDER BY pn.created_at DESC 
                 LIMIT $1 OFFSET $2`,
                [limit, offset]
            ),
        ]);

        res.status(200).json({
            success: true,
            data: dataResult.rows,
            pagination: {
                total: parseInt(countResult.rows[0]?.count || '0', 10),
                limit,
                offset,
            },
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to list phone numbers', { correlationId, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to list phone numbers',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

/**
 * PATCH /admin/phone-numbers/:phoneNumberId
 * Update phone number (WABA ID, rate limits)
 */
export async function updatePhoneNumber(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { phoneNumberId } = req.params;
    const { waba_id, daily_message_limit, tier } = req.body;

    try {
        const fields: string[] = [];
        const values: unknown[] = [];
        let paramIndex = 1;

        if (waba_id !== undefined) {
            fields.push(`waba_id = $${paramIndex}`);
            values.push(waba_id);
            paramIndex++;
        }

        if (daily_message_limit !== undefined) {
            fields.push(`daily_message_limit = $${paramIndex}`);
            values.push(daily_message_limit);
            paramIndex++;
        }

        if (tier !== undefined) {
            fields.push(`tier = $${paramIndex}`);
            values.push(tier);
            paramIndex++;
        }

        if (fields.length === 0) {
            res.status(400).json({
                error: 'Bad Request',
                message: 'No fields to update',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        values.push(phoneNumberId);

        const result = await db.query<PhoneNumberWithRateLimit>(
            `UPDATE phone_numbers SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
            values
        );

        if (!result.rows[0]) {
            res.status(404).json({
                error: 'Not Found',
                message: 'Phone number not found',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        logger.info('Phone number updated by admin', { correlationId, phoneNumberId });

        res.status(200).json({
            success: true,
            data: result.rows[0],
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to update phone number', { correlationId, phoneNumberId, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to update phone number',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

/**
 * POST /admin/users/:userId/phone-numbers
 * Add phone number to user (WhatsApp/Instagram)
 */
export async function addUserPhoneNumber(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { userId } = req.params;
    const { id, platform, meta_phone_number_id, access_token, display_name, waba_id } = req.body;

    // Auto-generate id if not provided
    const phoneNumberId = id || uuidv4();

    if (!platform || !meta_phone_number_id || !access_token) {
        res.status(400).json({
            error: 'Bad Request',
            message: 'platform, meta_phone_number_id, and access_token are required',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    if (!userId) {
        res.status(400).json({
            error: 'Bad Request',
            message: 'userId is required',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    const validPlatforms = ['whatsapp', 'instagram', 'webchat'];
    if (!validPlatforms.includes(platform)) {
        res.status(400).json({
            error: 'Bad Request',
            message: `platform must be one of: ${validPlatforms.join(', ')}`,
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    try {
        // Verify user exists
        const user = await userService.getUserById(userId);
        if (!user) {
            res.status(404).json({
                error: 'Not Found',
                message: 'User not found',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        // Check if phone number already exists
        const existing = await db.query(
            'SELECT id FROM phone_numbers WHERE id = $1',
            [phoneNumberId]
        );

        if (existing.rows[0]) {
            res.status(409).json({
                error: 'Conflict',
                message: 'Phone number already exists',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        // Insert phone number
        const result = await db.query<PhoneNumberWithRateLimit>(
            `INSERT INTO phone_numbers 
             (id, user_id, platform, meta_phone_number_id, access_token, display_name, waba_id, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             RETURNING *`,
            [phoneNumberId, userId, platform, meta_phone_number_id, access_token, display_name, waba_id]
        );

        logger.info('Phone number added by admin', { correlationId, userId, phoneNumberId });

        res.status(201).json({
            success: true,
            data: result.rows[0],
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to add phone number', { correlationId, userId, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to add phone number',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

/**
 * DELETE /admin/users/:userId/phone-numbers/:phoneNumberId
 * Delete phone number from user
 */
export async function deleteUserPhoneNumber(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { userId, phoneNumberId } = req.params;

    if (!userId || !phoneNumberId) {
        res.status(400).json({
            error: 'Bad Request',
            message: 'userId and phoneNumberId are required',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    try {
        // Verify phone number belongs to user
        const result = await db.query(
            'SELECT id FROM phone_numbers WHERE id = $1 AND user_id = $2',
            [phoneNumberId, userId]
        );

        if (!result.rows[0]) {
            res.status(404).json({
                error: 'Not Found',
                message: 'Phone number not found for this user',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        // Delete phone number
        await db.query('DELETE FROM phone_numbers WHERE id = $1', [phoneNumberId]);

        logger.info('Phone number deleted by admin', { correlationId, userId, phoneNumberId });

        res.status(200).json({
            success: true,
            message: 'Phone number deleted successfully',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to delete phone number', { correlationId, userId, phoneNumberId, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to delete phone number',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// =====================================
// Agents
// =====================================

/**
 * GET /admin/agents
 * List all agents
 */
export async function listAgents(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;

    try {
        const [countResult, dataResult] = await Promise.all([
            db.query<{ count: string }>('SELECT COUNT(*) FROM agents'),
            db.query<Agent & { user_email: string; phone_display_name: string }>(
                `SELECT a.*, u.email as user_email, pn.display_name as phone_display_name
                 FROM agents a
                 LEFT JOIN users u ON a.user_id = u.user_id
                 LEFT JOIN phone_numbers pn ON a.phone_number_id = pn.id
                 ORDER BY a.created_at DESC
                 LIMIT $1 OFFSET $2`,
                [limit, offset]
            ),
        ]);

        res.status(200).json({
            success: true,
            data: dataResult.rows,
            pagination: {
                total: parseInt(countResult.rows[0]?.count || '0', 10),
                limit,
                offset,
            },
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to list agents', { correlationId, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to list agents',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

/**
 * GET /admin/agents/:agentId
 * Get agent details
 */
export async function getAgent(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { agentId } = req.params;

    if (!agentId) {
        res.status(400).json({
            error: 'Bad Request',
            message: 'agentId is required',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    try {
        const agent = await agentService.getAgentById(agentId);
        if (!agent) {
            res.status(404).json({
                error: 'Not Found',
                message: 'Agent not found',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        res.status(200).json({
            success: true,
            data: agent,
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to get agent', { correlationId, agentId, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to get agent',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

/**
 * POST /admin/users/:userId/agents
 * Create agent for user with OpenAI prompt
 */
export async function createUserAgent(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { userId } = req.params;
    const { phone_number_id, prompt_id, name } = req.body;

    if (!userId) {
        res.status(400).json({
            error: 'Bad Request',
            message: 'userId is required',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    if (!phone_number_id || !prompt_id || !name) {
        res.status(400).json({
            error: 'Bad Request',
            message: 'phone_number_id, prompt_id, and name are required',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    try {
        // Verify user exists
        const user = await userService.getUserById(userId);
        if (!user) {
            res.status(404).json({
                error: 'Not Found',
                message: 'User not found',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        // Verify phone number exists and belongs to user
        const phoneResult = await db.query(
            'SELECT id FROM phone_numbers WHERE id = $1 AND user_id = $2',
            [phone_number_id, userId]
        );

        if (!phoneResult.rows[0]) {
            res.status(404).json({
                error: 'Not Found',
                message: 'Phone number not found for this user',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        // Create agent
        const agent_id = uuidv4();
        const result = await db.query<Agent>(
            `INSERT INTO agents 
             (agent_id, user_id, phone_number_id, prompt_id, name, created_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             RETURNING *`,
            [agent_id, userId, phone_number_id, prompt_id, name]
        );

        logger.info('Agent created by admin', { correlationId, userId, agentId: agent_id });

        res.status(201).json({
            success: true,
            data: result.rows[0],
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to create agent', { correlationId, userId, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to create agent',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

/**
 * PATCH /admin/users/:userId/agents/:agentId
 * Update agent for user
 */
export async function updateUserAgent(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { userId, agentId } = req.params;
    const { name, prompt_id } = req.body;

    if (!userId || !agentId) {
        res.status(400).json({
            error: 'Bad Request',
            message: 'userId and agentId are required',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    try {
        const fields: string[] = [];
        const values: unknown[] = [];
        let paramIndex = 1;

        if (name !== undefined) {
            fields.push(`name = $${paramIndex}`);
            values.push(name);
            paramIndex++;
        }

        if (prompt_id !== undefined) {
            fields.push(`prompt_id = $${paramIndex}`);
            values.push(prompt_id);
            paramIndex++;
        }

        if (fields.length === 0) {
            res.status(400).json({
                error: 'Bad Request',
                message: 'No fields to update',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        values.push(agentId, userId);

        const result = await db.query<Agent>(
            `UPDATE agents SET ${fields.join(', ')} 
             WHERE agent_id = $${paramIndex} AND user_id = $${paramIndex + 1}
             RETURNING *`,
            values
        );

        if (!result.rows[0]) {
            res.status(404).json({
                error: 'Not Found',
                message: 'Agent not found for this user',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        logger.info('Agent updated by admin', { correlationId, userId, agentId });

        res.status(200).json({
            success: true,
            data: result.rows[0],
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to update agent', { correlationId, userId, agentId, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to update agent',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

/**
 * DELETE /admin/agents/:agentId
 * Delete agent
 */
export async function deleteAgent(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { agentId } = req.params;

    if (!agentId) {
        res.status(400).json({
            error: 'Bad Request',
            message: 'agentId is required',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    try {
        const deleted = await agentService.deleteAgent(agentId);
        if (!deleted) {
            res.status(404).json({
                error: 'Not Found',
                message: 'Agent not found',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        logger.info('Agent deleted by admin', { correlationId, agentId });

        res.status(200).json({
            success: true,
            message: 'Agent deleted successfully',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to delete agent', { correlationId, agentId, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to delete agent',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// =====================================
// Conversations & Messages
// =====================================

/**
 * GET /admin/conversations
 * List all conversations
 */
export async function listConversations(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const userId = req.query.userId as string;
    const isActive = req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined;

    try {
        const conditions: string[] = [];
        const params: unknown[] = [];
        let paramIndex = 1;

        if (userId) {
            conditions.push(`a.user_id = $${paramIndex}`);
            params.push(userId);
            paramIndex++;
        }

        if (isActive !== undefined) {
            conditions.push(`c.is_active = $${paramIndex}`);
            params.push(isActive);
            paramIndex++;
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const [countResult, dataResult] = await Promise.all([
            db.query<{ count: string }>(
                `SELECT COUNT(*) FROM conversations c
                 JOIN agents a ON c.agent_id = a.agent_id
                 ${whereClause}`,
                params.slice(0, conditions.length)
            ),
            db.query<Conversation & { agent_name: string; user_id: string }>(
                `SELECT c.*, a.name as agent_name, a.user_id
                 FROM conversations c
                 JOIN agents a ON c.agent_id = a.agent_id
                 ${whereClause}
                 ORDER BY c.last_message_at DESC
                 LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
                [...params, limit, offset]
            ),
        ]);

        res.status(200).json({
            success: true,
            data: dataResult.rows,
            pagination: {
                total: parseInt(countResult.rows[0]?.count || '0', 10),
                limit,
                offset,
            },
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to list conversations', { correlationId, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to list conversations',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

/**
 * GET /admin/conversations/:conversationId/messages
 * Get messages for a conversation
 */
export async function getConversationMessages(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { conversationId } = req.params;
    const limit = parseInt(req.query.limit as string, 10) || 100;
    const offset = parseInt(req.query.offset as string, 10) || 0;

    try {
        const [countResult, dataResult] = await Promise.all([
            db.query<{ count: string }>(
                'SELECT COUNT(*) FROM messages WHERE conversation_id = $1',
                [conversationId]
            ),
            db.query<Message>(
                `SELECT * FROM messages 
                 WHERE conversation_id = $1
                 ORDER BY sequence_no ASC
                 LIMIT $2 OFFSET $3`,
                [conversationId, limit, offset]
            ),
        ]);

        res.status(200).json({
            success: true,
            data: dataResult.rows,
            pagination: {
                total: parseInt(countResult.rows[0]?.count || '0', 10),
                limit,
                offset,
            },
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to get conversation messages', { correlationId, conversationId, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to get conversation messages',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// =====================================
// Templates
// =====================================

/**
 * GET /admin/templates
 * List all templates
 */
export async function listTemplates(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const status = req.query.status as string;

    try {
        const { templates, total } = await templateService.getAllTemplates({
            limit,
            offset,
            status: status as any,
        });

        // Convert components to array format for frontend compatibility
        const templatesWithArrayComponents = templates.map(t => ({
            ...t,
            components: componentsToArray(t.components),
        }));

        res.status(200).json({
            success: true,
            data: templatesWithArrayComponents,
            pagination: {
                total,
                limit,
                offset,
            },
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to list templates', { correlationId, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to list templates',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

/**
 * GET /admin/templates/:templateId
 * Get template details
 */
export async function getTemplate(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { templateId } = req.params;

    try {
        const template = await templateService.getTemplateById(templateId!);
        if (!template) {
            res.status(404).json({
                error: 'Not Found',
                message: 'Template not found',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        const variables = await templateService.getTemplateVariables(templateId!);
        const analytics = await templateService.getTemplateAnalytics(templateId!);

        // Convert components to array format for frontend compatibility
        const templateWithArrayComponents = {
            ...template,
            components: componentsToArray(template.components),
        };

        res.status(200).json({
            success: true,
            data: {
                template: templateWithArrayComponents,
                variables,
                analytics,
            },
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to get template', { correlationId, templateId, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to get template',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

/**
 * Convert array-style components (Meta format) to object-style components (our format)
 */
function normalizeTemplateComponents(components: unknown): Record<string, unknown> {
    // If already in object format with 'body' key, return as-is
    if (components && typeof components === 'object' && !Array.isArray(components) && 'body' in components) {
        return components as Record<string, unknown>;
    }

    // If array format, convert to object format
    if (Array.isArray(components)) {
        const result: Record<string, unknown> = {};
        const buttons: unknown[] = [];

        for (const comp of components) {
            if (typeof comp !== 'object' || !comp) continue;
            const component = comp as Record<string, unknown>;
            const type = (component.type as string)?.toUpperCase();

            if (type === 'HEADER') {
                result.header = {
                    type: 'HEADER',
                    format: component.format || 'TEXT',
                    text: component.text,
                    example: component.example,
                };
            } else if (type === 'BODY') {
                result.body = {
                    type: 'BODY',
                    text: component.text,
                    example: component.example,
                };
            } else if (type === 'FOOTER') {
                result.footer = {
                    type: 'FOOTER',
                    text: component.text,
                };
            } else if (type === 'BUTTONS') {
                result.buttons = {
                    type: 'BUTTONS',
                    buttons: component.buttons || [],
                };
            } else if (type === 'BUTTON' || ['QUICK_REPLY', 'URL', 'PHONE_NUMBER'].includes(type)) {
                buttons.push(component);
            }
        }

        // If individual buttons were provided, wrap them
        if (buttons.length > 0 && !result.buttons) {
            result.buttons = { type: 'BUTTONS', buttons };
        }

        return result;
    }

    // Return empty object if invalid
    return {};
}

/**
 * Convert object-style components (our format) to array-style components (frontend/Meta format)
 */
function componentsToArray(components: unknown): unknown[] {
    // If already an array, return as-is
    if (Array.isArray(components)) {
        return components;
    }

    // If object format, convert to array
    if (components && typeof components === 'object') {
        const result: unknown[] = [];
        const obj = components as Record<string, unknown>;

        if (obj.header) {
            result.push(obj.header);
        }
        if (obj.body) {
            result.push(obj.body);
        }
        if (obj.footer) {
            result.push(obj.footer);
        }
        if (obj.buttons) {
            result.push(obj.buttons);
        }

        return result;
    }

    return [];
}

/**
 * POST /admin/templates
 * Create template
 */
export async function createTemplate(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { user_id, phone_number_id, name, category, components, variables } = req.body;

    try {
        // Normalize components from array format (Meta) to object format (our schema)
        const normalizedComponents = normalizeTemplateComponents(components) as unknown as TemplateComponents;

        const template = await templateService.createTemplate({
            template_id: uuidv4(),
            user_id,
            phone_number_id,
            name,
            category,
            components: normalizedComponents,
        });

        // Create variables if provided
        if (variables && Array.isArray(variables)) {
            for (const variable of variables) {
                await templateService.createTemplateVariable({
                    variable_id: uuidv4(),
                    template_id: template.template_id,
                    ...variable,
                });
            }
        }

        logger.info('Template created by admin', { correlationId, templateId: template.template_id });

        res.status(201).json({
            success: true,
            data: template,
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create template';
        logger.error('Failed to create template', { correlationId, error });
        res.status(400).json({
            error: 'Bad Request',
            message,
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

/**
 * POST /admin/templates/:templateId/submit
 * Submit template to Meta
 */
export async function submitTemplate(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { templateId } = req.params;

    try {
        const template = await templateService.submitTemplateToMeta(templateId!);

        logger.info('Template submitted to Meta by admin', { correlationId, templateId });

        res.status(200).json({
            success: true,
            data: template,
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to submit template';
        logger.error('Failed to submit template', { correlationId, templateId, error });
        res.status(400).json({
            error: 'Bad Request',
            message,
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

/**
 * DELETE /admin/templates/:templateId
 * Delete template
 */
export async function deleteTemplate(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { templateId } = req.params;

    try {
        // Try to delete from Meta first if it has been submitted
        const template = await templateService.getTemplateById(templateId!);
        if (template?.meta_template_id) {
            await templateService.deleteTemplateFromMeta(templateId!);
        }

        const deleted = await templateService.deleteTemplate(templateId!);
        if (!deleted) {
            res.status(404).json({
                error: 'Not Found',
                message: 'Template not found',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        logger.info('Template deleted by admin', { correlationId, templateId });

        res.status(200).json({
            success: true,
            message: 'Template deleted successfully',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to delete template', { correlationId, templateId, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to delete template',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

/**
 * Sync templates from Meta
 * POST /admin/templates/sync
 * 
 * Imports existing approved templates from Meta that aren't in our database
 */
export async function syncTemplates(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { user_id, phone_number_id } = req.body;

    if (!user_id) {
        res.status(400).json({
            error: 'Bad Request',
            message: 'user_id is required',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    if (!phone_number_id) {
        res.status(400).json({
            error: 'Bad Request',
            message: 'phone_number_id is required',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    try {
        const result = await templateService.syncTemplatesFromMeta(user_id, phone_number_id);

        logger.info('Templates synced from Meta', { 
            correlationId, 
            userId: user_id, 
            phoneNumberId: phone_number_id,
            imported: result.imported.length,
            updated: result.updated.length,
            errors: result.errors.length,
        });

        res.status(200).json({
            success: true,
            data: {
                imported: result.imported,
                updated: result.updated,
                errors: result.errors,
                summary: {
                    totalImported: result.imported.length,
                    totalUpdated: result.updated.length,
                    totalErrors: result.errors.length,
                }
            },
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to sync templates from Meta', { correlationId, userId: user_id, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: error instanceof Error ? error.message : 'Failed to sync templates',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// =====================================
// Contacts
// =====================================

/**
 * GET /admin/contacts
 * List all contacts
 */
export async function listContacts(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const userId = req.query.userId as string;

    try {
        const { contacts, total } = await contactService.getAllContacts({
            limit,
            offset,
            userId,
        });

        res.status(200).json({
            success: true,
            data: contacts,
            pagination: {
                total,
                limit,
                offset,
            },
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to list contacts', { correlationId, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to list contacts',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

/**
 * POST /admin/contacts/import
 * Import contacts from CSV
 */
export async function importContacts(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { userId, contacts, defaultTags } = req.body;

    if (!userId || !contacts || !Array.isArray(contacts)) {
        res.status(400).json({
            error: 'Bad Request',
            message: 'userId and contacts array are required',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    try {
        const result = await contactService.importFromCSV(userId, contacts, defaultTags);

        logger.info('Contacts imported by admin', {
            correlationId,
            userId,
            imported: result.imported,
            skipped: result.skipped,
        });

        res.status(200).json({
            success: true,
            data: result,
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to import contacts', { correlationId, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to import contacts',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

/**
 * DELETE /admin/contacts/:contactId
 * Delete contact
 */
export async function deleteContact(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { contactId } = req.params;

    try {
        const deleted = await contactService.deleteContact(contactId!);
        if (!deleted) {
            res.status(404).json({
                error: 'Not Found',
                message: 'Contact not found',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        logger.info('Contact deleted by admin', { correlationId, contactId });

        res.status(200).json({
            success: true,
            message: 'Contact deleted successfully',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to delete contact', { correlationId, contactId, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to delete contact',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// =====================================
// Campaigns
// =====================================

/**
 * GET /admin/campaigns
 * List all campaigns
 */
export async function listCampaigns(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const status = req.query.status as string;
    const userId = req.query.userId as string;

    try {
        const { campaigns, total } = await campaignService.getAllCampaigns({
            limit,
            offset,
            status: status as any,
            userId,
        });

        res.status(200).json({
            success: true,
            data: campaigns,
            pagination: {
                total,
                limit,
                offset,
            },
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to list campaigns', { correlationId, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to list campaigns',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

/**
 * GET /admin/campaigns/:campaignId
 * Get campaign details
 */
export async function getCampaign(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { campaignId } = req.params;

    try {
        const campaign = await campaignService.getCampaignById(campaignId!);
        if (!campaign) {
            res.status(404).json({
                error: 'Not Found',
                message: 'Campaign not found',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        const [triggers, stats] = await Promise.all([
            campaignService.getTriggersByCampaignId(campaignId!),
            campaignService.getRecipientStats(campaignId!),
        ]);

        res.status(200).json({
            success: true,
            data: {
                campaign,
                triggers,
                recipientStats: stats,
            },
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to get campaign', { correlationId, campaignId, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to get campaign',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

/**
 * POST /admin/campaigns
 * Create campaign
 */
export async function createCampaign(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { user_id, template_id, phone_number_id, name, description, recipient_filter, triggers } = req.body;

    try {
        const campaign = await campaignService.createCampaign({
            campaign_id: uuidv4(),
            user_id,
            template_id,
            phone_number_id,
            name,
            description,
            recipient_filter,
        });

        // Create triggers if provided
        if (triggers && Array.isArray(triggers)) {
            for (const trigger of triggers) {
                await campaignService.createTrigger({
                    trigger_id: uuidv4(),
                    campaign_id: campaign.campaign_id,
                    ...trigger,
                });
            }
        }

        logger.info('Campaign created by admin', { correlationId, campaignId: campaign.campaign_id });

        res.status(201).json({
            success: true,
            data: campaign,
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create campaign';
        logger.error('Failed to create campaign', { correlationId, error });
        res.status(400).json({
            error: 'Bad Request',
            message,
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

/**
 * POST /admin/campaigns/:campaignId/start
 * Start campaign
 */
export async function startCampaign(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { campaignId } = req.params;

    try {
        const campaign = await campaignService.startCampaign(campaignId!);

        logger.info('Campaign started by admin', { correlationId, campaignId });

        res.status(200).json({
            success: true,
            data: campaign,
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to start campaign';
        logger.error('Failed to start campaign', { correlationId, campaignId, error });
        res.status(400).json({
            error: 'Bad Request',
            message,
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

/**
 * POST /admin/campaigns/:campaignId/pause
 * Pause campaign
 */
export async function pauseCampaign(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { campaignId } = req.params;

    try {
        const campaign = await campaignService.pauseCampaign(campaignId!);

        logger.info('Campaign paused by admin', { correlationId, campaignId });

        res.status(200).json({
            success: true,
            data: campaign,
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to pause campaign';
        logger.error('Failed to pause campaign', { correlationId, campaignId, error });
        res.status(400).json({
            error: 'Bad Request',
            message,
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

/**
 * POST /admin/campaigns/:campaignId/resume
 * Resume campaign
 */
export async function resumeCampaign(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { campaignId } = req.params;

    try {
        const campaign = await campaignService.resumeCampaign(campaignId!);

        logger.info('Campaign resumed by admin', { correlationId, campaignId });

        res.status(200).json({
            success: true,
            data: campaign,
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to resume campaign';
        logger.error('Failed to resume campaign', { correlationId, campaignId, error });
        res.status(400).json({
            error: 'Bad Request',
            message,
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

/**
 * POST /admin/campaigns/:campaignId/cancel
 * Cancel campaign
 */
export async function cancelCampaign(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { campaignId } = req.params;

    try {
        const campaign = await campaignService.cancelCampaign(campaignId!);

        logger.info('Campaign cancelled by admin', { correlationId, campaignId });

        res.status(200).json({
            success: true,
            data: campaign,
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to cancel campaign';
        logger.error('Failed to cancel campaign', { correlationId, campaignId, error });
        res.status(400).json({
            error: 'Bad Request',
            message,
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

/**
 * DELETE /admin/campaigns/:campaignId
 * Delete campaign
 */
export async function deleteCampaign(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { campaignId } = req.params;

    try {
        const deleted = await campaignService.deleteCampaign(campaignId!);
        if (!deleted) {
            res.status(404).json({
                error: 'Not Found',
                message: 'Campaign not found',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        logger.info('Campaign deleted by admin', { correlationId, campaignId });

        res.status(200).json({
            success: true,
            message: 'Campaign deleted successfully',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to delete campaign', { correlationId, campaignId, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to delete campaign',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// =====================================
// Button Click Analytics
// =====================================

/**
 * GET /admin/templates/:templateId/button-clicks
 * Get button click analytics for a specific template
 */
export async function getTemplateButtonClicks(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { templateId } = req.params;

    try {
        const analytics = await templateService.getButtonClickAnalytics(templateId!);

        res.status(200).json({
            success: true,
            data: analytics,
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to get button click analytics', { correlationId, templateId, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to get button click analytics',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

/**
 * GET /admin/button-clicks
 * Get all button clicks for a user with optional filtering
 */
export async function listButtonClicks(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const userId = req.query.userId as string;
    const templateId = req.query.templateId as string;

    if (!userId) {
        res.status(400).json({
            error: 'Bad Request',
            message: 'userId is required',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    try {
        const { clicks, total } = await templateService.getButtonClicksByUser(userId, {
            templateId,
            limit,
            offset,
        });

        res.status(200).json({
            success: true,
            data: clicks,
            pagination: {
                total,
                limit,
                offset,
            },
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to list button clicks', { correlationId, userId, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to list button clicks',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

/**
 * GET /admin/leads/:customerPhone/button-activity
 * Get button activity for a specific lead
 */
export async function getLeadButtonActivity(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { customerPhone } = req.params;
    const userId = req.query.userId as string;

    if (!userId) {
        res.status(400).json({
            error: 'Bad Request',
            message: 'userId query parameter is required',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    try {
        const activity = await templateService.getLeadButtonActivity(customerPhone!, userId);

        if (!activity) {
            res.status(200).json({
                success: true,
                data: {
                    customer_phone: customerPhone,
                    buttons_clicked: [],
                    total_clicks: 0,
                },
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        res.status(200).json({
            success: true,
            data: activity,
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to get lead button activity', { correlationId, customerPhone, error });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to get lead button activity',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

export const adminController = {
    // Dashboard
    getDashboardStats,
    getRateLimitStats,
    // Conversation Analytics (WhatsApp)
    getConversationAnalytics,
    getAllConversationAnalytics,
    // Users
    listUsers,
    getUser,
    createUser,
    updateUser,
    deleteUser,
    addUserCredits,
    // Phone Numbers
    listPhoneNumbers,
    updatePhoneNumber,
    addUserPhoneNumber,
    deleteUserPhoneNumber,
    // Agents
    listAgents,
    getAgent,
    createUserAgent,
    updateUserAgent,
    deleteAgent,
    // Conversations
    listConversations,
    getConversationMessages,
    // Templates
    listTemplates,
    getTemplate,
    createTemplate,
    submitTemplate,
    syncTemplates,
    deleteTemplate,
    // Contacts
    listContacts,
    importContacts,
    deleteContact,
    // Campaigns
    listCampaigns,
    getCampaign,
    createCampaign,
    startCampaign,
    pauseCampaign,
    resumeCampaign,
    cancelCampaign,
    deleteCampaign,
    // Button Click Analytics
    getTemplateButtonClicks,
    listButtonClicks,
    getLeadButtonActivity,
};
