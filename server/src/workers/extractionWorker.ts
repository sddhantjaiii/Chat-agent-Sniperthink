import extractionService from '../services/extractionService';
import { callOpenAIWithMessages, createOpenAIConversation } from '../services/openaiService';
import { db } from '../utils/database';
import { logger } from '../utils/logger';
import { ExtractionData } from '../models/Extraction';
import { workerConfig, extractionConfig } from '../config';
import { contactService } from '../services/contactService';
import { appEventEmitter } from '../utils/eventEmitter';

interface ExtractionWorkerConfig {
  intervalMs: number; // Polling interval (how often to check for conversations needing extraction)
  maxRetries: number; // Max retry attempts for failed extractions
  inactivityThresholdMs: number; // Minimum inactivity time before extraction (e.g., 5 minutes)
}

const DEFAULT_CONFIG: ExtractionWorkerConfig = {
  intervalMs: workerConfig.extractionInterval, // How often to check (e.g., every 5 minutes)
  maxRetries: 3,
  inactivityThresholdMs: workerConfig.extractionInactivityThreshold // Inactivity threshold before extraction
};

class ExtractionWorker {
  private isRunning: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;
  private config: ExtractionWorkerConfig;

  constructor(config: Partial<ExtractionWorkerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the extraction worker
   */
  start(): void {
    // Check if extraction is enabled
    if (!extractionConfig.enabled) {
      logger.info('Extraction worker is disabled in configuration');
      return;
    }

    if (this.isRunning) {
      logger.warn('Extraction worker is already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting extraction worker', { 
      intervalMs: this.config.intervalMs,
      inactivityThresholdMs: this.config.inactivityThresholdMs 
    });

    // Run immediately on start
    this.processExtractions().catch(error => {
      logger.error('Error in initial extraction processing', { error });
    });

    // Then run on interval
    this.intervalId = setInterval(() => {
      this.processExtractions().catch(error => {
        logger.error('Error in extraction processing', { error });
      });
    }, this.config.intervalMs);
  }

  /**
   * Stop the extraction worker
   */
  stop(): void {
    if (!this.isRunning) {
      logger.warn('Extraction worker is not running');
      return;
    }

    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    logger.info('Extraction worker stopped');
  }

  /**
   * Process pending extractions
   */
  private async processExtractions(): Promise<void> {
    try {
      logger.debug('Processing extractions');

      // Find conversations that need extraction
      const conversations = await this.findConversationsNeedingExtraction();
      
      if (conversations.length === 0) {
        logger.debug('No conversations need extraction');
        return;
      }

      logger.info('Found conversations needing extraction', { 
        count: conversations.length 
      });

      // Process each conversation
      for (const conversation of conversations) {
        try {
          await this.extractLeadData(
            conversation.conversation_id,
            conversation.openai_conversation_id
          );
        } catch (error) {
          logger.error('Failed to extract lead data', { 
            conversationId: conversation.conversation_id,
            openaiConversationId: conversation.openai_conversation_id,
            error 
          });
        }
      }
    } catch (error) {
      logger.error('Error in processExtractions', { error });
    }
  }

  /**
   * Find conversations that need extraction
   * Returns conversations that:
   * - Are active
   * - Have been inactive for threshold period
   * - Have new messages since last extraction (or never extracted)
   * 
   * HISTORY MODE: Creates new extraction snapshot on every inactivity period
   */
  private async findConversationsNeedingExtraction(): Promise<Array<{ 
    conversation_id: string;
    openai_conversation_id: string;
    user_id: string;
    customer_phone: string;
    agent_id: string;
  }>> {
    const inactivityThresholdDate = new Date(Date.now() - this.config.inactivityThresholdMs);
    
    const query = `
      SELECT 
        c.conversation_id,
        c.openai_conversation_id,
        c.customer_phone,
        c.last_message_at,
        c.last_extraction_at,
        a.user_id,
        a.agent_id
      FROM conversations c
      INNER JOIN agents a ON c.agent_id = a.agent_id
      INNER JOIN phone_numbers pn ON a.phone_number_id = pn.id
      WHERE c.is_active = true
        AND c.openai_conversation_id IS NOT NULL
        AND c.last_message_at <= $1
        AND pn.platform != 'webchat'
        AND (
          c.last_extraction_at IS NULL 
          OR c.last_message_at > c.last_extraction_at
        )
      ORDER BY c.last_message_at ASC
      LIMIT 100
    `;

    try {
      const result = await db.query(query, [inactivityThresholdDate]);
      
      logger.debug('Found conversations needing extraction', {
        count: result.rows.length,
        inactivityThresholdMs: this.config.inactivityThresholdMs
      });
      
      return result.rows.map((row: any) => ({
        conversation_id: row.conversation_id,
        openai_conversation_id: row.openai_conversation_id,
        user_id: row.user_id,
        customer_phone: row.customer_phone,
        agent_id: row.agent_id
      }));
    } catch (error) {
      logger.error('Failed to find conversations needing extraction', { error });
      return [];
    }
  }

  /**
   * Extract lead data from a conversation using OpenAI
   * Uses the same OpenAI conversation ID that was used for customer messages
   */
  async extractLeadData(
    conversationId: string,
    openaiConversationId: string,
    retryCount: number = 0
  ): Promise<void> {
    try {
      logger.info('Extracting lead data', { 
        conversationId,
        openaiConversationId,
        retryCount 
      });

      // Call OpenAI for extraction using the existing conversation context
      // OpenAI already has the full conversation, we just ask it to extract
      const extractionResult = await this.callOpenAIForExtraction(openaiConversationId);

      // Validate extraction result
      const validation = extractionService.validateExtractionData(extractionResult);
      
      if (!validation.isValid) {
        logger.error('Invalid extraction data from OpenAI', { 
          conversationId,
          errors: validation.errors,
          extractionResult 
        });
        
        // Retry if under max retries
        if (retryCount < this.config.maxRetries) {
          logger.info('Retrying extraction', { conversationId, retryCount: retryCount + 1 });
          await this.extractLeadData(conversationId, openaiConversationId, retryCount + 1);
        }
        return;
      }

      // Store extraction
      await extractionService.createOrUpdateExtraction(conversationId, validation.data!);
      
      // Update last_extraction_at timestamp
      await this.updateLastExtractionTimestamp(conversationId);

      // Sync contact data from extraction and emit event for campaign triggers
      try {
        // Get conversation details to find user_id and customer_phone
        const convResult = await db.query(
          `SELECT c.customer_phone, c.conversation_id, a.user_id 
           FROM conversations c 
           JOIN agents a ON c.agent_id = a.agent_id 
           WHERE c.conversation_id = $1`,
          [conversationId]
        );
        
        if (convResult.rows.length > 0) {
          const { customer_phone, user_id } = convResult.rows[0];
          
          // Get extraction ID
          const extractionResult = await db.query(
            `SELECT extraction_id FROM extractions 
             WHERE conversation_id = $1 AND is_latest = true 
             ORDER BY extracted_at DESC LIMIT 1`,
            [conversationId]
          );
          
          const extractionId = extractionResult.rows[0]?.extraction_id || conversationId;
          
          // Sync extraction data to contacts table
          await contactService.syncFromExtraction(
            user_id,
            extractionId,
            conversationId,
            customer_phone,
            {
              name: validation.data!.name,
              email: validation.data!.email,
              company: validation.data!.company,
              lead_status_tag: validation.data!.lead_status_tag,
            }
          );
          
          // Emit extraction.complete event for campaign triggers
          appEventEmitter.emitExtractionComplete({
            extractionId,
            conversationId,
            userId: user_id,
            customerPhone: customer_phone,
            leadStatusTag: validation.data!.lead_status_tag,
          });
          
          logger.info('Contact synced and extraction event emitted', {
            conversationId,
            userId: user_id,
            customerPhone: customer_phone
          });
        }
      } catch (syncError) {
        // Don't fail the extraction if sync fails
        logger.error('Failed to sync contact from extraction', {
          conversationId,
          error: syncError
        });
      }
      
      logger.info('Lead data extracted successfully', { 
        conversationId,
        openaiConversationId,
        hasName: !!validation.data!.name,
        hasEmail: !!validation.data!.email,
        hasCompany: !!validation.data!.company
      });
    } catch (error) {
      logger.error('Failed to extract lead data', { 
        conversationId,
        openaiConversationId,
        retryCount,
        error 
      });

      // Retry if under max retries
      if (retryCount < this.config.maxRetries) {
        logger.info('Retrying extraction after error', { 
          conversationId, 
          retryCount: retryCount + 1 
        });
        await this.extractLeadData(conversationId, openaiConversationId, retryCount + 1);
      }
    }
  }

  /**
   * Call OpenAI API for extraction
   * Creates NEW conversation with full context to avoid polluting user conversation
   */
  private async callOpenAIForExtraction(openaiConversationId: string): Promise<ExtractionData> {
    try {
      // Use extraction prompt from environment config
      const extractionPromptId = extractionConfig.promptId;
      
      // Step 1: Get full conversation history from database as message array
      const messages = await this.getConversationMessages(openaiConversationId);
      
      if (!messages || messages.length === 0) {
        throw new Error('No conversation messages found');
      }
      
      logger.debug('Retrieved conversation messages for extraction', {
        openaiConversationId,
        messageCount: messages.length
      });
      
      // Step 2: Add extraction instruction as final user message (required for json_object format)
      // OpenAI requires the word "json" in input when using json_object format
      messages.push({
        role: 'user',
        content: 'Please analyze the above conversation and extract lead information in JSON format according to the schema.'
      });
      
      // Step 3: Create NEW OpenAI conversation for extraction (don't pollute user conversation)
      const extractionConversation = await createOpenAIConversation({
        source: 'extraction-worker',
        original_conversation_id: openaiConversationId
      });
      
      logger.info('Created new extraction conversation', {
        openaiConversationId,
        extractionConversationId: extractionConversation.id
      });
      
      // Step 4: Call OpenAI with full message history and extraction prompt
      const response = await callOpenAIWithMessages(
        messages,  // Pass full conversation history + extraction instruction
        extractionConversation.id,  // NEW conversation ID
        extractionPromptId,
        'extraction-system'
      );

      // Check if call was successful
      if (!response.success || !response.response) {
        throw new Error(response.error || 'OpenAI call failed');
      }

      // Parse JSON response
      const extractedData = this.parseExtractionResponse(response.response);
      return extractedData;
    } catch (error) {
      logger.error('OpenAI extraction call failed', { error });
      throw error;
    }
  }

  /**
   * Get conversation messages as array for OpenAI API
   */
  private async getConversationMessages(
    openaiConversationId: string
  ): Promise<Array<{ role: 'user' | 'assistant'; content: string }> | null> {
    try {
      const query = `
        SELECT m.sender, m.text, m.timestamp, m.sequence_no
        FROM messages m
        INNER JOIN conversations c ON m.conversation_id = c.conversation_id
        WHERE c.openai_conversation_id = $1
        ORDER BY m.sequence_no ASC
      `;
      
      const result = await db.query(query, [openaiConversationId]);
      
      if (result.rows.length === 0) {
        logger.warn('No messages found for conversation', { openaiConversationId });
        return null;
      }
      
      // Convert to OpenAI message format
      const messages = result.rows.map((msg: any) => ({
        role: msg.sender === 'user' ? 'user' as const : 'assistant' as const,
        content: msg.text
      }));
      
      logger.debug('Retrieved conversation messages', {
        openaiConversationId,
        messageCount: messages.length
      });
      
      return messages;
    } catch (error) {
      logger.error('Failed to get conversation messages', { 
        openaiConversationId,
        error 
      });
      return null;
    }
  }



  /**
   * Parse extraction response from OpenAI
   * Handles various response formats and extracts JSON
   * Maps the OpenAI response structure to our ExtractionData format
   */
  private parseExtractionResponse(responseText: string): ExtractionData {
    logger.debug('Parsing extraction response', { 
      responseText,
      responseLength: responseText.length 
    });

    let parsed: any;

    try {
      // Try to parse as JSON directly
      parsed = JSON.parse(responseText);
      logger.debug('Successfully parsed JSON directly', { parsed });
    } catch (error) {
      logger.debug('Direct JSON parse failed, trying alternative methods');
      
      // Try to extract JSON from markdown code blocks
      const jsonMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        try {
          parsed = JSON.parse(jsonMatch[1]);
          logger.debug('Successfully parsed JSON from code block', { parsed });
        } catch (e) {
          logger.error('Failed to parse JSON from code block', { responseText, error: e });
          throw new Error('Invalid JSON in code block');
        }
      } else {
        // Try to find JSON object in text
        const objectMatch = responseText.match(/\{[\s\S]*\}/);
        if (objectMatch) {
          try {
            parsed = JSON.parse(objectMatch[0]);
            logger.debug('Successfully parsed JSON from text match', { parsed });
          } catch (e) {
            logger.error('Failed to parse JSON object from text', { responseText, error: e });
            throw new Error('Invalid JSON object in text');
          }
        } else {
          logger.error('No valid JSON found in response', { responseText });
          throw new Error('No valid JSON found in OpenAI response');
        }
      }
    }

    // Map the parsed response to ExtractionData format
    const extractionData: ExtractionData = {
      // Lead scoring fields
      intent_level: parsed.intent_level,
      intent_score: parsed.intent_score,
      urgency_level: parsed.urgency_level,
      urgency_score: parsed.urgency_score,
      budget_constraint: parsed.budget_constraint,
      budget_score: parsed.budget_score,
      fit_alignment: parsed.fit_alignment,
      fit_score: parsed.fit_score,
      engagement_health: parsed.engagement_health,
      engagement_score: parsed.engagement_score,
      
      // Overall scoring
      total_score: parsed.total_score,
      lead_status_tag: parsed.lead_status_tag,
      
      // Demo booking
      demo_book_datetime: parsed.demo_book_datetime,
      
      // Reasoning
      reasoning: parsed.reasoning,
      
      // Contact info from extraction sub-object
      name: parsed.extraction?.name || null,
      email: parsed.extraction?.email_address || null,
      company: parsed.extraction?.company_name || null,
      smart_notification: parsed.extraction?.smartnotification || null,
      
      // New fields from extraction sub-object
      requirements: parsed.extraction?.requirements || null,
      custom_cta: parsed.extraction?.['Custom CTA'] || null,
      in_detail_summary: parsed.extraction?.['In detail summary'] || null
    };

    logger.debug('Mapped extraction data', { extractionData });
    return extractionData;
  }

  /**
   * Get worker status
   */
  getStatus(): { isRunning: boolean; config: ExtractionWorkerConfig } {
    return {
      isRunning: this.isRunning,
      config: this.config
    };
  }

  /**
   * Update last_extraction_at timestamp for a conversation
   */
  private async updateLastExtractionTimestamp(conversationId: string): Promise<void> {
    try {
      const query = `
        UPDATE conversations 
        SET last_extraction_at = CURRENT_TIMESTAMP 
        WHERE conversation_id = $1
      `;
      await db.query(query, [conversationId]);
      
      logger.debug('Updated last_extraction_at', { conversationId });
    } catch (error) {
      logger.error('Failed to update last_extraction_at', { 
        conversationId,
        error 
      });
      // Don't throw - extraction was successful, just timestamp update failed
    }
  }
}

// Export singleton instance
export default new ExtractionWorker();
