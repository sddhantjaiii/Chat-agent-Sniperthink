/**
 * Leads Controller
 * Handles API endpoints for unified lead management
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import {
    getLeads,
    getLeadByPhone,
    getLeadMessages,
    getLeadStats,
    LeadFilter,
    LeadSortOptions,
    PaginationOptions,
    LeadMessagesFilter
} from '../services/leadService';

export class LeadsController {

    /**
     * GET /users/:user_id/leads
     * Get all leads for a user with filtering, sorting, and pagination
     * 
     * Query Parameters:
     * - platform: comma-separated platforms (whatsapp,instagram,webchat)
     * - agent_id: filter by agent
     * - phone_number_id: filter by phone number/channel
     * - has_extraction: boolean - has lead scoring data
     * - lead_status: comma-separated status (Hot,Warm,Cold)
     * - min_total_score: minimum lead score
     * - max_total_score: maximum lead score
     * - has_email: boolean - has email extracted
     * - has_conversation: boolean - has at least one conversation
     * - is_active: boolean - has active conversation
     * - start_date: ISO date - filter from date
     * - end_date: ISO date - filter to date
     * - date: ISO date - specific date
     * - days: number - last N days
     * - search: text search in name, email, company, phone
     * - customer_phone: exact phone match
     * - sort_by: last_message_at, created_at, total_score, name, total_messages
     * - sort_order: asc, desc
     * - limit: page size (default 50, max 100)
     * - offset: skip count
     */
    getLeads = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { user_id } = req.params;

            // Parse filters from query params
            const filter: LeadFilter = {};

            if (req.query.platform) {
                filter.platform = (req.query.platform as string).split(',').map(p => p.trim());
            }

            if (req.query.agent_id) {
                filter.agent_id = req.query.agent_id as string;
            }

            if (req.query.phone_number_id) {
                filter.phone_number_id = req.query.phone_number_id as string;
            }

            if (req.query.has_extraction !== undefined) {
                filter.has_extraction = req.query.has_extraction === 'true';
            }

            if (req.query.lead_status) {
                filter.lead_status = (req.query.lead_status as string).split(',').map(s => s.trim());
            }

            if (req.query.min_total_score) {
                filter.min_total_score = parseInt(req.query.min_total_score as string, 10);
            }

            if (req.query.max_total_score) {
                filter.max_total_score = parseInt(req.query.max_total_score as string, 10);
            }

            if (req.query.has_email !== undefined) {
                filter.has_email = req.query.has_email === 'true';
            }

            if (req.query.has_conversation !== undefined) {
                filter.has_conversation = req.query.has_conversation === 'true';
            }

            if (req.query.is_active !== undefined) {
                filter.is_active = req.query.is_active === 'true';
            }

            if (req.query.start_date) {
                filter.start_date = req.query.start_date as string;
            }

            if (req.query.end_date) {
                filter.end_date = req.query.end_date as string;
            }

            if (req.query.date) {
                filter.date = req.query.date as string;
            }

            if (req.query.days) {
                filter.days = parseInt(req.query.days as string, 10);
            }

            if (req.query.search) {
                filter.search = req.query.search as string;
            }

            if (req.query.customer_phone) {
                filter.customer_phone = req.query.customer_phone as string;
            }

            // Parse sort options
            const sort: LeadSortOptions = {};

            if (req.query.sort_by) {
                const validSortFields = ['last_message_at', 'created_at', 'total_score', 'name', 'total_messages'];
                const sortBy = req.query.sort_by as string;
                if (validSortFields.includes(sortBy)) {
                    sort.sort_by = sortBy as LeadSortOptions['sort_by'];
                }
            }

            if (req.query.sort_order) {
                const sortOrder = (req.query.sort_order as string).toLowerCase();
                if (sortOrder === 'asc' || sortOrder === 'desc') {
                    sort.sort_order = sortOrder;
                }
            }

            // Parse pagination
            const pagination: PaginationOptions = {
                limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 50,
                offset: req.query.offset ? parseInt(req.query.offset as string, 10) : 0
            };

            // Get leads
            const result = await getLeads(user_id!, filter, sort, pagination);

            logger.info('Leads retrieved via API', {
                user_id,
                count: result.leads.length,
                total: result.pagination.total,
                correlationId: req.correlationId,
            });

            res.status(200).json({
                success: true,
                data: result.leads,
                pagination: result.pagination,
                timestamp: new Date().toISOString(),
                correlationId: req.correlationId,
            });

        } catch (error) {
            logger.error('Error retrieving leads', {
                error: (error as Error).message,
                user_id: req.params['user_id'],
                correlationId: req.correlationId,
            });
            next(error);
        }
    };

    /**
     * GET /users/:user_id/leads/stats
     * Get lead statistics for a user
     */
    getLeadStats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { user_id } = req.params;

            const stats = await getLeadStats(user_id!);

            logger.info('Lead stats retrieved', {
                user_id,
                correlationId: req.correlationId,
            });

            res.status(200).json({
                success: true,
                data: stats,
                timestamp: new Date().toISOString(),
                correlationId: req.correlationId,
            });

        } catch (error) {
            logger.error('Error retrieving lead stats', {
                error: (error as Error).message,
                user_id: req.params['user_id'],
                correlationId: req.correlationId,
            });
            next(error);
        }
    };

    /**
     * GET /users/:user_id/leads/:customer_phone
     * Get a single lead by phone number
     */
    getLead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { user_id, customer_phone } = req.params;

            // URL decode the customer_phone (might contain + sign)
            const decodedPhone = decodeURIComponent(customer_phone!);

            const lead = await getLeadByPhone(user_id!, decodedPhone);

            if (!lead) {
                res.status(404).json({
                    error: 'Lead not found',
                    message: `No lead found with phone: ${decodedPhone}`,
                    timestamp: new Date().toISOString(),
                    correlationId: req.correlationId,
                });
                return;
            }

            logger.info('Lead retrieved', {
                user_id,
                customer_phone: decodedPhone,
                correlationId: req.correlationId,
            });

            res.status(200).json({
                success: true,
                data: lead,
                timestamp: new Date().toISOString(),
                correlationId: req.correlationId,
            });

        } catch (error) {
            logger.error('Error retrieving lead', {
                error: (error as Error).message,
                user_id: req.params['user_id'],
                customer_phone: req.params['customer_phone'],
                correlationId: req.correlationId,
            });
            next(error);
        }
    };

    /**
     * GET /users/:user_id/leads/:customer_phone/messages
     * Get all messages for a lead across all conversations
     * 
     * Query Parameters:
     * - platform: comma-separated platforms
     * - conversation_id: filter to specific conversation
     * - sender: 'user' or 'agent'
     * - start_date: ISO date
     * - end_date: ISO date
     * - date: specific date
     * - days: last N days
     * - limit: page size (default 50, max 200)
     * - offset: skip count
     */
    getLeadMessages = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { user_id, customer_phone } = req.params;

            // URL decode the customer_phone
            const decodedPhone = decodeURIComponent(customer_phone!);

            // Parse filters
            const filter: LeadMessagesFilter = {};

            if (req.query.platform) {
                filter.platform = (req.query.platform as string).split(',').map(p => p.trim());
            }

            if (req.query.conversation_id) {
                filter.conversation_id = req.query.conversation_id as string;
            }

            if (req.query.sender) {
                const sender = req.query.sender as string;
                if (sender === 'user' || sender === 'agent') {
                    filter.sender = sender;
                }
            }

            if (req.query.start_date) {
                filter.start_date = req.query.start_date as string;
            }

            if (req.query.end_date) {
                filter.end_date = req.query.end_date as string;
            }

            if (req.query.date) {
                filter.date = req.query.date as string;
            }

            if (req.query.days) {
                filter.days = parseInt(req.query.days as string, 10);
            }

            // Parse pagination
            const pagination: PaginationOptions = {
                limit: req.query.limit ? Math.min(parseInt(req.query.limit as string, 10), 200) : 50,
                offset: req.query.offset ? parseInt(req.query.offset as string, 10) : 0
            };

            // Get messages
            const result = await getLeadMessages(user_id!, decodedPhone, filter, pagination);

            logger.info('Lead messages retrieved', {
                user_id,
                customer_phone: decodedPhone,
                count: result.messages.length,
                total: result.pagination.total,
                correlationId: req.correlationId,
            });

            res.status(200).json({
                success: true,
                data: result,
                timestamp: new Date().toISOString(),
                correlationId: req.correlationId,
            });

        } catch (error) {
            logger.error('Error retrieving lead messages', {
                error: (error as Error).message,
                user_id: req.params['user_id'],
                customer_phone: req.params['customer_phone'],
                correlationId: req.correlationId,
            });
            next(error);
        }
    };
}

export const leadsController = new LeadsController();
