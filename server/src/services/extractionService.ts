import { ExtractionModel, Extraction, ExtractionData } from '../models/Extraction';
import { ConversationModel } from '../models/Conversation';
import { MessageModel } from '../models/Message';
import { db } from '../utils/database';
import { logger } from '../utils/logger';

interface ExtractionValidationResult {
  isValid: boolean;
  errors: string[];
  data?: ExtractionData;
}

class ExtractionService {
  private extractionModel: ExtractionModel;
  private conversationModel: ConversationModel;
  private messageModel: MessageModel;

  constructor() {
    // Use the singleton db instance which is DatabaseConnection
    // For models that need Pool, we pass db (which has query method compatible with Pool)
    // For ConversationModel which expects DatabaseConnection, we pass db directly
    this.extractionModel = new ExtractionModel(db as any);
    this.conversationModel = new ConversationModel(db);
    this.messageModel = new MessageModel(db as any);
  }

  /**
   * Validate extraction data against expected schema
   */
  validateExtractionData(data: any): ExtractionValidationResult {
    const errors: string[] = [];
    const validatedData: ExtractionData = {};

    // Validate contact information
    if (data.name !== undefined && data.name !== null) {
      if (typeof data.name === 'string' && data.name.length <= 100) {
        validatedData.name = data.name.trim();
      } else {
        errors.push('name must be a string with max length 100');
      }
    }

    if (data.email !== undefined && data.email !== null) {
      if (typeof data.email === 'string') {
        const trimmedEmail = data.email.trim().toLowerCase();
        if (trimmedEmail.length <= 255) {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (emailRegex.test(trimmedEmail)) {
            validatedData.email = trimmedEmail;
          } else {
            errors.push('email must be a valid email address');
          }
        } else {
          errors.push('email must be a string with max length 255');
        }
      } else {
        errors.push('email must be a string');
      }
    }

    if (data.company !== undefined && data.company !== null) {
      if (typeof data.company === 'string' && data.company.length <= 255) {
        validatedData.company = data.company.trim();
      } else {
        errors.push('company must be a string with max length 255');
      }
    }

    // Validate lead scoring levels (Low, Medium, High)
    const levelFields = ['intent_level', 'urgency_level', 'fit_alignment', 'engagement_health'];
    levelFields.forEach(field => {
      if (data[field] !== undefined && data[field] !== null) {
        if (typeof data[field] === 'string') {
          (validatedData as any)[field] = data[field].trim();
        }
      }
    });

    // Validate budget constraint (Yes, No, Maybe)
    if (data.budget_constraint !== undefined && data.budget_constraint !== null) {
      if (typeof data.budget_constraint === 'string') {
        validatedData.budget_constraint = data.budget_constraint.trim();
      }
    }

    // Validate score fields (1-3 range)
    const scoreFields = ['intent_score', 'urgency_score', 'budget_score', 'fit_score', 'engagement_score'];
    scoreFields.forEach(field => {
      if (data[field] !== undefined && data[field] !== null) {
        const value = parseInt(data[field], 10);
        if (!isNaN(value) && value >= 1 && value <= 3) {
          (validatedData as any)[field] = value;
        } else {
          errors.push(`${field} must be an integer between 1 and 3`);
        }
      }
    });

    // Validate custom_cta (comma-separated string)
    if (data.custom_cta !== undefined && data.custom_cta !== null) {
      if (typeof data.custom_cta === 'string') {
        validatedData.custom_cta = data.custom_cta.trim();
      } else {
        errors.push('custom_cta must be a string');
      }
    }

    // Validate requirements
    if (data.requirements !== undefined && data.requirements !== null) {
      if (typeof data.requirements === 'string') {
        validatedData.requirements = data.requirements.trim();
      } else {
        errors.push('requirements must be a string');
      }
    }

    // Validate in_detail_summary
    if (data.in_detail_summary !== undefined && data.in_detail_summary !== null) {
      if (typeof data.in_detail_summary === 'string') {
        validatedData.in_detail_summary = data.in_detail_summary.trim();
      } else {
        errors.push('in_detail_summary must be a string');
      }
    }

    // Validate total_score
    if (data.total_score !== undefined && data.total_score !== null) {
      const value = parseInt(data.total_score, 10);
      if (!isNaN(value)) {
        validatedData.total_score = value;
      }
    }

    // Validate lead_status_tag (Hot, Warm, Cold)
    if (data.lead_status_tag !== undefined && data.lead_status_tag !== null) {
      if (typeof data.lead_status_tag === 'string') {
        validatedData.lead_status_tag = data.lead_status_tag.trim();
      }
    }

    // Validate demo_book_datetime
    if (data.demo_book_datetime !== undefined && data.demo_book_datetime !== null) {
      const date = new Date(data.demo_book_datetime);
      if (!isNaN(date.getTime())) {
        validatedData.demo_book_datetime = date;
      } else {
        errors.push('demo_book_datetime must be a valid date');
      }
    }

    // Validate reasoning object
    if (data.reasoning !== undefined && data.reasoning !== null) {
      if (typeof data.reasoning === 'object') {
        validatedData.reasoning = data.reasoning;
      } else {
        errors.push('reasoning must be an object');
      }
    }

    // Validate smart_notification
    if (data.smart_notification !== undefined && data.smart_notification !== null) {
      if (typeof data.smart_notification === 'string') {
        validatedData.smart_notification = data.smart_notification.trim();
      } else {
        errors.push('smart_notification must be a string');
      }
    }

    if (errors.length === 0) {
      return {
        isValid: true,
        errors: [],
        data: validatedData
      };
    } else {
      return {
        isValid: false,
        errors
      };
    }
  }

  /**
   * Create new extraction snapshot for a conversation
   * HISTORY MODE: Always creates new extraction, marks previous as not latest
   */
  async createOrUpdateExtraction(
    conversationId: string, 
    extractionData: ExtractionData
  ): Promise<Extraction> {
    // Validate conversation exists
    const conversation = await this.conversationModel.findById(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    // Validate extraction data
    const validation = this.validateExtractionData(extractionData);
    if (!validation.isValid) {
      logger.error('Invalid extraction data', { 
        conversationId, 
        errors: validation.errors 
      });
      throw new Error(`Invalid extraction data: ${validation.errors.join(', ')}`);
    }

    // Get message count at time of extraction
    const messageCountResult = await db.query(
      'SELECT COUNT(*) as count FROM messages WHERE conversation_id = $1',
      [conversationId]
    );
    const messageCount = parseInt(messageCountResult.rows[0]?.count || '0', 10);

    // Mark all previous extractions as not latest
    await db.query(
      'UPDATE extractions SET is_latest = false WHERE conversation_id = $1 AND is_latest = true',
      [conversationId]
    );

    logger.info('Creating new extraction snapshot', { 
      conversationId,
      messageCount,
      previousExtractionsMarkedOld: true
    });

    // Create new extraction (will be marked as latest by default)
    return await this.extractionModel.create({
      conversation_id: conversationId,
      message_count_at_extraction: messageCount,
      ...validation.data!
    });
  }

  /**
   * Get extraction for a conversation
   */
  async getExtractionByConversationId(conversationId: string): Promise<Extraction | null> {
    return await this.extractionModel.findByConversationId(conversationId);
  }

  /**
   * Get extraction history for a conversation
   */
  async getExtractionHistory(conversationId: string): Promise<Extraction[]> {
    return await this.extractionModel.findAllByConversationId(conversationId);
  }

  /**
   * Get all extractions for a user
   */
  async getExtractionsByUserId(
    userId: string, 
    limit: number = 50, 
    offset: number = 0
  ): Promise<Extraction[]> {
    return await this.extractionModel.findByUserId(userId, limit, offset);
  }

  /**
   * Check if conversation needs extraction
   * Returns true if conversation has recent activity and no extraction exists
   */
  async shouldExtract(conversationId: string): Promise<boolean> {
    const conversation = await this.conversationModel.findById(conversationId);
    if (!conversation || !conversation.is_active) {
      return false;
    }

    // Check if extraction already exists
    const hasExtraction = await this.extractionModel.existsForConversation(conversationId);
    if (hasExtraction) {
      // Check if there are new messages since last extraction
      const extraction = await this.extractionModel.findByConversationId(conversationId);
      if (extraction) {
        const messagesSinceExtraction = await this.messageModel.findByConversationId(
          conversationId,
          { limit: 100 }
        );
        const newMessages = messagesSinceExtraction.filter(
          msg => new Date(msg.timestamp) > new Date(extraction.updated_at)
        );
        return newMessages.length > 0;
      }
    }

    // Check if conversation has enough activity (at least 2 messages)
    const messages = await this.messageModel.findByConversationId(conversationId, { limit: 10 });
    return messages.length >= 2;
  }

  /**
   * Get conversation context for extraction
   * Returns recent messages formatted for OpenAI
   */
  async getConversationContext(conversationId: string, limit: number = 50): Promise<string> {
    const messages = await this.messageModel.findByConversationId(conversationId, { limit });
    
    if (messages.length === 0) {
      return '';
    }

    // Format messages as conversation transcript
    const transcript = messages.map(msg => {
      const role = msg.sender === 'user' ? 'Customer' : 'Agent';
      return `${role}: ${msg.text}`;
    }).join('\n');

    return transcript;
  }

  /**
   * Delete extraction
   */
  async deleteExtraction(extractionId: string): Promise<boolean> {
    return await this.extractionModel.delete(extractionId);
  }
}

export default new ExtractionService();
