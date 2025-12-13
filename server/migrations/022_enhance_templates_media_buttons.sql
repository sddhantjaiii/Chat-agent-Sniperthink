-- Migration: Enhance templates table for media headers and button tracking
-- Description: Adds support for IMAGE, VIDEO, DOCUMENT, LOCATION headers and button click tracking

-- =====================================================
-- 1. Enhance templates table with header media support
-- =====================================================

-- Add waba_id for template association
ALTER TABLE templates ADD COLUMN IF NOT EXISTS waba_id VARCHAR(100);

-- Header type (determines what kind of header the template uses)
ALTER TABLE templates ADD COLUMN IF NOT EXISTS header_type VARCHAR(20) DEFAULT 'NONE'
    CHECK (header_type IN ('NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'LOCATION'));

-- Media URL for IMAGE, VIDEO, DOCUMENT headers
ALTER TABLE templates ADD COLUMN IF NOT EXISTS header_media_url TEXT;

-- Document filename (for DOCUMENT headers)
ALTER TABLE templates ADD COLUMN IF NOT EXISTS header_document_filename VARCHAR(255);

-- Location fields (for LOCATION headers)
ALTER TABLE templates ADD COLUMN IF NOT EXISTS header_location_latitude DECIMAL(10, 8);
ALTER TABLE templates ADD COLUMN IF NOT EXISTS header_location_longitude DECIMAL(11, 8);
ALTER TABLE templates ADD COLUMN IF NOT EXISTS header_location_name VARCHAR(255);
ALTER TABLE templates ADD COLUMN IF NOT EXISTS header_location_address TEXT;

-- Add index for waba_id
CREATE INDEX IF NOT EXISTS idx_templates_waba_id ON templates(waba_id) WHERE waba_id IS NOT NULL;

-- =====================================================
-- 2. Enhance template_variables for button tracking
-- =====================================================

-- Button-specific fields for QUICK_REPLY tracking
ALTER TABLE template_variables ADD COLUMN IF NOT EXISTS button_id VARCHAR(100);
ALTER TABLE template_variables ADD COLUMN IF NOT EXISTS button_type VARCHAR(20)
    CHECK (button_type IN ('QUICK_REPLY', 'URL', 'PHONE_NUMBER', 'COPY_CODE'));
ALTER TABLE template_variables ADD COLUMN IF NOT EXISTS button_url TEXT;
ALTER TABLE template_variables ADD COLUMN IF NOT EXISTS button_phone VARCHAR(30);

-- =====================================================
-- 3. Create button_clicks table for tracking
-- =====================================================

CREATE TABLE IF NOT EXISTS button_clicks (
    click_id VARCHAR(50) PRIMARY KEY,
    
    -- Template context
    template_id VARCHAR(50) NOT NULL REFERENCES templates(template_id) ON DELETE CASCADE,
    template_send_id VARCHAR(50) REFERENCES template_sends(send_id) ON DELETE SET NULL,
    
    -- Button identification
    button_id VARCHAR(100) NOT NULL,          -- e.g., "pricing_btn", "track_order_btn"
    button_text VARCHAR(100) NOT NULL,        -- Display text: "View Pricing"
    button_index INTEGER,                     -- Button position (0, 1, 2...)
    button_payload TEXT,                      -- Full payload from WhatsApp
    
    -- Lead tracking
    customer_phone VARCHAR(50) NOT NULL,
    contact_id VARCHAR(50) REFERENCES contacts(contact_id) ON DELETE SET NULL,
    conversation_id VARCHAR(50) REFERENCES conversations(conversation_id) ON DELETE SET NULL,
    
    -- Account context
    waba_id VARCHAR(100),
    phone_number_id VARCHAR(50) REFERENCES phone_numbers(id) ON DELETE SET NULL,
    user_id VARCHAR(50) REFERENCES users(user_id) ON DELETE CASCADE,
    
    -- WhatsApp message context
    message_id VARCHAR(100),                  -- WhatsApp message ID that contained the button
    original_message_id VARCHAR(100),         -- ID of original template message sent
    
    -- Timestamps
    clicked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for button_clicks analytics
CREATE INDEX IF NOT EXISTS idx_button_clicks_template_id ON button_clicks(template_id);
CREATE INDEX IF NOT EXISTS idx_button_clicks_customer_phone ON button_clicks(customer_phone);
CREATE INDEX IF NOT EXISTS idx_button_clicks_button_id ON button_clicks(template_id, button_id);
CREATE INDEX IF NOT EXISTS idx_button_clicks_clicked_at ON button_clicks(clicked_at);
CREATE INDEX IF NOT EXISTS idx_button_clicks_user_id ON button_clicks(user_id);
CREATE INDEX IF NOT EXISTS idx_button_clicks_phone_number_id ON button_clicks(phone_number_id);
CREATE INDEX IF NOT EXISTS idx_button_clicks_contact_id ON button_clicks(contact_id) WHERE contact_id IS NOT NULL;

-- Composite index for lead-specific queries
CREATE INDEX IF NOT EXISTS idx_button_clicks_lead_template 
ON button_clicks(customer_phone, template_id, clicked_at DESC);

-- =====================================================
-- 4. Add tracking fields to template_sends
-- =====================================================

-- Add original_message_id to link button clicks back to the sent message
ALTER TABLE template_sends ADD COLUMN IF NOT EXISTS original_context JSONB DEFAULT '{}';

-- =====================================================
-- 5. Create template_buttons table for button definitions
-- =====================================================

CREATE TABLE IF NOT EXISTS template_buttons (
    button_id VARCHAR(50) PRIMARY KEY,
    template_id VARCHAR(50) NOT NULL REFERENCES templates(template_id) ON DELETE CASCADE,
    
    -- Button definition
    button_type VARCHAR(20) NOT NULL CHECK (button_type IN ('QUICK_REPLY', 'URL', 'PHONE_NUMBER', 'COPY_CODE')),
    button_text VARCHAR(100) NOT NULL,
    button_index INTEGER NOT NULL,            -- Position in button array (0, 1, 2...)
    
    -- Type-specific fields
    button_url TEXT,                          -- For URL buttons
    button_url_suffix_variable INTEGER,       -- Position of variable for dynamic URL suffix
    button_phone VARCHAR(30),                 -- For PHONE_NUMBER buttons
    copy_code_example VARCHAR(15),            -- For COPY_CODE buttons
    
    -- Tracking identifier for QUICK_REPLY buttons
    tracking_id VARCHAR(100),                 -- Custom ID for tracking (e.g., "pricing_cta")
    
    -- Analytics
    total_clicks INTEGER DEFAULT 0,
    unique_clicks INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for template_buttons
CREATE INDEX IF NOT EXISTS idx_template_buttons_template_id ON template_buttons(template_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_template_buttons_unique_index 
ON template_buttons(template_id, button_index);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_template_buttons_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS template_buttons_updated_at ON template_buttons;
CREATE TRIGGER template_buttons_updated_at
    BEFORE UPDATE ON template_buttons
    FOR EACH ROW
    EXECUTE FUNCTION update_template_buttons_updated_at();

-- =====================================================
-- 6. Update phone_numbers to ensure waba_id is present
-- =====================================================

-- waba_id should already exist from migration 014, but ensure it's there
ALTER TABLE phone_numbers ADD COLUMN IF NOT EXISTS waba_id VARCHAR(100);

COMMENT ON TABLE button_clicks IS 'Tracks Quick Reply button clicks from WhatsApp templates for lead engagement analytics';
COMMENT ON TABLE template_buttons IS 'Defines buttons for WhatsApp templates with tracking configuration';
COMMENT ON COLUMN templates.header_type IS 'Type of header: NONE, TEXT, IMAGE, VIDEO, DOCUMENT, LOCATION';
COMMENT ON COLUMN templates.header_media_url IS 'Public URL for IMAGE, VIDEO, or DOCUMENT header media';
COMMENT ON COLUMN button_clicks.button_id IS 'Identifier for the button, used for grouping clicks';
COMMENT ON COLUMN button_clicks.customer_phone IS 'Phone number of lead who clicked the button';
