import { Request, Response, NextFunction } from 'express';
import extractionService from '../services/extractionService';
import { db } from '../utils/database';
import { logger } from '../utils/logger';
import { QueryOptions } from '../models/types';

export class ExtractionsController {
  /**
   * GET /users/:user_id/extractions
   * Get ALL extractions (history) for a user with filtering options
   * HISTORY MODE: Returns all extraction snapshots, not just latest
   */
  getExtractions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { user_id } = req.params;
      const {
        conversation_id,
        agent_id,
        phone_number_id,
        has_email,
        has_demo,
        min_urgency,
        min_fit,
        limit,
        offset,
        orderBy,
        orderDirection,
        latest_only  // New parameter to optionally filter to latest only
      } = req.query;

      // Build query options
      const options: QueryOptions = {
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
        orderBy: (orderBy as string) || 'extracted_at',
        orderDirection: (orderDirection as 'ASC' | 'DESC') || 'DESC'
      };

      // Build the query based on filters (Migration 032 schema)
      let query = `
        SELECT 
          e.extraction_id,
          e.conversation_id,
          e.user_id,
          e.customer_phone,
          e.extracted_at,
          e.is_latest,
          e.message_count_at_extraction,
          e.name,
          e.email,
          e.company,
          e.intent_level,
          e.intent_score,
          e.urgency_level,
          e.urgency_score,
          e.budget_constraint,
          e.budget_score,
          e.fit_alignment,
          e.fit_score,
          e.engagement_health,
          e.engagement_score,
          e.total_score,
          e.lead_status_tag,
          e.demo_book_datetime,
          e.reasoning,
          e.smart_notification,
          e.requirements,
          e.custom_cta,
          e.in_detail_summary,
          e.created_at,
          e.updated_at,
          c.agent_id,
          c.is_active as conversation_active,
          a.name as agent_name,
          a.phone_number_id,
          pn.platform,
          pn.display_name as phone_display_name
        FROM extractions e
        JOIN conversations c ON e.conversation_id = c.conversation_id
        JOIN agents a ON c.agent_id = a.agent_id
        JOIN phone_numbers pn ON a.phone_number_id = pn.id
        WHERE e.user_id = $1
      `;

      const queryParams: any[] = [user_id];
      let paramIndex = 2;

      // Filter to latest only if requested
      if (latest_only === 'true') {
        query += ` AND e.is_latest = true`;
      }

      // Add filters
      if (conversation_id) {
        query += ` AND e.conversation_id = $${paramIndex}`;
        queryParams.push(conversation_id);
        paramIndex++;
      }

      if (agent_id) {
        query += ` AND c.agent_id = $${paramIndex}`;
        queryParams.push(agent_id);
        paramIndex++;
      }

      if (phone_number_id) {
        query += ` AND a.phone_number_id = $${paramIndex}`;
        queryParams.push(phone_number_id);
        paramIndex++;
      }

      if (has_email === 'true') {
        query += ` AND e.email IS NOT NULL AND e.email != ''`;
      }

      if (has_demo === 'true') {
        query += ` AND e.demo_book_datetime IS NOT NULL`;
      }

      if (min_urgency) {
        const urgencyValue = parseInt(min_urgency as string, 10);
        if (urgencyValue >= 1 && urgencyValue <= 3) {
          query += ` AND e.urgency_score >= $${paramIndex}`;
          queryParams.push(urgencyValue);
          paramIndex++;
        }
      }

      if (min_fit) {
        const fitValue = parseInt(min_fit as string, 10);
        if (fitValue >= 1 && fitValue <= 3) {
          query += ` AND e.fit_score >= $${paramIndex}`;
          queryParams.push(fitValue);
          paramIndex++;
        }
      }

      // Add ordering and pagination
      query += ` ORDER BY e.${options.orderBy} ${options.orderDirection}`;
      query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      queryParams.push(options.limit, options.offset);

      // Execute query
      const result = await (db as any).pool.query(query, queryParams);

      // Get total count for pagination
      let countQuery = `
        SELECT COUNT(*) as total
        FROM extractions e
        JOIN conversations c ON e.conversation_id = c.conversation_id
        JOIN agents a ON c.agent_id = a.agent_id
        WHERE a.user_id = $1
      `;

      const countParams: any[] = [user_id];
      let countParamIndex = 2;

      if (conversation_id) {
        countQuery += ` AND e.conversation_id = $${countParamIndex}`;
        countParams.push(conversation_id);
        countParamIndex++;
      }

      if (agent_id) {
        countQuery += ` AND c.agent_id = $${countParamIndex}`;
        countParams.push(agent_id);
        countParamIndex++;
      }

      if (phone_number_id) {
        countQuery += ` AND a.phone_number_id = $${countParamIndex}`;
        countParams.push(phone_number_id);
        countParamIndex++;
      }

      if (has_email === 'true') {
        countQuery += ` AND e.email IS NOT NULL AND e.email != ''`;
      }

      if (has_demo === 'true') {
        countQuery += ` AND e.demo_book_datetime IS NOT NULL`;
      }

      if (min_urgency) {
        const urgencyValue = parseInt(min_urgency as string, 10);
        if (urgencyValue >= 1 && urgencyValue <= 3) {
          countQuery += ` AND e.urgency_score >= $${countParamIndex}`;
          countParams.push(urgencyValue);
          countParamIndex++;
        }
      }

      if (min_fit) {
        const fitValue = parseInt(min_fit as string, 10);
        if (fitValue >= 1 && fitValue <= 3) {
          countQuery += ` AND e.fit_score >= $${countParamIndex}`;
          countParams.push(fitValue);
          countParamIndex++;
        }
      }

      const countResult = await (db as any).pool.query(countQuery, countParams);
      const totalCount = parseInt(countResult.rows[0].total);

      logger.info('Extractions retrieved successfully', {
        user_id,
        count: result.rows.length,
        total: totalCount,
        filters: {
          conversation_id,
          agent_id,
          phone_number_id,
          has_email,
          has_demo,
          min_urgency,
          min_fit
        },
        correlationId: req.correlationId,
      });

      res.status(200).json({
        success: true,
        data: result.rows,
        pagination: {
          total: totalCount,
          limit: options.limit,
          offset: options.offset,
          hasMore: (options.offset || 0) + result.rows.length < totalCount
        },
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId,
      });
    } catch (error) {
      logger.error('Error retrieving extractions', {
        error: (error as Error).message,
        user_id: req.params['user_id'],
        correlationId: req.correlationId,
      });
      next(error);
    }
  };

  /**
   * GET /users/:user_id/extractions/:extraction_id
   * Get a specific extraction by ID
   */
  getExtraction = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { user_id, extraction_id } = req.params;

      // Get extraction with details (Migration 008 schema)
      const query = `
        SELECT 
          e.extraction_id,
          e.conversation_id,
          e.user_id,
          e.customer_phone,
          e.extracted_at,
          e.is_latest,
          e.message_count_at_extraction,
          e.name,
          e.email,
          e.company,
          e.intent_level,
          e.intent_score,
          e.urgency_level,
          e.urgency_score,
          e.budget_constraint,
          e.budget_score,
          e.fit_alignment,
          e.fit_score,
          e.engagement_health,
          e.engagement_score,
          e.total_score,
          e.lead_status_tag,
          e.demo_book_datetime,
          e.reasoning,
          e.smart_notification,
          e.requirements,
          e.custom_cta,
          e.in_detail_summary,
          e.created_at,
          e.updated_at,
          c.agent_id,
          c.customer_phone as conversation_customer_phone,
          c.is_active as conversation_active,
          c.created_at as conversation_created_at,
          c.last_message_at,
          a.name as agent_name,
          a.prompt_id,
          a.phone_number_id,
          pn.platform,
          pn.display_name as phone_display_name,
          (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.conversation_id) as message_count
        FROM extractions e
        JOIN conversations c ON e.conversation_id = c.conversation_id
        JOIN agents a ON c.agent_id = a.agent_id
        JOIN phone_numbers pn ON a.phone_number_id = pn.id
        WHERE e.extraction_id = $1
      `;

      const result = await (db as any).pool.query(query, [extraction_id]);

      if (result.rows.length === 0) {
        res.status(404).json({
          error: 'Extraction not found',
          message: 'The specified extraction does not exist',
          timestamp: new Date().toISOString(),
          correlationId: req.correlationId,
        });
        return;
      }

      const extraction = result.rows[0];

      // Verify user ownership
      if (extraction.user_id !== user_id) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Extraction does not belong to this user',
          timestamp: new Date().toISOString(),
          correlationId: req.correlationId,
        });
        return;
      }

      logger.info('Extraction retrieved successfully', {
        user_id,
        extraction_id,
        correlationId: req.correlationId,
      });

      res.status(200).json({
        success: true,
        data: extraction,
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId,
      });
    } catch (error) {
      logger.error('Error retrieving extraction', {
        error: (error as Error).message,
        user_id: req.params['user_id'],
        extraction_id: req.params['extraction_id'],
        correlationId: req.correlationId,
      });
      next(error);
    }
  };

  /**
   * GET /users/:user_id/conversations/:conversation_id/extraction
   * Get extraction for a specific conversation
   */
  getConversationExtraction = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { user_id, conversation_id } = req.params;

      // Verify conversation belongs to user
      const conversationQuery = `
        SELECT a.user_id 
        FROM conversations c
        JOIN agents a ON c.agent_id = a.agent_id
        WHERE c.conversation_id = $1
      `;
      const conversationResult = await (db as any).pool.query(conversationQuery, [conversation_id]);

      if (conversationResult.rows.length === 0) {
        res.status(404).json({
          error: 'Conversation not found',
          message: 'The specified conversation does not exist',
          timestamp: new Date().toISOString(),
          correlationId: req.correlationId,
        });
        return;
      }

      if (conversationResult.rows[0].user_id !== user_id) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Conversation does not belong to this user',
          timestamp: new Date().toISOString(),
          correlationId: req.correlationId,
        });
        return;
      }

      // Get extraction
      const extraction = await extractionService.getExtractionByConversationId(conversation_id!);

      if (!extraction) {
        res.status(404).json({
          error: 'Extraction not found',
          message: 'No extraction exists for this conversation',
          timestamp: new Date().toISOString(),
          correlationId: req.correlationId,
        });
        return;
      }

      logger.info('Conversation extraction retrieved successfully', {
        user_id,
        conversation_id,
        extraction_id: extraction.extraction_id,
        correlationId: req.correlationId,
      });

      res.status(200).json({
        success: true,
        data: extraction,
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId,
      });
    } catch (error) {
      logger.error('Error retrieving conversation extraction', {
        error: (error as Error).message,
        user_id: req.params['user_id'],
        conversation_id: req.params['conversation_id'],
        correlationId: req.correlationId,
      });
      next(error);
    }
  };

  /**
   * POST /users/:user_id/conversations/:conversation_id/extract
   * Manually trigger extraction for a conversation
   */
  triggerExtraction = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { user_id, conversation_id } = req.params;

      // Verify conversation belongs to user
      const conversationQuery = `
        SELECT a.user_id, c.is_active
        FROM conversations c
        JOIN agents a ON c.agent_id = a.agent_id
        WHERE c.conversation_id = $1
      `;
      const conversationResult = await (db as any).pool.query(conversationQuery, [conversation_id]);

      if (conversationResult.rows.length === 0) {
        res.status(404).json({
          error: 'Conversation not found',
          message: 'The specified conversation does not exist',
          timestamp: new Date().toISOString(),
          correlationId: req.correlationId,
        });
        return;
      }

      const conversation = conversationResult.rows[0];

      if (conversation.user_id !== user_id) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Conversation does not belong to this user',
          timestamp: new Date().toISOString(),
          correlationId: req.correlationId,
        });
        return;
      }

      if (!conversation.is_active) {
        res.status(400).json({
          error: 'Invalid conversation',
          message: 'Cannot extract from inactive conversation',
          timestamp: new Date().toISOString(),
          correlationId: req.correlationId,
        });
        return;
      }

      // Check if conversation has enough messages
      const shouldExtract = await extractionService.shouldExtract(conversation_id!);
      if (!shouldExtract) {
        res.status(400).json({
          error: 'Extraction not needed',
          message: 'Conversation does not have enough activity for extraction or extraction is up to date',
          timestamp: new Date().toISOString(),
          correlationId: req.correlationId,
        });
        return;
      }

      logger.info('Manual extraction triggered', {
        user_id,
        conversation_id,
        correlationId: req.correlationId,
      });

      // Note: In production, this would enqueue the extraction job
      // For now, we return a success response indicating the job was queued
      res.status(202).json({
        success: true,
        message: 'Extraction job queued successfully',
        data: {
          conversation_id,
          status: 'queued'
        },
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId,
      });
    } catch (error) {
      logger.error('Error triggering extraction', {
        error: (error as Error).message,
        user_id: req.params['user_id'],
        conversation_id: req.params['conversation_id'],
        correlationId: req.correlationId,
      });
      next(error);
    }
  };

  /**
   * GET /users/:user_id/extractions/export
   * Export extraction data in CSV format
   */
  exportExtractions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { user_id } = req.params;
      const {
        conversation_id,
        agent_id,
        phone_number_id,
        has_email,
        has_demo,
        min_urgency,
        min_fit,
        format
      } = req.query;

      // Build the query (similar to getExtractions but without pagination) - Migration 008 schema
      let query = `
        SELECT 
          e.extraction_id,
          e.conversation_id,
          e.user_id,
          e.customer_phone,
          e.extracted_at,
          e.is_latest,
          e.message_count_at_extraction,
          e.name,
          e.email,
          e.company,
          e.intent_level,
          e.intent_score,
          e.urgency_level,
          e.urgency_score,
          e.budget_constraint,
          e.budget_score,
          e.fit_alignment,
          e.fit_score,
          e.engagement_health,
          e.engagement_score,
          e.total_score,
          e.lead_status_tag,
          e.demo_book_datetime,
          e.reasoning,
          e.smart_notification,
          e.requirements,
          e.custom_cta,
          e.in_detail_summary,
          e.created_at,
          e.updated_at,
          c.customer_phone as conversation_customer_phone,
          a.name as agent_name,
          pn.platform,
          pn.display_name as phone_display_name
        FROM extractions e
        JOIN conversations c ON e.conversation_id = c.conversation_id
        JOIN agents a ON c.agent_id = a.agent_id
        JOIN phone_numbers pn ON a.phone_number_id = pn.id
        WHERE e.user_id = $1
      `;

      const queryParams: any[] = [user_id];
      let paramIndex = 2;

      // Add filters (same as getExtractions)
      if (conversation_id) {
        query += ` AND e.conversation_id = $${paramIndex}`;
        queryParams.push(conversation_id);
        paramIndex++;
      }

      if (agent_id) {
        query += ` AND c.agent_id = $${paramIndex}`;
        queryParams.push(agent_id);
        paramIndex++;
      }

      if (phone_number_id) {
        query += ` AND a.phone_number_id = $${paramIndex}`;
        queryParams.push(phone_number_id);
        paramIndex++;
      }

      if (has_email === 'true') {
        query += ` AND e.email IS NOT NULL AND e.email != ''`;
      }

      if (has_demo === 'true') {
        query += ` AND e.demo_book_datetime IS NOT NULL`;
      }

      if (min_urgency) {
        const urgencyValue = parseInt(min_urgency as string, 10);
        if (urgencyValue >= 1 && urgencyValue <= 3) {
          query += ` AND e.urgency_score >= $${paramIndex}`;
          queryParams.push(urgencyValue);
          paramIndex++;
        }
      }

      if (min_fit) {
        const fitValue = parseInt(min_fit as string, 10);
        if (fitValue >= 1 && fitValue <= 3) {
          query += ` AND e.fit_score >= $${paramIndex}`;
          queryParams.push(fitValue);
          paramIndex++;
        }
      }

      query += ` ORDER BY e.extracted_at DESC`;

      // Execute query
      const result = await (db as any).pool.query(query, queryParams);

      if (format === 'csv') {
        // Generate CSV
        const csvHeaders = [
          'extraction_id',
          'conversation_id',
          'user_id',
          'customer_phone',
          'extracted_at',
          'is_latest',
          'message_count_at_extraction',
          'name',
          'email',
          'company',
          'intent_level',
          'intent_score',
          'urgency_level',
          'urgency_score',
          'budget_constraint',
          'budget_score',
          'fit_alignment',
          'fit_score',
          'engagement_health',
          'engagement_score',
          'total_score',
          'lead_status_tag',
          'demo_book_datetime',
          'smart_notification',
          'requirements',
          'custom_cta',
          'in_detail_summary',
          'agent_name',
          'platform',
          'phone_display_name',
          'created_at',
          'updated_at'
        ];

        const csvRows = result.rows.map((row: any) => {
          return csvHeaders.map(header => {
            const value = row[header];
            if (value === null || value === undefined) return '';
            // Escape quotes and wrap in quotes if contains comma or quote
            const stringValue = String(value);
            if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
              return `"${stringValue.replace(/"/g, '""')}"`;
            }
            return stringValue;
          }).join(',');
        });

        const csv = [csvHeaders.join(','), ...csvRows].join('\n');

        logger.info('Extractions exported as CSV', {
          user_id,
          count: result.rows.length,
          correlationId: req.correlationId,
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="extractions_${user_id}_${Date.now()}.csv"`);
        res.status(200).send(csv);
      } else {
        // Return as JSON
        logger.info('Extractions exported as JSON', {
          user_id,
          count: result.rows.length,
          correlationId: req.correlationId,
        });

        res.status(200).json({
          success: true,
          data: result.rows,
          count: result.rows.length,
          timestamp: new Date().toISOString(),
          correlationId: req.correlationId,
        });
      }
    } catch (error) {
      logger.error('Error exporting extractions', {
        error: (error as Error).message,
        user_id: req.params['user_id'],
        correlationId: req.correlationId,
      });
      next(error);
    }
  };

  /**
   * GET /users/:user_id/extractions/stats
   * Get extraction statistics for a user
   */
  getExtractionStats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { user_id } = req.params;
      const { agent_id, phone_number_id, time_range } = req.query;

      // Build time filter
      let timeFilter = '';
      switch (time_range) {
        case 'day':
          timeFilter = "AND e.extracted_at >= NOW() - INTERVAL '1 day'";
          break;
        case 'week':
          timeFilter = "AND e.extracted_at >= NOW() - INTERVAL '1 week'";
          break;
        case 'month':
          timeFilter = "AND e.extracted_at >= NOW() - INTERVAL '1 month'";
          break;
        case 'all':
        default:
          timeFilter = '';
      }

      // Build query (Migration 032 schema)
      let query = `
        SELECT 
          COUNT(*) as total_extractions,
          COUNT(CASE WHEN e.email IS NOT NULL AND e.email != '' THEN 1 END) as with_email,
          COUNT(CASE WHEN e.demo_book_datetime IS NOT NULL THEN 1 END) as with_demo,
          COUNT(CASE WHEN e.urgency_score >= 2 THEN 1 END) as high_urgency,
          COUNT(CASE WHEN e.fit_score >= 2 THEN 1 END) as good_fit,
          COUNT(CASE WHEN e.engagement_score >= 2 THEN 1 END) as high_engagement,
          COUNT(CASE WHEN e.total_score >= 12 THEN 1 END) as hot_leads,
          COUNT(CASE WHEN e.total_score >= 8 AND e.total_score < 12 THEN 1 END) as warm_leads,
          COUNT(CASE WHEN e.total_score < 8 THEN 1 END) as cold_leads,
          AVG(e.urgency_score) as avg_urgency_score,
          AVG(e.budget_score) as avg_budget_score,
          AVG(e.fit_score) as avg_fit_score,
          AVG(e.engagement_score) as avg_engagement_score,
          AVG(e.total_score) as avg_total_score
        FROM extractions e
        JOIN conversations c ON e.conversation_id = c.conversation_id
        JOIN agents a ON c.agent_id = a.agent_id
        WHERE e.user_id = $1 ${timeFilter}
      `;

      const queryParams: any[] = [user_id];
      let paramIndex = 2;

      if (agent_id) {
        query += ` AND c.agent_id = $${paramIndex}`;
        queryParams.push(agent_id);
        paramIndex++;
      }

      if (phone_number_id) {
        query += ` AND a.phone_number_id = $${paramIndex}`;
        queryParams.push(phone_number_id);
        paramIndex++;
      }

      const result = await (db as any).pool.query(query, queryParams);
      const stats = result.rows[0];

      logger.info('Extraction stats retrieved successfully', {
        user_id,
        time_range: time_range || 'all',
        correlationId: req.correlationId,
      });

      res.status(200).json({
        success: true,
        data: {
          total_extractions: parseInt(stats.total_extractions),
          with_email: parseInt(stats.with_email),
          with_demo: parseInt(stats.with_demo),
          high_urgency: parseInt(stats.high_urgency),
          good_fit: parseInt(stats.good_fit),
          high_engagement: parseInt(stats.high_engagement),
          lead_quality: {
            hot_leads: parseInt(stats.hot_leads),
            warm_leads: parseInt(stats.warm_leads),
            cold_leads: parseInt(stats.cold_leads)
          },
          averages: {
            urgency_score: stats.avg_urgency_score ? parseFloat(stats.avg_urgency_score).toFixed(2) : null,
            budget_score: stats.avg_budget_score ? parseFloat(stats.avg_budget_score).toFixed(2) : null,
            fit_score: stats.avg_fit_score ? parseFloat(stats.avg_fit_score).toFixed(2) : null,
            engagement_score: stats.avg_engagement_score ? parseFloat(stats.avg_engagement_score).toFixed(2) : null,
            total_score: stats.avg_total_score ? parseFloat(stats.avg_total_score).toFixed(2) : null
          },
          time_range: time_range || 'all'
        },
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId,
      });
    } catch (error) {
      logger.error('Error retrieving extraction stats', {
        error: (error as Error).message,
        user_id: req.params['user_id'],
        correlationId: req.correlationId,
      });
      next(error);
    }
  };
}
