-- Migration 032: Update Extractions Schema v2
-- Removes individual CTA columns, adds new extraction fields (requirements, custom_cta, in_detail_summary)
-- Removes intent TEXT and notes TEXT columns

-- Drop old CTA columns
ALTER TABLE extractions 
  DROP COLUMN IF EXISTS cta_pricing_clicked,
  DROP COLUMN IF EXISTS cta_demo_clicked,
  DROP COLUMN IF EXISTS cta_followup_clicked,
  DROP COLUMN IF EXISTS cta_sample_clicked,
  DROP COLUMN IF EXISTS cta_website_clicked,
  DROP COLUMN IF EXISTS cta_escalated_to_human;

-- Drop intent TEXT and notes TEXT columns
ALTER TABLE extractions 
  DROP COLUMN IF EXISTS intent,
  DROP COLUMN IF EXISTS notes;

-- Add new columns
ALTER TABLE extractions 
  ADD COLUMN IF NOT EXISTS requirements TEXT,
  ADD COLUMN IF NOT EXISTS custom_cta TEXT,
  ADD COLUMN IF NOT EXISTS in_detail_summary TEXT;

-- Add comments for new columns
COMMENT ON COLUMN extractions.requirements IS 'Key requirements from conversation - product needs, features, etc.';
COMMENT ON COLUMN extractions.custom_cta IS 'Comma-separated list of custom CTAs clicked/mentioned';
COMMENT ON COLUMN extractions.in_detail_summary IS 'Detailed summary of the conversation';

-- Drop total_score constraint if exists (it was 5-15 range, now it should be unconstrained for flexibility)
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'extractions_total_score_check'
    ) THEN
        ALTER TABLE extractions DROP CONSTRAINT extractions_total_score_check;
    END IF;
END $$;

-- Note: reasoning JSONB column structure is now:
-- { intent, urgency, budget, fit, engagement, cta_behavior }
