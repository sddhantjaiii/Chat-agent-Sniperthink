-- Backfill campaign_recipients status from template_sends
-- This script syncs the delivery status from template_sends to campaign_recipients
-- Run this to fix historical campaigns where delivered/read status wasn't synced

-- First, let's see the current state for the specific campaign
SELECT 
    cr.recipient_id,
    cr.status as recipient_status,
    ts.status as template_send_status,
    ts.delivered_at,
    ts.read_at,
    ts.platform_message_id
FROM campaign_recipients cr
JOIN template_sends ts ON cr.template_send_id = ts.send_id
WHERE cr.campaign_id = '87bd5968-c858-4949-a55f-26c823db2d81';

-- Backfill: Update campaign_recipients to match template_sends status
-- This updates recipients where template_sends has a more advanced status
BEGIN;

-- Update to DELIVERED where template_sends shows DELIVERED but recipient is still SENT
UPDATE campaign_recipients cr
SET 
    status = 'DELIVERED',
    delivered_at = ts.delivered_at,
    updated_at = CURRENT_TIMESTAMP
FROM template_sends ts
WHERE cr.template_send_id = ts.send_id
  AND ts.status = 'DELIVERED'
  AND cr.status = 'SENT';

-- Update to READ where template_sends shows READ but recipient is still SENT or DELIVERED
UPDATE campaign_recipients cr
SET 
    status = 'READ',
    delivered_at = COALESCE(cr.delivered_at, ts.delivered_at, ts.read_at),
    read_at = ts.read_at,
    updated_at = CURRENT_TIMESTAMP
FROM template_sends ts
WHERE cr.template_send_id = ts.send_id
  AND ts.status = 'READ'
  AND cr.status IN ('SENT', 'DELIVERED');

COMMIT;

-- Now sync the campaign aggregate stats
-- This recalculates delivered_count and read_count from campaign_recipients
UPDATE campaigns c
SET 
    delivered_count = stats.delivered_count,
    read_count = stats.read_count,
    updated_at = CURRENT_TIMESTAMP
FROM (
    SELECT 
        campaign_id,
        COUNT(*) FILTER (WHERE status IN ('DELIVERED', 'READ')) as delivered_count,
        COUNT(*) FILTER (WHERE status = 'READ') as read_count
    FROM campaign_recipients
    GROUP BY campaign_id
) stats
WHERE c.campaign_id = stats.campaign_id;

-- Verify the fix for specific campaign
SELECT 
    campaign_id,
    name,
    status,
    total_recipients,
    sent_count,
    delivered_count,
    read_count,
    failed_count
FROM campaigns
WHERE campaign_id = '87bd5968-c858-4949-a55f-26c823db2d81';

-- Also verify recipient stats
SELECT 
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE status = 'PENDING') as pending,
    COUNT(*) FILTER (WHERE status = 'QUEUED') as queued,
    COUNT(*) FILTER (WHERE status = 'SENT') as sent,
    COUNT(*) FILTER (WHERE status = 'DELIVERED') as delivered,
    COUNT(*) FILTER (WHERE status = 'READ') as read,
    COUNT(*) FILTER (WHERE status = 'FAILED') as failed,
    COUNT(*) FILTER (WHERE status = 'SKIPPED') as skipped
FROM campaign_recipients 
WHERE campaign_id = '87bd5968-c858-4949-a55f-26c823db2d81';
