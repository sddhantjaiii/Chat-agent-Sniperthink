import * as dotenv from 'dotenv';
import * as Joi from 'joi';

// Load environment variables
dotenv.config();

export interface AppConfig {
    app: {
        name: string;
        version: string;
        env: string;
        port: number;
        logLevel: string;
        logFormat: string;
        correlationIdHeader: string;
    };
    database: {
        url: string;
        poolSize: number;
        timeout: number;
    };
    openai: {
        apiKey: string;
        baseUrl: string;
        timeout: number;
        maxRetries: number;
    };
    rateLimit: {
        retryEnabled: boolean;
        retryDelays: number[];
        initialMessage: string;
        finalMessage: string;
    };
    webhook: {
        secret: string;
        port: number;
        path: string;
    };
    api: {
        port: number;
        keyHeader: string;
        rateLimit: number;
    };
    worker: {
        concurrency: number;
        pollInterval: number;
        extractionInterval: number;
        extractionInactivityThreshold: number;
    };
    extraction: {
        promptId: string;
        enabled: boolean;
    };
    platforms: {
        whatsappBaseUrl: string;
        instagramBaseUrl: string;
        webchatWidgetUrl: string;
    };
    admin: {
        password: string;
        jwtSecret: string;
        jwtExpiresIn: string;
    };
    templates: {
        defaultLanguage: string;
        syncIntervalMs: number;
        maxVariablesPerTemplate: number;
    };
    campaigns: {
        batchSize: number;
        delayBetweenBatchesMs: number;
        maxRecipientsPerCampaign: number;
    };
}

// Configuration validation schema
const configSchema = Joi.object({
    app: Joi.object({
        name: Joi.string().default('multi-channel-ai-agent'),
        version: Joi.string().default('1.0.0'),
        env: Joi.string().valid('development', 'production', 'test').default('development'),
        port: Joi.number().port().default(4000),
        logLevel: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
        logFormat: Joi.string().valid('json', 'simple').default('json'),
        correlationIdHeader: Joi.string().default('x-correlation-id'),
    }).required(),

    database: Joi.object({
        url: Joi.string().uri().required(),
        poolSize: Joi.number().integer().min(1).max(1000).default(20),
        timeout: Joi.number().integer().min(1000).default(30000),
    }).required(),

    openai: Joi.object({
        apiKey: Joi.string().pattern(/^sk-/).required(),
        baseUrl: Joi.string().uri().default('https://api.openai.com/v1'),
        timeout: Joi.number().integer().min(5000).default(30000),
        maxRetries: Joi.number().integer().min(1).max(5).default(3),
    }).required(),

    rateLimit: Joi.object({
        retryEnabled: Joi.boolean().default(true),
        retryDelays: Joi.array().items(Joi.number().integer().min(1000)).default([10000, 30000, 60000]),
        initialMessage: Joi.string().default('⏳ Server is busy, we\'re working on your request...'),
        finalMessage: Joi.string().default('❌ Server is experiencing high load. Please try again later.'),
    }).required(),

    webhook: Joi.object({
        secret: Joi.string().min(10).required(),
        port: Joi.number().port().default(4000),
        path: Joi.string().default('/webhook/meta'),
    }).required(),

    api: Joi.object({
        port: Joi.number().port().default(8080),
        keyHeader: Joi.string().default('x-api-key'),
        rateLimit: Joi.number().integer().min(100).default(1000),
    }).required(),

    worker: Joi.object({
        concurrency: Joi.number().integer().min(1).max(50).default(10),
        pollInterval: Joi.number().integer().min(100).default(1000),
        extractionInterval: Joi.number().integer().min(60000).default(300000),
        extractionInactivityThreshold: Joi.number().integer().min(60000).default(300000),
    }).required(),

    extraction: Joi.object({
        promptId: Joi.string().required(),
        enabled: Joi.boolean().default(true),
    }).required(),

    platforms: Joi.object({
        whatsappBaseUrl: Joi.string().uri().default('https://graph.facebook.com/v24.0'),
        instagramBaseUrl: Joi.string().uri().default('https://graph.facebook.com/v24.0'),
        webchatWidgetUrl: Joi.string().uri().required(),
    }).required(),

    admin: Joi.object({
        password: Joi.string().min(8).required(),
        jwtSecret: Joi.string().min(32).required(),
        jwtExpiresIn: Joi.string().default('24h'),
    }).required(),

    templates: Joi.object({
        defaultLanguage: Joi.string().default('en'),
        syncIntervalMs: Joi.number().integer().min(60000).default(300000), // 5 minutes
        maxVariablesPerTemplate: Joi.number().integer().min(1).max(10).default(10),
    }).required(),

    campaigns: Joi.object({
        batchSize: Joi.number().integer().min(1).max(100).default(50),
        delayBetweenBatchesMs: Joi.number().integer().min(1000).default(5000),
        maxRecipientsPerCampaign: Joi.number().integer().min(1).default(10000),
    }).required(),
});

function loadConfig(): AppConfig {
    const rawConfig = {
        app: {
            name: process.env['APP_NAME'],
            version: process.env['APP_VERSION'],
            env: process.env['NODE_ENV'],
            port: parseInt(process.env['PORT'] || '4000', 10),
            logLevel: process.env['LOG_LEVEL'],
            logFormat: process.env['LOG_FORMAT'],
            correlationIdHeader: process.env['CORRELATION_ID_HEADER'],
        },
        database: {
            url: process.env['DATABASE_URL'],
            poolSize: parseInt(process.env['DATABASE_POOL_SIZE'] || '20', 10),
            timeout: parseInt(process.env['DATABASE_TIMEOUT'] || '30000', 10),
        },
        openai: {
            apiKey: process.env['OPENAI_API_KEY'],
            baseUrl: process.env['OPENAI_BASE_URL'],
            timeout: parseInt(process.env['OPENAI_TIMEOUT'] || '30000', 10),
            maxRetries: parseInt(process.env['OPENAI_MAX_RETRIES'] || '3', 10),
        },
        rateLimit: {
            retryEnabled: process.env['RATE_LIMIT_RETRY_ENABLED'] !== 'false',
            retryDelays: process.env['RATE_LIMIT_RETRY_DELAYS']
                ? process.env['RATE_LIMIT_RETRY_DELAYS'].split(',').map(d => parseInt(d.trim(), 10))
                : [10000, 30000, 60000],
            initialMessage: process.env['RATE_LIMIT_INITIAL_MESSAGE'] || '⏳ Server is busy, we\'re working on your request...',
            finalMessage: process.env['RATE_LIMIT_FINAL_MESSAGE'] || '❌ Server is experiencing high load. Please try again later.',
        },
        webhook: {
            secret: process.env['WEBHOOK_SECRET'],
            port: parseInt(process.env['WEBHOOK_PORT'] || '3000', 10),
            path: process.env['WEBHOOK_PATH'],
        },
        api: {
            port: parseInt(process.env['API_PORT'] || '8080', 10),
            keyHeader: process.env['API_KEY_HEADER'],
            rateLimit: parseInt(process.env['API_RATE_LIMIT'] || '1000', 10),
        },
        worker: {
            concurrency: parseInt(process.env['WORKER_CONCURRENCY'] || '10', 10),
            pollInterval: parseInt(process.env['WORKER_POLL_INTERVAL'] || '1000', 10),
            extractionInterval: parseInt(process.env['EXTRACTION_INTERVAL'] || '300000', 10),
            extractionInactivityThreshold: parseInt(process.env['EXTRACTION_INACTIVITY_THRESHOLD'] || '300000', 10),
        },
        extraction: {
            promptId: process.env['EXTRACTION_PROMPT_ID'],
            enabled: process.env['EXTRACTION_ENABLED'] !== 'false',
        },
        platforms: {
            whatsappBaseUrl: process.env['WHATSAPP_API_BASE_URL'],
            instagramBaseUrl: process.env['INSTAGRAM_API_BASE_URL'],
            webchatWidgetUrl: process.env['WEBCHAT_WIDGET_URL'],
        },
        admin: {
            password: process.env['SUPER_ADMIN_PASSWORD'],
            jwtSecret: process.env['ADMIN_JWT_SECRET'],
            jwtExpiresIn: process.env['ADMIN_JWT_EXPIRES_IN'] || '24h',
        },
        templates: {
            defaultLanguage: process.env['TEMPLATES_DEFAULT_LANGUAGE'] || 'en',
            syncIntervalMs: parseInt(process.env['TEMPLATES_SYNC_INTERVAL_MS'] || '300000', 10),
            maxVariablesPerTemplate: parseInt(process.env['TEMPLATES_MAX_VARIABLES'] || '10', 10),
        },
        campaigns: {
            batchSize: parseInt(process.env['CAMPAIGNS_BATCH_SIZE'] || '50', 10),
            delayBetweenBatchesMs: parseInt(process.env['CAMPAIGNS_DELAY_BETWEEN_BATCHES_MS'] || '5000', 10),
            maxRecipientsPerCampaign: parseInt(process.env['CAMPAIGNS_MAX_RECIPIENTS'] || '10000', 10),
        },
    };

    const { error, value } = configSchema.validate(rawConfig, {
        allowUnknown: false,
        stripUnknown: true,
    });

    if (error) {
        const missingVars = error.details
            .filter(detail => detail.type === 'any.required')
            .map(detail => detail.path.join('.'))
            .join(', ');

        const invalidVars = error.details
            .filter(detail => detail.type !== 'any.required')
            .map(detail => `${detail.path.join('.')}: ${detail.message}`)
            .join(', ');

        let errorMessage = 'Configuration validation failed:';
        if (missingVars) {
            errorMessage += `\nMissing required environment variables: ${missingVars}`;
        }
        if (invalidVars) {
            errorMessage += `\nInvalid configuration values: ${invalidVars}`;
        }

        throw new Error(errorMessage);
    }

    return value as AppConfig;
}

// Export singleton configuration instance
export const config = loadConfig();

// Export individual configuration sections for convenience
export const {
    app: appConfig,
    database: databaseConfig,
    openai: openaiConfig,
    webhook: webhookConfig,
    api: apiConfig,
    worker: workerConfig,
    extraction: extractionConfig,
    platforms: platformsConfig,
    rateLimit: rateLimitConfig,
    admin: adminConfig,
    templates: templatesConfig,
    campaigns: campaignsConfig,
} = config;