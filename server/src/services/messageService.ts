import { db } from '../utils/database';
import { logger } from '../utils/logger';
import { Message, CreateMessageData, PhoneNumberType } from '../models/types';
import { platformsConfig } from '../config';

/**
 * Service response interface
 */
interface SendMessageResult {
    success: boolean;
    messageId?: string;
    error?: string;
    errorCode?: string;
    retryable?: boolean;
}

/**
 * Message delivery status
 */
export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

/**
 * Message service error types
 */
export class MessageServiceError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly statusCode?: number,
        public readonly retryable: boolean = false
    ) {
        super(message);
        this.name = 'MessageServiceError';
    }
}

/**
 * Access token information retrieved from database
 * Note: metaPhoneNumberId is Meta's ID used in API calls, not our internal ID
 */
interface AccessTokenInfo {
    accessToken: string;
    metaPhoneNumberId: string;  // Meta's phone_number_id for API calls
    platform: PhoneNumberType;
    displayPhoneNumber?: string;
}

/**
 * Send typing indicator + read receipt asynchronously (fire and forget)
 * 
 * Combines two features:
 * 1. Marks message as read (double blue checkmarks)
 * 2. Shows "typing..." indicator (visible for up to 25 seconds or until response sent)
 * 
 * @param phoneNumberId - Internal phone number ID
 * @param customerPhone - Customer phone number
 * @param platformType - Platform type
 * @param messageId - Incoming message ID to mark as read
 * @param accessToken - Optional access token
 * @param metaPhoneNumberId - Optional Meta phone number ID
 */
export async function sendTypingIndicator(
    phoneNumberId: string,
    customerPhone: string,
    platformType: PhoneNumberType,
    messageId: string,
    accessToken?: string,
    metaPhoneNumberId?: string
): Promise<void> {
    const correlationId = `typing-${phoneNumberId}-${Date.now()}`;
    
    // Fire and forget - don't wait for response
    (async () => {
        try {
            logger.info('Sending typing indicator + read receipt', {
                correlationId,
                phoneNumberId,
                customerPhone,
                platformType,
                messageId,
                hasAccessToken: !!accessToken,
                hasMetaPhoneNumberId: !!metaPhoneNumberId
            });

            // Get access token if not provided
            let tokenInfo: AccessTokenInfo | null = null;
            
            if (accessToken && metaPhoneNumberId) {
                tokenInfo = {
                    accessToken,
                    metaPhoneNumberId,
                    platform: platformType
                };
            } else {
                tokenInfo = await getAccessTokenInfo(phoneNumberId);
                if (!tokenInfo) {
                    logger.warn('No access token found for typing indicator', {
                        correlationId,
                        phoneNumberId
                    });
                    return;
                }
            }

            // Send typing indicator based on platform
            if (platformType === 'whatsapp') {
                const success = await sendWhatsAppTypingIndicator(
                    tokenInfo.metaPhoneNumberId,
                    customerPhone,
                    tokenInfo.accessToken,
                    messageId,
                    correlationId
                );
                
                if (success) {
                    logger.info('WhatsApp typing indicator sent', {
                        correlationId,
                        phoneNumberId,
                        customerPhone
                    });
                }
            } else if (platformType === 'instagram') {
                const success = await sendInstagramTypingIndicator(
                    tokenInfo.metaPhoneNumberId,
                    customerPhone,
                    tokenInfo.accessToken,
                    correlationId
                );
                
                if (success) {
                    logger.info('Instagram typing indicator sent', {
                        correlationId,
                        phoneNumberId,
                        customerPhone
                    });
                }
            } else {
                logger.debug('Typing indicator skipped (platform not supported)', {
                    correlationId,
                    platformType
                });
            }
        } catch (error) {
            // Log failures but don't throw - typing indicators are non-critical
            logger.warn('Typing indicator failed (non-critical)', {
                correlationId,
                phoneNumberId,
                customerPhone,
                platformType,
                messageId,
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined
            });
        }
    })();
}

/**
 * Send message to customer via appropriate platform with comprehensive error handling
 * 
 * @param phoneNumberId - Internal phone number ID
 * @param customerPhone - Customer phone number
 * @param messageText - Message text to send
 * @param platformType - Platform type (whatsapp, instagram, webchat)
 * @param accessToken - Optional access token (if already available, skips DB query)
 * @param metaPhoneNumberId - Optional Meta phone number ID (if already available)
 */
export async function sendMessage(
    phoneNumberId: string,
    customerPhone: string,
    messageText: string,
    platformType: PhoneNumberType,
    accessToken?: string,
    metaPhoneNumberId?: string
): Promise<SendMessageResult> {
    const correlationId = `send-${phoneNumberId}-${Date.now()}`;
    
    try {
        logger.info('Sending outbound message', {
            correlationId,
            phoneNumberId,
            customerPhone,
            platformType,
            messageLength: messageText.length,
            hasAccessToken: !!accessToken
        });

        // Validate inputs
        if (!phoneNumberId?.trim()) {
            throw new MessageServiceError('Phone number ID is required', 'INVALID_INPUT');
        }

        if (!customerPhone?.trim()) {
            throw new MessageServiceError('Customer phone is required', 'INVALID_INPUT');
        }

        if (!messageText?.trim()) {
            throw new MessageServiceError('Message text is required', 'INVALID_INPUT');
        }

        // Get access token and platform info (use provided or fetch from DB)
        let tokenInfo: AccessTokenInfo | null = null;
        
        if (accessToken && metaPhoneNumberId) {
            // Use provided access token (from session cache) - FAST PATH
            tokenInfo = {
                accessToken,
                metaPhoneNumberId,
                platform: platformType
            };
            
            logger.debug('Using provided access token (cached)', {
                correlationId,
                phoneNumberId,
                metaPhoneNumberId
            });
        } else {
            // Fetch from database - SLOW PATH (fallback)
            tokenInfo = await getAccessTokenInfo(phoneNumberId);
            if (!tokenInfo) {
                throw new MessageServiceError('Access token not found for phone number', 'TOKEN_NOT_FOUND');
            }
        }

        // Verify platform type matches
        if (tokenInfo.platform !== platformType) {
            throw new MessageServiceError(
                `Platform mismatch: expected ${platformType}, got ${tokenInfo.platform}`,
                'PLATFORM_MISMATCH'
            );
        }

        let result: SendMessageResult;

        switch (platformType) {
            case 'whatsapp':
                result = await sendWhatsAppMessage(
                    tokenInfo.metaPhoneNumberId,
                    customerPhone,
                    messageText,
                    tokenInfo.accessToken,
                    correlationId
                );
                break;
            case 'instagram':
                result = await sendInstagramMessage(
                    tokenInfo.metaPhoneNumberId,
                    customerPhone,
                    messageText,
                    tokenInfo.accessToken,
                    correlationId
                );
                break;
            case 'webchat':
                result = await sendWebChatMessage(
                    tokenInfo.metaPhoneNumberId,
                    customerPhone,
                    messageText,
                    tokenInfo.accessToken,
                    correlationId
                );
                break;
            default:
                throw new MessageServiceError(`Unsupported platform type: ${platformType}`, 'UNSUPPORTED_PLATFORM');
        }

        if (result.success) {
            logger.info('Outbound message sent successfully', {
                correlationId,
                phoneNumberId,
                customerPhone,
                platformType,
                messageId: result.messageId
            });
        } else {
            logger.warn('Outbound message sending failed', {
                correlationId,
                phoneNumberId,
                customerPhone,
                platformType,
                error: result.error,
                errorCode: result.errorCode,
                retryable: result.retryable
            });
        }

        return result;

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorCode = error instanceof MessageServiceError ? error.code : 'UNKNOWN_ERROR';
        const retryable = error instanceof MessageServiceError ? error.retryable : false;
        
        logger.error('Failed to send outbound message', {
            correlationId,
            phoneNumberId,
            customerPhone,
            platformType,
            error: errorMessage,
            errorCode,
            retryable
        });

        return {
            success: false,
            error: errorMessage,
            errorCode,
            retryable
        };
    }
}

/**
 * Send typing indicator + mark as read to WhatsApp
 * 
 * Combines two features:
 * 1. Mark message as read (double blue checkmarks)
 * 2. Show typing indicator (shows "typing..." for up to 25 seconds)
 * 
 * Reference: https://developers.facebook.com/docs/whatsapp/cloud-api/guides/mark-message-as-read
 */
async function sendWhatsAppTypingIndicator(
    phoneNumberId: string,
    customerPhone: string,
    accessToken: string,
    messageId: string,
    correlationId: string
): Promise<boolean> {
    try {
        // WhatsApp Cloud API: Mark as read + show typing indicator
        // This shows double blue checkmarks AND "typing..." status
        const requestBody = {
            messaging_product: 'whatsapp',
            status: 'read',
            message_id: messageId,
            typing_indicator: {
                type: 'text'  // Shows "typing..." indicator for up to 25 seconds
            }
        };

        // Set a 5-second timeout (typing indicators are async, so this won't block)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(
            `${platformsConfig.whatsappBaseUrl}/${phoneNumberId}/messages`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody),
                signal: controller.signal
            }
        );

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            logger.warn('Typing indicator + read receipt failed (non-critical)', {
                correlationId,
                phoneNumberId,
                customerPhone,
                messageId,
                statusCode: response.status,
                error: errorData
            });
            return false;
        }

        const responseData = await response.json();
        logger.info('Typing indicator + read receipt sent successfully', {
            correlationId,
            phoneNumberId,
            customerPhone,
            messageId,
            response: responseData
        });

        return true;
    } catch (error) {
        // Typing indicators are non-critical, don't throw errors
        logger.warn('Typing indicator error (non-critical)', {
            correlationId,
            phoneNumberId,
            customerPhone,
            messageId,
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
        });
        return false;
    }
}

/**
 * Send Instagram typing indicator
 * Shows "typing..." indicator to the user
 * 
 * Reference: https://developers.facebook.com/docs/messenger-platform/send-messages/sender-actions
 */
async function sendInstagramTypingIndicator(
    businessAccountId: string,
    customerUserId: string,
    accessToken: string,
    correlationId: string
): Promise<boolean> {
    try {
        // Send typing_on action
        const requestBody = {
            recipient: {
                id: customerUserId
            },
            sender_action: 'typing_on'
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        // Try Instagram Graph API first
        const instagramApiUrl = 'https://graph.facebook.com/v24.0/me/messages';
        
        const response = await fetch(instagramApiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        // If Instagram API fails, try Facebook API fallback
        if (!response.ok && (response.status === 401 || response.status === 403)) {
            const fbApiUrl = `${platformsConfig.instagramBaseUrl}/${businessAccountId}/messages`;
            
            const fbResponse = await fetch(fbApiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (fbResponse.ok) {
                logger.info('Instagram typing indicator sent via Facebook API', {
                    correlationId,
                    businessAccountId,
                    customerUserId
                });
                return true;
            }

            logger.warn('Instagram typing indicator failed on both APIs', {
                correlationId,
                businessAccountId,
                customerUserId
            });
            return false;
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            logger.warn('Instagram typing indicator failed (non-critical)', {
                correlationId,
                businessAccountId,
                customerUserId,
                statusCode: response.status,
                error: errorData
            });
            return false;
        }

        logger.info('Instagram typing indicator sent successfully', {
            correlationId,
            businessAccountId,
            customerUserId
        });

        return true;
    } catch (error) {
        // Typing indicators are non-critical, don't throw errors
        logger.warn('Instagram typing indicator error (non-critical)', {
            correlationId,
            businessAccountId,
            customerUserId,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        return false;
    }
}

/**
 * Send WhatsApp message with comprehensive error handling
 */
async function sendWhatsAppMessage(
    phoneNumberId: string,
    customerPhone: string,
    messageText: string,
    accessToken: string,
    correlationId: string
): Promise<SendMessageResult> {
    try {
        logger.debug('Sending WhatsApp message', {
            correlationId,
            phoneNumberId,
            customerPhone,
            messageLength: messageText.length
        });

        const requestBody = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: customerPhone,
            type: 'text',
            text: { 
                body: messageText.substring(0, 4096) // WhatsApp limit
            }
        };

        // Add timeout to prevent hanging on slow API responses
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

        const fetchStart = Date.now();
        
        try {
            const response = await fetch(
                `${platformsConfig.whatsappBaseUrl}/${phoneNumberId}/messages`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                        'User-Agent': 'multi-channel-ai-agent/1.0.0'
                    },
                    body: JSON.stringify(requestBody),
                    signal: controller.signal
                }
            );
            
            clearTimeout(timeoutId);
            const fetchDuration = Date.now() - fetchStart;
            
            logger.debug('WhatsApp API response received', {
                correlationId,
                phoneNumberId,
                fetchDuration,
                statusCode: response.status
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } })) as any;
                const statusCode = response.status;
                
                // Handle specific WhatsApp error codes
                const errorCode = errorData.error?.code;
                const errorMessage = errorData.error?.message || `HTTP ${statusCode}`;
                
                let retryable = false;
                let serviceErrorCode = 'WHATSAPP_API_ERROR';

                switch (errorCode) {
                    case 131000: // Generic user error
                        serviceErrorCode = 'WHATSAPP_USER_ERROR';
                        break;
                    case 131005: // Message undeliverable
                        serviceErrorCode = 'WHATSAPP_UNDELIVERABLE';
                        break;
                    case 131047: // Re-engagement window expired
                        serviceErrorCode = 'WHATSAPP_WINDOW_EXPIRED';
                        break;
                    case 132001: // Invalid phone number
                        serviceErrorCode = 'WHATSAPP_INVALID_PHONE';
                        break;
                    case 132007: // Not a WhatsApp number
                        serviceErrorCode = 'WHATSAPP_NOT_WHATSAPP_NUMBER';
                        break;
                    default:
                        if (statusCode >= 500) {
                            retryable = true;
                            serviceErrorCode = 'WHATSAPP_SERVER_ERROR';
                        } else if (statusCode === 429) {
                            retryable = true;
                            serviceErrorCode = 'WHATSAPP_RATE_LIMIT';
                        }
                }

                logger.warn('WhatsApp API error', {
                    correlationId,
                    phoneNumberId,
                    customerPhone,
                    statusCode,
                    errorCode,
                    errorMessage,
                    retryable
                });

                return {
                    success: false,
                    error: errorMessage,
                    errorCode: serviceErrorCode,
                    retryable
                };
            }

            const data = await response.json() as any;
            const messageId = data.messages?.[0]?.id;

            if (!messageId) {
                logger.warn('WhatsApp API returned no message ID', {
                    correlationId,
                    phoneNumberId,
                    customerPhone,
                    response: data
                });

                return {
                    success: false,
                    error: 'No message ID returned from WhatsApp API',
                    errorCode: 'WHATSAPP_NO_MESSAGE_ID'
                };
            }

            logger.debug('WhatsApp message sent successfully', {
                correlationId,
                phoneNumberId,
                customerPhone,
                messageId,
                fetchDuration
            });

            return {
                success: true,
                messageId
            };
            
        } catch (fetchError) {
            clearTimeout(timeoutId);
            
            // Handle timeout specifically
            if (fetchError instanceof Error && fetchError.name === 'AbortError') {
                logger.error('WhatsApp API timeout', {
                    correlationId,
                    phoneNumberId,
                    customerPhone,
                    timeout: 10000
                });
                
                return {
                    success: false,
                    error: 'WhatsApp API timeout after 10 seconds',
                    errorCode: 'WHATSAPP_TIMEOUT',
                    retryable: true
                };
            }
            
            throw fetchError; // Re-throw other errors
        }

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        logger.error('WhatsApp message sending failed', {
            correlationId,
            phoneNumberId,
            customerPhone,
            error: errorMessage
        });

        return {
            success: false,
            error: errorMessage,
            errorCode: 'WHATSAPP_NETWORK_ERROR',
            retryable: true
        };
    }
}

/**
 * Send Instagram message with comprehensive error handling
 * Supports both Instagram Graph API methods:
 * 1. Instagram Login Token: POST graph.instagram.com/me/messages
 * 2. Facebook Page Token: POST graph.facebook.com/{id}/messages
 */
async function sendInstagramMessage(
    businessAccountId: string,
    customerUserId: string,
    messageText: string,
    accessToken: string,
    correlationId: string
): Promise<SendMessageResult> {
    try {
        logger.debug('Sending Instagram message', {
            correlationId,
            businessAccountId,
            customerUserId,
            messageLength: messageText.length
        });

        const requestBody = {
            recipient: { id: customerUserId },
            message: { 
                text: messageText.substring(0, 1000) // Instagram limit
            }
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const fetchStart = Date.now();
        
        try {
            // Try Instagram Graph API first (works with Instagram Login tokens)
            const instagramApiUrl = 'https://graph.facebook.com/v24.0/me/messages';
            
            logger.debug('Attempting Instagram Graph API (me/messages)', {
                correlationId,
                url: instagramApiUrl
            });

            const response = await fetch(instagramApiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'multi-channel-ai-agent/1.0.0'
                },
                body: JSON.stringify(requestBody),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            const fetchDuration = Date.now() - fetchStart;
            
            // If Instagram Graph API fails with auth/invalid parameter error, try Facebook Graph API fallback
            // 400 = Invalid parameter (me endpoint not supported), 401/403 = auth errors
            if (!response.ok && (response.status === 400 || response.status === 401 || response.status === 403)) {
                logger.info('Instagram Graph API failed, trying Facebook Graph API fallback', {
                    correlationId,
                    statusCode: response.status
                });

                const fbApiUrl = `${platformsConfig.instagramBaseUrl}/${businessAccountId}/messages`;
                const fbRequestBody = { messaging_type: 'RESPONSE', ...requestBody };

                const fbResponse = await fetch(fbApiUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                        'User-Agent': 'multi-channel-ai-agent/1.0.0'
                    },
                    body: JSON.stringify(fbRequestBody)
                });

                if (fbResponse.ok) {
                    const data = await fbResponse.json() as any;
                    logger.info('Instagram message sent via Facebook Graph API', {
                        correlationId,
                        messageId: data.message_id,
                        method: 'facebook-graph-api'
                    });

                    return {
                        success: true,
                        messageId: data.message_id
                    };
                }

                return await handleInstagramApiError(fbResponse, correlationId, businessAccountId, customerUserId);
            }

            if (!response.ok) {
                return await handleInstagramApiError(response, correlationId, businessAccountId, customerUserId);
            }

            const data = await response.json() as any;
            logger.info('Instagram message sent successfully', {
                correlationId,
                messageId: data.message_id || data.id,
                fetchDuration,
                method: 'instagram-graph-api'
            });

            return {
                success: true,
                messageId: data.message_id || data.id
            };

        } catch (fetchError) {
            clearTimeout(timeoutId);
            
            if (fetchError instanceof Error && fetchError.name === 'AbortError') {
                logger.warn('Instagram API request timeout', {
                    correlationId,
                    timeout: 10000
                });

                return {
                    success: false,
                    error: 'Request timeout',
                    errorCode: 'INSTAGRAM_TIMEOUT',
                    retryable: true
                };
            }

            throw fetchError;
        }
    } catch (error) {
        logger.error('Failed to send Instagram message', {
            correlationId,
            error: error instanceof Error ? error.message : 'Unknown error'
        });

        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            errorCode: 'INSTAGRAM_SEND_ERROR',
            retryable: false
        };
    }
}

/**
 * Handle Instagram API error responses
 */
async function handleInstagramApiError(
    response: Response,
    correlationId: string,
    businessAccountId: string,
    customerUserId: string
): Promise<SendMessageResult> {
    const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } })) as any;
    const statusCode = response.status;
    const errorCode = errorData.error?.code;
    const errorMessage = errorData.error?.message || `HTTP ${statusCode}`;
    
    let retryable = false;
    let serviceErrorCode = 'INSTAGRAM_API_ERROR';

    switch (errorCode) {
        case 100:
            serviceErrorCode = 'INSTAGRAM_INVALID_PARAMETER';
            break;
        case 190:
            serviceErrorCode = 'INSTAGRAM_INVALID_TOKEN';
            break;
        case 200:
            serviceErrorCode = 'INSTAGRAM_PERMISSIONS_ERROR';
            break;
        case 368:
            serviceErrorCode = 'INSTAGRAM_TEMPORARILY_BLOCKED';
            retryable = true;
            break;
        case 551:
            serviceErrorCode = 'INSTAGRAM_USER_UNAVAILABLE';
            retryable = true;
            break;
        case 2018001:
            serviceErrorCode = 'INSTAGRAM_USER_NOT_FOUND';
            break;
        default:
            if (statusCode >= 500) {
                retryable = true;
                serviceErrorCode = 'INSTAGRAM_SERVER_ERROR';
            } else if (statusCode === 429) {
                retryable = true;
                serviceErrorCode = 'INSTAGRAM_RATE_LIMIT';
            }
    }

    logger.warn('Instagram API error', {
        correlationId,
        businessAccountId,
        customerUserId,
        statusCode,
        errorCode,
        errorMessage,
        retryable
    });

    return {
        success: false,
        error: errorMessage,
        errorCode: serviceErrorCode,
        retryable
    };
}

/**
 * Send Web Chat message
 * 
 * For webchat, we don't need to call any external API.
 * The message is already stored in the database by the worker.
 * The visitor will poll for new messages via GET /api/webchat/:webchat_id/messages
 */
async function sendWebChatMessage(
    phoneNumberId: string,
    customerPhone: string,
    messageText: string,
    _accessToken: string,
    correlationId: string
): Promise<SendMessageResult> {
    try {
        logger.info('Webchat message - no external API call needed', {
            correlationId,
            phoneNumberId,
            customerPhone,
            messageLength: messageText.length
        });

        // Generate a message ID for tracking
        const messageId = `webchat_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

        // Message is already stored by worker in database
        // Visitor will poll for it via GET endpoint
        return {
            success: true,
            messageId
        };

    } catch (error) {
        logger.error('Webchat message handling failed', {
            correlationId,
            phoneNumberId,
            customerPhone,
            error: error instanceof Error ? error.message : 'Unknown error'
        });

        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            errorCode: 'WEBCHAT_ERROR'
        };
    }
}

/**
 * Get access token and platform information for phone number
 * 
 * @param internalPhoneNumberId - Our internal phone number ID from database
 * @returns Access token info with Meta's phone_number_id for API calls
 */
async function getAccessTokenInfo(internalPhoneNumberId: string): Promise<AccessTokenInfo | null> {
    const correlationId = `get-token-${internalPhoneNumberId}`;
    
    try {
        const query = `
            SELECT 
                pn.access_token,
                pn.meta_phone_number_id,
                pn.platform,
                pn.display_name
            FROM phone_numbers pn
            WHERE pn.id = $1
        `;
        
        const result = await db.query(query, [internalPhoneNumberId]);
        
        if (result.rows.length === 0) {
            logger.warn('No phone number found', {
                correlationId,
                internalPhoneNumberId
            });
            return null;
        }

        const row = result.rows[0];
        
        logger.debug('Retrieved access token info', {
            correlationId,
            internalPhoneNumberId,
            metaPhoneNumberId: row.meta_phone_number_id,
            platform: row.platform,
            hasToken: !!row.access_token
        });

        return {
            accessToken: row.access_token,
            metaPhoneNumberId: row.meta_phone_number_id,  // Meta's ID for API calls
            platform: row.platform as PhoneNumberType,
            displayPhoneNumber: row.display_name
        };

    } catch (error) {
        logger.error('Failed to get access token info', {
            correlationId,
            internalPhoneNumberId,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        return null;
    }
}

/**
 * Manual retry functionality for failed messages
 */
export async function retryFailedMessage(
    messageId: string,
    userId: string
): Promise<SendMessageResult> {
    const correlationId = `retry-${messageId}`;
    
    try {
        logger.info('Retrying failed message', {
            correlationId,
            messageId,
            userId
        });

        // Get the failed message details
        const messageQuery = `
            SELECT 
                m.id,
                m.conversation_id,
                m.content,
                m.sender_type,
                c.phone_number_id,
                c.contact_phone,
                c.platform,
                c.user_id
            FROM messages m
            JOIN conversations c ON m.conversation_id = c.id
            WHERE m.id = $1 AND c.user_id = $2 AND m.sender_type = 'agent'
        `;
        
        const messageResult = await db.query(messageQuery, [messageId, userId]);
        
        if (messageResult.rows.length === 0) {
            throw new MessageServiceError('Message not found or access denied', 'MESSAGE_NOT_FOUND');
        }

        const message = messageResult.rows[0];
        
        // Retry sending the message
        const result = await sendMessage(
            message.phone_number_id,
            message.contact_phone,
            message.content,
            message.platform
        );

        if (result.success) {
            // Update message status to sent
            await updateMessageStatus(messageId, 'sent');
            
            logger.info('Message retry successful', {
                correlationId,
                messageId,
                newMessageId: result.messageId
            });
        } else {
            logger.warn('Message retry failed', {
                correlationId,
                messageId,
                error: result.error,
                errorCode: result.errorCode
            });
        }

        return result;

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorCode = error instanceof MessageServiceError ? error.code : 'RETRY_ERROR';
        
        logger.error('Failed to retry message', {
            correlationId,
            messageId,
            userId,
            error: errorMessage,
            errorCode
        });

        return {
            success: false,
            error: errorMessage,
            errorCode
        };
    }
}

/**
 * Get failed messages for manual retry
 */
export async function getFailedMessages(
    userId: string,
    limit: number = 50,
    offset: number = 0
): Promise<Array<{
    messageId: string;
    conversationId: string;
    content: string;
    phoneNumberId: string;
    contactPhone: string;
    platform: PhoneNumberType;
    createdAt: Date;
    error?: string;
}>> {
    const correlationId = `get-failed-${userId}`;
    
    try {
        const query = `
            SELECT 
                m.id as message_id,
                m.conversation_id,
                m.content,
                m.created_at,
                c.phone_number_id,
                c.contact_phone,
                c.platform
            FROM messages m
            JOIN conversations c ON m.conversation_id = c.id
            WHERE c.user_id = $1 
                AND m.sender_type = 'agent'
                AND m.id IN (
                    SELECT message_id 
                    FROM message_delivery_status 
                    WHERE status = 'failed'
                )
            ORDER BY m.created_at DESC
            LIMIT $2 OFFSET $3
        `;
        
        const result = await db.query(query, [userId, limit, offset]);
        
        const failedMessages = result.rows.map((row: any) => ({
            messageId: row.message_id,
            conversationId: row.conversation_id,
            content: row.content,
            phoneNumberId: row.phone_number_id,
            contactPhone: row.contact_phone,
            platform: row.platform as PhoneNumberType,
            createdAt: row.created_at
        }));

        logger.debug('Retrieved failed messages', {
            correlationId,
            userId,
            count: failedMessages.length,
            limit,
            offset
        });

        return failedMessages;

    } catch (error) {
        logger.error('Failed to get failed messages', {
            correlationId,
            userId,
            limit,
            offset,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        return [];
    }
}

/**
 * Store message in database
 */
export async function storeMessage(messageData: CreateMessageData): Promise<Message> {
    const correlationId = `store-${messageData.message_id}`;
    
    try {
        const query = `
            INSERT INTO messages (message_id, conversation_id, sender, text, timestamp, status, sequence_no)
            VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5, $6)
            RETURNING *
        `;
        
        const result = await db.query(query, [
            messageData.message_id,
            messageData.conversation_id,
            messageData.sender,
            messageData.text,
            messageData.status || 'sent',
            messageData.sequence_no
        ]);

        const message: Message = {
            message_id: result.rows[0].message_id,
            conversation_id: result.rows[0].conversation_id,
            sender: result.rows[0].sender,
            text: result.rows[0].text,
            timestamp: result.rows[0].timestamp,
            status: result.rows[0].status,
            sequence_no: result.rows[0].sequence_no
        };

        logger.debug('Message stored successfully', {
            correlationId,
            messageId: message.message_id,
            conversationId: message.conversation_id,
            sender: message.sender
        });

        return message;

    } catch (error) {
        logger.error('Failed to store message', {
            correlationId,
            messageData,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        throw error;
    }
}

/**
 * Get messages for a conversation
 */
export async function getMessages(
    conversationId: string,
    limit: number = 50,
    offset: number = 0
): Promise<Message[]> {
    const correlationId = `get-messages-${conversationId}`;
    
    try {
        const query = `
            SELECT * FROM messages 
            WHERE conversation_id = $1 
            ORDER BY sequence_no ASC 
            LIMIT $2 OFFSET $3
        `;
        
        const result = await db.query(query, [conversationId, limit, offset]);
        
        const messages: Message[] = result.rows.map((row: any) => ({
            message_id: row.message_id,
            conversation_id: row.conversation_id,
            sender: row.sender,
            text: row.text,
            timestamp: row.timestamp,
            status: row.status,
            sequence_no: row.sequence_no
        }));

        logger.debug('Retrieved messages', {
            correlationId,
            conversationId,
            messageCount: messages.length,
            limit,
            offset
        });

        return messages;

    } catch (error) {
        logger.error('Failed to get messages', {
            correlationId,
            conversationId,
            limit,
            offset,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        throw error;
    }
}

/**
 * Track message delivery status
 */
export async function trackMessageDelivery(
    messageId: string,
    status: MessageStatus,
    platformMessageId?: string,
    error?: string
): Promise<void> {
    const correlationId = `track-delivery-${messageId}`;
    
    try {
        // Insert or update delivery status
        const query = `
            INSERT INTO message_delivery_status (
                message_id, 
                platform_message_id, 
                status, 
                error_message, 
                updated_at
            ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
            ON CONFLICT (message_id) 
            DO UPDATE SET 
                platform_message_id = EXCLUDED.platform_message_id,
                status = EXCLUDED.status,
                error_message = EXCLUDED.error_message,
                updated_at = EXCLUDED.updated_at
        `;
        
        await db.query(query, [messageId, platformMessageId, status, error]);
        
        logger.debug('Message delivery status tracked', {
            correlationId,
            messageId,
            status,
            platformMessageId,
            hasError: !!error
        });

    } catch (dbError) {
        logger.error('Failed to track message delivery status', {
            correlationId,
            messageId,
            status,
            platformMessageId,
            error: dbError instanceof Error ? dbError.message : 'Unknown error'
        });
        // Don't throw - delivery tracking failure shouldn't break message flow
    }
}

/**
 * Update message status (legacy function for backward compatibility)
 */
export async function updateMessageStatus(
    messageId: string,
    status: MessageStatus
): Promise<void> {
    await trackMessageDelivery(messageId, status);
}

/**
 * Get message delivery status
 */
export async function getMessageDeliveryStatus(
    messageId: string
): Promise<{
    status: MessageStatus;
    platformMessageId?: string;
    error?: string;
    updatedAt: Date;
} | null> {
    const correlationId = `get-delivery-status-${messageId}`;
    
    try {
        const query = `
            SELECT 
                status,
                platform_message_id,
                error_message,
                updated_at
            FROM message_delivery_status
            WHERE message_id = $1
        `;
        
        const result = await db.query(query, [messageId]);
        
        if (result.rows.length === 0) {
            return null;
        }

        const row = result.rows[0];
        
        logger.debug('Retrieved message delivery status', {
            correlationId,
            messageId,
            status: row.status
        });

        return {
            status: row.status as MessageStatus,
            platformMessageId: row.platform_message_id,
            error: row.error_message,
            updatedAt: row.updated_at
        };

    } catch (error) {
        logger.error('Failed to get message delivery status', {
            correlationId,
            messageId,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        return null;
    }
}

/**
 * Get delivery statistics for a user
 */
export async function getDeliveryStatistics(
    userId: string,
    timeRange: 'hour' | 'day' | 'week' | 'month' = 'day'
): Promise<{
    sent: number;
    delivered: number;
    failed: number;
    pending: number;
    totalMessages: number;
}> {
    const correlationId = `get-delivery-stats-${userId}`;
    
    try {
        let timeFilter = '';
        switch (timeRange) {
            case 'hour':
                timeFilter = "AND m.created_at >= NOW() - INTERVAL '1 hour'";
                break;
            case 'day':
                timeFilter = "AND m.created_at >= NOW() - INTERVAL '1 day'";
                break;
            case 'week':
                timeFilter = "AND m.created_at >= NOW() - INTERVAL '1 week'";
                break;
            case 'month':
                timeFilter = "AND m.created_at >= NOW() - INTERVAL '1 month'";
                break;
        }

        const query = `
            SELECT 
                COALESCE(mds.status, 'pending') as status,
                COUNT(*) as count
            FROM messages m
            JOIN conversations c ON m.conversation_id = c.id
            LEFT JOIN message_delivery_status mds ON m.id = mds.message_id
            WHERE c.user_id = $1 
                AND m.sender_type = 'agent'
                ${timeFilter}
            GROUP BY COALESCE(mds.status, 'pending')
        `;
        
        const result = await db.query(query, [userId]);
        
        const stats = {
            sent: 0,
            delivered: 0,
            failed: 0,
            pending: 0,
            totalMessages: 0
        };

        for (const row of result.rows) {
            const status = row.status as MessageStatus;
            const count = parseInt(row.count, 10);
            
            if (status in stats) {
                (stats as any)[status] = count;
            }
            stats.totalMessages += count;
        }

        logger.debug('Retrieved delivery statistics', {
            correlationId,
            userId,
            timeRange,
            stats
        });

        return stats;

    } catch (error) {
        logger.error('Failed to get delivery statistics', {
            correlationId,
            userId,
            timeRange,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        return {
            sent: 0,
            delivered: 0,
            failed: 0,
            pending: 0,
            totalMessages: 0
        };
    }
}

/**
 * WhatsApp template message component structure for API
 */
interface TemplateMessageComponent {
    type: 'header' | 'body' | 'button';
    parameters?: Array<{
        type: 'text' | 'currency' | 'date_time' | 'image' | 'document' | 'video';
        text?: string;
    }>;
    sub_type?: 'quick_reply' | 'url';
    index?: number;
}

/**
 * Send WhatsApp template message
 * Used for initiating conversations (first messages) or sending approved templates
 * 
 * @param phoneNumberId - Meta's phone_number_id (not our internal ID)
 * @param customerPhone - Customer phone number in E.164 format
 * @param templateName - Approved template name
 * @param languageCode - Template language code (e.g., 'en', 'en_US')
 * @param variables - Variable values keyed by position: { "1": "John", "2": "Acme" }
 * @param accessToken - Access token for Meta API
 * @param correlationId - Correlation ID for logging
 */
export async function sendWhatsAppTemplateMessage(
    phoneNumberId: string,
    customerPhone: string,
    templateName: string,
    languageCode: string,
    variables: Record<string, string>,
    accessToken: string,
    correlationId: string
): Promise<SendMessageResult> {
    try {
        logger.info('📤 Sending WhatsApp template message', {
            correlationId,
            phoneNumberId,
            customerPhone,
            templateName,
            languageCode,
            variableCount: Object.keys(variables).length,
            variables: variables, // Log actual variable values for debugging
        });

        // Build components array with variables
        const components: TemplateMessageComponent[] = [];

        // Add body component with variables if any
        if (Object.keys(variables).length > 0) {
            const bodyParameters = Object.keys(variables)
                .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
                .map(key => ({
                    type: 'text' as const,
                    text: variables[key]
                }));

            components.push({
                type: 'body',
                parameters: bodyParameters
            });
        }

        const requestBody = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: customerPhone,
            type: 'template',
            template: {
                name: templateName,
                language: {
                    code: languageCode
                },
                components: components.length > 0 ? components : undefined
            }
        };

        // Deep logging: Log the full request body being sent to WhatsApp
        logger.info('📋 WhatsApp Template API Request Body', {
            correlationId,
            url: `${platformsConfig.whatsappBaseUrl}/${phoneNumberId}/messages`,
            requestBody: JSON.stringify(requestBody, null, 2),
        });

        // Add timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout for templates

        const fetchStart = Date.now();

        try {
            const response = await fetch(
                `${platformsConfig.whatsappBaseUrl}/${phoneNumberId}/messages`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                        'User-Agent': 'multi-channel-ai-agent/1.0.0'
                    },
                    body: JSON.stringify(requestBody),
                    signal: controller.signal
                }
            );

            clearTimeout(timeoutId);
            const fetchDuration = Date.now() - fetchStart;

            // Get raw response text first for logging
            const responseText = await response.text();
            
            logger.info('📥 WhatsApp Template API Raw Response', {
                correlationId,
                phoneNumberId,
                fetchDuration,
                statusCode: response.status,
                statusText: response.statusText,
                responseBody: responseText,
            });

            // Parse the response
            let responseData: any;
            try {
                responseData = JSON.parse(responseText);
            } catch {
                responseData = { raw: responseText };
            }

            if (!response.ok) {
                const statusCode = response.status;
                const errorCode = responseData.error?.code;
                const errorMessage = responseData.error?.message || `HTTP ${statusCode}`;
                const errorDetails = responseData.error?.error_data;

                let retryable = false;
                let serviceErrorCode = 'WHATSAPP_TEMPLATE_ERROR';
                let marketingOptInRequired = false;

                // Handle template-specific errors with detailed logging
                switch (errorCode) {
                    case 131026: // Message undeliverable - user hasn't opted in for marketing
                        serviceErrorCode = 'WHATSAPP_USER_NOT_OPTED_IN';
                        marketingOptInRequired = true;
                        logger.error('❌ USER NOT OPTED IN FOR MARKETING', {
                            correlationId,
                            customerPhone,
                            templateName,
                            errorCode,
                            errorMessage,
                            errorDetails,
                            hint: 'User must opt-in to receive marketing messages. They need to message you first or explicitly opt-in.',
                        });
                        break;
                    case 131047: // Re-engagement message - more than 24 hours without user response
                        serviceErrorCode = 'WHATSAPP_REENGAGEMENT_REQUIRED';
                        marketingOptInRequired = true;
                        logger.error('❌ 24-HOUR WINDOW EXPIRED', {
                            correlationId,
                            customerPhone,
                            templateName,
                            errorCode,
                            errorMessage,
                            errorDetails,
                            hint: 'User has not messaged in the last 24 hours. Only utility templates can be sent outside the 24-hour window.',
                        });
                        break;
                    case 131053: // Marketing message limit reached for user
                        serviceErrorCode = 'WHATSAPP_MARKETING_LIMIT_REACHED';
                        logger.error('❌ MARKETING MESSAGE LIMIT REACHED', {
                            correlationId,
                            customerPhone,
                            templateName,
                            errorCode,
                            errorMessage,
                            errorDetails,
                            hint: 'User has received too many marketing messages. Wait for them to engage or use utility template.',
                        });
                        break;
                    case 132000: // Template param value has invalid format
                        serviceErrorCode = 'WHATSAPP_TEMPLATE_PARAM_INVALID';
                        break;
                    case 132001: // Template name doesn't exist
                        serviceErrorCode = 'WHATSAPP_TEMPLATE_NOT_FOUND';
                        break;
                    case 132005: // Template hydration failed
                        serviceErrorCode = 'WHATSAPP_TEMPLATE_HYDRATION_FAILED';
                        break;
                    case 132007: // Template not approved for that language
                        serviceErrorCode = 'WHATSAPP_TEMPLATE_NOT_APPROVED';
                        break;
                    case 132012: // Template param count mismatch
                        serviceErrorCode = 'WHATSAPP_TEMPLATE_PARAM_MISMATCH';
                        logger.error('❌ TEMPLATE PARAM COUNT MISMATCH', {
                            correlationId,
                            customerPhone,
                            templateName,
                            errorCode,
                            errorMessage,
                            errorDetails,
                            hint: 'Number of variables provided does not match template requirements.',
                        });
                        break;
                    case 132015: // Template is paused
                        serviceErrorCode = 'WHATSAPP_TEMPLATE_PAUSED';
                        break;
                    case 132016: // Template is disabled
                        serviceErrorCode = 'WHATSAPP_TEMPLATE_DISABLED';
                        break;
                    default:
                        if (statusCode >= 500) {
                            retryable = true;
                            serviceErrorCode = 'WHATSAPP_SERVER_ERROR';
                        } else if (statusCode === 429) {
                            retryable = true;
                            serviceErrorCode = 'WHATSAPP_RATE_LIMIT';
                        }
                }

                logger.warn('⚠️ WhatsApp Template API error', {
                    correlationId,
                    phoneNumberId,
                    customerPhone,
                    templateName,
                    statusCode,
                    errorCode,
                    errorMessage,
                    errorDetails,
                    fullErrorResponse: responseData.error,
                    marketingOptInRequired,
                    retryable
                });

                return {
                    success: false,
                    error: errorMessage,
                    errorCode: serviceErrorCode,
                    retryable
                };
            }

            const messageId = responseData.messages?.[0]?.id;
            const messageStatus = responseData.messages?.[0]?.message_status;
            const contacts = responseData.contacts;

            // Log successful response details
            logger.info('✅ WhatsApp template message accepted', {
                correlationId,
                phoneNumberId,
                customerPhone,
                templateName,
                messageId,
                messageStatus,
                contacts,
                hint: messageStatus === 'accepted' ? 'Message queued for delivery. Watch for delivery status webhook.' : undefined,
            });

            if (!messageId) {
                logger.warn('WhatsApp Template API returned no message ID', {
                    correlationId,
                    phoneNumberId,
                    customerPhone,
                    templateName,
                    response: responseData
                });

                return {
                    success: false,
                    error: 'No message ID returned from WhatsApp Template API',
                    errorCode: 'WHATSAPP_TEMPLATE_NO_MESSAGE_ID'
                };
            }

            logger.info('WhatsApp template message sent successfully', {
                correlationId,
                phoneNumberId,
                customerPhone,
                templateName,
                messageId,
                fetchDuration
            });

            return {
                success: true,
                messageId
            };

        } catch (fetchError) {
            clearTimeout(timeoutId);

            if (fetchError instanceof Error && fetchError.name === 'AbortError') {
                logger.error('WhatsApp Template API timeout', {
                    correlationId,
                    phoneNumberId,
                    customerPhone,
                    templateName,
                    timeout: 15000
                });

                return {
                    success: false,
                    error: 'WhatsApp Template API timeout after 15 seconds',
                    errorCode: 'WHATSAPP_TEMPLATE_TIMEOUT',
                    retryable: true
                };
            }

            throw fetchError;
        }

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        logger.error('WhatsApp template message sending failed', {
            correlationId,
            phoneNumberId,
            customerPhone,
            templateName,
            error: errorMessage
        });

        return {
            success: false,
            error: errorMessage,
            errorCode: 'WHATSAPP_TEMPLATE_NETWORK_ERROR',
            retryable: true
        };
    }
}

/**
 * Send template message to a customer (high-level function)
 * Retrieves access token and phone number info automatically
 * 
 * @param phoneNumberId - Our internal phone number ID
 * @param customerPhone - Customer phone number
 * @param templateName - Template name
 * @param languageCode - Language code
 * @param variables - Variable values
 * @param correlationId - Correlation ID
 */
export async function sendTemplateMessage(
    phoneNumberId: string,
    customerPhone: string,
    templateName: string,
    languageCode: string,
    variables: Record<string, string>,
    correlationId: string
): Promise<SendMessageResult> {
    try {
        // Get access token info
        const tokenInfo = await getAccessTokenInfo(phoneNumberId);
        
        if (!tokenInfo) {
            logger.error('No access token found for template message', {
                correlationId,
                phoneNumberId
            });
            
            return {
                success: false,
                error: 'Phone number not found or missing access token',
                errorCode: 'PHONE_NUMBER_NOT_FOUND'
            };
        }

        if (tokenInfo.platform !== 'whatsapp') {
            return {
                success: false,
                error: 'Template messages only supported for WhatsApp',
                errorCode: 'PLATFORM_NOT_SUPPORTED'
            };
        }

        return sendWhatsAppTemplateMessage(
            tokenInfo.metaPhoneNumberId,
            customerPhone,
            templateName,
            languageCode,
            variables,
            tokenInfo.accessToken,
            correlationId
        );

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        logger.error('Template message sending failed', {
            correlationId,
            phoneNumberId,
            customerPhone,
            templateName,
            error: errorMessage
        });

        return {
            success: false,
            error: errorMessage,
            errorCode: 'TEMPLATE_SEND_ERROR'
        };
    }
}
