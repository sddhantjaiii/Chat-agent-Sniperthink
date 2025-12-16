-- Migration: Backfill template_buttons from existing templates
-- Created: 2024-12-17
-- Description: Populate template_buttons table from existing templates that have buttons in components JSONB

-- This migration extracts buttons from templates.components and inserts them into template_buttons
-- Only processes templates that don't already have entries in template_buttons

DO $$
DECLARE
    template_rec RECORD;
    button_rec RECORD;
    btn_index INTEGER;
    btn_type TEXT;
    btn_text TEXT;
    btn_url TEXT;
    btn_phone TEXT;
    new_button_id UUID;
BEGIN
    -- Loop through templates that have buttons in components but no entries in template_buttons
    FOR template_rec IN 
        SELECT t.template_id, t.components
        FROM templates t
        LEFT JOIN template_buttons tb ON tb.template_id = t.template_id
        WHERE tb.template_id IS NULL
          AND t.components IS NOT NULL
          AND (
              t.components->'buttons'->'buttons' IS NOT NULL
              OR t.components->'buttons' IS NOT NULL
          )
    LOOP
        -- Reset button index for each template
        btn_index := 0;
        
        -- Try to get buttons from components.buttons.buttons (our standard format)
        FOR button_rec IN 
            SELECT * FROM jsonb_array_elements(
                COALESCE(
                    template_rec.components->'buttons'->'buttons',
                    template_rec.components->'buttons'
                )
            )
        LOOP
            -- Extract button properties
            btn_type := button_rec.value->>'type';
            btn_text := button_rec.value->>'text';
            btn_url := button_rec.value->>'url';
            btn_phone := button_rec.value->>'phone_number';
            
            -- Skip if no type
            IF btn_type IS NULL THEN
                CONTINUE;
            END IF;
            
            -- Generate new UUID for button
            new_button_id := gen_random_uuid();
            
            -- Insert button definition
            INSERT INTO template_buttons (
                button_id,
                template_id,
                button_type,
                button_text,
                button_index,
                button_url,
                button_phone,
                tracking_id,
                created_at,
                updated_at
            ) VALUES (
                new_button_id::text,
                template_rec.template_id,
                btn_type,
                COALESCE(btn_text, ''),
                btn_index,
                btn_url,
                btn_phone,
                LOWER(btn_type) || '_' || btn_index,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            );
            
            btn_index := btn_index + 1;
        END LOOP;
        
        RAISE NOTICE 'Processed template % with % buttons', template_rec.template_id, btn_index;
    END LOOP;
END $$;

-- Report results
SELECT 
    'Migration complete' as status,
    (SELECT COUNT(DISTINCT template_id) FROM template_buttons) as templates_with_buttons,
    (SELECT COUNT(*) FROM template_buttons) as total_buttons;
