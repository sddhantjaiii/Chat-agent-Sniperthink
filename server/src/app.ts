// Early startup logging - before any imports that might hang
console.log('[STARTUP] App.ts loading...');
console.log('[STARTUP] NODE_ENV:', process.env['NODE_ENV']);
console.log('[STARTUP] DATABASE_URL set:', !!process.env['DATABASE_URL']);
console.log('[STARTUP] OPENAI_API_KEY set:', !!process.env['OPENAI_API_KEY']);

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import session from 'express-session';

console.log('[STARTUP] Loading config...');
import { appConfig } from './config';
console.log('[STARTUP] Config loaded, port:', appConfig.port);

console.log('[STARTUP] Loading logger...');
import { logger } from './utils/logger';
console.log('[STARTUP] Loading database...');
import { db } from './utils/database';
console.log('[STARTUP] Loading storage...');
import { initializeStorage, storage } from './utils/storage';
console.log('[STARTUP] All imports complete');

// Increase max listeners to support many workers
process.setMaxListeners(1000);

export class App {
  public app: express.Application;

  constructor() {
    console.log('[STARTUP] App constructor starting...');
    this.app = express();
    console.log('[STARTUP] Express app created');
    this.initializeMiddleware();
    console.log('[STARTUP] Middleware initialized');
    this.initializeRoutes();
    console.log('[STARTUP] Routes initialized');
    this.initializeErrorHandling();
  }

  private initializeMiddleware(): void {
    // Security middleware with relaxed CSP for development
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          scriptSrcAttr: ["'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
        },
      },
    }));

    // CORS configuration - Allow all origins in development
    this.app.use(cors({
      origin: true, // Allow all origins
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-correlation-id'],
    }));

    // Compression
    this.app.use(compression());

    // Session middleware for Google OAuth
    this.app.use(session({
      secret: process.env['SESSION_SECRET'] || 'your-secret-key-change-in-production',
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env['NODE_ENV'] === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      }
    }));

    // Serve static files from public directory (for webchat widget)
    // Path is relative to server directory, so go up one level
    const path = require('path');
    const publicPath = path.join(__dirname, '../../public');
    this.app.use(express.static(publicPath, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js')) {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
          res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        }
      }
    }));

    // Raw body parser for webhook signature verification
    // Must be BEFORE express.json() to preserve raw body
    this.app.use('/webhook/meta', express.json({
      limit: '10mb',
      verify: (req: any, _res, buf) => {
        // Store raw body for signature verification
        req.rawBody = buf.toString('utf8');
      }
    }));

    // Body parsing for other routes
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Request logging
    this.app.use((req, res, next) => {
      const start = Date.now();
      const headerValue = req.headers['x-correlation-id'];
      const correlationId: string = Array.isArray(headerValue)
        ? (headerValue[0] || `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`)
        : (headerValue || `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`);

      req.correlationId = correlationId;
      res.setHeader('x-correlation-id', correlationId);

      res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info('HTTP Request', {
          method: req.method,
          url: req.url,
          statusCode: res.statusCode,
          duration,
          correlationId,
          userAgent: req.get('User-Agent'),
          ip: req.ip,
        });
      });

      next();
    });
  }

  private initializeRoutes(): void {
    // Import webhook handlers
    const { handleMetaWebhook, handleWebhookVerification } = require('./controllers/webhook');
    const { validateWebhookSignature, validateCreditAmount } = require('./middleware/auth');

    // Import Google tokens controller
    const { listGoogleTokens, getUserGoogleToken, deleteUserGoogleToken, connectGoogleCalendar } = require('./controllers/googleTokensController');

    // Import admin controller and middleware
    const { adminController } = require('./controllers/adminController');
    const { adminAuthMiddleware, adminLoginHandler, refreshAdminToken } = require('./middleware/adminAuth');
    
    // Import external API controller
    const { externalApiController } = require('./controllers/externalApiController');

    // Import controllers
    const { UsersController } = require('./controllers/users');
    const { AgentsController } = require('./controllers/agents');
    const { MessagesController } = require('./controllers/messages');
    const { ExtractionsController } = require('./controllers/extractions');
    const { WebchatController } = require('./controllers/webchat');
    const { leadsController } = require('./controllers/leads');
    const cacheController = require('./controllers/cache');

    // Initialize controllers
    const usersController = new UsersController();
    const agentsController = new AgentsController();
    const messagesController = new MessagesController();
    const extractionsController = new ExtractionsController();
    const webchatController = new WebchatController();

    // Simple test endpoint
    this.app.get('/ping', (_req, res) => {
      res.json({ pong: true });
    });

    // Health check endpoint
    this.app.get('/health', async (req, res) => {
      try {
        const dbHealth = await db.healthCheck();
        const storageHealth = await storage.healthCheck();

        const health = {
          status: dbHealth.status === 'healthy' && storageHealth.status === 'healthy' ? 'healthy' : 'unhealthy',
          timestamp: new Date().toISOString(),
          service: appConfig.name,
          version: appConfig.version,
          environment: appConfig.env,
          checks: {
            database: dbHealth,
            storage: storageHealth,
          },
        };

        const statusCode = health.status === 'healthy' ? 200 : 503;
        res.status(statusCode).json(health);
      } catch (error) {
        logger.error('Health check failed', { error: (error as Error).message, correlationId: req.correlationId });
        res.status(503).json({
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: 'Health check failed',
        });
      }
    });

    // Meta webhook endpoints (WhatsApp & Instagram)
    // GET for webhook verification during setup
    this.app.get('/webhook/meta', handleWebhookVerification);
    // POST for receiving messages (with signature validation)
    this.app.post('/webhook/meta', validateWebhookSignature, handleMetaWebhook);

    // User routes
    this.app.post('/users/:user_id/phone_numbers', usersController.addPhoneNumber);
    this.app.get('/users/:user_id/phone_numbers', usersController.listPhoneNumbers);
    this.app.delete('/users/:user_id/phone_numbers/:phone_number_id', usersController.deletePhoneNumber);
    this.app.get('/users/:user_id/credits', usersController.getCredits);
    this.app.post('/users/:user_id/credits/add', validateCreditAmount, usersController.addCredits);

    // Agent routes
    this.app.post('/users/:user_id/agents', agentsController.createAgent);
    this.app.get('/users/:user_id/agents', agentsController.listAgents);
    this.app.get('/users/:user_id/agents/:agent_id', agentsController.getAgent);
    this.app.patch('/users/:user_id/agents/:agent_id', agentsController.updateAgent);
    this.app.delete('/users/:user_id/agents/:agent_id', agentsController.deleteAgent);

    // Message and conversation routes
    this.app.get('/users/:user_id/messages', messagesController.getMessages);
    this.app.get('/users/:user_id/messages/stats', messagesController.getMessageStats);
    this.app.get('/users/:user_id/conversations', messagesController.getConversations);
    this.app.get('/users/:user_id/conversations/:conversation_id', messagesController.getConversation);
    this.app.get('/users/:user_id/conversations/:conversation_id/messages', messagesController.getConversationMessages);

    // Extraction routes
    this.app.get('/users/:user_id/extractions', extractionsController.getExtractions);
    this.app.get('/users/:user_id/extractions/stats', extractionsController.getExtractionStats);
    this.app.get('/users/:user_id/extractions/export', extractionsController.exportExtractions);
    this.app.get('/users/:user_id/extractions/:extraction_id', extractionsController.getExtraction);
    this.app.get('/users/:user_id/conversations/:conversation_id/extraction', extractionsController.getConversationExtraction);
    this.app.post('/users/:user_id/conversations/:conversation_id/extract', extractionsController.triggerExtraction);

    // Leads routes (unified lead management)
    this.app.get('/users/:user_id/leads', leadsController.getLeads);
    this.app.get('/users/:user_id/leads/stats', leadsController.getLeadStats);
    this.app.get('/users/:user_id/leads/:customer_phone', leadsController.getLead);
    this.app.get('/users/:user_id/leads/:customer_phone/messages', leadsController.getLeadMessages);

    // Webchat routes
    this.app.post('/api/users/:user_id/webchat/channels', webchatController.createChannel);
    this.app.get('/api/webchat/:webchat_id/embed', webchatController.getEmbedCode);
    this.app.get('/api/webchat/:webchat_id/config', webchatController.getConfigPage);
    this.app.get('/api/webchat/:webchat_id/stream', webchatController.streamMessages); // SSE endpoint
    this.app.post('/api/webchat/:webchat_id/verify-phone', webchatController.verifyPhone);
    this.app.post('/api/webchat/:webchat_id/messages', webchatController.sendMessage);
    this.app.get('/api/webchat/:webchat_id/messages', webchatController.getMessages);
    this.app.post('/api/webchat/:webchat_id/init', webchatController.initSession);

    // Cache management routes (for performance optimization)
    this.app.post('/api/cache/invalidate/session', cacheController.invalidateSessionCache);
    this.app.post('/api/cache/invalidate/phone-number', cacheController.invalidatePhoneNumberCache);
    this.app.post('/api/cache/invalidate/agent', cacheController.invalidateAgentCache);
    this.app.post('/api/cache/invalidate/credits', cacheController.invalidateCreditsCache);
    this.app.post('/api/cache/clear-all', cacheController.clearAllCache);
    this.app.get('/api/cache/stats', cacheController.getCacheStats);

    // Google Calendar token management routes
    this.app.post('/api/users/:user_id/google-calendar/connect', connectGoogleCalendar);
    this.app.get('/api/google-tokens', listGoogleTokens);
    this.app.get('/api/google-tokens/:user_id', getUserGoogleToken);
    this.app.delete('/api/google-tokens/:user_id', deleteUserGoogleToken);

    // ===================================================
    // Admin Panel Routes (Super Admin)
    // ===================================================
    
    // Admin authentication (public endpoints)
    this.app.post('/admin/login', adminLoginHandler);
    this.app.post('/admin/refresh', refreshAdminToken);

    // Apply admin auth middleware to all /admin/* routes (except login/refresh)
    this.app.use('/admin', adminAuthMiddleware);

    // Dashboard & Analytics
    this.app.get('/admin/dashboard', adminController.getDashboardStats);
    this.app.get('/admin/rate-limits', adminController.getRateLimitStats);

    // Users management
    this.app.get('/admin/users', adminController.listUsers);
    this.app.post('/admin/users', adminController.createUser);
    this.app.get('/admin/users/:userId', adminController.getUser);
    this.app.patch('/admin/users/:userId', adminController.updateUser);
    this.app.delete('/admin/users/:userId', adminController.deleteUser);
    this.app.post('/admin/users/:userId/credits', adminController.addUserCredits);

    // User-specific phone numbers (admin manages user's phone numbers)
    this.app.post('/admin/users/:userId/phone-numbers', adminController.addUserPhoneNumber);
    this.app.delete('/admin/users/:userId/phone-numbers/:phoneNumberId', adminController.deleteUserPhoneNumber);

    // User-specific agents (admin manages user's agents with OpenAI prompts)
    this.app.post('/admin/users/:userId/agents', adminController.createUserAgent);
    this.app.patch('/admin/users/:userId/agents/:agentId', adminController.updateUserAgent);

    // Phone Numbers management (global view)
    this.app.get('/admin/phone-numbers', adminController.listPhoneNumbers);
    this.app.patch('/admin/phone-numbers/:phoneNumberId', adminController.updatePhoneNumber);

    // Agents management (global view)
    this.app.get('/admin/agents', adminController.listAgents);
    this.app.get('/admin/agents/:agentId', adminController.getAgent);
    this.app.delete('/admin/agents/:agentId', adminController.deleteAgent);

    // Conversations & Messages
    this.app.get('/admin/conversations', adminController.listConversations);
    this.app.get('/admin/conversations/:conversationId/messages', adminController.getConversationMessages);

    // Templates management
    this.app.get('/admin/templates', adminController.listTemplates);
    this.app.get('/admin/templates/:templateId', adminController.getTemplate);
    this.app.post('/admin/templates', adminController.createTemplate);
    this.app.post('/admin/templates/sync', adminController.syncTemplates);
    this.app.post('/admin/templates/:templateId/submit', adminController.submitTemplate);
    this.app.delete('/admin/templates/:templateId', adminController.deleteTemplate);
    this.app.get('/admin/templates/:templateId/button-clicks', adminController.getTemplateButtonClicks);

    // Button Click Analytics
    this.app.get('/admin/button-clicks', adminController.listButtonClicks);
    this.app.get('/admin/leads/:customerPhone/button-activity', adminController.getLeadButtonActivity);

    // Contacts management
    this.app.get('/admin/contacts', adminController.listContacts);
    this.app.post('/admin/contacts/import', adminController.importContacts);
    this.app.delete('/admin/contacts/:contactId', adminController.deleteContact);

    // Campaigns management
    this.app.get('/admin/campaigns', adminController.listCampaigns);
    this.app.get('/admin/campaigns/:campaignId', adminController.getCampaign);
    this.app.post('/admin/campaigns', adminController.createCampaign);
    this.app.post('/admin/campaigns/:campaignId/start', adminController.startCampaign);
    this.app.post('/admin/campaigns/:campaignId/pause', adminController.pauseCampaign);
    this.app.post('/admin/campaigns/:campaignId/resume', adminController.resumeCampaign);
    this.app.post('/admin/campaigns/:campaignId/cancel', adminController.cancelCampaign);
    this.app.delete('/admin/campaigns/:campaignId', adminController.deleteCampaign);

    // ===================================================
    // External API Routes (NO AUTHENTICATION)
    // For Dashboard to communicate with WhatsApp service
    // ===================================================
    
    // Users
    this.app.post('/api/v1/users', externalApiController.createUser);
    this.app.get('/api/v1/users/:userId', externalApiController.getUser);
    
    // Credits
    this.app.get('/api/v1/credits', externalApiController.getCredits);
    this.app.post('/api/v1/credits/adjust', externalApiController.adjustCredits);
    
    // Phone Numbers
    this.app.get('/api/v1/phone-numbers', externalApiController.listPhoneNumbers);
    this.app.post('/api/v1/phone-numbers', externalApiController.createPhoneNumber);
    this.app.get('/api/v1/phone-numbers/:phoneNumberId', externalApiController.getPhoneNumber);
    this.app.patch('/api/v1/phone-numbers/:phoneNumberId', externalApiController.updatePhoneNumber);
    this.app.delete('/api/v1/phone-numbers/:phoneNumberId', externalApiController.deletePhoneNumber);
    
    // Agents
    this.app.get('/api/v1/agents', externalApiController.listAgents);
    this.app.post('/api/v1/agents', externalApiController.createAgent);
    this.app.get('/api/v1/agents/:agentId', externalApiController.getAgent);
    this.app.patch('/api/v1/agents/:agentId', externalApiController.updateAgent);
    this.app.delete('/api/v1/agents/:agentId', externalApiController.deleteAgent);
    
    // Templates - Full CRUD
    this.app.get('/api/v1/templates', externalApiController.listTemplates);
    this.app.get('/api/v1/templates/:templateId', externalApiController.getTemplate);
    this.app.post('/api/v1/templates', externalApiController.createTemplate);
    this.app.post('/api/v1/templates/sync', externalApiController.syncTemplates);
    this.app.post('/api/v1/templates/:templateId/submit', externalApiController.submitTemplate);
    this.app.delete('/api/v1/templates/:templateId', externalApiController.deleteTemplate);
    
    // Button Click Analytics
    this.app.get('/api/v1/templates/:templateId/button-clicks', externalApiController.getTemplateButtonClicks);
    this.app.get('/api/v1/button-clicks', externalApiController.listButtonClicks);
    this.app.get('/api/v1/leads/:customerPhone/button-activity', externalApiController.getLeadButtonActivity);
    
    // Messaging
    this.app.post('/api/v1/send', externalApiController.sendSingleMessage);
    this.app.post('/api/v1/campaign', externalApiController.createExternalCampaign);
    this.app.get('/api/v1/campaign/:campaignId', externalApiController.getCampaignStatus);

    // Root endpoint
    this.app.get('/', (_req, res) => {
      res.json({
        service: appConfig.name,
        version: appConfig.version,
        environment: appConfig.env,
        timestamp: new Date().toISOString(),
      });
    });
  }

  private initializeErrorHandling(): void {
    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.originalUrl} not found`,
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId,
      });
    });

    // Global error handler
    this.app.use((error: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
      logger.error('Unhandled error', {
        error: error.message,
        stack: error.stack,
        correlationId: req.correlationId,
        method: req.method,
        url: req.url,
      });

      res.status(500).json({
        error: 'Internal Server Error',
        message: process.env['NODE_ENV'] === 'development' ? error.message : 'Something went wrong',
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId,
      });
    });
  }

  public async initialize(): Promise<void> {
    try {
      logger.info('Starting application initialization...');
      
      // Initialize database connection
      logger.info('Connecting to database...');
      await db.connect();
      logger.info('Database connection initialized');

      // Initialize in-memory storage
      logger.info('Initializing storage...');
      await initializeStorage();
      logger.info('In-memory storage initialized');

      // Workers will be started after server is listening
      logger.info('Workers will start after server initialization');
      logger.info('Application initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize application', { error: (error as Error).message });
      throw error;
    }
  }

  public async shutdown(): Promise<void> {
    try {
      await db.disconnect();
      logger.info('Application shutdown completed');
    } catch (error) {
      logger.error('Error during application shutdown', { error: (error as Error).message });
    }
  }

  public listen(): void {
    const port = appConfig.port;
    const host = '0.0.0.0'; // Listen on all interfaces
    logger.info(`Attempting to start server on port ${port}...`);
    this.app.listen(port, host, () => {
      logger.info(`Server started on port ${port}`, {
        port,
        host,
        environment: appConfig.env,
        version: appConfig.version,
      });

      // Start workers AFTER server is listening
      logger.info('Server is ready, starting workers...');
      this.startWorkers();
    });
  }

  private startWorkers(): void {
    logger.info('Starting optimized background workers...');

    // Start workers asynchronously without blocking
    (async () => {
      try {
        const { startOptimizedMessageWorker } = await import('./workers/optimizedMessageWorker');
        const extractionWorkerModule = await import('./workers/extractionWorker');
        const extractionWorker = extractionWorkerModule.default;
        const { campaignWorker } = await import('./workers/campaignWorker');

        // Get worker count from environment
        const workerCount = parseInt(process.env['MIN_WORKERS'] || '5', 10);

        // Start optimized message workers
        logger.info(`Starting ${workerCount} optimized message workers...`);
        for (let i = 0; i < workerCount; i++) {
          const workerId = `optimized-worker-${Date.now()}-${i}`;
          startOptimizedMessageWorker(workerId);
          logger.info('Started optimized message worker', { workerId });
        }

        // Start extraction worker
        extractionWorker.start();
        logger.info('Extraction worker started successfully');

        // Start campaign worker
        campaignWorker.start();
        logger.info('Campaign worker started successfully');

        logger.info('All background workers started', {
          messageWorkers: workerCount,
          extractionWorker: 'running',
          campaignWorker: 'running'
        });
      } catch (error) {
        logger.error('Failed to start workers', { error: (error as Error).message });
      }
    })();
  }
}

// Extend Express Request interface
declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
      rawBody?: string;
    }
  }
}

// Extend express-session types
declare module 'express-session' {
  interface SessionData {
    userId?: string;
  }
}

// Create and export app instance
const app = new App();

// Handle graceful shutdown (use once to avoid duplicate listeners)
process.once('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await app.shutdown();
  process.exit(0);
});

process.once('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await app.shutdown();
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', { reason, promise });
  process.exit(1);
});

export default app;