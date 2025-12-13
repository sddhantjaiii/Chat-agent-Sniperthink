-- Migration: Update template variables for client-side dynamic mapping
-- Description: Makes extraction_field optional, adds description field for dashboard UI
-- This supports the client-side variable mapping approach where dashboard resolves values

-- Add description field for better UI presentation
ALTER TABLE template_variables 
ADD COLUMN IF NOT EXISTS description TEXT;

-- Add is_required field to indicate if variable must be provided
ALTER TABLE template_variables 
ADD COLUMN IF NOT EXISTS is_required BOOLEAN DEFAULT false;

-- Add placeholder text for UI input fields
ALTER TABLE template_variables 
ADD COLUMN IF NOT EXISTS placeholder VARCHAR(255);

-- Update comment to clarify extraction_field is optional
COMMENT ON COLUMN template_variables.extraction_field IS 
'Optional: Source field from extractions for server-side auto-fill. NULL means dashboard will provide resolved values at send time.';

COMMENT ON COLUMN template_variables.description IS 
'Human-readable description of what this variable is for, shown in dashboard UI';

COMMENT ON COLUMN template_variables.is_required IS 
'Whether this variable must have a value (either from dashboard or default)';

COMMENT ON COLUMN template_variables.placeholder IS 
'Placeholder text shown in input field when dashboard needs manual entry';

-- Add index for querying variables by position
CREATE INDEX IF NOT EXISTS idx_template_variables_position 
ON template_variables(template_id, position);
