/**
 * External API Controller
 * Handles API requests from external systems (Dashboard) for WhatsApp messaging
 * 
 * NO AUTHENTICATION REQUIRED - Internal microservice communication
 * 
 * Template Management:
 * - GET    /api/v1/templates                    - List templates for a phone number
 * - GET    /api/v1/templates/:templateId        - Get template with variables & analytics
 * - POST   /api/v1/templates                    - Create template
 * - POST   /api/v1/templates/:templateId/submit - Submit template to Meta
 * - POST   /api/v1/templates/sync               - Sync templates from Meta
 * - DELETE /api/v1/templates/:templateId        - Delete template
 * 
 * Button Click Analytics:
 * - GET    /api/v1/templates/:templateId/button-clicks - Get template button analytics
 * - GET    /api/v1/button-clicks                       - List all button clicks
 * - GET    /api/v1/leads/:customerPhone/button-activity - Get lead's button activity
 * 
 * Messaging:
 * - GET  /api/v1/phone-numbers           - List phone numbers for a user
 * - POST /api/v1/send                    - Send single template message
 * - POST /api/v1/campaign                - Create and optionally start a campaign
 * - GET  /api/v1/campaign/:campaignId    - Get campaign status
 */

import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../utils/database';
import { logger } from '../utils/logger';
import { contactService } from '../services/contactService';
import { campaignService } from '../services/campaignService';
import { templateService } from '../services/templateService';
import { sendTemplateMessage } from '../services/messageService';
import { deductCredits, getUserCredits, InsufficientCreditsError } from '../services/creditService';
import { campaignsConfig } from '../config';
import type { PhoneNumber, Template, Campaign, TemplateComponents, Agent, User, Platform } from '../models/types';

// Helper to get correlation ID
function getCorrelationId(req: Request): string {
    return (req.headers['x-correlation-id'] as string) || `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// Helper to generate IDs
function generateId(prefix: string): string {
    return `${prefix}_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
}

// =====================================
// USER MANAGEMENT
// =====================================

// POST /api/v1/users - Create a new user
export async function createUser(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { user_id, email, company_name } = req.body;

    if (!user_id || !email) {
        res.status(400).json({
            success: false,
            error: 'Bad Request',
            message: 'user_id and email are required',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        res.status(400).json({
            success: false,
            error: 'Bad Request',
            message: 'Invalid email format',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    try {
        const result = await db.query<User>(
            `INSERT INTO users (user_id, email, company_name, created_at, updated_at)
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             RETURNING user_id, email, company_name, created_at, updated_at`,
            [user_id, email, company_name || null]
        );

        // Initialize credits for new user
        await db.query(
            `INSERT INTO credits (user_id, remaining_credits, total_used, last_updated)
             VALUES ($1, 100, 0, CURRENT_TIMESTAMP)
             ON CONFLICT (user_id) DO NOTHING`,
            [user_id]
        );

        logger.info('User created via external API', { correlationId, userId: user_id, email });

        res.status(201).json({
            success: true,
            data: result.rows[0],
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error: any) {
        if (error.code === '23505') { // Unique constraint violation
            res.status(409).json({
                success: false,
                error: 'Conflict',
                message: 'User with this user_id or email already exists',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }
        logger.error('Failed to create user', { correlationId, email, error });
        res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            message: 'Failed to create user',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// GET /api/v1/users/:userId - Get user details
export async function getUser(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { userId } = req.params;

    try {
        const result = await db.query<User>(
            `SELECT user_id, email, company_name, created_at, updated_at
             FROM users WHERE user_id = $1`,
            [userId]
        );

        if (result.rows.length === 0) {
            res.status(404).json({
                success: false,
                error: 'Not Found',
                message: 'User not found',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        // Get credits
        const creditsResult = await db.query(
            'SELECT remaining_credits, total_used FROM credits WHERE user_id = $1',
            [userId]
        );

        res.status(200).json({
            success: true,
            data: {
                ...result.rows[0],
                credits: creditsResult.rows[0] || { remaining_credits: 0, total_used: 0 },
            },
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to get user', { correlationId, userId, error });
        res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            message: 'Failed to get user',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// =====================================
// CREDITS MANAGEMENT
// =====================================

// GET /api/v1/credits - Get user credits
export async function getCredits(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
        res.status(400).json({
            success: false,
            error: 'Bad Request',
            message: 'x-user-id header is required',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    try {
        const result = await db.query(
            `SELECT user_id, remaining_credits, total_used, last_updated
             FROM credits WHERE user_id = $1`,
            [userId]
        );

        if (result.rows.length === 0) {
            // Return default credits if user has no record
            res.status(200).json({
                success: true,
                data: {
                    user_id: userId,
                    remaining_credits: 0,
                    total_used: 0,
                    last_updated: null,
                },
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        logger.info('Credits retrieved via external API', { correlationId, userId });

        res.status(200).json({
            success: true,
            data: result.rows[0],
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to get credits', { correlationId, userId, error });
        res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            message: 'Failed to get credits',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// POST /api/v1/credits/adjust - Adjust user credits (add or deduct)
export async function adjustCredits(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const userId = req.headers['x-user-id'] as string;
    const { amount, operation, reason } = req.body;

    if (!userId) {
        res.status(400).json({
            success: false,
            error: 'Bad Request',
            message: 'x-user-id header is required',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    if (amount === undefined || typeof amount !== 'number') {
        res.status(400).json({
            success: false,
            error: 'Bad Request',
            message: 'amount is required and must be a number',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    if (amount <= 0) {
        res.status(400).json({
            success: false,
            error: 'Bad Request',
            message: 'amount must be a positive number',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    if (!operation || !['add', 'deduct', 'set'].includes(operation)) {
        res.status(400).json({
            success: false,
            error: 'Bad Request',
            message: 'operation is required and must be one of: add, deduct, set',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    try {
        let query: string;
        let params: unknown[];
        
        if (operation === 'add') {
            // Add credits (upsert)
            query = `
                INSERT INTO credits (user_id, remaining_credits, total_used, last_updated)
                VALUES ($1, $2, 0, CURRENT_TIMESTAMP)
                ON CONFLICT (user_id)
                DO UPDATE SET 
                    remaining_credits = credits.remaining_credits + $2,
                    last_updated = CURRENT_TIMESTAMP
                RETURNING user_id, remaining_credits, total_used, last_updated
            `;
            params = [userId, amount];
        } else if (operation === 'deduct') {
            // Deduct credits (must have enough)
            query = `
                UPDATE credits 
                SET remaining_credits = remaining_credits - $2,
                    total_used = total_used + $2,
                    last_updated = CURRENT_TIMESTAMP
                WHERE user_id = $1 AND remaining_credits >= $2
                RETURNING user_id, remaining_credits, total_used, last_updated
            `;
            params = [userId, amount];
        } else {
            // Set absolute value
            query = `
                INSERT INTO credits (user_id, remaining_credits, total_used, last_updated)
                VALUES ($1, $2, 0, CURRENT_TIMESTAMP)
                ON CONFLICT (user_id)
                DO UPDATE SET 
                    remaining_credits = $2,
                    last_updated = CURRENT_TIMESTAMP
                RETURNING user_id, remaining_credits, total_used, last_updated
            `;
            params = [userId, amount];
        }

        const result = await db.query(query, params);

        if (result.rows.length === 0) {
            res.status(400).json({
                success: false,
                error: 'Bad Request',
                message: operation === 'deduct' 
                    ? 'Insufficient credits or user not found' 
                    : 'User not found',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        logger.info('Credits adjusted via external API', { 
            correlationId, 
            userId, 
            operation, 
            amount,
            reason: reason || 'not specified',
            newBalance: result.rows[0].remaining_credits,
        });

        res.status(200).json({
            success: true,
            data: {
                ...result.rows[0],
                adjustment: {
                    operation,
                    amount,
                    reason: reason || null,
                },
            },
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to adjust credits', { correlationId, userId, operation, amount, error });
        res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            message: 'Failed to adjust credits',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// =====================================
// PHONE NUMBER MANAGEMENT
// =====================================

// GET /api/v1/phone-numbers - List phone numbers for a user
export async function listPhoneNumbers(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const userId = req.query.user_id as string;
    const platform = req.query.platform as string | undefined;

    if (!userId) {
        res.status(400).json({
            success: false,
            error: 'Bad Request',
            message: 'user_id query parameter is required',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    try {
        let query = `SELECT id, user_id, platform, meta_phone_number_id, display_name, waba_id, created_at, updated_at
             FROM phone_numbers 
             WHERE user_id = $1 AND platform IN ('whatsapp', 'instagram')`;
        const params: string[] = [userId];

        // Filter by platform if specified
        if (platform && ['whatsapp', 'instagram'].includes(platform)) {
            query = `SELECT id, user_id, platform, meta_phone_number_id, display_name, waba_id, created_at, updated_at
                     FROM phone_numbers 
                     WHERE user_id = $1 AND platform = $2`;
            params.push(platform);
        }

        query += ' ORDER BY created_at DESC';

        const result = await db.query<PhoneNumber>(query, params);

        logger.info('Listed phone numbers for external API', { 
            correlationId, 
            userId, 
            platform,
            count: result.rows.length 
        });

        res.status(200).json({
            success: true,
            data: result.rows.map(pn => ({
                id: pn.id,
                user_id: pn.user_id,
                platform: pn.platform,
                meta_phone_number_id: pn.meta_phone_number_id,
                display_name: pn.display_name,
                waba_id: pn.waba_id,
                created_at: pn.created_at,
                updated_at: pn.updated_at,
            })),
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to list phone numbers', { correlationId, userId, error });
        res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            message: 'Failed to list phone numbers',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// POST /api/v1/phone-numbers - Create a new phone number
export async function createPhoneNumber(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { user_id, platform, meta_phone_number_id, access_token, display_name, waba_id } = req.body;

    // Validate required fields
    if (!user_id || !platform || !meta_phone_number_id || !access_token) {
        res.status(400).json({
            success: false,
            error: 'Bad Request',
            message: 'user_id, platform, meta_phone_number_id, and access_token are required',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    // Validate platform
    const validPlatforms: Platform[] = ['whatsapp', 'instagram'];
    if (!validPlatforms.includes(platform)) {
        res.status(400).json({
            success: false,
            error: 'Bad Request',
            message: `platform must be one of: ${validPlatforms.join(', ')}`,
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    // Require waba_id for WhatsApp (needed for template management)
    if (platform === 'whatsapp' && !waba_id) {
        res.status(400).json({
            success: false,
            error: 'Bad Request',
            message: 'waba_id is required for WhatsApp phone numbers (needed for template management)',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    try {
        // Verify user exists
        const userResult = await db.query('SELECT user_id FROM users WHERE user_id = $1', [user_id]);
        if (userResult.rows.length === 0) {
            res.status(404).json({
                success: false,
                error: 'Not Found',
                message: 'User not found',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        const phoneNumberId = generateId('pn');

        const result = await db.query<PhoneNumber>(
            `INSERT INTO phone_numbers (id, user_id, platform, meta_phone_number_id, access_token, display_name, waba_id, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             RETURNING id, user_id, platform, meta_phone_number_id, display_name, waba_id, created_at, updated_at`,
            [phoneNumberId, user_id, platform, meta_phone_number_id, access_token, display_name || null, waba_id || null]
        );

        logger.info('Phone number created via external API', { 
            correlationId, 
            phoneNumberId, 
            userId: user_id, 
            platform 
        });

        res.status(201).json({
            success: true,
            data: result.rows[0],
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error: any) {
        if (error.code === '23505') { // Unique constraint violation
            res.status(409).json({
                success: false,
                error: 'Conflict',
                message: 'This meta_phone_number_id is already registered for this user and platform',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }
        logger.error('Failed to create phone number', { correlationId, user_id, platform, error });
        res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            message: 'Failed to create phone number',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// GET /api/v1/phone-numbers/:phoneNumberId - Get a specific phone number
export async function getPhoneNumber(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { phoneNumberId } = req.params;

    try {
        const result = await db.query<PhoneNumber>(
            `SELECT id, user_id, platform, meta_phone_number_id, display_name, waba_id, created_at, updated_at
             FROM phone_numbers WHERE id = $1`,
            [phoneNumberId]
        );

        if (result.rows.length === 0) {
            res.status(404).json({
                success: false,
                error: 'Not Found',
                message: 'Phone number not found',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        // Also get linked agent info
        const agentResult = await db.query<Agent>(
            `SELECT agent_id, name, prompt_id, created_at FROM agents WHERE phone_number_id = $1`,
            [phoneNumberId]
        );

        res.status(200).json({
            success: true,
            data: {
                ...result.rows[0],
                agent: agentResult.rows[0] || null,
            },
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to get phone number', { correlationId, phoneNumberId, error });
        res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            message: 'Failed to get phone number',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// PATCH /api/v1/phone-numbers/:phoneNumberId - Update a phone number
export async function updatePhoneNumber(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { phoneNumberId } = req.params;
    const { access_token, display_name, waba_id } = req.body;

    // At least one field must be provided
    if (!access_token && !display_name && !waba_id) {
        res.status(400).json({
            success: false,
            error: 'Bad Request',
            message: 'At least one field (access_token, display_name, or waba_id) must be provided',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    try {
        // Check if phone number exists
        const existingResult = await db.query<PhoneNumber>(
            'SELECT id FROM phone_numbers WHERE id = $1',
            [phoneNumberId]
        );

        if (existingResult.rows.length === 0) {
            res.status(404).json({
                success: false,
                error: 'Not Found',
                message: 'Phone number not found',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        // Build dynamic update query
        const updates: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        if (access_token) {
            updates.push(`access_token = $${paramIndex++}`);
            values.push(access_token);
        }
        if (display_name !== undefined) {
            updates.push(`display_name = $${paramIndex++}`);
            values.push(display_name);
        }
        if (waba_id !== undefined) {
            updates.push(`waba_id = $${paramIndex++}`);
            values.push(waba_id);
        }

        updates.push(`updated_at = CURRENT_TIMESTAMP`);
        values.push(phoneNumberId);

        const result = await db.query<PhoneNumber>(
            `UPDATE phone_numbers SET ${updates.join(', ')} WHERE id = $${paramIndex}
             RETURNING id, user_id, platform, meta_phone_number_id, display_name, waba_id, created_at, updated_at`,
            values
        );

        logger.info('Phone number updated via external API', { correlationId, phoneNumberId });

        res.status(200).json({
            success: true,
            data: result.rows[0],
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to update phone number', { correlationId, phoneNumberId, error });
        res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            message: 'Failed to update phone number',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// DELETE /api/v1/phone-numbers/:phoneNumberId - Delete a phone number
export async function deletePhoneNumber(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { phoneNumberId } = req.params;

    try {
        // Check if phone number exists
        const existingResult = await db.query<PhoneNumber>(
            'SELECT id FROM phone_numbers WHERE id = $1',
            [phoneNumberId]
        );

        if (existingResult.rows.length === 0) {
            res.status(404).json({
                success: false,
                error: 'Not Found',
                message: 'Phone number not found',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        // Check for linked agent
        const agentResult = await db.query('SELECT agent_id FROM agents WHERE phone_number_id = $1', [phoneNumberId]);
        if (agentResult.rows.length > 0) {
            res.status(409).json({
                success: false,
                error: 'Conflict',
                message: 'Cannot delete phone number with an active agent. Delete the agent first.',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        await db.query('DELETE FROM phone_numbers WHERE id = $1', [phoneNumberId]);

        logger.info('Phone number deleted via external API', { correlationId, phoneNumberId });

        res.status(200).json({
            success: true,
            message: 'Phone number deleted successfully',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to delete phone number', { correlationId, phoneNumberId, error });
        res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            message: 'Failed to delete phone number',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// =====================================
// AGENT MANAGEMENT
// =====================================

// GET /api/v1/agents - List agents for a user
export async function listAgents(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const userId = req.query.user_id as string;

    if (!userId) {
        res.status(400).json({
            success: false,
            error: 'Bad Request',
            message: 'user_id query parameter is required',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    try {
        const result = await db.query<Agent & { phone_number_platform: string; phone_number_display_name: string }>(
            `SELECT a.agent_id, a.user_id, a.phone_number_id, a.prompt_id, a.name, a.created_at, a.updated_at,
                    p.platform as phone_number_platform, p.display_name as phone_number_display_name
             FROM agents a
             JOIN phone_numbers p ON a.phone_number_id = p.id
             WHERE a.user_id = $1
             ORDER BY a.created_at DESC`,
            [userId]
        );

        logger.info('Listed agents for external API', { correlationId, userId, count: result.rows.length });

        res.status(200).json({
            success: true,
            data: result.rows.map(a => ({
                agent_id: a.agent_id,
                user_id: a.user_id,
                phone_number_id: a.phone_number_id,
                prompt_id: a.prompt_id,
                name: a.name,
                phone_number: {
                    platform: a.phone_number_platform,
                    display_name: a.phone_number_display_name,
                },
                created_at: a.created_at,
                updated_at: a.updated_at,
            })),
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to list agents', { correlationId, userId, error });
        res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            message: 'Failed to list agents',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// POST /api/v1/agents - Create a new agent
export async function createAgent(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { user_id, phone_number_id, prompt_id, name } = req.body;

    // Validate required fields
    if (!user_id || !phone_number_id || !prompt_id || !name) {
        res.status(400).json({
            success: false,
            error: 'Bad Request',
            message: 'user_id, phone_number_id, prompt_id, and name are required',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    try {
        // Verify phone number exists and belongs to user
        const phoneResult = await db.query<PhoneNumber>(
            'SELECT id, user_id FROM phone_numbers WHERE id = $1',
            [phone_number_id]
        );

        if (phoneResult.rows.length === 0) {
            res.status(404).json({
                success: false,
                error: 'Not Found',
                message: 'Phone number not found',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        const phoneNumber = phoneResult.rows[0]!;
        if (phoneNumber.user_id !== user_id) {
            res.status(403).json({
                success: false,
                error: 'Forbidden',
                message: 'Phone number does not belong to this user',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        // Check if phone number already has an agent
        const existingAgent = await db.query(
            'SELECT agent_id FROM agents WHERE phone_number_id = $1',
            [phone_number_id]
        );

        if (existingAgent.rows.length > 0) {
            res.status(409).json({
                success: false,
                error: 'Conflict',
                message: 'Phone number already has an active agent. Update or delete the existing agent first.',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        const agentId = generateId('agt');

        const result = await db.query<Agent>(
            `INSERT INTO agents (agent_id, user_id, phone_number_id, prompt_id, name, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             RETURNING agent_id, user_id, phone_number_id, prompt_id, name, created_at, updated_at`,
            [agentId, user_id, phone_number_id, prompt_id, name]
        );

        logger.info('Agent created via external API', { 
            correlationId, 
            agentId, 
            userId: user_id, 
            phoneNumberId: phone_number_id 
        });

        res.status(201).json({
            success: true,
            data: result.rows[0],
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to create agent', { correlationId, user_id, phone_number_id, error });
        res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            message: 'Failed to create agent',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// GET /api/v1/agents/:agentId - Get a specific agent
export async function getAgent(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { agentId } = req.params;

    try {
        const result = await db.query<Agent & { phone_number_platform: string; phone_number_display_name: string; meta_phone_number_id: string }>(
            `SELECT a.agent_id, a.user_id, a.phone_number_id, a.prompt_id, a.name, a.created_at, a.updated_at,
                    p.platform as phone_number_platform, p.display_name as phone_number_display_name, p.meta_phone_number_id
             FROM agents a
             JOIN phone_numbers p ON a.phone_number_id = p.id
             WHERE a.agent_id = $1`,
            [agentId]
        );

        if (result.rows.length === 0) {
            res.status(404).json({
                success: false,
                error: 'Not Found',
                message: 'Agent not found',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        const agent = result.rows[0]!;

        // Get conversation stats
        const statsResult = await db.query(
            `SELECT COUNT(*) as total_conversations,
                    COUNT(CASE WHEN is_active = true THEN 1 END) as active_conversations
             FROM conversations WHERE agent_id = $1`,
            [agentId]
        );

        res.status(200).json({
            success: true,
            data: {
                agent_id: agent.agent_id,
                user_id: agent.user_id,
                phone_number_id: agent.phone_number_id,
                prompt_id: agent.prompt_id,
                name: agent.name,
                phone_number: {
                    platform: agent.phone_number_platform,
                    display_name: agent.phone_number_display_name,
                    meta_phone_number_id: agent.meta_phone_number_id,
                },
                stats: {
                    total_conversations: parseInt(statsResult.rows[0]?.total_conversations || '0'),
                    active_conversations: parseInt(statsResult.rows[0]?.active_conversations || '0'),
                },
                created_at: agent.created_at,
                updated_at: agent.updated_at,
            },
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to get agent', { correlationId, agentId, error });
        res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            message: 'Failed to get agent',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// PATCH /api/v1/agents/:agentId - Update an agent
export async function updateAgent(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { agentId } = req.params;
    const { name, prompt_id } = req.body;

    // At least one field must be provided
    if (!name && !prompt_id) {
        res.status(400).json({
            success: false,
            error: 'Bad Request',
            message: 'At least one field (name or prompt_id) must be provided',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    try {
        // Check if agent exists
        const existingResult = await db.query<Agent>(
            'SELECT agent_id FROM agents WHERE agent_id = $1',
            [agentId]
        );

        if (existingResult.rows.length === 0) {
            res.status(404).json({
                success: false,
                error: 'Not Found',
                message: 'Agent not found',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        // Build dynamic update query
        const updates: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        if (name) {
            updates.push(`name = $${paramIndex++}`);
            values.push(name);
        }
        if (prompt_id) {
            updates.push(`prompt_id = $${paramIndex++}`);
            values.push(prompt_id);
        }

        updates.push(`updated_at = CURRENT_TIMESTAMP`);
        values.push(agentId);

        const result = await db.query<Agent>(
            `UPDATE agents SET ${updates.join(', ')} WHERE agent_id = $${paramIndex}
             RETURNING agent_id, user_id, phone_number_id, prompt_id, name, created_at, updated_at`,
            values
        );

        logger.info('Agent updated via external API', { correlationId, agentId });

        res.status(200).json({
            success: true,
            data: result.rows[0],
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to update agent', { correlationId, agentId, error });
        res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            message: 'Failed to update agent',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// DELETE /api/v1/agents/:agentId - Delete an agent
export async function deleteAgent(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { agentId } = req.params;

    try {
        // Check if agent exists
        const existingResult = await db.query<Agent>(
            'SELECT agent_id FROM agents WHERE agent_id = $1',
            [agentId]
        );

        if (existingResult.rows.length === 0) {
            res.status(404).json({
                success: false,
                error: 'Not Found',
                message: 'Agent not found',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        // Note: This will leave conversations orphaned but they can be archived
        await db.query('DELETE FROM agents WHERE agent_id = $1', [agentId]);

        logger.info('Agent deleted via external API', { correlationId, agentId });

        res.status(200).json({
            success: true,
            message: 'Agent deleted successfully',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to delete agent', { correlationId, agentId, error });
        res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            message: 'Failed to delete agent',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// =====================================
// GET /api/v1/templates
// List approved templates for a phone number
// =====================================
export async function listTemplates(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const phoneNumberId = req.query.phone_number_id as string;

    if (!phoneNumberId) {
        res.status(400).json({
            success: false,
            error: 'Bad Request',
            message: 'phone_number_id query parameter is required',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    try {
        // Get user_id from phone number
        const phoneResult = await db.query<PhoneNumber>(
            'SELECT user_id FROM phone_numbers WHERE id = $1',
            [phoneNumberId]
        );

        if (phoneResult.rows.length === 0) {
            res.status(404).json({
                success: false,
                error: 'Not Found',
                message: 'Phone number not found',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        // Get all templates for this phone number (all statuses)
        const result = await db.query<Template>(
            `SELECT template_id, name, category, status, language, components, 
                    meta_template_id, header_type, rejection_reason, 
                    submitted_at, approved_at, created_at, updated_at,
                    header_media_url, header_document_filename,
                    header_location_latitude, header_location_longitude,
                    header_location_name, header_location_address, waba_id
             FROM templates 
             WHERE phone_number_id = $1
             ORDER BY created_at DESC`,
            [phoneNumberId]
        );

        // Get variables for each template
        const templatesWithVariables = await Promise.all(
            result.rows.map(async (template) => {
                const variables = await templateService.getTemplateVariables(template.template_id);
                return {
                    template_id: template.template_id,
                    name: template.name,
                    category: template.category,
                    status: template.status,
                    language: template.language,
                    components: template.components,
                    header_type: template.header_type,
                    header_media_url: template.header_media_url,
                    header_document_filename: template.header_document_filename,
                    header_location_latitude: template.header_location_latitude,
                    header_location_longitude: template.header_location_longitude,
                    header_location_name: template.header_location_name,
                    header_location_address: template.header_location_address,
                    meta_template_id: template.meta_template_id,
                    waba_id: template.waba_id,
                    rejection_reason: template.rejection_reason,
                    submitted_at: template.submitted_at,
                    approved_at: template.approved_at,
                    created_at: template.created_at,
                    updated_at: template.updated_at,
                    variables: variables.map(v => ({
                        position: v.position,
                        variable_name: v.variable_name,
                        component_type: v.component_type,
                        dashboard_mapping: v.dashboard_mapping,
                        default_value: v.default_value,
                        sample_value: v.sample_value,
                    })),
                };
            })
        );

        logger.info('Listed templates for external API', { 
            correlationId, 
            phoneNumberId, 
            count: templatesWithVariables.length 
        });

        res.status(200).json({
            success: true,
            data: templatesWithVariables,
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to list templates', { correlationId, phoneNumberId, error });
        res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            message: 'Failed to list templates',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// =====================================
// GET /api/v1/templates/:templateId
// Get single template with variables and analytics
// =====================================
export async function getTemplate(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { templateId } = req.params;

    try {
        const template = await templateService.getTemplateById(templateId!);
        if (!template) {
            res.status(404).json({
                success: false,
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

        logger.info('Fetched template via external API', { correlationId, templateId });

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
            success: false,
            error: 'Internal Server Error',
            message: 'Failed to get template',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// =====================================
// POST /api/v1/templates
// Create template (supports all header types: TEXT, IMAGE, VIDEO, DOCUMENT, LOCATION)
// =====================================
export async function createTemplate(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { 
        user_id, 
        phone_number_id, 
        name, 
        category, 
        language, 
        components, 
        variables,
        // Media header fields
        header_type,
        header_media_url,
        header_document_filename,
        // Location header fields  
        header_location_latitude,
        header_location_longitude,
        header_location_name,
        header_location_address,
    } = req.body;

    // Validate required fields
    if (!user_id || !phone_number_id || !name || !category) {
        res.status(400).json({
            success: false,
            error: 'Bad Request',
            message: 'user_id, phone_number_id, name, and category are required',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    try {
        // Normalize components from array format (Meta) to object format (our schema)
        const normalizedComponents = normalizeTemplateComponents(components) as unknown as TemplateComponents;

        // Extract media URL from components if not provided directly
        // Dashboard may send it inside components[].example.header_handle
        let extractedMediaUrl = header_media_url;
        let extractedHeaderType = header_type;
        let extractedDocumentFilename = header_document_filename;

        if (Array.isArray(components)) {
            const headerComponent = components.find((c: any) => c.type === 'HEADER');
            if (headerComponent) {
                // Set header type from component format
                if (!extractedHeaderType && headerComponent.format) {
                    extractedHeaderType = headerComponent.format;
                }
                
                // Extract URL from example.header_handle (Meta's format)
                if (!extractedMediaUrl && headerComponent.example?.header_handle?.[0]) {
                    extractedMediaUrl = headerComponent.example.header_handle[0];
                }
                
                // Also check for direct URL field
                if (!extractedMediaUrl && headerComponent.url) {
                    extractedMediaUrl = headerComponent.url;
                }

                // Extract document filename if present
                if (!extractedDocumentFilename && headerComponent.filename) {
                    extractedDocumentFilename = headerComponent.filename;
                }
            }
        }

        // Get waba_id from phone_numbers table (auto-populate)
        const phoneResult = await db.query<PhoneNumber>(
            'SELECT waba_id FROM phone_numbers WHERE id = $1 AND user_id = $2',
            [phone_number_id, user_id]
        );
        const wabaId = phoneResult.rows[0]?.waba_id || undefined;

        // Use transaction to ensure template + variables are created atomically
        const templateId = uuidv4();
        
        const template = await db.transaction(async (client) => {
            // Create template
            const templateResult = await client.query<Template>(
                `INSERT INTO templates (
                    template_id, user_id, phone_number_id, name, category, language,
                    components, header_type, header_media_url, header_document_filename,
                    header_location_latitude, header_location_longitude,
                    header_location_name, header_location_address, waba_id
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                RETURNING *`,
                [
                    templateId,
                    user_id,
                    phone_number_id,
                    name,
                    category,
                    language || 'en',
                    JSON.stringify(normalizedComponents),
                    extractedHeaderType || 'NONE',
                    extractedMediaUrl || null,
                    extractedDocumentFilename || null,
                    header_location_latitude || null,
                    header_location_longitude || null,
                    header_location_name || null,
                    header_location_address || null,
                    wabaId || null,
                ]
            );
            const createdTemplate = templateResult.rows[0]!;

            // Create variables if provided
            if (variables && Array.isArray(variables)) {
                for (const variable of variables) {
                    await client.query(
                        `INSERT INTO template_variables (
                            variable_id, template_id, variable_name, position, 
                            component_type, dashboard_mapping, default_value, sample_value,
                            description, is_required, placeholder
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                        [
                            uuidv4(),
                            templateId,
                            variable.variable_name,
                            variable.position,
                            variable.component_type || 'BODY',
                            variable.dashboard_mapping || null, // Dashboard's variable identifier
                            variable.default_value || null,
                            variable.sample_value || null,
                            variable.description || null,
                            variable.is_required || false,
                            variable.placeholder || null,
                        ]
                    );
                }
            }

            return createdTemplate;
        });

        logger.info('Template created via external API', { 
            correlationId, 
            templateId: template.template_id,
            userId: user_id,
            variableCount: variables?.length || 0,
        });

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
            success: false,
            error: 'Bad Request',
            message,
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// =====================================
// POST /api/v1/templates/:templateId/submit
// Submit template to Meta for approval
// =====================================
export async function submitTemplate(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { templateId } = req.params;

    try {
        const template = await templateService.submitTemplateToMeta(templateId!);

        logger.info('Template submitted to Meta via external API', { correlationId, templateId });

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
            success: false,
            error: 'Bad Request',
            message,
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// =====================================
// POST /api/v1/templates/sync
// Sync templates from Meta (import existing approved templates)
// =====================================
export async function syncTemplates(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { user_id, phone_number_id } = req.body;

    if (!user_id || !phone_number_id) {
        res.status(400).json({
            success: false,
            error: 'Bad Request',
            message: 'user_id and phone_number_id are required',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    try {
        const result = await templateService.syncTemplatesFromMeta(user_id, phone_number_id);

        logger.info('Templates synced from Meta via external API', { 
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
            success: false,
            error: 'Internal Server Error',
            message: error instanceof Error ? error.message : 'Failed to sync templates',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// =====================================
// DELETE /api/v1/templates/:templateId
// Delete template
// =====================================
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
                success: false,
                error: 'Not Found',
                message: 'Template not found',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        logger.info('Template deleted via external API', { correlationId, templateId });

        res.status(200).json({
            success: true,
            message: 'Template deleted successfully',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to delete template', { correlationId, templateId, error });
        res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            message: 'Failed to delete template',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// =====================================
// GET /api/v1/templates/:templateId/button-clicks
// Get button click analytics for a template
// =====================================
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
            success: false,
            error: 'Internal Server Error',
            message: 'Failed to get button click analytics',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// =====================================
// GET /api/v1/button-clicks
// List all button clicks for a user
// =====================================
export async function listButtonClicks(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const userId = req.query.user_id as string;
    const templateId = req.query.template_id as string;

    if (!userId) {
        res.status(400).json({
            success: false,
            error: 'Bad Request',
            message: 'user_id query parameter is required',
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
            success: false,
            error: 'Internal Server Error',
            message: 'Failed to list button clicks',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// =====================================
// GET /api/v1/leads/:customerPhone/button-activity
// Get button activity for a specific lead
// =====================================
export async function getLeadButtonActivity(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { customerPhone } = req.params;
    const userId = req.query.user_id as string;

    if (!userId) {
        res.status(400).json({
            success: false,
            error: 'Bad Request',
            message: 'user_id query parameter is required',
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
            success: false,
            error: 'Internal Server Error',
            message: 'Failed to get lead button activity',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// =====================================
// POST /api/v1/send
// Send single template message directly
// =====================================
export async function sendSingleMessage(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { phone_number_id, template_id, contact, variables } = req.body;

    // Validate required fields
    if (!phone_number_id || !template_id || !contact?.phone) {
        res.status(400).json({
            success: false,
            error: 'Bad Request',
            message: 'phone_number_id, template_id, and contact.phone are required',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    try {
        // Get phone number to find user_id
        const phoneResult = await db.query<PhoneNumber>(
            'SELECT * FROM phone_numbers WHERE id = $1',
            [phone_number_id]
        );

        if (phoneResult.rows.length === 0) {
            res.status(404).json({
                success: false,
                error: 'Not Found',
                message: 'Phone number not found',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        const phoneNumber = phoneResult.rows[0]!;
        const userId = phoneNumber.user_id;

        // Get template
        const template = await templateService.getTemplateById(template_id);
        if (!template || template.status !== 'APPROVED') {
            res.status(400).json({
                success: false,
                error: 'Bad Request',
                message: 'Template not found or not approved',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        // Check credits
        const currentCredits = await getUserCredits(userId);
        if (currentCredits < 1) {
            res.status(402).json({
                success: false,
                error: 'Payment Required',
                message: 'Insufficient credits',
                credits_remaining: currentCredits,
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        // Normalize phone number (ensure E.164 format)
        const normalizedPhone = normalizePhoneNumber(contact.phone);

        // Create or update contact
        let savedContact = await contactService.getContactByPhone(userId, normalizedPhone);
        
        if (savedContact) {
            // Update existing contact
            savedContact = await contactService.updateContact(savedContact.contact_id, {
                name: contact.name || savedContact.name,
                email: contact.email || savedContact.email,
                company: contact.company || savedContact.company,
            });
        } else {
            // Create new contact
            savedContact = await contactService.createContact({
                contact_id: uuidv4(),
                user_id: userId,
                phone: normalizedPhone,
                name: contact.name || null,
                email: contact.email || null,
                company: contact.company || null,
                source: 'MANUAL',
            });
        }

        // Get agent for this phone number (needed for conversation)
        const agentResult = await db.query(
            'SELECT agent_id, prompt_id FROM agents WHERE phone_number_id = $1',
            [phone_number_id]
        );

        if (agentResult.rows.length === 0) {
            res.status(400).json({
                success: false,
                error: 'Bad Request',
                message: 'No agent configured for this phone number',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        const agent = agentResult.rows[0];

        // Create conversation with OpenAI context
        const conversationId = uuidv4();
        const templateText = getTemplateText(template, variables || {});
        
        // Create OpenAI conversation with template as context
        const openaiConversationId = await createOpenAIConversationForTemplate(
            templateText,
            correlationId
        );

        // Insert conversation record
        await db.query(
            `INSERT INTO conversations (conversation_id, agent_id, customer_phone, openai_conversation_id, created_at, last_message_at, is_active)
             VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, true)`,
            [conversationId, agent.agent_id, normalizedPhone, openaiConversationId]
        );

        // Deduct 1 credit
        const creditsRemaining = await deductCredits(userId, 1);

        // Send template message via WhatsApp
        const sendResult = await sendTemplateMessage(
            phone_number_id,
            normalizedPhone,
            template.name,
            template.language,
            variables || {},
            correlationId
        );

        if (!sendResult.success) {
            // Refund credit if send failed (TODO: implement refund)
            logger.error('Failed to send template message', { 
                correlationId, 
                error: sendResult.error 
            });
            
            res.status(500).json({
                success: false,
                error: 'Send Failed',
                message: sendResult.error || 'Failed to send message',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        // Save message record
        const messageId = sendResult.messageId || `msg_${Date.now()}`;
        await db.query(
            `INSERT INTO messages (message_id, conversation_id, sender, text, timestamp, status, sequence_no, platform_message_id)
             VALUES ($1, $2, 'agent', $3, CURRENT_TIMESTAMP, 'sent', 1, $4)`,
            [messageId, conversationId, templateText, sendResult.messageId]
        );

        // Track template send
        const sendId = `send_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        await templateService.createTemplateSend({
            send_id: sendId,
            template_id: template.template_id,
            customer_phone: normalizedPhone,
            conversation_id: conversationId,
        });

        if (sendResult.messageId) {
            await templateService.updateTemplateSendStatus(sendId, 'SENT', sendResult.messageId);
        }

        // Update contact messaging stats
        await contactService.updateMessagingStats(savedContact!.contact_id, 'sent');

        logger.info('Single message sent via external API', {
            correlationId,
            userId,
            contactId: savedContact!.contact_id,
            conversationId,
            templateId: template_id,
        });

        res.status(200).json({
            success: true,
            data: {
                message_id: sendResult.messageId,
                contact_id: savedContact!.contact_id,
                conversation_id: conversationId,
                openai_conversation_id: openaiConversationId,
                credits_remaining: creditsRemaining,
            },
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        if (error instanceof InsufficientCreditsError) {
            res.status(402).json({
                success: false,
                error: 'Payment Required',
                message: 'Insufficient credits',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        logger.error('Failed to send single message', { correlationId, error });
        res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            message: error instanceof Error ? error.message : 'Failed to send message',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// =====================================
// POST /api/v1/campaign
// Create campaign for multiple contacts
// =====================================
export async function createExternalCampaign(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { phone_number_id, template_id, name, description, contacts, schedule } = req.body;

    // Validate required fields
    if (!phone_number_id || !template_id || !contacts || !Array.isArray(contacts)) {
        res.status(400).json({
            success: false,
            error: 'Bad Request',
            message: 'phone_number_id, template_id, and contacts array are required',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    // Validate contacts
    if (contacts.length === 0) {
        res.status(400).json({
            success: false,
            error: 'Bad Request',
            message: 'At least one contact is required',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    const maxContacts = campaignsConfig.maxRecipientsPerCampaign;
    if (contacts.length > maxContacts) {
        res.status(400).json({
            success: false,
            error: 'Bad Request',
            message: `Maximum ${maxContacts} contacts allowed per campaign`,
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    // Validate each contact has phone
    const invalidContacts = contacts.filter((c: { phone?: string }) => !c.phone);
    if (invalidContacts.length > 0) {
        res.status(400).json({
            success: false,
            error: 'Bad Request',
            message: 'All contacts must have a phone number',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    try {
        // Get phone number to find user_id
        const phoneResult = await db.query<PhoneNumber>(
            'SELECT * FROM phone_numbers WHERE id = $1',
            [phone_number_id]
        );

        if (phoneResult.rows.length === 0) {
            res.status(404).json({
                success: false,
                error: 'Not Found',
                message: 'Phone number not found',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        const phoneNumber = phoneResult.rows[0]!;
        const userId = phoneNumber.user_id;

        // Validate template
        const template = await templateService.getTemplateById(template_id);
        if (!template || template.status !== 'APPROVED') {
            res.status(400).json({
                success: false,
                error: 'Bad Request',
                message: 'Template not found or not approved',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        // Check credits upfront
        const creditsRequired = contacts.length;
        const currentCredits = await getUserCredits(userId);
        
        if (currentCredits < creditsRequired) {
            res.status(402).json({
                success: false,
                error: 'Payment Required',
                message: `Insufficient credits. Required: ${creditsRequired}, Available: ${currentCredits}`,
                credits_required: creditsRequired,
                credits_available: currentCredits,
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        // Deduct credits upfront
        const creditsRemaining = await deductCredits(userId, creditsRequired);

        // Create/update contacts and collect their IDs
        const contactIds: string[] = [];
        const contactErrors: Array<{ phone: string; error: string }> = [];

        for (const contactData of contacts) {
            try {
                const normalizedPhone = normalizePhoneNumber(contactData.phone);
                
                let savedContact = await contactService.getContactByPhone(userId, normalizedPhone);
                
                if (savedContact) {
                    // Update existing contact
                    savedContact = await contactService.updateContact(savedContact.contact_id, {
                        name: contactData.name || savedContact.name,
                        email: contactData.email || savedContact.email,
                        company: contactData.company || savedContact.company,
                    });
                } else {
                    // Create new contact
                    savedContact = await contactService.createContact({
                        contact_id: uuidv4(),
                        user_id: userId,
                        phone: normalizedPhone,
                        name: contactData.name || null,
                        email: contactData.email || null,
                        company: contactData.company || null,
                        source: 'MANUAL',
                    });
                }

                if (savedContact) {
                    contactIds.push(savedContact.contact_id);
                }
            } catch (err) {
                contactErrors.push({
                    phone: contactData.phone,
                    error: err instanceof Error ? err.message : 'Failed to create contact',
                });
            }
        }

        if (contactIds.length === 0) {
            res.status(400).json({
                success: false,
                error: 'Bad Request',
                message: 'Failed to create any contacts',
                errors: contactErrors,
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        // Create campaign with contact_ids filter
        const campaignId = uuidv4();
        const campaignName = name || `External Campaign ${new Date().toISOString().split('T')[0]}`;
        
        const campaign = await campaignService.createCampaign({
            campaign_id: campaignId,
            user_id: userId,
            template_id,
            phone_number_id,
            name: campaignName,
            description: description || 'Created via External API',
            recipient_filter: { contactIds: contactIds },
        });

        // Determine schedule type
        const scheduleType = schedule?.type || 'IMMEDIATE';
        const scheduledAt = schedule?.scheduled_at ? new Date(schedule.scheduled_at) : undefined;

        // Create trigger
        await campaignService.createTrigger({
            trigger_id: uuidv4(),
            campaign_id: campaignId,
            trigger_type: scheduleType,
            scheduled_at: scheduledAt,
        });

        // If immediate, start the campaign
        let finalCampaign: Campaign = campaign;
        if (scheduleType === 'IMMEDIATE') {
            finalCampaign = await campaignService.startCampaignWithContactIds(campaignId, contactIds);
        }

        logger.info('External campaign created', {
            correlationId,
            userId,
            campaignId,
            totalContacts: contactIds.length,
            creditsDeducted: creditsRequired,
            scheduleType,
        });

        res.status(201).json({
            success: true,
            data: {
                campaign_id: campaignId,
                name: campaignName,
                status: finalCampaign.status,
                total_recipients: contactIds.length,
                credits_deducted: creditsRequired,
                credits_remaining: creditsRemaining,
                schedule: {
                    type: scheduleType,
                    scheduled_at: scheduledAt?.toISOString() || null,
                },
                contact_errors: contactErrors.length > 0 ? contactErrors : undefined,
            },
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        if (error instanceof InsufficientCreditsError) {
            res.status(402).json({
                success: false,
                error: 'Payment Required',
                message: 'Insufficient credits',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        logger.error('Failed to create external campaign', { correlationId, error });
        res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            message: error instanceof Error ? error.message : 'Failed to create campaign',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// =====================================
// GET /api/v1/campaign/:campaignId
// Get campaign status
// =====================================
export async function getCampaignStatus(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    const { campaignId } = req.params;

    if (!campaignId) {
        res.status(400).json({
            success: false,
            error: 'Bad Request',
            message: 'campaignId is required',
            timestamp: new Date().toISOString(),
            correlationId,
        });
        return;
    }

    try {
        const campaign = await campaignService.getCampaignById(campaignId);
        
        if (!campaign) {
            res.status(404).json({
                success: false,
                error: 'Not Found',
                message: 'Campaign not found',
                timestamp: new Date().toISOString(),
                correlationId,
            });
            return;
        }

        // Get recipient stats
        const stats = await campaignService.getCampaignRecipientStats(campaignId);

        logger.info('Campaign status retrieved', { correlationId, campaignId });

        res.status(200).json({
            success: true,
            data: {
                campaign_id: campaign.campaign_id,
                name: campaign.name,
                status: campaign.status,
                total_recipients: campaign.total_recipients,
                sent_count: campaign.sent_count,
                delivered_count: campaign.delivered_count,
                read_count: campaign.read_count,
                failed_count: campaign.failed_count,
                progress_percent: campaign.total_recipients > 0 
                    ? Math.round((campaign.sent_count / campaign.total_recipients) * 100) 
                    : 0,
                started_at: campaign.started_at,
                completed_at: campaign.completed_at,
                recipient_stats: stats,
            },
            timestamp: new Date().toISOString(),
            correlationId,
        });
    } catch (error) {
        logger.error('Failed to get campaign status', { correlationId, campaignId, error });
        res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            message: 'Failed to get campaign status',
            timestamp: new Date().toISOString(),
            correlationId,
        });
    }
}

// =====================================
// Helper Functions
// =====================================

/**
 * Normalize phone number to E.164 format
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
 * Extract text from template with variables substituted
 */
function getTemplateText(template: Template, variables: Record<string, string>): string {
    let text = template.components.body?.text || '';
    
    // Substitute variables {{1}}, {{2}}, etc.
    for (const [key, value] of Object.entries(variables)) {
        text = text.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    
    return text;
}

/**
 * Create OpenAI conversation with template context
 */
async function createOpenAIConversationForTemplate(
    templateText: string,
    correlationId: string
): Promise<string | null> {
    try {
        // Import OpenAI service dynamically to avoid circular deps
        const { createOpenAIConversation } = await import('../services/openaiService');
        
        // Create conversation with metadata about the template
        const result = await createOpenAIConversation({
            source: 'template_message',
            template_context: templateText.substring(0, 200), // Limit context size
            created_via: 'external_api',
        });
        
        return result.id;
    } catch (error) {
        logger.warn('Failed to create OpenAI conversation', { correlationId, error });
        return null;
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

// Export controller
export const externalApiController = {
    // Users
    createUser,
    getUser,
    
    // Credits
    getCredits,
    adjustCredits,
    
    // Phone Numbers
    listPhoneNumbers,
    createPhoneNumber,
    getPhoneNumber,
    updatePhoneNumber,
    deletePhoneNumber,
    
    // Agents
    listAgents,
    createAgent,
    getAgent,
    updateAgent,
    deleteAgent,
    
    // Templates - CRUD
    listTemplates,
    getTemplate,
    createTemplate,
    submitTemplate,
    syncTemplates,
    deleteTemplate,
    
    // Button Click Analytics
    getTemplateButtonClicks,
    listButtonClicks,
    getLeadButtonActivity,
    
    // Messaging
    sendSingleMessage,
    createExternalCampaign,
    getCampaignStatus,
};
