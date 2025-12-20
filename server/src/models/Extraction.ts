import { v4 as uuidv4 } from 'uuid';
import { Pool } from 'pg';
import { logger } from '../utils/logger';

export interface ExtractionReasoning {
  intent?: string;
  urgency?: string;
  budget?: string;
  fit?: string;
  engagement?: string;
  cta_behavior?: string;
}

export interface ExtractionData {
  // Contact Information
  name?: string;
  email?: string;
  company?: string;
  
  // Lead Scoring - Intent
  intent_level?: string; // Low, Medium, High
  intent_score?: number; // 1-3
  
  // Lead Scoring - Urgency
  urgency_level?: string; // Low, Medium, High
  urgency_score?: number; // 1-3
  
  // Lead Scoring - Budget
  budget_constraint?: string; // Yes, No, Maybe
  budget_score?: number; // 1-3
  
  // Lead Scoring - Fit
  fit_alignment?: string; // Low, Medium, High
  fit_score?: number; // 1-3
  
  // Lead Scoring - Engagement
  engagement_health?: string; // Low, Medium, High
  engagement_score?: number; // 1-3
  
  // Overall Scoring
  total_score?: number;
  lead_status_tag?: string; // Hot, Warm, Cold
  
  // Demo Booking
  demo_book_datetime?: Date;
  
  // Reasoning (structured JSONB with intent, urgency, budget, fit, engagement, cta_behavior)
  reasoning?: ExtractionReasoning;
  
  // Smart Notification (4-5 word summary)
  smart_notification?: string;
  
  // New fields for detailed extraction
  requirements?: string; // Key requirements from conversation
  custom_cta?: string; // Comma-separated list of custom CTAs
  in_detail_summary?: string; // Detailed summary of the conversation
}

export interface Extraction extends ExtractionData {
  extraction_id: string;
  conversation_id: string;
  user_id: string;
  customer_phone: string;
  extracted_at: Date;
  is_latest: boolean;
  message_count_at_extraction: number;
  created_at: Date;
  updated_at: Date;
}

export interface CreateExtractionData extends ExtractionData {
  conversation_id: string;
  message_count_at_extraction?: number;
}

export interface UpdateExtractionData extends Partial<ExtractionData> {}

export class ExtractionModel {
  constructor(private db: Pool) {}

  /**
   * Create a new extraction record
   * HISTORY MODE: Creates new snapshot with is_latest=true by default
   */
  async create(data: CreateExtractionData): Promise<Extraction> {
    const extractionId = uuidv4();
    
    // Get user_id and customer_phone from conversation
    const convQuery = `
      SELECT c.customer_phone, a.user_id
      FROM conversations c
      INNER JOIN agents a ON c.agent_id = a.agent_id
      WHERE c.conversation_id = $1
    `;
    const convResult = await this.db.query(convQuery, [data.conversation_id]);
    
    if (convResult.rows.length === 0) {
      throw new Error(`Conversation not found: ${data.conversation_id}`);
    }
    
    const { customer_phone, user_id } = convResult.rows[0];
    
    const query = `
      INSERT INTO extractions (
        extraction_id, conversation_id, user_id, customer_phone,
        message_count_at_extraction, is_latest,
        name, email, company,
        intent_level, intent_score,
        urgency_level, urgency_score,
        budget_constraint, budget_score,
        fit_alignment, fit_score,
        engagement_health, engagement_score,
        total_score, lead_status_tag, smart_notification, reasoning, demo_book_datetime,
        requirements, custom_cta, in_detail_summary
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 
              $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
      RETURNING *
    `;

    const values = [
      extractionId,
      data.conversation_id,
      user_id,
      customer_phone,
      data.message_count_at_extraction || 0,
      true, // is_latest (default true for new extractions)
      data.name || null,
      data.email || null,
      data.company || null,
      data.intent_level || null,
      data.intent_score || null,
      data.urgency_level || null,
      data.urgency_score || null,
      data.budget_constraint || null,
      data.budget_score || null,
      data.fit_alignment || null,
      data.fit_score || null,
      data.engagement_health || null,
      data.engagement_score || null,
      data.total_score || null,
      data.lead_status_tag || null,
      data.smart_notification || null,
      data.reasoning ? JSON.stringify(data.reasoning) : null,
      data.demo_book_datetime || null,
      data.requirements || null,
      data.custom_cta || null,
      data.in_detail_summary || null
    ];

    try {
      const result = await this.db.query(query, values);
      logger.info('Extraction snapshot created', { 
        extractionId, 
        conversationId: data.conversation_id,
        messageCount: data.message_count_at_extraction,
        isLatest: true
      });
      return result.rows[0];
    } catch (error) {
      logger.error('Failed to create extraction', { error, data });
      throw error;
    }
  }

  /**
   * Update an existing extraction
   */
  async update(extractionId: string, data: UpdateExtractionData): Promise<Extraction | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    // Build dynamic update query
    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) {
        fields.push(`${key} = $${paramCount}`);
        values.push(value);
        paramCount++;
      }
    });

    if (fields.length === 0) {
      logger.warn('No fields to update', { extractionId });
      return this.findById(extractionId);
    }

    values.push(extractionId);
    const query = `
      UPDATE extractions
      SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE extraction_id = $${paramCount}
      RETURNING *
    `;

    try {
      const result = await this.db.query(query, values);
      if (result.rows.length === 0) {
        logger.warn('Extraction not found for update', { extractionId });
        return null;
      }
      logger.info('Extraction updated', { extractionId });
      return result.rows[0];
    } catch (error) {
      logger.error('Failed to update extraction', { error, extractionId, data });
      throw error;
    }
  }

  /**
   * Find extraction by ID
   */
  async findById(extractionId: string): Promise<Extraction | null> {
    const query = 'SELECT * FROM extractions WHERE extraction_id = $1';
    
    try {
      const result = await this.db.query(query, [extractionId]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Failed to find extraction by ID', { error, extractionId });
      throw error;
    }
  }

  /**
   * Find latest extraction by conversation ID
   * Uses is_latest flag for fast lookup
   */
  async findByConversationId(conversationId: string): Promise<Extraction | null> {
    const query = `
      SELECT * FROM extractions 
      WHERE conversation_id = $1 AND is_latest = true
      LIMIT 1
    `;
    
    try {
      const result = await this.db.query(query, [conversationId]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Failed to find latest extraction by conversation ID', { 
        error, 
        conversationId 
      });
      throw error;
    }
  }

  /**
   * Find ALL extractions for a conversation (history)
   * Returns all extraction snapshots ordered by time (newest first)
   */
  async findAllByConversationId(conversationId: string): Promise<Extraction[]> {
    const query = `
      SELECT * FROM extractions 
      WHERE conversation_id = $1
      ORDER BY extracted_at DESC
    `;
    
    try {
      const result = await this.db.query(query, [conversationId]);
      logger.debug('Found extraction history', { 
        conversationId,
        count: result.rows.length
      });
      return result.rows;
    } catch (error) {
      logger.error('Failed to find extraction history', { 
        error, 
        conversationId 
      });
      throw error;
    }
  }

  /**
   * Find extractions by user ID (through conversation and agent relationships)
   */
  async findByUserId(userId: string, limit: number = 50, offset: number = 0): Promise<Extraction[]> {
    const query = `
      SELECT e.* 
      FROM extractions e
      JOIN conversations c ON e.conversation_id = c.conversation_id
      JOIN agents a ON c.agent_id = a.agent_id
      WHERE a.user_id = $1
      ORDER BY e.extracted_at DESC
      LIMIT $2 OFFSET $3
    `;
    
    try {
      const result = await this.db.query(query, [userId, limit, offset]);
      return result.rows;
    } catch (error) {
      logger.error('Failed to find extractions by user ID', { error, userId });
      throw error;
    }
  }

  /**
   * Delete extraction by ID
   */
  async delete(extractionId: string): Promise<boolean> {
    const query = 'DELETE FROM extractions WHERE extraction_id = $1';
    
    try {
      const result = await this.db.query(query, [extractionId]);
      const deleted = (result.rowCount ?? 0) > 0;
      if (deleted) {
        logger.info('Extraction deleted', { extractionId });
      } else {
        logger.warn('Extraction not found for deletion', { extractionId });
      }
      return deleted;
    } catch (error) {
      logger.error('Failed to delete extraction', { error, extractionId });
      throw error;
    }
  }

  /**
   * Check if extraction exists for conversation
   */
  async existsForConversation(conversationId: string): Promise<boolean> {
    const query = 'SELECT 1 FROM extractions WHERE conversation_id = $1 LIMIT 1';
    
    try {
      const result = await this.db.query(query, [conversationId]);
      return result.rows.length > 0;
    } catch (error) {
      logger.error('Failed to check extraction existence', { error, conversationId });
      throw error;
    }
  }
}
