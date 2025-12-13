import { Request, Response, NextFunction } from 'express';
import { db } from '../utils/database';
import { enqueueMessage } from '../utils/messageQueue';
import { logger } from '../utils/logger';
import { sseManager } from '../utils/sseManager';
import { cache } from '../utils/cacheManager';
import { QueuedMessage } from '../models/types';
import { platformsConfig } from '../config';

/**
 * Webchat Controller
 * Handles REST API endpoints for webchat functionality
 */
export class WebchatController {

    /**
     * POST /api/users/:user_id/webchat/channels
     * Create a new webchat channel with agent
     */
    createChannel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const user_id = req.params['user_id'];
            const { prompt_id, name } = req.body;

            // Validate required fields
            if (!prompt_id || !name) {
                res.status(400).json({
                    error: 'Missing required fields',
                    message: 'prompt_id and name are required',
                    timestamp: new Date().toISOString(),
                    correlationId: req.correlationId,
                });
                return;
            }

            // Verify user exists
            const userCheck = await db.query('SELECT 1 FROM users WHERE user_id = $1', [user_id]);
            if (userCheck.rows.length === 0) {
                res.status(404).json({
                    error: 'User not found',
                    message: `User with ID ${user_id} not found`,
                    timestamp: new Date().toISOString(),
                    correlationId: req.correlationId,
                });
                return;
            }

            // Generate unique IDs
            const randomString = Math.random().toString(36).substring(2, 11);
            const webchat_id = `webchat_${user_id}_${randomString}`;
            const phone_number_id = `pn_${webchat_id}`;
            const agent_id = `agent_${webchat_id}`;

            // Start transaction
            await db.query('BEGIN');

            try {
                // Create phone_number record for webchat
                const phoneNumberQuery = `
          INSERT INTO phone_numbers (id, user_id, platform, meta_phone_number_id, access_token, display_name, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
          RETURNING *
        `;

                const phoneNumberValues = [
                    phone_number_id,
                    user_id,
                    'webchat',
                    webchat_id,
                    'not_needed', // Webchat doesn't need access token
                    name
                ];

                const phoneNumberResult = await db.query(phoneNumberQuery, phoneNumberValues);

                // Create agent record linked to phone_number
                const agentQuery = `
          INSERT INTO agents (agent_id, user_id, phone_number_id, prompt_id, name, created_at)
          VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
          RETURNING *
        `;

                const agentValues = [
                    agent_id,
                    user_id,
                    phone_number_id,
                    prompt_id,
                    name
                ];

                await db.query(agentQuery, agentValues);

                // Commit transaction
                await db.query('COMMIT');

                logger.info('Webchat channel and agent created', {
                    user_id,
                    webchat_id,
                    phone_number_id,
                    agent_id,
                    prompt_id,
                    correlationId: req.correlationId,
                });

                // Generate embed code and config URL
                const embedCode = this.generateEmbedCode(webchat_id, name);
                const baseUrl = platformsConfig.webchatWidgetUrl;
                const configUrl = `${baseUrl}/widget-config.html?agent_id=${webchat_id}`;

                res.status(201).json({
                    success: true,
                    data: {
                        webchat_id,
                        phone_number_id,
                        agent_id,
                        prompt_id,
                        name,
                        embed_code: embedCode,
                        config_url: configUrl,
                        created_at: phoneNumberResult.rows[0].created_at
                    },
                    timestamp: new Date().toISOString(),
                    correlationId: req.correlationId,
                });
            } catch (error) {
                // Rollback transaction on error
                await db.query('ROLLBACK');
                throw error;
            }
        } catch (error) {
            logger.error('Error creating webchat channel', {
                error: (error as Error).message,
                user_id: req.params['user_id'],
                correlationId: req.correlationId,
            });
            next(error);
        }
    };

    /**
     * GET /api/webchat/:webchat_id/embed
     * Get embed code for webchat widget
     */
    getEmbedCode = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const webchat_id = req.params['webchat_id'];

            if (!webchat_id) {
                res.status(400).json({
                    error: 'Missing webchat_id',
                    message: 'webchat_id parameter is required',
                    timestamp: new Date().toISOString(),
                    correlationId: req.correlationId,
                });
                return;
            }

            // Verify webchat_id exists
            const phoneNumberCheck = await db.query(
                'SELECT display_name FROM phone_numbers WHERE meta_phone_number_id = $1 AND platform = $2',
                [webchat_id, 'webchat']
            );

            if (phoneNumberCheck.rows.length === 0) {
                res.status(404).json({
                    error: 'Webchat channel not found',
                    message: `Webchat channel ${webchat_id} not found`,
                    timestamp: new Date().toISOString(),
                    correlationId: req.correlationId,
                });
                return;
            }

            const name = phoneNumberCheck.rows[0].display_name;
            const embedCode = this.generateEmbedCode(webchat_id, name);

            res.status(200).json({
                success: true,
                data: {
                    webchat_id,
                    embed_code: embedCode
                },
                timestamp: new Date().toISOString(),
                correlationId: req.correlationId,
            });
        } catch (error) {
            logger.error('Error getting embed code', {
                error: (error as Error).message,
                webchat_id: req.params['webchat_id'],
                correlationId: req.correlationId,
            });
            next(error);
        }
    };

    /**
     * POST /api/webchat/:webchat_id/messages
     * Send message from website visitor
     */
    sendMessage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const webchat_id = req.params['webchat_id'];
            const { message, session_id, visitor_phone } = req.body;

            // Validate required fields
            if (!webchat_id || !message || !session_id || !visitor_phone) {
                res.status(400).json({
                    error: 'Missing required fields',
                    message: 'webchat_id, message, session_id, and visitor_phone are required',
                    timestamp: new Date().toISOString(),
                    correlationId: req.correlationId,
                });
                return;
            }

            // Get webchat phone_number and agent
            const phoneResult = await db.query(
                `SELECT pn.id as phone_number_id, pn.user_id, a.agent_id
         FROM phone_numbers pn
         JOIN agents a ON a.phone_number_id = pn.id
         WHERE pn.meta_phone_number_id = $1 AND pn.platform = 'webchat'`,
                [webchat_id]
            );

            if (phoneResult.rows.length === 0) {
                res.status(404).json({
                    error: 'Webchat channel not found',
                    message: `Webchat channel ${webchat_id} not found or no agent configured`,
                    timestamp: new Date().toISOString(),
                    correlationId: req.correlationId,
                });
                return;
            }

            const agentId = phoneResult.rows[0].agent_id;
            const phoneNumberId = phoneResult.rows[0].phone_number_id;

            // Find conversation ONLY for this webchat agent (platform isolation)
            // visitor_phone is actually session_id for webchat
            let conversation = await db.query(
                `SELECT c.conversation_id, c.agent_id, c.openai_conversation_id
         FROM conversations c
         WHERE c.agent_id = $1 
         AND c.customer_phone = $2 
         AND c.is_active = true
         LIMIT 1`,
                [agentId, visitor_phone]
            );

            let conversationId: string;
            let isNewConversation = false;

            if (conversation.rows.length === 0) {
                // Invalidate session cache FIRST (before creating conversation)
                // This ensures worker will fetch fresh data
                const sessionCacheKey = `session:${phoneNumberId}:${visitor_phone}`;
                await cache.del(sessionCacheKey);

                // Create new conversation
                isNewConversation = true;
                conversationId = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
                await db.query(
                    `INSERT INTO conversations (conversation_id, agent_id, customer_phone, last_message_at, is_active)
           VALUES ($1, $2, $3, NOW(), true)`,
                    [conversationId, agentId, visitor_phone]
                );

                logger.info('New webchat conversation created', {
                    conversation_id: conversationId,
                    visitor_phone,
                    session_id,
                    webchat_id,
                    phone_number_id: phoneNumberId,
                    cache_invalidated: sessionCacheKey,
                    correlationId: req.correlationId,
                });
            } else {
                // Existing conversation found - update last_message_at
                conversationId = conversation.rows[0].conversation_id;

                await db.query(
                    `UPDATE conversations SET last_message_at = NOW() WHERE conversation_id = $1`,
                    [conversationId]
                );
            }

            // Generate message ID
            const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

            // Enqueue message for processing (same as webhook)
            const queuedMessage: QueuedMessage = {
                message_id: messageId,
                phone_number_id: webchat_id, // Use webchat_id (meta_phone_number_id)
                customer_phone: visitor_phone,
                message_text: message,
                timestamp: new Date().toISOString(),
                platform_type: 'webchat'
            };

            await enqueueMessage(queuedMessage);

            // Note: Welcome message and phone/name collection now handled by AI prompt
            // No system messages sent - AI will naturally ask for phone and name

            logger.info('Webchat message enqueued', {
                message_id: messageId,
                conversation_id: conversationId,
                visitor_phone,
                webchat_id,
                is_new_conversation: isNewConversation,
                correlationId: req.correlationId,
            });

            res.status(200).json({
                success: true,
                data: {
                    message_id: messageId,
                    conversation_id: conversationId,
                    status: 'queued'
                },
                timestamp: new Date().toISOString(),
                correlationId: req.correlationId,
            });
        } catch (error) {
            logger.error('Error sending webchat message', {
                error: (error as Error).message,
                webchat_id: req.params['webchat_id'],
                correlationId: req.correlationId,
            });
            next(error);
        }
    };

    /**
     * GET /api/webchat/:webchat_id/messages
     * Poll for new messages in conversation
     */
    getMessages = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const webchat_id = req.params['webchat_id'];
            const { visitor_phone, since } = req.query;

            if (!visitor_phone) {
                res.status(400).json({
                    error: 'Missing required parameter',
                    message: 'visitor_phone is required',
                    timestamp: new Date().toISOString(),
                    correlationId: req.correlationId,
                });
                return;
            }

            // Get conversation via agent
            const convResult = await db.query(
                `SELECT c.conversation_id 
         FROM conversations c
         JOIN agents a ON c.agent_id = a.agent_id
         JOIN phone_numbers pn ON a.phone_number_id = pn.id
         WHERE pn.meta_phone_number_id = $1 
         AND pn.platform = 'webchat'
         AND c.customer_phone = $2
         AND c.is_active = true`,
                [webchat_id, visitor_phone]
            );

            if (convResult.rows.length === 0) {
                res.status(200).json({
                    success: true,
                    data: {
                        messages: [],
                        conversation_id: null
                    },
                    timestamp: new Date().toISOString(),
                    correlationId: req.correlationId,
                });
                return;
            }

            const conversationId = convResult.rows[0].conversation_id;

            // Get messages since timestamp
            const sinceTimestamp = since ? new Date(since as string) : new Date(0);

            const messages = await db.query(
                `SELECT message_id, text as message_text, sender, timestamp, sequence_no
         FROM messages
         WHERE conversation_id = $1
         AND timestamp > $2
         ORDER BY sequence_no ASC`,
                [conversationId, sinceTimestamp]
            );

            res.status(200).json({
                success: true,
                data: {
                    messages: messages.rows,
                    conversation_id: conversationId
                },
                timestamp: new Date().toISOString(),
                correlationId: req.correlationId,
            });
        } catch (error) {
            logger.error('Error fetching webchat messages', {
                error: (error as Error).message,
                webchat_id: req.params['webchat_id'],
                correlationId: req.correlationId,
            });
            next(error);
        }
    };

    /**
     * POST /api/webchat/:webchat_id/init
     * Initialize chat session (check if returning visitor)
     */
    initSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const webchat_id = req.params['webchat_id'];
            const { visitor_phone, session_id } = req.body;

            if (!visitor_phone || !session_id) {
                res.status(400).json({
                    error: 'Missing required fields',
                    message: 'visitor_phone and session_id are required',
                    timestamp: new Date().toISOString(),
                    correlationId: req.correlationId,
                });
                return;
            }

            // Validate webchat exists and get user_id
            const phoneResult = await db.query(
                `SELECT pn.id, pn.user_id 
         FROM phone_numbers pn
         WHERE pn.meta_phone_number_id = $1 AND pn.platform = 'webchat'`,
                [webchat_id]
            );

            if (phoneResult.rows.length === 0) {
                res.status(404).json({
                    error: 'Webchat channel not found',
                    message: `Webchat channel ${webchat_id} not found`,
                    timestamp: new Date().toISOString(),
                    correlationId: req.correlationId,
                });
                return;
            }

            const user_id = phoneResult.rows[0].user_id;

            // Check if returning visitor - look across ALL user's agents (cross-platform)
            const existingConv = await db.query(
                `SELECT c.conversation_id, c.created_at, c.agent_id, a.phone_number_id, pn.platform,
                COUNT(m.message_id) as message_count
         FROM conversations c
         JOIN agents a ON c.agent_id = a.agent_id
         JOIN phone_numbers pn ON a.phone_number_id = pn.id
         LEFT JOIN messages m ON c.conversation_id = m.conversation_id
         WHERE a.user_id = $1 AND c.customer_phone = $2 AND c.is_active = true
         GROUP BY c.conversation_id, c.created_at, c.agent_id, a.phone_number_id, pn.platform
         ORDER BY c.last_message_at DESC
         LIMIT 1`,
                [user_id, visitor_phone]
            );

            const isReturning = existingConv.rows.length > 0;
            const previousPlatform = isReturning ? existingConv.rows[0].platform : null;

            logger.info('Webchat session initialized', {
                webchat_id,
                visitor_phone,
                session_id,
                is_returning: isReturning,
                previous_platform: previousPlatform,
                correlationId: req.correlationId,
            });

            res.status(200).json({
                success: true,
                data: {
                    session_id,
                    is_returning_visitor: isReturning,
                    conversation_id: isReturning ? existingConv.rows[0].conversation_id : null,
                    previous_messages: isReturning ? parseInt(existingConv.rows[0].message_count) : 0,
                    previous_platform: previousPlatform
                },
                timestamp: new Date().toISOString(),
                correlationId: req.correlationId,
            });
        } catch (error) {
            logger.error('Error initializing webchat session', {
                error: (error as Error).message,
                webchat_id: req.params['webchat_id'],
                correlationId: req.correlationId,
            });
            next(error);
        }
    };

    /**
     * GET /api/webchat/:webchat_id/stream
     * Server-Sent Events endpoint for real-time messages
     */
    streamMessages = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const webchat_id = req.params['webchat_id'];
            const session_id = req.query['session_id'] as string;

            if (!webchat_id || !session_id) {
                res.status(400).json({
                    error: 'Missing required parameters',
                    message: 'webchat_id and session_id are required',
                    timestamp: new Date().toISOString(),
                });
                return;
            }

            // Verify webchat exists
            const phoneResult = await db.query(
                `SELECT pn.id FROM phone_numbers pn
         WHERE pn.meta_phone_number_id = $1 AND pn.platform = 'webchat'`,
                [webchat_id]
            );

            if (phoneResult.rows.length === 0) {
                res.status(404).json({
                    error: 'Webchat channel not found',
                    timestamp: new Date().toISOString(),
                });
                return;
            }

            // Add SSE connection
            sseManager.addConnection(session_id, webchat_id, res);

            // Handle client disconnect
            req.on('close', () => {
                sseManager.removeConnection(session_id, webchat_id);
            });

            // Keep connection open (don't call next())
        } catch (error) {
            logger.error('Error establishing SSE connection', {
                error: (error as Error).message,
                webchat_id: req.params['webchat_id'],
            });
            next(error);
        }
    };

    /**
     * POST /api/webchat/:webchat_id/verify-phone
     * Verify phone number and get user info from extractions
     */
    verifyPhone = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { phone } = req.body;

            if (!phone) {
                res.status(400).json({
                    error: 'Missing phone number',
                    timestamp: new Date().toISOString(),
                });
                return;
            }

            // Normalize phone: remove +, spaces, dashes
            const normalizedPhone = phone.replace(/[\s\-\+]/g, '');

            // Validate: should be 10-15 digits
            if (!/^\d{10,15}$/.test(normalizedPhone)) {
                res.status(400).json({
                    error: 'Invalid phone format',
                    message: 'Phone should be 10-15 digits',
                    timestamp: new Date().toISOString(),
                });
                return;
            }

            // Check extractions for existing name
            const extraction = await db.query(
                `SELECT name, email, company 
         FROM extractions 
         WHERE customer_phone LIKE $1 
         AND name IS NOT NULL 
         AND is_latest = true
         ORDER BY extracted_at DESC 
         LIMIT 1`,
                [`%${normalizedPhone}%`]
            );

            const hasName = extraction.rows.length > 0 && extraction.rows[0].name;

            res.status(200).json({
                success: true,
                data: {
                    phone: normalizedPhone,
                    has_name: hasName,
                    name: hasName ? extraction.rows[0].name : null,
                    email: extraction.rows[0]?.email || null,
                    company: extraction.rows[0]?.company || null
                },
                timestamp: new Date().toISOString(),
            });
        } catch (error) {
            logger.error('Error verifying phone', {
                error: (error as Error).message,
                correlationId: req.correlationId,
            });
            next(error);
        }
    };

    /**
     * GET /api/webchat/:webchat_id/config
     * Get configuration page URL for customizing widget colors
     */
    getConfigPage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const webchat_id = req.params['webchat_id'];

            if (!webchat_id) {
                res.status(400).json({
                    error: 'Missing webchat_id',
                    message: 'webchat_id parameter is required',
                    timestamp: new Date().toISOString(),
                    correlationId: req.correlationId,
                });
                return;
            }

            // Verify webchat_id exists
            const phoneNumberCheck = await db.query(
                'SELECT display_name FROM phone_numbers WHERE meta_phone_number_id = $1 AND platform = $2',
                [webchat_id, 'webchat']
            );

            if (phoneNumberCheck.rows.length === 0) {
                res.status(404).json({
                    error: 'Webchat channel not found',
                    message: `Webchat channel ${webchat_id} not found`,
                    timestamp: new Date().toISOString(),
                    correlationId: req.correlationId,
                });
                return;
            }

            const baseUrl = platformsConfig.webchatWidgetUrl;
            const configUrl = `${baseUrl}/widget-config.html?agent_id=${webchat_id}`;

            res.status(200).json({
                success: true,
                data: {
                    webchat_id,
                    config_url: configUrl,
                    message: 'Open this URL to customize widget colors and get embed code'
                },
                timestamp: new Date().toISOString(),
                correlationId: req.correlationId,
            });
        } catch (error) {
            logger.error('Error getting config page', {
                error: (error as Error).message,
                webchat_id: req.params['webchat_id'],
                correlationId: req.correlationId,
            });
            next(error);
        }
    };

    /**
     * Generate embed code for webchat widget with color customization
     * Simple 2-line embed - just copy and paste!
     */
    private generateEmbedCode(webchat_id: string, name: string, primaryColor?: string, secondaryColor?: string): string {
        const baseUrl = platformsConfig.webchatWidgetUrl;
        const primary = primaryColor || '#3B82F6';
        const secondary = secondaryColor || '#EFF6FF';

        return `<!-- ${name} AI Chat Widget - Customizable Colors -->
<webchat-widget 
  agent-id="${webchat_id}"
  primary-color="${primary}"
  secondary-color="${secondary}">
</webchat-widget>
<script src="${baseUrl}/widget.js" async type="text/javascript"></script>

<!-- 
  Customize colors by changing the hex values:
  - primary-color: Buttons & user messages (default: #3B82F6)
  - secondary-color: Background accents (default: #EFF6FF)
  
  Or visit: ${baseUrl}/widget-config.html?agent_id=${webchat_id}
  to customize colors visually and get updated embed code!
-->`;
    }
}
