/**
 * Template Service
 * Manages WhatsApp message templates with Meta Graph API integration
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from '../utils/database';
import { logger } from '../utils/logger';
import { platformsConfig, templatesConfig } from '../config';
import type {
    Template,
    CreateTemplateData,
    UpdateTemplateData,
    TemplateVariable,
    CreateTemplateVariableData,
    TemplateSend,
    CreateTemplateSendData,
    TemplateComponents,
    TemplateStatus,
    TemplateCategory,
    PhoneNumberWithRateLimit,
    TemplateHeaderFormat,
    TemplateButtonDefinition,
    ButtonClick,
    CreateButtonClickData,
    ButtonClickAnalytics,
    LeadButtonActivity,
    TemplateLocationData,
    TemplateUrlButton,
    TemplatePhoneButton,
    TemplateCopyCodeButton,
} from '../models/types';

// Meta Graph API response types
interface MetaTemplateResponse {
    id: string;
    status: string;
    category: string;
}

interface MetaTemplateListResponse {
    data: Array<{
        id: string;
        name: string;
        status: string;
        category: string;
        language: string;
        components: unknown[];
        rejected_reason?: string;
    }>;
    paging?: {
        cursors: { before: string; after: string };
        next?: string;
    };
}

interface MetaErrorResponse {
    error: {
        message: string;
        type: string;
        code: number;
        error_subcode?: number;
        fbtrace_id?: string;
    };
}

/**
 * Convert our component format to Meta's expected format for template creation
 * Supports TEXT, IMAGE, VIDEO, DOCUMENT, LOCATION headers
 * 
 * Meta API requires:
 * - Body example only when body text contains variables ({{1}}, {{2}}, etc.)
 * - body_text must be array of arrays: [["value1", "value2"]]
 * - Header text example: { header_text: ["value"] }
 * - Media header example: { header_handle: ["uploaded_handle"] }
 */
function toMetaComponents(components: TemplateComponents, headerMediaUrl?: string): unknown[] {
    const metaComponents: unknown[] = [];

    if (components.header) {
        const headerComponent: Record<string, unknown> = {
            type: 'HEADER',
            format: components.header.format,
        };

        switch (components.header.format) {
            case 'TEXT':
                if ('text' in components.header) {
                    headerComponent.text = components.header.text;
                    // Only include example if header text has variables
                    if (components.header.example && 
                        'header_text' in components.header.example && 
                        Array.isArray(components.header.example.header_text) &&
                        components.header.example.header_text.length > 0) {
                        headerComponent.example = components.header.example;
                    }
                }
                break;
            case 'IMAGE':
            case 'VIDEO':
            case 'DOCUMENT':
                // For media headers, provide example handle/URL
                if (headerMediaUrl) {
                    headerComponent.example = { header_handle: [headerMediaUrl] };
                } else if ('example' in components.header && components.header.example) {
                    headerComponent.example = components.header.example;
                }
                break;
            case 'LOCATION':
                // Location headers don't need example data for template creation
                break;
        }

        metaComponents.push(headerComponent);
    }

    // Build body component - only include example if body has variables
    const bodyComponent: Record<string, unknown> = {
        type: 'BODY',
        text: components.body.text,
    };
    
    // Check if body text contains variables ({{1}}, {{2}}, etc. or {{name}})
    const hasVariables = /\{\{[^}]+\}\}/.test(components.body.text);
    
    if (hasVariables && components.body.example?.body_text) {
        // Ensure body_text is in the correct format: [["val1", "val2"]]
        const bodyText = components.body.example.body_text;
        if (Array.isArray(bodyText) && bodyText.length > 0) {
            // If it's already nested array, use it; otherwise wrap it
            if (Array.isArray(bodyText[0])) {
                bodyComponent.example = { body_text: bodyText };
            } else {
                // Wrap single array in outer array: ["val1"] -> [["val1"]]
                bodyComponent.example = { body_text: [bodyText] };
            }
        }
    }
    
    metaComponents.push(bodyComponent);

    if (components.footer) {
        metaComponents.push({
            type: 'FOOTER',
            text: components.footer.text,
        });
    }

    if (components.buttons && components.buttons.buttons.length > 0) {
        metaComponents.push({
            type: 'BUTTONS',
            buttons: components.buttons.buttons.map(btn => {
                const button: Record<string, unknown> = {
                    type: btn.type,
                };
                
                // Handle different button types
                switch (btn.type) {
                    case 'QUICK_REPLY':
                        button.text = btn.text;
                        break;
                    case 'URL':
                        button.text = btn.text;
                        button.url = (btn as TemplateUrlButton).url;
                        if ((btn as TemplateUrlButton).example) {
                            button.example = (btn as TemplateUrlButton).example;
                        }
                        break;
                    case 'PHONE_NUMBER':
                        button.text = btn.text;
                        button.phone_number = (btn as TemplatePhoneButton).phone_number;
                        break;
                    case 'COPY_CODE':
                        button.example = (btn as TemplateCopyCodeButton).example;
                        break;
                }
                return button;
            }),
        });
    }

    return metaComponents;
}

/**
 * Validate template components
 * Supports all header formats: TEXT, IMAGE, VIDEO, DOCUMENT, LOCATION
 */
export function validateTemplateComponents(components: TemplateComponents): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Body is required
    if (!components.body || !components.body.text) {
        errors.push('Template body is required');
    } else {
        // Body max 1024 chars
        if (components.body.text.length > 1024) {
            errors.push('Template body must be 1024 characters or less');
        }
    }

    // Header validation (optional)
    if (components.header) {
        switch (components.header.format) {
            case 'TEXT':
                if ('text' in components.header && components.header.text && components.header.text.length > 60) {
                    errors.push('Header text must be 60 characters or less');
                }
                break;
            case 'IMAGE':
            case 'VIDEO':
            case 'DOCUMENT':
            case 'LOCATION':
                // Media headers are validated by Meta, no local validation needed
                break;
            default:
                errors.push(`Unsupported header format: ${(components.header as { format: string }).format}`);
        }
    }

    // Footer validation (optional)
    if (components.footer) {
        if (components.footer.text && components.footer.text.length > 60) {
            errors.push('Footer text must be 60 characters or less');
        }
    }

    // Buttons validation
    if (components.buttons) {
        const buttons = components.buttons.buttons;
        
        // Max 10 quick reply OR max 2 CTA buttons
        const quickReplyCount = buttons.filter(b => b.type === 'QUICK_REPLY').length;
        const ctaCount = buttons.filter(b => ['URL', 'PHONE_NUMBER'].includes(b.type)).length;
        const copyCodeCount = buttons.filter(b => b.type === 'COPY_CODE').length;

        if (quickReplyCount > 0 && ctaCount > 0) {
            // Can't mix quick reply with CTA buttons
            errors.push('Cannot mix Quick Reply buttons with URL/Phone buttons');
        }

        if (quickReplyCount > 10) {
            errors.push('Maximum 10 Quick Reply buttons allowed');
        }

        if (ctaCount > 2) {
            errors.push('Maximum 2 Call-to-Action buttons allowed');
        }

        if (copyCodeCount > 1) {
            errors.push('Maximum 1 Copy Code button allowed');
        }

        for (const btn of buttons) {
            switch (btn.type) {
                case 'QUICK_REPLY':
                    if (!btn.text || btn.text.length > 25) {
                        errors.push('Quick Reply button text is required and must be 25 characters or less');
                    }
                    break;
                case 'URL':
                    if (!btn.text || btn.text.length > 25) {
                        errors.push('URL button text is required and must be 25 characters or less');
                    }
                    if (!(btn as TemplateUrlButton).url) {
                        errors.push('URL button requires a URL');
                    }
                    break;
                case 'PHONE_NUMBER':
                    if (!btn.text || btn.text.length > 25) {
                        errors.push('Phone button text is required and must be 25 characters or less');
                    }
                    if (!(btn as TemplatePhoneButton).phone_number) {
                        errors.push('Phone button requires a phone number');
                    }
                    break;
                case 'COPY_CODE':
                    if (!(btn as TemplateCopyCodeButton).example || (btn as TemplateCopyCodeButton).example.length > 15) {
                        errors.push('Copy Code button requires an example code (max 15 characters)');
                    }
                    break;
            }
        }
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Create a new template (draft)
 * Supports all header types: TEXT, IMAGE, VIDEO, DOCUMENT, LOCATION
 */
export async function createTemplate(data: CreateTemplateData): Promise<Template> {
    const correlationId = uuidv4();
    logger.info('Creating template', { correlationId, templateName: data.name, userId: data.user_id });

    // Validate components
    const validation = validateTemplateComponents(data.components);
    if (!validation.valid) {
        throw new Error(`Invalid template components: ${validation.errors.join(', ')}`);
    }

    // Determine header type from components
    const headerType = data.header_type || 
        (data.components.header?.format as TemplateHeaderFormat) || 
        'NONE';

    const result = await db.query<Template>(
        `INSERT INTO templates (
            template_id, user_id, phone_number_id, name, category, 
            language, components, status,
            header_type, header_media_url, header_document_filename,
            header_location_latitude, header_location_longitude,
            header_location_name, header_location_address, waba_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'DRAFT', $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING *`,
        [
            data.template_id,
            data.user_id,
            data.phone_number_id,
            data.name,
            data.category,
            data.language || templatesConfig.defaultLanguage,
            JSON.stringify(data.components),
            headerType,
            data.header_media_url || null,
            data.header_document_filename || null,
            data.header_location_latitude || null,
            data.header_location_longitude || null,
            data.header_location_name || null,
            data.header_location_address || null,
            data.waba_id || null,
        ]
    );

    const template = result.rows[0]!;

    // Auto-create button definitions if buttons exist
    if (data.components.buttons?.buttons.length) {
        await createButtonDefinitionsFromTemplate(template.template_id, data.components.buttons.buttons);
    }

    logger.info('Template created', { correlationId, templateId: data.template_id, headerType });
    return template;
}

/**
 * Get template by ID
 */
export async function getTemplateById(templateId: string): Promise<Template | null> {
    const result = await db.query<Template>(
        'SELECT * FROM templates WHERE template_id = $1',
        [templateId]
    );
    return result.rows[0] || null;
}

/**
 * Get templates by user ID
 */
export async function getTemplatesByUserId(
    userId: string,
    options?: { status?: TemplateStatus; phoneNumberId?: string }
): Promise<Template[]> {
    let query = 'SELECT * FROM templates WHERE user_id = $1';
    const params: unknown[] = [userId];

    if (options?.status) {
        query += ` AND status = $${params.length + 1}`;
        params.push(options.status);
    }

    if (options?.phoneNumberId) {
        query += ` AND phone_number_id = $${params.length + 1}`;
        params.push(options.phoneNumberId);
    }

    query += ' ORDER BY created_at DESC';

    const result = await db.query<Template>(query, params);
    return result.rows;
}

/**
 * Get all templates (admin)
 */
export async function getAllTemplates(options?: {
    limit?: number;
    offset?: number;
    status?: TemplateStatus;
}): Promise<{ templates: Template[]; total: number }> {
    let countQuery = 'SELECT COUNT(*) FROM templates';
    let query = 'SELECT * FROM templates';
    const params: unknown[] = [];

    if (options?.status) {
        const whereClause = ` WHERE status = $1`;
        countQuery += whereClause;
        query += whereClause;
        params.push(options.status);
    }

    query += ' ORDER BY created_at DESC';

    if (options?.limit) {
        query += ` LIMIT $${params.length + 1}`;
        params.push(options.limit);
    }

    if (options?.offset) {
        query += ` OFFSET $${params.length + 1}`;
        params.push(options.offset);
    }

    const [countResult, dataResult] = await Promise.all([
        db.query<{ count: string }>(countQuery, options?.status ? [options.status] : []),
        db.query<Template>(query, params),
    ]);

    return {
        templates: dataResult.rows,
        total: parseInt(countResult.rows[0]?.count || '0', 10),
    };
}

/**
 * Update template
 */
export async function updateTemplate(templateId: string, data: UpdateTemplateData): Promise<Template | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
            fields.push(`${key} = $${paramIndex}`);
            values.push(key === 'components' ? JSON.stringify(value) : value);
            paramIndex++;
        }
    }

    if (fields.length === 0) {
        return getTemplateById(templateId);
    }

    values.push(templateId);

    const result = await db.query<Template>(
        `UPDATE templates SET ${fields.join(', ')} WHERE template_id = $${paramIndex} RETURNING *`,
        values
    );

    return result.rows[0] || null;
}

/**
 * Delete template
 */
export async function deleteTemplate(templateId: string): Promise<boolean> {
    const result = await db.query(
        'DELETE FROM templates WHERE template_id = $1',
        [templateId]
    );
    return (result.rowCount ?? 0) > 0;
}

/**
 * Submit template to Meta for approval
 * Supports all header types including media (IMAGE, VIDEO, DOCUMENT) and LOCATION
 */
export async function submitTemplateToMeta(templateId: string): Promise<Template> {
    const correlationId = uuidv4();
    
    const template = await getTemplateById(templateId);
    if (!template) {
        throw new Error('Template not found');
    }

    if (template.status !== 'DRAFT') {
        throw new Error(`Cannot submit template with status ${template.status}`);
    }

    // Get phone number to get WABA ID and access token
    const phoneResult = await db.query<PhoneNumberWithRateLimit>(
        'SELECT * FROM phone_numbers WHERE id = $1',
        [template.phone_number_id]
    );
    const phoneNumber = phoneResult.rows[0];
    
    if (!phoneNumber) {
        throw new Error('Phone number not found');
    }

    if (!phoneNumber.waba_id) {
        throw new Error('Phone number does not have a WABA ID configured');
    }

    logger.info('Submitting template to Meta', {
        correlationId,
        templateId,
        templateName: template.name,
        wabaId: phoneNumber.waba_id,
        headerType: template.header_type,
    });

    // Submit to Meta Graph API (include media URL for media headers)
    const metaComponents = toMetaComponents(template.components, template.header_media_url);

    const requestPayload = {
        name: template.name,
        category: template.category,
        language: template.language,
        components: metaComponents,
    };

    // Log the payload being sent to Meta for debugging
    logger.info('Meta template submission payload', {
        correlationId,
        templateId,
        payload: JSON.stringify(requestPayload, null, 2),
    });

    const response = await fetch(
        `${platformsConfig.whatsappBaseUrl}/${phoneNumber.waba_id}/message_templates`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${phoneNumber.access_token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestPayload),
        }
    );

    const responseData = await response.json() as MetaTemplateResponse | MetaErrorResponse;

    if (!response.ok || 'error' in responseData) {
        const errorData = responseData as MetaErrorResponse;
        logger.error('Failed to submit template to Meta', {
            correlationId,
            templateId,
            error: errorData.error,
            errorCode: errorData.error?.code,
            errorSubcode: errorData.error?.error_subcode,
            fbtrace: errorData.error?.fbtrace_id,
            requestPayload: JSON.stringify(requestPayload),
        });
        throw new Error(`Meta API error: ${errorData.error?.message || 'Unknown error'}`);
    }

    const successData = responseData as MetaTemplateResponse;

    // Update template with Meta's template ID and pending status
    const updatedTemplate = await updateTemplate(templateId, {
        meta_template_id: successData.id,
        status: 'PENDING',
        submitted_at: new Date(),
    });

    logger.info('Template submitted to Meta', {
        correlationId,
        templateId,
        metaTemplateId: successData.id,
    });

    return updatedTemplate!;
}

/**
 * Sync all templates from Meta for a phone number
 * Imports existing approved templates that aren't in our database
 */
export async function syncTemplatesFromMeta(
    userId: string,
    phoneNumberId: string
): Promise<{ imported: Template[]; updated: Template[]; errors: string[] }> {
    const correlationId = uuidv4();
    const imported: Template[] = [];
    const updated: Template[] = [];
    const errors: string[] = [];

    logger.info('Syncing templates from Meta', { correlationId, userId, phoneNumberId });

    // Get phone number with WABA ID
    const phoneResult = await db.query<PhoneNumberWithRateLimit>(
        'SELECT * FROM phone_numbers WHERE id = $1 AND user_id = $2',
        [phoneNumberId, userId]
    );
    const phoneNumber = phoneResult.rows[0];

    if (!phoneNumber?.waba_id) {
        throw new Error('Phone number not found or missing WABA ID');
    }

    // Fetch all templates from Meta
    const response = await fetch(
        `${platformsConfig.whatsappBaseUrl}/${phoneNumber.waba_id}/message_templates?limit=100`,
        {
            headers: {
                'Authorization': `Bearer ${phoneNumber.access_token}`,
            },
        }
    );

    if (!response.ok) {
        const errorData = await response.json() as MetaErrorResponse;
        throw new Error(`Failed to fetch templates from Meta: ${errorData.error?.message || 'Unknown error'}`);
    }

    const data = await response.json() as MetaTemplateListResponse;
    
    logger.info('📋 Fetched templates from Meta', { 
        correlationId, 
        count: data.data?.length || 0,
        rawData: JSON.stringify(data.data?.map(t => ({
            id: t.id,
            name: t.name,
            status: t.status,
            category: t.category,
            language: t.language,
            quality_score: (t as any).quality_score,
        })), null, 2),
    });

    // Process each template from Meta
    for (const metaTemplate of data.data || []) {
        try {
            // Log each template's raw data for debugging
            logger.info('📄 Processing Meta template', {
                correlationId,
                templateId: metaTemplate.id,
                name: metaTemplate.name,
                status: metaTemplate.status,
                category: metaTemplate.category,
                language: metaTemplate.language,
                quality_score: (metaTemplate as any).quality_score,
                rejected_reason: metaTemplate.rejected_reason,
            });
            // Check if template already exists in our database
            const existingResult = await db.query<Template>(
                `SELECT * FROM templates 
                 WHERE (meta_template_id = $1 OR (name = $2 AND phone_number_id = $3 AND language = $4))`,
                [metaTemplate.id, metaTemplate.name, phoneNumberId, metaTemplate.language]
            );
            const existing = existingResult.rows[0];

            // Map Meta status to our status
            // Meta statuses: APPROVED, PENDING, REJECTED, PAUSED, DISABLED, IN_APPEAL, PENDING_DELETION, DELETED, LIMIT_EXCEEDED
            const statusMap: Record<string, TemplateStatus> = {
                APPROVED: 'APPROVED',
                PENDING: 'PENDING',
                REJECTED: 'REJECTED',
                PAUSED: 'PAUSED',
                DISABLED: 'DISABLED',
                IN_APPEAL: 'PENDING',
                PENDING_DELETION: 'DISABLED',
                DELETED: 'DISABLED',
                LIMIT_EXCEEDED: 'PAUSED',
            };
            const status = statusMap[metaTemplate.status] || 'PENDING';
            
            logger.info('📊 Template status mapping', {
                correlationId,
                templateName: metaTemplate.name,
                metaStatus: metaTemplate.status,
                metaCategory: metaTemplate.category,
                mappedStatus: status,
                qualityScore: (metaTemplate as any).quality_score,
            });

            // Convert Meta components to our format (now returns headerType too)
            const { components, headerType } = fromMetaComponents(metaTemplate.components);

            if (existing) {
                // Update existing template with both status AND category from Meta
                logger.info('🔄 Updating existing template', {
                    correlationId,
                    templateId: existing.template_id,
                    oldStatus: existing.status,
                    newStatus: status,
                    oldCategory: existing.category,
                    newCategory: metaTemplate.category,
                });
                const updatedTemplate = await updateTemplate(existing.template_id, {
                    status,
                    category: metaTemplate.category as TemplateCategory, // Sync category from Meta!
                    meta_template_id: metaTemplate.id,
                    rejection_reason: metaTemplate.rejected_reason || undefined,
                    approved_at: status === 'APPROVED' ? new Date() : undefined,
                    header_type: headerType,
                    components,
                });
                if (updatedTemplate) {
                    updated.push(updatedTemplate);
                }
            } else {
                // Create new template from Meta
                const templateId = uuidv4();
                const result = await db.query<Template>(
                    `INSERT INTO templates (
                        template_id, user_id, phone_number_id, name, category, 
                        status, language, components, meta_template_id,
                        rejection_reason, submitted_at, approved_at, header_type,
                        waba_id, created_at, updated_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    RETURNING *`,
                    [
                        templateId,
                        userId,
                        phoneNumberId,
                        metaTemplate.name,
                        metaTemplate.category,
                        status,
                        metaTemplate.language,
                        JSON.stringify(components),
                        metaTemplate.id,
                        metaTemplate.rejected_reason || null,
                        new Date(), // submitted_at - it's already on Meta
                        status === 'APPROVED' ? new Date() : null,
                        headerType,
                        phoneNumber.waba_id,
                    ]
                );
                
                // Auto-create button definitions if buttons exist
                if (components.buttons?.buttons.length) {
                    await createButtonDefinitionsFromTemplate(templateId, components.buttons.buttons);
                }
                
                imported.push(result.rows[0]!);
            }
        } catch (error) {
            const errorMsg = `Failed to import template ${metaTemplate.name}: ${error instanceof Error ? error.message : 'Unknown error'}`;
            logger.warn(errorMsg, { correlationId, metaTemplate: metaTemplate.name });
            errors.push(errorMsg);
        }
    }

    logger.info('Template sync completed', { 
        correlationId, 
        imported: imported.length, 
        updated: updated.length,
        errors: errors.length 
    });

    return { imported, updated, errors };
}

/**
 * Convert Meta components to our internal format
 * Handles all header types: TEXT, IMAGE, VIDEO, DOCUMENT, LOCATION
 */
function fromMetaComponents(metaComponents: unknown[]): { components: TemplateComponents; headerType: TemplateHeaderFormat | 'NONE' } {
    const components: TemplateComponents = {
        body: { text: '', type: 'BODY' }
    };
    let headerType: TemplateHeaderFormat | 'NONE' = 'NONE';

    for (const comp of metaComponents as Array<{ 
        type: string; 
        text?: string; 
        format?: string; 
        buttons?: unknown[];
        example?: { header_handle?: string[]; header_text?: string[] };
    }>) {
        switch (comp.type) {
            case 'HEADER':
                headerType = (comp.format as TemplateHeaderFormat) || 'TEXT';
                switch (comp.format) {
                    case 'TEXT':
                        components.header = {
                            type: 'HEADER',
                            format: 'TEXT',
                            text: comp.text || '',
                            example: comp.example?.header_text ? { header_text: comp.example.header_text } : undefined,
                        };
                        break;
                    case 'IMAGE':
                        components.header = {
                            type: 'HEADER',
                            format: 'IMAGE',
                            example: comp.example?.header_handle ? { header_handle: comp.example.header_handle } : undefined,
                        };
                        break;
                    case 'VIDEO':
                        components.header = {
                            type: 'HEADER',
                            format: 'VIDEO',
                            example: comp.example?.header_handle ? { header_handle: comp.example.header_handle } : undefined,
                        };
                        break;
                    case 'DOCUMENT':
                        components.header = {
                            type: 'HEADER',
                            format: 'DOCUMENT',
                            example: comp.example?.header_handle ? { header_handle: comp.example.header_handle } : undefined,
                        };
                        break;
                    case 'LOCATION':
                        components.header = {
                            type: 'HEADER',
                            format: 'LOCATION',
                        };
                        break;
                    default:
                        // Fallback to TEXT
                        components.header = {
                            type: 'HEADER',
                            format: 'TEXT',
                            text: comp.text || '',
                        };
                }
                break;
            case 'BODY':
                components.body = {
                    type: 'BODY',
                    text: comp.text || '',
                };
                break;
            case 'FOOTER':
                components.footer = {
                    type: 'FOOTER',
                    text: comp.text || '',
                };
                break;
            case 'BUTTONS':
                components.buttons = {
                    type: 'BUTTONS',
                    buttons: (comp.buttons as Array<{ 
                        type: string; 
                        text?: string; 
                        url?: string; 
                        phone_number?: string;
                        example?: string | string[];
                    }> || []).map(btn => {
                        switch (btn.type) {
                            case 'QUICK_REPLY':
                                return {
                                    type: 'QUICK_REPLY' as const,
                                    text: btn.text || '',
                                };
                            case 'URL':
                                return {
                                    type: 'URL' as const,
                                    text: btn.text || '',
                                    url: btn.url || '',
                                    example: btn.example ? (Array.isArray(btn.example) ? btn.example : [btn.example]) : undefined,
                                };
                            case 'PHONE_NUMBER':
                                return {
                                    type: 'PHONE_NUMBER' as const,
                                    text: btn.text || '',
                                    phone_number: btn.phone_number || '',
                                };
                            case 'COPY_CODE':
                                return {
                                    type: 'COPY_CODE' as const,
                                    example: (typeof btn.example === 'string' ? btn.example : btn.example?.[0]) || '',
                                };
                            default:
                                return {
                                    type: 'QUICK_REPLY' as const,
                                    text: btn.text || '',
                                };
                        }
                    }),
                };
                break;
        }
    }

    return { components, headerType };
}

/**
 * Sync template status from Meta
 */
export async function syncTemplateStatusFromMeta(templateId: string): Promise<Template | null> {
    const correlationId = uuidv4();
    
    const template = await getTemplateById(templateId);
    if (!template || !template.meta_template_id) {
        return template;
    }

    const phoneResult = await db.query<PhoneNumberWithRateLimit>(
        'SELECT * FROM phone_numbers WHERE id = $1',
        [template.phone_number_id]
    );
    const phoneNumber = phoneResult.rows[0];
    
    if (!phoneNumber?.waba_id) {
        return template;
    }

    logger.debug('Syncing template status from Meta', {
        correlationId,
        templateId,
        metaTemplateId: template.meta_template_id,
    });

    const response = await fetch(
        `${platformsConfig.whatsappBaseUrl}/${phoneNumber.waba_id}/message_templates?name=${template.name}`,
        {
            headers: {
                'Authorization': `Bearer ${phoneNumber.access_token}`,
            },
        }
    );

    if (!response.ok) {
        logger.warn('Failed to fetch template status from Meta', { correlationId, templateId });
        return template;
    }

    const data = await response.json() as MetaTemplateListResponse;
    const metaTemplate = data.data?.find(t => t.id === template.meta_template_id);

    if (!metaTemplate) {
        return template;
    }

    // Map Meta status to our status
    const statusMap: Record<string, TemplateStatus> = {
        APPROVED: 'APPROVED',
        PENDING: 'PENDING',
        REJECTED: 'REJECTED',
        PAUSED: 'PAUSED',
        DISABLED: 'DISABLED',
    };

    const newStatus = statusMap[metaTemplate.status] || template.status;
    const updateData: UpdateTemplateData = { status: newStatus };

    if (newStatus === 'APPROVED' && template.status !== 'APPROVED') {
        updateData.approved_at = new Date();
    }

    if (newStatus === 'REJECTED' && metaTemplate.rejected_reason) {
        updateData.rejection_reason = metaTemplate.rejected_reason;
    }

    return updateTemplate(templateId, updateData);
}

/**
 * Delete template from Meta
 */
export async function deleteTemplateFromMeta(templateId: string): Promise<boolean> {
    const correlationId = uuidv4();
    
    const template = await getTemplateById(templateId);
    if (!template || !template.meta_template_id) {
        return false;
    }

    const phoneResult = await db.query<PhoneNumberWithRateLimit>(
        'SELECT * FROM phone_numbers WHERE id = $1',
        [template.phone_number_id]
    );
    const phoneNumber = phoneResult.rows[0];
    
    if (!phoneNumber?.waba_id) {
        return false;
    }

    logger.info('Deleting template from Meta', {
        correlationId,
        templateId,
        templateName: template.name,
    });

    const response = await fetch(
        `${platformsConfig.whatsappBaseUrl}/${phoneNumber.waba_id}/message_templates?name=${template.name}`,
        {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${phoneNumber.access_token}`,
            },
        }
    );

    if (!response.ok) {
        logger.warn('Failed to delete template from Meta', { correlationId, templateId });
        return false;
    }

    return true;
}

// =====================================
// Template Variables
// =====================================

/**
 * Create template variable
 * Dashboard provides variable metadata; server stores it for reference
 */
export async function createTemplateVariable(data: CreateTemplateVariableData): Promise<TemplateVariable> {
    const result = await db.query<TemplateVariable>(
        `INSERT INTO template_variables (
            variable_id, template_id, variable_name, position, 
            component_type, dashboard_mapping, default_value, sample_value,
            description, is_required, placeholder
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *`,
        [
            data.variable_id,
            data.template_id,
            data.variable_name,
            data.position,
            data.component_type || 'BODY',
            data.dashboard_mapping || null, // Dashboard's variable identifier
            data.default_value,
            data.sample_value,
            data.description || null,
            data.is_required || false,
            data.placeholder || null,
        ]
    );
    return result.rows[0]!;
}

/**
 * Get variables for template
 */
export async function getTemplateVariables(templateId: string): Promise<TemplateVariable[]> {
    const result = await db.query<TemplateVariable>(
        'SELECT * FROM template_variables WHERE template_id = $1 ORDER BY position',
        [templateId]
    );
    return result.rows;
}

/**
 * Delete template variable
 */
export async function deleteTemplateVariable(variableId: string): Promise<boolean> {
    const result = await db.query(
        'DELETE FROM template_variables WHERE variable_id = $1',
        [variableId]
    );
    return (result.rowCount ?? 0) > 0;
}

/**
 * Substitute variables with actual values
 * 
 * Dashboard sends resolved values in manualValues (keyed by position "1", "2" OR variable_name)
 * 
 * Priority: manualValues (by position) > manualValues (by name) > default_value > sample_value
 */
export async function substituteVariables(
    templateId: string,
    _extractionData?: Record<string, unknown>, // Kept for backwards compatibility
    manualValues?: Record<string, string>
): Promise<Record<string, string>> {
    const variables = await getTemplateVariables(templateId);
    const result: Record<string, string> = {};

    for (const variable of variables) {
        const position = variable.position.toString();

        // Priority 1: Manual value by position (e.g., { "1": "John" })
        if (manualValues?.[position]) {
            result[position] = manualValues[position]!;
            continue;
        }

        // Priority 2: Manual value by variable_name (e.g., { "customer_name": "John" })
        if (manualValues?.[variable.variable_name]) {
            result[position] = manualValues[variable.variable_name]!;
            continue;
        }

        // Priority 3: Default value
        if (variable.default_value) {
            result[position] = variable.default_value;
            continue;
        }

        // Priority 4: Sample value (last resort)
        result[position] = variable.sample_value || '';
    }

    return result;
}

// =====================================
// Template Sends
// =====================================

/**
 * Create template send record
 */
export async function createTemplateSend(data: CreateTemplateSendData): Promise<TemplateSend> {
    const result = await db.query<TemplateSend>(
        `INSERT INTO template_sends (
            send_id, template_id, conversation_id, campaign_id,
            customer_phone, variable_values
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *`,
        [
            data.send_id,
            data.template_id,
            data.conversation_id,
            data.campaign_id,
            data.customer_phone,
            JSON.stringify(data.variable_values || {}),
        ]
    );
    return result.rows[0]!;
}

/**
 * Update template send status
 */
export async function updateTemplateSendStatus(
    sendId: string,
    status: TemplateSend['status'],
    platformMessageId?: string,
    errorCode?: string,
    errorMessage?: string
): Promise<TemplateSend | null> {
    const updates: string[] = ['status = $2'];
    const params: unknown[] = [sendId, status];
    let paramIndex = 3;

    if (platformMessageId) {
        updates.push(`platform_message_id = $${paramIndex}`);
        params.push(platformMessageId);
        paramIndex++;
    }

    if (status === 'SENT') {
        updates.push(`sent_at = CURRENT_TIMESTAMP`);
    } else if (status === 'DELIVERED') {
        updates.push(`delivered_at = CURRENT_TIMESTAMP`);
    } else if (status === 'READ') {
        updates.push(`read_at = CURRENT_TIMESTAMP`);
    } else if (status === 'FAILED') {
        if (errorCode) {
            updates.push(`error_code = $${paramIndex}`);
            params.push(errorCode);
            paramIndex++;
        }
        if (errorMessage) {
            updates.push(`error_message = $${paramIndex}`);
            params.push(errorMessage);
            paramIndex++;
        }
    }

    const result = await db.query<TemplateSend>(
        `UPDATE template_sends SET ${updates.join(', ')} WHERE send_id = $1 RETURNING *`,
        params
    );

    return result.rows[0] || null;
}

/**
 * Get template send by platform message ID
 */
export async function getTemplateSendByPlatformMessageId(platformMessageId: string): Promise<TemplateSend | null> {
    const result = await db.query<TemplateSend>(
        'SELECT * FROM template_sends WHERE platform_message_id = $1',
        [platformMessageId]
    );
    return result.rows[0] || null;
}

/**
 * Get template analytics
 */
export async function getTemplateAnalytics(templateId: string): Promise<{
    totalSent: number;
    delivered: number;
    read: number;
    failed: number;
    deliveryRate: number;
    readRate: number;
}> {
    const result = await db.query<{
        total: string;
        sent: string;
        delivered: string;
        read: string;
        failed: string;
    }>(
        `SELECT 
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status IN ('SENT', 'DELIVERED', 'READ')) as sent,
            COUNT(*) FILTER (WHERE status IN ('DELIVERED', 'READ')) as delivered,
            COUNT(*) FILTER (WHERE status = 'READ') as read,
            COUNT(*) FILTER (WHERE status = 'FAILED') as failed
        FROM template_sends 
        WHERE template_id = $1`,
        [templateId]
    );

    const row = result.rows[0]!;
    const totalSent = parseInt(row.sent, 10);
    const delivered = parseInt(row.delivered, 10);
    const read = parseInt(row.read, 10);
    const failed = parseInt(row.failed, 10);

    return {
        totalSent,
        delivered,
        read,
        failed,
        deliveryRate: totalSent > 0 ? (delivered / totalSent) * 100 : 0,
        readRate: totalSent > 0 ? (read / totalSent) * 100 : 0,
    };
}

// ============================================================
// Button Definition Functions
// ============================================================

/**
 * Create button definitions from template buttons
 * Called automatically when creating templates or syncing from Meta
 */
export async function createButtonDefinitionsFromTemplate(
    templateId: string, 
    buttons: Array<{ type: string; text?: string; url?: string; phone_number?: string; example?: string | string[]; tracking_id?: string }>
): Promise<TemplateButtonDefinition[]> {
    const definitions: TemplateButtonDefinition[] = [];

    for (let i = 0; i < buttons.length; i++) {
        const btn = buttons[i]!;
        const buttonId = uuidv4();
        
        const result = await db.query<TemplateButtonDefinition>(
            `INSERT INTO template_buttons (
                button_id, template_id, button_type, button_text, button_index,
                button_url, button_phone, copy_code_example, tracking_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *`,
            [
                buttonId,
                templateId,
                btn.type,
                btn.text || '',
                i,
                btn.url || null,
                btn.phone_number || null,
                typeof btn.example === 'string' ? btn.example : (btn.example?.[0] || null),
                btn.tracking_id || `${btn.type.toLowerCase()}_${i}`,
            ]
        );
        
        definitions.push(result.rows[0]!);
    }

    return definitions;
}

/**
 * Get button definitions for a template
 */
export async function getTemplateButtons(templateId: string): Promise<TemplateButtonDefinition[]> {
    const result = await db.query<TemplateButtonDefinition>(
        'SELECT * FROM template_buttons WHERE template_id = $1 ORDER BY button_index',
        [templateId]
    );
    return result.rows;
}

/**
 * Update button tracking ID
 */
export async function updateButtonTrackingId(buttonId: string, trackingId: string): Promise<TemplateButtonDefinition | null> {
    const result = await db.query<TemplateButtonDefinition>(
        'UPDATE template_buttons SET tracking_id = $1 WHERE button_id = $2 RETURNING *',
        [trackingId, buttonId]
    );
    return result.rows[0] || null;
}

// ============================================================
// Button Click Tracking Functions
// ============================================================

/**
 * Record a button click from WhatsApp webhook
 * Called when we receive an interactive.button_reply message
 */
export async function recordButtonClick(data: CreateButtonClickData): Promise<ButtonClick> {
    const correlationId = uuidv4();
    logger.info('Recording button click', { 
        correlationId, 
        templateId: data.template_id, 
        buttonId: data.button_id,
        customerPhone: data.customer_phone 
    });

    const result = await db.query<ButtonClick>(
        `INSERT INTO button_clicks (
            click_id, template_id, template_send_id, button_id, button_text,
            button_index, button_payload, customer_phone, contact_id,
            conversation_id, waba_id, phone_number_id, user_id,
            message_id, original_message_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING *`,
        [
            data.click_id,
            data.template_id,
            data.template_send_id || null,
            data.button_id,
            data.button_text,
            data.button_index || null,
            data.button_payload || null,
            data.customer_phone,
            data.contact_id || null,
            data.conversation_id || null,
            data.waba_id || null,
            data.phone_number_id || null,
            data.user_id,
            data.message_id || null,
            data.original_message_id || null,
        ]
    );

    // Update button click counts
    await db.query(
        `UPDATE template_buttons 
         SET total_clicks = total_clicks + 1 
         WHERE template_id = $1 AND button_text = $2`,
        [data.template_id, data.button_text]
    );

    // Update unique clicks (check if this lead clicked before)
    const existingClick = await db.query(
        `SELECT 1 FROM button_clicks 
         WHERE template_id = $1 AND button_text = $2 AND customer_phone = $3 
         AND click_id != $4`,
        [data.template_id, data.button_text, data.customer_phone, data.click_id]
    );

    if (existingClick.rowCount === 0) {
        await db.query(
            `UPDATE template_buttons 
             SET unique_clicks = unique_clicks + 1 
             WHERE template_id = $1 AND button_text = $2`,
            [data.template_id, data.button_text]
        );
    }

    logger.info('Button click recorded', { correlationId, clickId: data.click_id });
    return result.rows[0]!;
}

/**
 * Get button click analytics for a template
 */
export async function getButtonClickAnalytics(templateId: string): Promise<ButtonClickAnalytics[]> {
    const result = await db.query<ButtonClickAnalytics & { template_name: string }>(
        `SELECT 
            bc.template_id,
            t.name as template_name,
            bc.button_id,
            bc.button_text,
            COUNT(*) as total_clicks,
            COUNT(DISTINCT bc.customer_phone) as unique_leads
        FROM button_clicks bc
        JOIN templates t ON t.template_id = bc.template_id
        WHERE bc.template_id = $1
        GROUP BY bc.template_id, t.name, bc.button_id, bc.button_text
        ORDER BY total_clicks DESC`,
        [templateId]
    );

    // Calculate click rate (clicks / sends)
    const sendStats = await getTemplateAnalytics(templateId);
    
    return result.rows.map(row => ({
        ...row,
        total_clicks: parseInt(String(row.total_clicks), 10),
        unique_leads: parseInt(String(row.unique_leads), 10),
        click_rate: sendStats.totalSent > 0 
            ? (parseInt(String(row.total_clicks), 10) / sendStats.totalSent) * 100 
            : 0,
    }));
}

/**
 * Get button clicks by user (for dashboard)
 */
export async function getButtonClicksByUser(
    userId: string, 
    options?: { templateId?: string; limit?: number; offset?: number }
): Promise<{ clicks: ButtonClick[]; total: number }> {
    let countQuery = 'SELECT COUNT(*) FROM button_clicks WHERE user_id = $1';
    let query = 'SELECT * FROM button_clicks WHERE user_id = $1';
    const params: unknown[] = [userId];

    if (options?.templateId) {
        countQuery += ` AND template_id = $2`;
        query += ` AND template_id = $2`;
        params.push(options.templateId);
    }

    query += ' ORDER BY clicked_at DESC';

    if (options?.limit) {
        query += ` LIMIT $${params.length + 1}`;
        params.push(options.limit);
    }

    if (options?.offset) {
        query += ` OFFSET $${params.length + 1}`;
        params.push(options.offset);
    }

    const [countResult, dataResult] = await Promise.all([
        db.query<{ count: string }>(countQuery, options?.templateId ? [userId, options.templateId] : [userId]),
        db.query<ButtonClick>(query, params),
    ]);

    return {
        clicks: dataResult.rows,
        total: parseInt(countResult.rows[0]?.count || '0', 10),
    };
}

/**
 * Get lead button activity
 * Shows which buttons a specific lead has clicked
 */
export async function getLeadButtonActivity(customerPhone: string, userId: string): Promise<LeadButtonActivity | null> {
    const result = await db.query<{
        customer_phone: string;
        contact_id: string | null;
        button_id: string;
        button_text: string;
        template_name: string;
        clicked_at: Date;
    }>(
        `SELECT 
            bc.customer_phone,
            bc.contact_id,
            bc.button_id,
            bc.button_text,
            t.name as template_name,
            bc.clicked_at
        FROM button_clicks bc
        JOIN templates t ON t.template_id = bc.template_id
        WHERE bc.customer_phone = $1 AND bc.user_id = $2
        ORDER BY bc.clicked_at DESC`,
        [customerPhone, userId]
    );

    if (result.rows.length === 0) {
        return null;
    }

    // Get contact name if available
    let contactName: string | undefined;
    const contactId = result.rows[0]?.contact_id;
    if (contactId) {
        const contactResult = await db.query<{ name: string }>(
            'SELECT name FROM contacts WHERE contact_id = $1',
            [contactId]
        );
        contactName = contactResult.rows[0]?.name;
    }

    return {
        customer_phone: customerPhone,
        contact_id: contactId || undefined,
        contact_name: contactName,
        buttons_clicked: result.rows.map(row => ({
            button_id: row.button_id,
            button_text: row.button_text,
            template_name: row.template_name,
            clicked_at: row.clicked_at,
        })),
        total_clicks: result.rows.length,
        last_click_at: result.rows[0]!.clicked_at,
    };
}

/**
 * Find template send by context (for linking button clicks)
 * Looks up the original template message that was sent to this customer
 * Searches both templates.components JSONB and template_buttons table
 */
export async function findTemplateSendForButtonClick(
    customerPhone: string,
    buttonText: string,
    userId: string
): Promise<{ templateSend: TemplateSend; template: Template } | null> {
    // First, try to find by template_buttons table (more reliable)
    // This handles templates where buttons are stored in the separate table
    let result = await db.query<TemplateSend & { template_id: string }>(
        `SELECT ts.* 
         FROM template_sends ts
         JOIN templates t ON t.template_id = ts.template_id
         JOIN template_buttons tb ON tb.template_id = t.template_id
         WHERE ts.customer_phone = $1 
           AND t.user_id = $2
           AND ts.status IN ('SENT', 'DELIVERED', 'READ')
           AND tb.button_text = $3
         ORDER BY ts.sent_at DESC
         LIMIT 1`,
        [customerPhone, userId, buttonText]
    );

    // Fallback: search in templates.components JSONB (legacy/inline buttons)
    if (result.rows.length === 0) {
        result = await db.query<TemplateSend & { template_id: string }>(
            `SELECT ts.* 
             FROM template_sends ts
             JOIN templates t ON t.template_id = ts.template_id
             WHERE ts.customer_phone = $1 
               AND t.user_id = $2
               AND ts.status IN ('SENT', 'DELIVERED', 'READ')
               AND (
                 t.components::text LIKE $3
                 OR t.components::text LIKE $4
               )
             ORDER BY ts.sent_at DESC
             LIMIT 1`,
            [customerPhone, userId, `%"text":"${buttonText}"%`, `%"text": "${buttonText}"%`]
        );
    }

    if (result.rows.length === 0) {
        return null;
    }

    const templateSend = result.rows[0]!;
    const template = await getTemplateById(templateSend.template_id);

    if (!template) {
        return null;
    }

    return { templateSend, template };
}

// ============================================================
// Template Sending with Media Support
// ============================================================

/**
 * Build runtime template components for sending
 * Handles all header types including media and location
 */
export function buildRuntimeComponents(
    template: Template,
    variableValues: Record<string, string>,
    mediaUrl?: string,
    locationData?: TemplateLocationData
): unknown[] {
    const components: unknown[] = [];

    // Header component (if any)
    if (template.header_type && template.header_type !== 'NONE') {
        const headerComponent: Record<string, unknown> = { type: 'header' };
        const parameters: unknown[] = [];

        switch (template.header_type) {
            case 'TEXT':
                // Text header with variable substitution
                if (template.components.header && 'text' in template.components.header) {
                    const headerVars = template.components.header.text?.match(/\{\{(\d+)\}\}/g) || [];
                    for (const match of headerVars) {
                        const position = match.replace(/[{}]/g, '');
                        parameters.push({
                            type: 'text',
                            text: variableValues[position] || '',
                        });
                    }
                }
                break;
            case 'IMAGE':
                parameters.push({
                    type: 'image',
                    image: { link: mediaUrl || template.header_media_url },
                });
                break;
            case 'VIDEO':
                parameters.push({
                    type: 'video',
                    video: { link: mediaUrl || template.header_media_url },
                });
                break;
            case 'DOCUMENT':
                parameters.push({
                    type: 'document',
                    document: { 
                        link: mediaUrl || template.header_media_url,
                        filename: template.header_document_filename || 'document',
                    },
                });
                break;
            case 'LOCATION':
                if (locationData) {
                    parameters.push({
                        type: 'location',
                        location: {
                            latitude: locationData.latitude,
                            longitude: locationData.longitude,
                            name: locationData.name || template.header_location_name,
                            address: locationData.address || template.header_location_address,
                        },
                    });
                } else if (template.header_location_latitude && template.header_location_longitude) {
                    parameters.push({
                        type: 'location',
                        location: {
                            latitude: template.header_location_latitude,
                            longitude: template.header_location_longitude,
                            name: template.header_location_name,
                            address: template.header_location_address,
                        },
                    });
                }
                break;
        }

        if (parameters.length > 0) {
            headerComponent.parameters = parameters;
            components.push(headerComponent);
        }
    }

    // Body component with variables
    const bodyVars = template.components.body.text.match(/\{\{(\d+)\}\}/g) || [];
    if (bodyVars.length > 0) {
        const bodyParams = bodyVars.map(match => {
            const position = match.replace(/[{}]/g, '');
            return {
                type: 'text',
                text: variableValues[position] || '',
            };
        });
        components.push({
            type: 'body',
            parameters: bodyParams,
        });
    }

    // Button components (for URL buttons with dynamic suffix)
    if (template.components.buttons?.buttons) {
        template.components.buttons.buttons.forEach((btn, index) => {
            if (btn.type === 'URL' && 'url_suffix_variable' in btn && btn.url_suffix_variable) {
                const suffixValue = variableValues[String(btn.url_suffix_variable)] || '';
                components.push({
                    type: 'button',
                    sub_type: 'url',
                    index,
                    parameters: [{ type: 'text', text: suffixValue }],
                });
            }
        });
    }

    return components;
}

export const templateService = {
    // Template CRUD
    createTemplate,
    getTemplateById,
    getTemplatesByUserId,
    getAllTemplates,
    updateTemplate,
    deleteTemplate,
    
    // Meta Integration
    submitTemplateToMeta,
    syncTemplateStatusFromMeta,
    syncTemplatesFromMeta,
    deleteTemplateFromMeta,
    validateTemplateComponents,
    
    // Variables
    createTemplateVariable,
    getTemplateVariables,
    deleteTemplateVariable,
    substituteVariables,
    
    // Template Sending
    createTemplateSend,
    updateTemplateSendStatus,
    getTemplateSendByPlatformMessageId,
    getTemplateAnalytics,
    buildRuntimeComponents,
    
    // Button Definitions
    createButtonDefinitionsFromTemplate,
    getTemplateButtons,
    updateButtonTrackingId,
    
    // Button Click Tracking
    recordButtonClick,
    getButtonClickAnalytics,
    getButtonClicksByUser,
    getLeadButtonActivity,
    findTemplateSendForButtonClick,
};
