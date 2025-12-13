/**
 * Rate Limit Service
 * Manages WhatsApp messaging rate limits per phone number based on tier
 */

import { db } from '../utils/database';
import { logger } from '../utils/logger';
import type {
    MessageTier,
    PhoneNumberWithRateLimit,
    RateLimitStats,
} from '../models/types';

// Tier limits
const TIER_LIMITS: Record<MessageTier, number> = {
    TIER_1K: 1000,
    TIER_10K: 10000,
    TIER_100K: 100000,
    TIER_UNLIMITED: Number.MAX_SAFE_INTEGER,
};

/**
 * Check if phone number can send more messages today
 */
export async function checkLimit(phoneNumberId: string): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: Date;
    tier: MessageTier;
}> {
    // First, ensure daily counter is reset if needed
    await resetDailyIfNeeded(phoneNumberId);

    const result = await db.query<PhoneNumberWithRateLimit>(
        `SELECT daily_message_limit, daily_messages_sent, tier, limit_reset_at 
         FROM phone_numbers WHERE id = $1`,
        [phoneNumberId]
    );

    const phoneNumber = result.rows[0];
    if (!phoneNumber) {
        throw new Error(`Phone number ${phoneNumberId} not found`);
    }

    const limit = phoneNumber.daily_message_limit || TIER_LIMITS[phoneNumber.tier] || TIER_LIMITS.TIER_1K;
    const sent = phoneNumber.daily_messages_sent || 0;
    const remaining = Math.max(0, limit - sent);

    return {
        allowed: remaining > 0,
        remaining,
        resetAt: phoneNumber.limit_reset_at,
        tier: phoneNumber.tier,
    };
}

/**
 * Increment usage counter for a phone number
 */
export async function incrementUsage(phoneNumberId: string, count: number = 1): Promise<{
    newCount: number;
    remaining: number;
}> {
    // First check and reset if needed
    await resetDailyIfNeeded(phoneNumberId);

    const result = await db.query<{ daily_messages_sent: number; daily_message_limit: number }>(
        `UPDATE phone_numbers 
         SET daily_messages_sent = daily_messages_sent + $2
         WHERE id = $1
         RETURNING daily_messages_sent, daily_message_limit`,
        [phoneNumberId, count]
    );

    const row = result.rows[0];
    if (!row) {
        throw new Error(`Phone number ${phoneNumberId} not found`);
    }

    return {
        newCount: row.daily_messages_sent,
        remaining: Math.max(0, row.daily_message_limit - row.daily_messages_sent),
    };
}

/**
 * Reset daily counter if it's a new day (UTC)
 */
export async function resetDailyIfNeeded(phoneNumberId: string): Promise<boolean> {
    const result = await db.query(
        `UPDATE phone_numbers 
         SET daily_messages_sent = 0, limit_reset_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND limit_reset_at < CURRENT_DATE
         RETURNING id`,
        [phoneNumberId]
    );

    const wasReset = (result.rowCount ?? 0) > 0;
    
    if (wasReset) {
        logger.info('Daily rate limit counter reset', { phoneNumberId });
    }

    return wasReset;
}

/**
 * Reset all phone numbers daily counters (run via cron at midnight UTC)
 */
export async function resetAllDaily(): Promise<number> {
    const result = await db.query(
        `UPDATE phone_numbers 
         SET daily_messages_sent = 0, limit_reset_at = CURRENT_TIMESTAMP
         WHERE limit_reset_at < CURRENT_DATE
         RETURNING id`
    );

    const count = result.rowCount ?? 0;
    
    // Only log if we actually reset something
    if (count > 0) {
        logger.info('Reset daily rate limits for all phone numbers', { count });
    }
    
    return count;
}

/**
 * Get rate limit stats for a phone number
 */
export async function getStats(phoneNumberId: string): Promise<RateLimitStats | null> {
    await resetDailyIfNeeded(phoneNumberId);

    const result = await db.query<PhoneNumberWithRateLimit>(
        `SELECT id, display_name, daily_message_limit, daily_messages_sent, tier, limit_reset_at 
         FROM phone_numbers WHERE id = $1`,
        [phoneNumberId]
    );

    const row = result.rows[0];
    if (!row) {
        return null;
    }

    const limit = row.daily_message_limit || TIER_LIMITS[row.tier] || TIER_LIMITS.TIER_1K;
    const sent = row.daily_messages_sent || 0;

    return {
        phoneNumberId: row.id,
        displayName: row.display_name,
        tier: row.tier,
        dailyLimit: limit,
        dailySent: sent,
        percentUsed: limit > 0 ? (sent / limit) * 100 : 0,
        resetsAt: row.limit_reset_at,
    };
}

/**
 * Get rate limit stats for all phone numbers (admin)
 */
export async function getAllStats(options?: { userId?: string }): Promise<RateLimitStats[]> {
    // First reset any counters that need it
    await resetAllDaily();

    let query = `
        SELECT id, display_name, daily_message_limit, daily_messages_sent, tier, limit_reset_at, user_id
        FROM phone_numbers 
        WHERE platform = 'whatsapp'
    `;
    const params: unknown[] = [];

    if (options?.userId) {
        query += ` AND user_id = $1`;
        params.push(options.userId);
    }

    query += ` ORDER BY daily_messages_sent DESC`;

    const result = await db.query<PhoneNumberWithRateLimit & { user_id: string }>(query, params);

    return result.rows.map(row => {
        const limit = row.daily_message_limit || TIER_LIMITS[row.tier] || TIER_LIMITS.TIER_1K;
        const sent = row.daily_messages_sent || 0;

        return {
            phoneNumberId: row.id,
            displayName: row.display_name,
            tier: row.tier,
            dailyLimit: limit,
            dailySent: sent,
            percentUsed: limit > 0 ? (sent / limit) * 100 : 0,
            resetsAt: row.limit_reset_at,
        };
    });
}

/**
 * Update phone number tier and limits
 */
export async function updateTier(
    phoneNumberId: string,
    tier: MessageTier,
    customLimit?: number
): Promise<PhoneNumberWithRateLimit | null> {
    const limit = customLimit ?? TIER_LIMITS[tier];

    const result = await db.query<PhoneNumberWithRateLimit>(
        `UPDATE phone_numbers 
         SET tier = $2, daily_message_limit = $3
         WHERE id = $1
         RETURNING *`,
        [phoneNumberId, tier, limit]
    );

    if (result.rows[0]) {
        logger.info('Updated phone number tier', { phoneNumberId, tier, limit });
    }

    return result.rows[0] || null;
}

/**
 * Check if can send N messages (for batch operations)
 */
export async function canSendBatch(phoneNumberId: string, count: number): Promise<{
    canSend: boolean;
    availableToSend: number;
    wouldExceedBy: number;
}> {
    const { remaining } = await checkLimit(phoneNumberId);

    return {
        canSend: remaining >= count,
        availableToSend: Math.min(remaining, count),
        wouldExceedBy: Math.max(0, count - remaining),
    };
}

/**
 * Reserve capacity for batch send (atomic operation)
 */
export async function reserveCapacity(
    phoneNumberId: string,
    count: number
): Promise<{ reserved: number; remaining: number } | null> {
    return db.transaction(async (client) => {
        // Lock the row
        const lockResult = await client.query<PhoneNumberWithRateLimit>(
            `SELECT daily_message_limit, daily_messages_sent, tier, limit_reset_at
             FROM phone_numbers 
             WHERE id = $1
             FOR UPDATE`,
            [phoneNumberId]
        );

        const row = lockResult.rows[0];
        if (!row) {
            return null;
        }

        const limit = row.daily_message_limit || TIER_LIMITS[row.tier] || TIER_LIMITS.TIER_1K;
        const sent = row.daily_messages_sent || 0;
        const available = Math.max(0, limit - sent);
        const toReserve = Math.min(available, count);

        if (toReserve === 0) {
            return { reserved: 0, remaining: 0 };
        }

        // Increment counter
        await client.query(
            `UPDATE phone_numbers SET daily_messages_sent = daily_messages_sent + $2 WHERE id = $1`,
            [phoneNumberId, toReserve]
        );

        return {
            reserved: toReserve,
            remaining: available - toReserve,
        };
    });
}

/**
 * Release reserved capacity (if send failed)
 */
export async function releaseCapacity(phoneNumberId: string, count: number): Promise<void> {
    await db.query(
        `UPDATE phone_numbers 
         SET daily_messages_sent = GREATEST(0, daily_messages_sent - $2)
         WHERE id = $1`,
        [phoneNumberId, count]
    );

    logger.debug('Released rate limit capacity', { phoneNumberId, count });
}

/**
 * Get tier limits info
 */
export function getTierLimits(): Record<MessageTier, number> {
    return { ...TIER_LIMITS };
}

export const rateLimitService = {
    checkLimit,
    incrementUsage,
    resetDailyIfNeeded,
    resetAllDaily,
    getStats,
    getAllStats,
    updateTier,
    canSendBatch,
    reserveCapacity,
    releaseCapacity,
    getTierLimits,
};
