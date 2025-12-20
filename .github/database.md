# Database Schema Reference

PostgreSQL database with multi-tenant isolation via `user_id`. Run `npm run migrate` to apply changes.

---

## Tables Overview

| Table | Purpose |
|-------|---------|
| `users` | Primary tenant table for multi-tenant isolation |
| `phone_numbers` | WhatsApp/Instagram/Webchat channel configurations |
| `agents` | AI agent configurations linked to phone numbers |
| `conversations` | Conversation lifecycle with OpenAI tracking |
| `messages` | Message storage with sequence ordering |
| `extractions` | Lead scoring and contact extraction data |
| `credits` | User credit balance tracking |
| `google_calendar_tokens` | Google OAuth tokens for calendar integration |
| `meetings` | Booked meetings via Google Calendar |
| `message_delivery_status` | Message delivery lifecycle (sent/delivered/read) |
| `conversation_archives` | Archive tracking when agents are relinked |
| `contacts` | Contact management with auto-sync from extractions |
| `templates` | WhatsApp message templates with Meta approval tracking |
| `template_variables` | Variable mappings for templates with auto-fill support |
| `template_sends` | Individual template message send tracking |
| `campaigns` | Bulk messaging campaigns with scheduling |
| `campaign_triggers` | Campaign automation triggers (immediate/scheduled/event) |
| `campaign_recipients` | Individual recipient tracking within campaigns |

---

## Table Definitions

### `users`
Primary tenant table.

| Column | Type | Constraints |
|--------|------|-------------|
| `user_id` | VARCHAR(50) | PRIMARY KEY |
| `email` | VARCHAR(255) | UNIQUE NOT NULL |
| `company_name` | VARCHAR(255) | |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

---

### `phone_numbers`
Channel configurations for WhatsApp, Instagram, and Webchat.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | VARCHAR(50) | PRIMARY KEY |
| `user_id` | VARCHAR(50) | FK → users, NOT NULL |
| `platform` | VARCHAR(20) | CHECK IN ('whatsapp', 'instagram', 'webchat') |
| `meta_phone_number_id` | VARCHAR(100) | NOT NULL (WABA ID or Instagram Account ID) |
| `access_token` | TEXT | NOT NULL |
| `display_name` | VARCHAR(255) | |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

**Unique**: `(user_id, meta_phone_number_id, platform)`

---

### `agents`
AI agent configurations. One agent per phone number.

| Column | Type | Constraints |
|--------|------|-------------|
| `agent_id` | VARCHAR(50) | PRIMARY KEY |
| `user_id` | VARCHAR(50) | FK → users, NOT NULL |
| `phone_number_id` | VARCHAR(50) | FK → phone_numbers, NOT NULL, UNIQUE |
| `prompt_id` | VARCHAR(100) | NOT NULL |
| `name` | VARCHAR(255) | NOT NULL |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

---

### `conversations`
Conversation lifecycle with OpenAI context tracking.

| Column | Type | Constraints |
|--------|------|-------------|
| `conversation_id` | VARCHAR(50) | PRIMARY KEY |
| `agent_id` | VARCHAR(50) | FK → agents, NOT NULL |
| `customer_phone` | VARCHAR(50) | NOT NULL |
| `openai_conversation_id` | VARCHAR(100) | OpenAI Responses API ID |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |
| `last_message_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |
| `last_extraction_at` | TIMESTAMP | NULL |
| `is_active` | BOOLEAN | DEFAULT true |

**Unique**: `(agent_id, customer_phone, is_active)`

---

### `messages`
Message storage with sequence ordering.

| Column | Type | Constraints |
|--------|------|-------------|
| `message_id` | VARCHAR(100) | PRIMARY KEY |
| `conversation_id` | VARCHAR(50) | FK → conversations, NOT NULL |
| `sender` | VARCHAR(20) | CHECK IN ('user', 'agent') |
| `text` | TEXT | NOT NULL |
| `timestamp` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |
| `status` | VARCHAR(20) | CHECK IN ('sent', 'failed', 'pending') |
| `sequence_no` | INTEGER | NOT NULL |
| `platform_message_id` | VARCHAR(100) | External platform ID |

**Unique**: `(conversation_id, sequence_no)`

---

### `extractions`
Lead scoring with history tracking. Supports multiple extractions per conversation.

| Column | Type | Constraints |
|--------|------|-------------|
| `extraction_id` | UUID | PRIMARY KEY DEFAULT gen_random_uuid() |
| `conversation_id` | VARCHAR(50) | FK → conversations, NOT NULL |
| `user_id` | VARCHAR(50) | FK → users, NOT NULL |
| `customer_phone` | VARCHAR(50) | NOT NULL |
| `extracted_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |
| `is_latest` | BOOLEAN | DEFAULT true |
| `message_count_at_extraction` | INTEGER | DEFAULT 0 |
| `name` | VARCHAR(255) | Contact name |
| `email` | VARCHAR(255) | Contact email |
| `company` | VARCHAR(255) | Company name |
| `intent_level` | VARCHAR(20) | CHECK IN ('Low', 'Medium', 'High') |
| `intent_score` | INTEGER | CHECK 1-3 |
| `urgency_level` | VARCHAR(20) | CHECK IN ('Low', 'Medium', 'High') |
| `urgency_score` | INTEGER | CHECK 1-3 |
| `budget_constraint` | VARCHAR(20) | CHECK IN ('Yes', 'No', 'Maybe') |
| `budget_score` | INTEGER | CHECK 1-3 |
| `fit_alignment` | VARCHAR(20) | CHECK IN ('Low', 'Medium', 'High') |
| `fit_score` | INTEGER | CHECK 1-3 |
| `engagement_health` | VARCHAR(20) | CHECK IN ('Low', 'Medium', 'High') |
| `engagement_score` | INTEGER | CHECK 1-3 |
| `total_score` | INTEGER | Sum of all scores (5-15) |
| `lead_status_tag` | VARCHAR(20) | CHECK IN ('Hot', 'Warm', 'Cold') |
| `demo_book_datetime` | TIMESTAMP | |
| `reasoning` | JSONB | `{ intent, urgency, budget, fit, engagement, cta_behavior }` |
| `smart_notification` | TEXT | 4-5 word summary |
| `requirements` | TEXT | Key requirements from conversation |
| `custom_cta` | TEXT | Comma-separated custom CTAs |
| `in_detail_summary` | TEXT | Detailed summary of conversation |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

---

### `credits`
User credit balance tracking.

| Column | Type | Constraints |
|--------|------|-------------|
| `user_id` | VARCHAR(50) | PRIMARY KEY, FK → users |
| `remaining_credits` | INTEGER | DEFAULT 0, CHECK >= 0 |
| `total_used` | INTEGER | DEFAULT 0, CHECK >= 0 |
| `last_updated` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

---

### `google_calendar_tokens`
Google OAuth tokens for meeting booking.

| Column | Type | Constraints |
|--------|------|-------------|
| `user_id` | VARCHAR(50) | PRIMARY KEY, FK → users |
| `access_token` | TEXT | NOT NULL |
| `refresh_token` | TEXT | NOT NULL |
| `token_expiry` | TIMESTAMP | NOT NULL |
| `scope` | TEXT | NOT NULL |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

---

### `meetings`
Booked meetings via Google Calendar.

| Column | Type | Constraints |
|--------|------|-------------|
| `meeting_id` | VARCHAR(50) | PRIMARY KEY |
| `user_id` | VARCHAR(50) | FK → users, NOT NULL |
| `conversation_id` | VARCHAR(50) | FK → conversations, NOT NULL |
| `google_event_id` | VARCHAR(255) | NOT NULL |
| `title` | VARCHAR(255) | NOT NULL |
| `customer_name` | VARCHAR(255) | |
| `customer_email` | VARCHAR(255) | |
| `participants` | TEXT[] | Array of emails |
| `meeting_time` | TIMESTAMP | NOT NULL |
| `duration_minutes` | INTEGER | DEFAULT 30 |
| `timezone` | VARCHAR(100) | |
| `meet_link` | TEXT | Google Meet URL |
| `status` | VARCHAR(20) | CHECK IN ('scheduled', 'cancelled', 'completed') |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

---

### `message_delivery_status`
Message delivery lifecycle tracking.

| Column | Type | Constraints |
|--------|------|-------------|
| `message_id` | VARCHAR(100) | PRIMARY KEY, FK → messages |
| `platform_message_id` | VARCHAR(100) | |
| `status` | VARCHAR(20) | CHECK IN ('pending', 'sent', 'delivered', 'read', 'failed') |
| `error_message` | TEXT | |
| `updated_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

---

### `conversation_archives`
Archive tracking when agents are relinked.

| Column | Type | Constraints |
|--------|------|-------------|
| `archive_id` | VARCHAR(50) | PRIMARY KEY |
| `old_agent_id` | VARCHAR(50) | NOT NULL |
| `new_agent_id` | VARCHAR(50) | FK → agents, NOT NULL |
| `phone_number_id` | VARCHAR(50) | FK → phone_numbers, NOT NULL |
| `archived_conversations_count` | INTEGER | DEFAULT 0 |
| `archived_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |
| `reason` | VARCHAR(255) | DEFAULT 'Agent relinked' |

---

### `contacts`
Contact management with auto-sync from extractions and E.164 phone format.

| Column | Type | Constraints |
|--------|------|-------------|
| `contact_id` | VARCHAR(50) | PRIMARY KEY |
| `user_id` | VARCHAR(50) | FK → users, NOT NULL |
| `phone` | VARCHAR(20) | NOT NULL (E.164 format: +14155551234) |
| `name` | VARCHAR(255) | |
| `email` | VARCHAR(255) | |
| `company` | VARCHAR(255) | |
| `tags` | TEXT[] | DEFAULT '{}' (array for segmentation) |
| `source` | VARCHAR(20) | NOT NULL, DEFAULT 'MANUAL', CHECK IN ('EXTRACTION', 'IMPORT', 'MANUAL') |
| `extraction_id` | UUID | FK → extractions, NULL |
| `conversation_id` | VARCHAR(50) | FK → conversations, NULL |
| `is_active` | BOOLEAN | DEFAULT true |
| `opted_out` | BOOLEAN | DEFAULT false |
| `opted_out_at` | TIMESTAMP | |
| `last_contacted_at` | TIMESTAMP | |
| `total_messages_sent` | INTEGER | DEFAULT 0 |
| `total_messages_received` | INTEGER | DEFAULT 0 |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

**Unique**: `(user_id, phone)`

---

### `templates`
WhatsApp message templates with Meta approval tracking and media header support.

| Column | Type | Constraints |
|--------|------|-------------|
| `template_id` | VARCHAR(50) | PRIMARY KEY |
| `user_id` | VARCHAR(50) | FK → users, NOT NULL |
| `phone_number_id` | VARCHAR(50) | FK → phone_numbers, NOT NULL |
| `name` | VARCHAR(512) | NOT NULL |
| `category` | VARCHAR(20) | NOT NULL, CHECK IN ('MARKETING', 'UTILITY', 'AUTHENTICATION') |
| `status` | VARCHAR(20) | NOT NULL, DEFAULT 'DRAFT', CHECK IN ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED') |
| `language` | VARCHAR(10) | NOT NULL, DEFAULT 'en' |
| `components` | JSONB | NOT NULL, DEFAULT '{}' |
| `header_type` | VARCHAR(20) | DEFAULT 'NONE', CHECK IN ('NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'LOCATION') |
| `header_media_url` | TEXT | Public URL for IMAGE/VIDEO/DOCUMENT headers |
| `header_document_filename` | VARCHAR(255) | Filename for DOCUMENT headers |
| `header_location_latitude` | DECIMAL(10,8) | For LOCATION headers |
| `header_location_longitude` | DECIMAL(11,8) | For LOCATION headers |
| `header_location_name` | VARCHAR(255) | Location name for LOCATION headers |
| `header_location_address` | TEXT | Location address for LOCATION headers |
| `waba_id` | VARCHAR(100) | WhatsApp Business Account ID |
| `meta_template_id` | VARCHAR(100) | Meta's template ID after submission |
| `rejection_reason` | TEXT | |
| `submitted_at` | TIMESTAMP | |
| `approved_at` | TIMESTAMP | |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

**Unique**: `(phone_number_id, name)`

**Components structure**: `{ header?: {...}, body: {...}, footer?: {...}, buttons?: [...] }`

**Header Types**:
- `TEXT`: Text header with variables (max 60 chars)
- `IMAGE`: Image header (JPG, PNG - 5MB max, Meta uploads)
- `VIDEO`: Video header (MP4 - 16MB max)
- `DOCUMENT`: Document header (PDF - 100MB max)
- `LOCATION`: Location header (sent at runtime with lat/long)

---

### `template_variables`
Maps custom variable names to WhatsApp positional variables with auto-fill support.

| Column | Type | Constraints |
|--------|------|-------------|
| `variable_id` | VARCHAR(50) | PRIMARY KEY |
| `template_id` | VARCHAR(50) | FK → templates, NOT NULL |
| `variable_name` | VARCHAR(100) | NOT NULL |
| `position` | INTEGER | NOT NULL, CHECK 1-10 (maps to {{1}}-{{10}}) |
| `component_type` | VARCHAR(20) | NOT NULL, DEFAULT 'BODY', CHECK IN ('HEADER', 'BODY', 'BUTTON') |
| `dashboard_mapping` | VARCHAR(50) | Dashboard's variable identifier (e.g., "name", "meetingLink"). Server stores but doesn't use - dashboard provides resolved values |
| `default_value` | VARCHAR(255) | |
| `sample_value` | VARCHAR(255) | |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

**Unique**: `(template_id, position)` and `(template_id, variable_name)`

---

### `template_sends`
Tracks individual template message sends with delivery status.

| Column | Type | Constraints |
|--------|------|-------------|
| `send_id` | VARCHAR(50) | PRIMARY KEY |
| `template_id` | VARCHAR(50) | FK → templates, NOT NULL |
| `conversation_id` | VARCHAR(50) | FK → conversations, NULL |
| `campaign_id` | VARCHAR(50) | |
| `customer_phone` | VARCHAR(50) | NOT NULL |
| `variable_values` | JSONB | DEFAULT '{}' (maps position to value) |
| `status` | VARCHAR(20) | NOT NULL, DEFAULT 'PENDING', CHECK IN ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED') |
| `platform_message_id` | VARCHAR(100) | Meta's message ID after sending |
| `error_code` | VARCHAR(50) | |
| `error_message` | TEXT | |
| `sent_at` | TIMESTAMP | |
| `delivered_at` | TIMESTAMP | |
| `read_at` | TIMESTAMP | |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

**Variable values structure**: `{ "1": "John", "2": "Acme Corp" }`

---

### `template_buttons`
Defines buttons for WhatsApp templates with tracking configuration.

| Column | Type | Constraints |
|--------|------|-------------|
| `button_id` | VARCHAR(50) | PRIMARY KEY |
| `template_id` | VARCHAR(50) | FK → templates, NOT NULL |
| `button_type` | VARCHAR(20) | NOT NULL, CHECK IN ('QUICK_REPLY', 'URL', 'PHONE_NUMBER', 'COPY_CODE') |
| `button_text` | VARCHAR(100) | NOT NULL |
| `button_index` | INTEGER | NOT NULL (0, 1, 2...) |
| `button_url` | TEXT | For URL buttons |
| `button_url_suffix_variable` | INTEGER | Position of variable for dynamic URL suffix |
| `button_phone` | VARCHAR(30) | For PHONE_NUMBER buttons |
| `copy_code_example` | VARCHAR(15) | For COPY_CODE buttons |
| `tracking_id` | VARCHAR(100) | Custom ID for tracking (e.g., "pricing_cta") |
| `total_clicks` | INTEGER | DEFAULT 0 |
| `unique_clicks` | INTEGER | DEFAULT 0 |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

**Unique**: `(template_id, button_index)`

---

### `button_clicks`
Tracks Quick Reply button clicks from WhatsApp templates for lead engagement analytics.

| Column | Type | Constraints |
|--------|------|-------------|
| `click_id` | VARCHAR(50) | PRIMARY KEY |
| `template_id` | VARCHAR(50) | FK → templates, NOT NULL |
| `template_send_id` | VARCHAR(50) | FK → template_sends, NULL |
| `button_id` | VARCHAR(100) | NOT NULL (e.g., "pricing_btn") |
| `button_text` | VARCHAR(100) | NOT NULL (display text) |
| `button_index` | INTEGER | Button position |
| `button_payload` | TEXT | Full payload from WhatsApp |
| `customer_phone` | VARCHAR(50) | NOT NULL |
| `contact_id` | VARCHAR(50) | FK → contacts, NULL |
| `conversation_id` | VARCHAR(50) | FK → conversations, NULL |
| `waba_id` | VARCHAR(100) | |
| `phone_number_id` | VARCHAR(50) | FK → phone_numbers, NULL |
| `user_id` | VARCHAR(50) | FK → users, NOT NULL |
| `message_id` | VARCHAR(100) | WhatsApp message ID containing button |
| `original_message_id` | VARCHAR(100) | ID of original template message sent |
| `clicked_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

**Indexes**: `template_id`, `customer_phone`, `(template_id, button_id)`, `clicked_at`, `user_id`

---

### `campaigns`
Bulk messaging campaigns with scheduling and event triggers.

| Column | Type | Constraints |
|--------|------|-------------|
| `campaign_id` | VARCHAR(50) | PRIMARY KEY |
| `user_id` | VARCHAR(50) | FK → users, NOT NULL |
| `template_id` | VARCHAR(50) | FK → templates, NOT NULL |
| `phone_number_id` | VARCHAR(50) | FK → phone_numbers, NOT NULL |
| `name` | VARCHAR(255) | NOT NULL |
| `description` | TEXT | |
| `status` | VARCHAR(20) | NOT NULL, DEFAULT 'DRAFT', CHECK IN ('DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED') |
| `recipient_filter` | JSONB | DEFAULT '{}' |
| `total_recipients` | INTEGER | DEFAULT 0 |
| `sent_count` | INTEGER | DEFAULT 0 |
| `delivered_count` | INTEGER | DEFAULT 0 |
| `read_count` | INTEGER | DEFAULT 0 |
| `failed_count` | INTEGER | DEFAULT 0 |
| `started_at` | TIMESTAMP | |
| `completed_at` | TIMESTAMP | |
| `paused_at` | TIMESTAMP | |
| `last_error` | TEXT | |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

**Recipient filter structure**: `{ tags?: string[], excludeTags?: string[], contactIds?: string[] }`

---

### `campaign_triggers`
Defines campaign execution triggers (immediate, scheduled, or event-based).

| Column | Type | Constraints |
|--------|------|-------------|
| `trigger_id` | VARCHAR(50) | PRIMARY KEY |
| `campaign_id` | VARCHAR(50) | FK → campaigns, NOT NULL |
| `trigger_type` | VARCHAR(20) | NOT NULL, CHECK IN ('IMMEDIATE', 'SCHEDULED', 'EVENT') |
| `scheduled_at` | TIMESTAMP | For SCHEDULED triggers |
| `event_type` | VARCHAR(30) | CHECK IN ('NEW_EXTRACTION', 'LEAD_HOT', 'LEAD_WARM', 'TAG_ADDED', 'CONVERSATION_ENDED') |
| `event_config` | JSONB | DEFAULT '{}' |
| `is_active` | BOOLEAN | DEFAULT true |
| `last_triggered_at` | TIMESTAMP | |
| `trigger_count` | INTEGER | DEFAULT 0 |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

**Event config examples**: `{ "tag": "vip" }` or `{ "inactiveMinutes": 60 }`

---

### `campaign_recipients`
Tracks individual recipient status within campaigns.

| Column | Type | Constraints |
|--------|------|-------------|
| `recipient_id` | VARCHAR(50) | PRIMARY KEY |
| `campaign_id` | VARCHAR(50) | FK → campaigns, NOT NULL |
| `contact_id` | VARCHAR(50) | FK → contacts, NOT NULL |
| `template_send_id` | VARCHAR(50) | FK → template_sends, NULL |
| `status` | VARCHAR(20) | NOT NULL, DEFAULT 'PENDING', CHECK IN ('PENDING', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED') |
| `skip_reason` | VARCHAR(50) | CHECK IN ('OPTED_OUT', 'RATE_LIMITED', 'INVALID_PHONE', 'DUPLICATE', 'RECENTLY_CONTACTED') |
| `error_message` | TEXT | |
| `variable_values` | JSONB | DEFAULT '{}' (Per-recipient template variables: `{ "1": "value1", "2": "value2" }`) |
| `queued_at` | TIMESTAMP | |
| `sent_at` | TIMESTAMP | |
| `delivered_at` | TIMESTAMP | |
| `read_at` | TIMESTAMP | |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

**Unique**: `(campaign_id, contact_id)`

---

## Triggers

### `update_updated_at_column()`
Auto-updates `updated_at` on row modification.

**Applied to**: `users`, `phone_numbers`, `agents`, `google_calendar_tokens`, `meetings`, `contacts`, `templates`, `template_variables`, `template_sends`, `campaigns`, `campaign_triggers`, `campaign_recipients`

```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';
```

---

## Key Relationships

```
users (1) ─────┬───── (*) phone_numbers ─────┬───── (*) templates ──────┬───── (*) template_variables
              │                              │                          │
              │                              │                          ├───── (*) template_sends
              │                              │                          │
              │                              └───── (*) campaigns ──────┬───── (*) campaign_triggers
              │                                                         │
              │                                                         └───── (*) campaign_recipients ───→ (1) contacts
              │
              ├───── (*) agents ──────── (*) conversations ──────── (*) messages
              │                                    │
              ├───── (1) credits                   ├───── (*) extractions ───→ (1) contacts
              │                                    │
              ├───── (1) google_calendar_tokens    └───── (*) meetings
              │
              └───── (*) contacts
```
