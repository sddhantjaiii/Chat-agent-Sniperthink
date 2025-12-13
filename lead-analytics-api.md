# Lead Analytics API Documentation

**Version:** 1.0.0  
**Base URL:** `http://localhost:3000`

This document provides comprehensive documentation for the Lead Analytics system, including how lead data is extracted, stored, and retrieved via API endpoints.

---

## Table of Contents

1. [Overview](#overview)
2. [Key Concepts](#key-concepts)
   - [What is an Extraction?](#what-is-an-extraction)
   - [Understanding `is_latest`](#understanding-is_latest)
   - [Successive Extractions (History Mode)](#successive-extractions-history-mode)
   - [Phone Number ID Terminology](#phone-number-id-terminology)
3. [Lead Scoring System](#lead-scoring-system)
   - [Score Components](#score-components)
   - [Lead Classification](#lead-classification)
4. [Extraction Fields Reference](#extraction-fields-reference)
5. [API Endpoints](#api-endpoints)
   - [Get All Extractions](#1-get-all-extractions)
   - [Get Extraction Statistics](#2-get-extraction-statistics)
   - [Get Single Extraction](#3-get-single-extraction)
   - [Get Conversation Extraction](#4-get-conversation-extraction)
   - [Trigger Manual Extraction](#5-trigger-manual-extraction)
   - [Export Extractions](#6-export-extractions)
6. [Supporting APIs](#supporting-apis)
7. [Extraction Trigger Logic](#extraction-trigger-logic)
8. [Integration Examples](#integration-examples)

---

## Overview

The Lead Analytics system automatically extracts and scores lead information from customer conversations across WhatsApp, Instagram, and Webchat. It uses OpenAI to analyze conversation content and extract:

- **Contact Information**: Name, email, company
- **Lead Scores**: Intent, urgency, budget, fit, engagement (1-3 scale each)
- **CTA Tracking**: Which calls-to-action the customer engaged with
- **Lead Classification**: Hot, Warm, or Cold based on total score

### Architecture Flow

```
Customer Message → AI Agent Response → Conversation Stored
                                              ↓
                         [After inactivity threshold]
                                              ↓
                    Extraction Worker polls for candidates
                                              ↓
                    OpenAI analyzes full conversation
                                              ↓
                    New Extraction Snapshot Created
                                              ↓
                    Contact synced + Event emitted
```

---

## Key Concepts

### What is an Extraction?

An **extraction** is a snapshot of lead information extracted from a conversation at a specific point in time. Each extraction contains:

- Contact details (name, email, company) - extracted from conversation
- 5 lead scores (intent, urgency, budget, fit, engagement)
- CTA tracking (which buttons/links were clicked)
- Overall classification (Hot/Warm/Cold)
- Metadata (when extracted, message count at time of extraction)

### Understanding `is_latest`

The `is_latest` field is a boolean flag that indicates whether an extraction is the **most recent snapshot** for a conversation.

| `is_latest` | Meaning |
|-------------|---------|
| `true` | This is the current/most recent extraction for the conversation |
| `false` | This is a historical extraction (superseded by a newer one) |

**Important**: Only ONE extraction per conversation can have `is_latest = true` at any time.

When querying extractions:
- Use `latest_only=true` to get only current lead data (one per conversation)
- Omit or set `latest_only=false` to get full extraction history

### Successive Extractions (History Mode)

The system operates in **History Mode**, meaning each extraction creates a NEW record rather than updating an existing one. This provides a complete audit trail of how lead scores evolved over time.

**How Successive Extraction Works:**

1. **First Extraction**: When a conversation becomes inactive and meets extraction criteria:
   - OpenAI analyzes all messages
   - Creates extraction record with `is_latest = true`
   - Records `message_count_at_extraction` (e.g., 5 messages)

2. **Conversation Continues**: Customer sends more messages, agent responds

3. **Second Extraction**: After next inactivity period:
   - Previous extraction is marked `is_latest = false`
   - OpenAI analyzes ALL messages (including new ones)
   - Creates NEW extraction record with `is_latest = true`
   - Records new `message_count_at_extraction` (e.g., 12 messages)

4. **Result**: Both extractions are preserved:
   ```
   Extraction 1: is_latest=false, message_count=5,  total_score=8  (Warm)
   Extraction 2: is_latest=true,  message_count=12, total_score=13 (Hot)
   ```

**Use Cases for History:**
- Track how lead qualification improved/degraded over time
- Audit trail for sales team
- Analyze conversation effectiveness
- Debug AI extraction accuracy

### Phone Number ID Terminology

In our system, `phone_number_id` refers to the internal identifier for a communication channel. This identifier is used consistently regardless of platform:

| Platform | What `phone_number_id` Represents |
|----------|-----------------------------------|
| **WhatsApp** | WhatsApp Business phone number configuration |
| **Instagram** | Instagram Business Account configuration |
| **Webchat** | Webchat widget configuration |

**Important**: For Instagram integrations, the field is still called `phone_number_id` but it represents the Instagram Account ID internally stored as `meta_phone_number_id`.

When filtering by channel:
```
?phone_number_id=pn_abc123  // Works for WhatsApp, Instagram, or Webchat
```

---

## Lead Scoring System

### Score Components

The system extracts 5 independent scores from conversations. Each score ranges from **1 to 3**:

| Score | Field | Level Field | Meaning |
|-------|-------|-------------|---------|
| **Intent Score** | `intent_score` | `intent_level` | How strong is the purchase/action intent? |
| **Urgency Score** | `urgency_score` | `urgency_level` | How time-sensitive is the need? |
| **Budget Score** | `budget_score` | `budget_constraint` | Does budget exist/is it available? |
| **Fit Score** | `fit_score` | `fit_alignment` | How well does product/service match needs? |
| **Engagement Score** | `engagement_score` | `engagement_health` | How engaged is the lead in conversation? |

**Score Values:**

| Numeric Score | Level Text | Meaning |
|---------------|------------|---------|
| 1 | Low | Minimal indicator |
| 2 | Medium | Moderate indicator |
| 3 | High | Strong indicator |

**Budget Constraint Special Values:**

| Value | `budget_score` |
|-------|----------------|
| "Yes" (has budget) | 3 |
| "Maybe" (uncertain) | 2 |
| "No" (no budget) | 1 |

### Lead Classification

The `total_score` is the sum of all 5 component scores (range: 5-15).

The `lead_status_tag` is determined by the AI based on overall conversation analysis:

| Classification | Typical Score Range | Description |
|----------------|---------------------|-------------|
| **Hot** 🔥 | 12-15 | High-priority lead, ready to convert |
| **Warm** 🌡️ | 8-11 | Medium-priority, needs nurturing |
| **Cold** ❄️ | 5-7 | Low-priority, early-stage or poor fit |

**Note**: The `lead_status_tag` is determined by AI, not calculated automatically from `total_score`. The AI considers the full conversation context, not just numeric scores.

---

## Extraction Fields Reference

### Contact Information Fields

| Field | Type | Description | Source |
|-------|------|-------------|--------|
| `name` | string | Customer's name | Extracted from conversation |
| `email` | string | Email address | Extracted from conversation |
| `company` | string | Company name | Extracted from conversation |
| `customer_phone` | string | Phone number (E.164) | From incoming message |

### Lead Scoring Fields

| Field | Type | Values | Description |
|-------|------|--------|-------------|
| `intent_level` | string | Low, Medium, High | Purchase intent level |
| `intent_score` | integer | 1-3 | Numeric intent score |
| `urgency_level` | string | Low, Medium, High | Time sensitivity level |
| `urgency_score` | integer | 1-3 | Numeric urgency score |
| `budget_constraint` | string | Yes, No, Maybe | Budget availability |
| `budget_score` | integer | 1-3 | Numeric budget score |
| `fit_alignment` | string | Low, Medium, High | Product fit level |
| `fit_score` | integer | 1-3 | Numeric fit score |
| `engagement_health` | string | Low, Medium, High | Engagement level |
| `engagement_score` | integer | 1-3 | Numeric engagement score |
| `total_score` | integer | 5-15 | Sum of all 5 scores |
| `lead_status_tag` | string | Hot, Warm, Cold | AI-determined classification |

### CTA Tracking Fields

| Field | Type | Values | Description |
|-------|------|--------|-------------|
| `cta_pricing_clicked` | string | Yes, No | Clicked pricing link/button |
| `cta_demo_clicked` | string | Yes, No | Requested demo |
| `cta_followup_clicked` | string | Yes, No | Requested follow-up |
| `cta_sample_clicked` | string | Yes, No | Requested sample |
| `cta_website_clicked` | string | Yes, No | Clicked website link |
| `cta_escalated_to_human` | string | Yes, No | Requested human agent |

### Metadata Fields

| Field | Type | Description |
|-------|------|-------------|
| `extraction_id` | UUID | Unique extraction identifier |
| `conversation_id` | string | Associated conversation ID |
| `user_id` | string | User (tenant) ID |
| `extracted_at` | timestamp | When extraction was performed |
| `is_latest` | boolean | Is this the current extraction? |
| `message_count_at_extraction` | integer | Messages in conversation when extracted |
| `demo_book_datetime` | timestamp | Scheduled demo time (if booked) |
| `reasoning` | JSON | AI's reasoning for each score |
| `smart_notification` | string | Human-readable summary for notifications |
| `created_at` | timestamp | Record creation time |
| `updated_at` | timestamp | Record update time |

### Joined Fields (from related tables)

| Field | Source | Description |
|-------|--------|-------------|
| `agent_id` | conversations → agents | Agent handling the conversation |
| `agent_name` | agents | Agent display name |
| `phone_number_id` | agents | Channel ID (WhatsApp/Instagram/Webchat) |
| `platform` | phone_numbers | "whatsapp", "instagram", or "webchat" |
| `phone_display_name` | phone_numbers | Friendly name for the channel |
| `conversation_active` | conversations | Is conversation still active? |
| `message_count` | messages | Total messages in conversation |

---

## API Endpoints

### 1. Get All Extractions

**Endpoint:** `GET /users/:user_id/extractions`

**Description:** Retrieve extraction records for a user with flexible filtering. By default returns ALL extractions (history mode). Use `latest_only=true` to get only current extractions.

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `user_id` | string | Yes | The user ID to get extractions for |

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `latest_only` | boolean | false | If `true`, only return extractions with `is_latest=true` |
| `conversation_id` | string | - | Filter by specific conversation |
| `agent_id` | string | - | Filter by agent |
| `phone_number_id` | string | - | Filter by channel (WhatsApp/Instagram/Webchat) |
| `has_email` | boolean | - | Only leads with extracted email |
| `has_demo` | boolean | - | Only leads who clicked demo CTA |
| `min_urgency` | 1-3 | - | Minimum urgency score |
| `min_fit` | 1-3 | - | Minimum fit score |
| `limit` | integer | 50 | Results per page |
| `offset` | integer | 0 | Pagination offset |
| `orderBy` | string | extracted_at | Sort field |
| `orderDirection` | ASC/DESC | DESC | Sort direction |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "extraction_id": "123e4567-e89b-12d3-a456-426614174000",
      "conversation_id": "conv_abc123",
      "user_id": "user_xyz",
      "customer_phone": "+14155551234",
      "extracted_at": "2024-12-12T10:30:00.000Z",
      "is_latest": true,
      "message_count_at_extraction": 15,
      
      "name": "John Doe",
      "email": "john@example.com",
      "company": "Acme Corp",
      
      "intent_level": "High",
      "intent_score": 3,
      "urgency_level": "Medium",
      "urgency_score": 2,
      "budget_constraint": "Yes",
      "budget_score": 3,
      "fit_alignment": "High",
      "fit_score": 3,
      "engagement_health": "High",
      "engagement_score": 3,
      
      "cta_pricing_clicked": "Yes",
      "cta_demo_clicked": "Yes",
      "cta_followup_clicked": "No",
      "cta_sample_clicked": "No",
      "cta_website_clicked": "Yes",
      "cta_escalated_to_human": "No",
      
      "total_score": 14,
      "lead_status_tag": "Hot",
      
      "agent_id": "agent_123",
      "agent_name": "Sales Bot",
      "phone_number_id": "pn_456",
      "platform": "whatsapp",
      "phone_display_name": "Business Support",
      "conversation_active": true
    }
  ],
  "pagination": {
    "total": 150,
    "limit": 50,
    "offset": 0,
    "hasMore": true
  },
  "timestamp": "2024-12-12T10:35:00.000Z",
  "correlationId": "abc123"
}
```

**Example Requests:**

```bash
# Get all extraction history for a user
curl "http://localhost:3000/users/user_xyz/extractions"

# Get only latest extractions (one per conversation)
curl "http://localhost:3000/users/user_xyz/extractions?latest_only=true"

# Get hot leads with email
curl "http://localhost:3000/users/user_xyz/extractions?latest_only=true&has_email=true&min_urgency=2&min_fit=2"

# Get extractions for specific WhatsApp channel
curl "http://localhost:3000/users/user_xyz/extractions?phone_number_id=pn_whatsapp123"

# Get extractions for Instagram channel (same parameter name)
curl "http://localhost:3000/users/user_xyz/extractions?phone_number_id=pn_instagram456"

# Get extraction history for specific conversation
curl "http://localhost:3000/users/user_xyz/extractions?conversation_id=conv_abc123&latest_only=false"
```

---

### 2. Get Extraction Statistics

**Endpoint:** `GET /users/:user_id/extractions/stats`

**Description:** Get aggregated analytics for lead extractions.

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `user_id` | string | Yes | The user ID |

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `time_range` | string | all | `day`, `week`, `month`, or `all` |
| `agent_id` | string | - | Filter by agent |
| `phone_number_id` | string | - | Filter by channel |

**Response:**
```json
{
  "success": true,
  "data": {
    "total_extractions": 150,
    "with_email": 85,
    "with_demo": 42,
    "high_urgency": 67,
    "good_fit": 78,
    "high_engagement": 89,
    "lead_quality": {
      "hot_leads": 25,
      "warm_leads": 65,
      "cold_leads": 60
    },
    "averages": {
      "urgency_score": "2.15",
      "budget_score": "1.85",
      "fit_score": "2.35",
      "engagement_score": "2.45",
      "total_score": "10.80"
    },
    "time_range": "week"
  },
  "timestamp": "2024-12-12T10:35:00.000Z",
  "correlationId": "abc123"
}
```

**Example Requests:**

```bash
# Get all-time stats
curl "http://localhost:3000/users/user_xyz/extractions/stats"

# Get this week's stats
curl "http://localhost:3000/users/user_xyz/extractions/stats?time_range=week"

# Get stats for WhatsApp channel only
curl "http://localhost:3000/users/user_xyz/extractions/stats?phone_number_id=pn_whatsapp123"
```

---

### 3. Get Single Extraction

**Endpoint:** `GET /users/:user_id/extractions/:extraction_id`

**Description:** Get detailed data for a specific extraction by its ID.

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `user_id` | string | Yes | The user ID |
| `extraction_id` | UUID | Yes | The extraction ID |

**Response:**
```json
{
  "success": true,
  "data": {
    "extraction_id": "123e4567-e89b-12d3-a456-426614174000",
    "conversation_id": "conv_abc123",
    "user_id": "user_xyz",
    "customer_phone": "+14155551234",
    "extracted_at": "2024-12-12T10:30:00.000Z",
    "is_latest": true,
    "message_count_at_extraction": 15,
    
    "name": "John Doe",
    "email": "john@example.com",
    "company": "Acme Corp",
    
    "intent_level": "High",
    "intent_score": 3,
    "urgency_level": "Medium",
    "urgency_score": 2,
    "budget_constraint": "Yes",
    "budget_score": 3,
    "fit_alignment": "High",
    "fit_score": 3,
    "engagement_health": "High",
    "engagement_score": 3,
    
    "cta_pricing_clicked": "Yes",
    "cta_demo_clicked": "Yes",
    "cta_followup_clicked": "No",
    "cta_sample_clicked": "No",
    "cta_website_clicked": "Yes",
    "cta_escalated_to_human": "No",
    
    "total_score": 14,
    "lead_status_tag": "Hot",
    "demo_book_datetime": null,
    "reasoning": {
      "intent": "Customer explicitly asked for pricing and timeline",
      "urgency": "Mentioned Q1 deadline",
      "budget": "Confirmed budget approval",
      "fit": "Requirements match our enterprise plan",
      "engagement": "Responded promptly to all questions"
    },
    "smart_notification": "Hot lead John Doe from Acme Corp requested demo. High intent with Q1 timeline.",
    
    "agent_id": "agent_123",
    "agent_name": "Sales Bot",
    "prompt_id": "prompt_sales_v2",
    "phone_number_id": "pn_456",
    "platform": "whatsapp",
    "phone_display_name": "Business Support",
    "conversation_active": true,
    "conversation_created_at": "2024-12-10T08:00:00.000Z",
    "last_message_at": "2024-12-12T10:25:00.000Z",
    "message_count": 18
  },
  "timestamp": "2024-12-12T10:35:00.000Z",
  "correlationId": "abc123"
}
```

---

### 4. Get Conversation Extraction

**Endpoint:** `GET /users/:user_id/conversations/:conversation_id/extraction`

**Description:** Get the latest extraction for a specific conversation.

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `user_id` | string | Yes | The user ID |
| `conversation_id` | string | Yes | The conversation ID |

**Response:** Same structure as single extraction.

**Example:**
```bash
curl "http://localhost:3000/users/user_xyz/conversations/conv_abc123/extraction"
```

---

### 5. Trigger Manual Extraction

**Endpoint:** `POST /users/:user_id/conversations/:conversation_id/extract`

**Description:** Manually trigger an extraction for a conversation. Useful when you need immediate lead data without waiting for the automatic extraction cycle.

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `user_id` | string | Yes | The user ID |
| `conversation_id` | string | Yes | The conversation ID |

**Response:**
```json
{
  "success": true,
  "message": "Extraction job queued successfully",
  "data": {
    "conversation_id": "conv_abc123",
    "status": "queued"
  },
  "timestamp": "2024-12-12T10:35:00.000Z",
  "correlationId": "abc123"
}
```

**Error Responses:**

- **400**: Conversation doesn't have enough activity
- **400**: Extraction is up to date (no new messages since last extraction)
- **403**: Conversation doesn't belong to user
- **404**: Conversation not found

---

### 6. Export Extractions

**Endpoint:** `GET /users/:user_id/extractions/export`

**Description:** Export extraction data in CSV or JSON format.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `format` | string | json | `csv` or `json` |
| + all filters from `/extractions` | | | |

**CSV Response Headers:**
```
Content-Type: text/csv
Content-Disposition: attachment; filename="extractions_user_xyz_1702380900000.csv"
```

**Example Requests:**

```bash
# Export as CSV
curl "http://localhost:3000/users/user_xyz/extractions/export?format=csv" -o extractions.csv

# Export hot leads only as JSON
curl "http://localhost:3000/users/user_xyz/extractions/export?format=json&min_urgency=3"
```

---

## Supporting APIs

These APIs provide additional context needed when working with lead analytics.

### Conversations

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/users/:user_id/conversations` | GET | List all conversations |
| `/users/:user_id/conversations/:id` | GET | Get conversation details |
| `/users/:user_id/conversations/:id/messages` | GET | Get messages in conversation |

### Messages & Stats

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/users/:user_id/messages` | GET | Get all messages |
| `/users/:user_id/messages/stats` | GET | Get message statistics |

### Agents

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/users/:user_id/agents` | GET | List all agents |
| `/users/:user_id/agents/:id` | GET | Get agent details |

### Phone Numbers (Channels)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/users/:user_id/phone_numbers` | GET | List all channels (WhatsApp/Instagram/Webchat) |

### Contacts

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/admin/contacts` | GET | List contacts (admin only) |

---

## Extraction Trigger Logic

### Automatic Extraction

The **Extraction Worker** runs on a configurable interval and automatically extracts lead data.

**Configuration (Environment Variables):**

| Variable | Default | Description |
|----------|---------|-------------|
| `EXTRACTION_INTERVAL` | 300000 (5 min) | How often worker checks for candidates |
| `EXTRACTION_INACTIVITY_THRESHOLD` | 300000 (5 min) | Minimum inactivity before extraction |
| `EXTRACTION_ENABLED` | true | Enable/disable automatic extraction |
| `EXTRACTION_PROMPT_ID` | (required) | OpenAI prompt ID for extraction |

**Extraction Candidate Criteria:**

A conversation is selected for extraction when ALL conditions are met:

1. `is_active = true` - Conversation is still active
2. `openai_conversation_id IS NOT NULL` - Has OpenAI context
3. `last_message_at <= NOW() - inactivity_threshold` - Inactive for threshold period
4. Either:
   - `last_extraction_at IS NULL` - Never extracted before, OR
   - `last_message_at > last_extraction_at` - New messages since last extraction

**Process Flow:**

```
1. Worker wakes up (every EXTRACTION_INTERVAL)
         ↓
2. Query for candidate conversations (up to 100)
         ↓
3. For each candidate:
   a. Retrieve ALL messages from database
   b. Create NEW OpenAI conversation for extraction
   c. Send messages + extraction instruction to OpenAI
   d. Parse JSON response
   e. Validate extraction data
   f. Mark previous extraction as is_latest=false
   g. Create new extraction with is_latest=true
   h. Update conversation.last_extraction_at
   i. Sync contact table with extracted data
   j. Emit extraction.complete event (for campaign triggers)
```

### Manual Extraction

Use `POST /users/:user_id/conversations/:conversation_id/extract` to trigger extraction immediately.

**Requirements:**
- Conversation must be active
- Conversation must belong to user
- Must have at least 2 messages
- Must have new messages since last extraction (if one exists)

---

## Integration Examples

### Example 1: Dashboard Lead Overview

```javascript
// Get summary stats for dashboard
const stats = await fetch('/users/user_xyz/extractions/stats?time_range=week');

// Get latest hot leads for display
const hotLeads = await fetch(
  '/users/user_xyz/extractions?latest_only=true&min_urgency=2&min_fit=2&limit=10'
);
```

### Example 2: Lead Detail View

```javascript
// Get all extraction history for a conversation
const history = await fetch(
  '/users/user_xyz/extractions?conversation_id=conv_abc123&latest_only=false&orderBy=extracted_at&orderDirection=ASC'
);

// Show score progression over time
history.data.forEach(extraction => {
  console.log(`${extraction.extracted_at}: Score ${extraction.total_score} (${extraction.lead_status_tag})`);
});
```

### Example 3: Export for CRM Integration

```javascript
// Export all leads with email for CRM sync
const response = await fetch(
  '/users/user_xyz/extractions/export?format=csv&latest_only=true&has_email=true'
);

// Save to file or send to CRM
const csvData = await response.text();
```

### Example 4: Multi-Channel Analytics

```javascript
// Get stats per channel
const whatsappStats = await fetch(
  '/users/user_xyz/extractions/stats?phone_number_id=pn_whatsapp123'
);

const instagramStats = await fetch(
  '/users/user_xyz/extractions/stats?phone_number_id=pn_instagram456'
);

// Compare channel performance
console.log('WhatsApp hot leads:', whatsappStats.data.lead_quality.hot_leads);
console.log('Instagram hot leads:', instagramStats.data.lead_quality.hot_leads);
```

### Example 5: Real-time Lead Notification

```javascript
// Poll for new hot leads (or use webhooks if implemented)
setInterval(async () => {
  const recentHot = await fetch(
    '/users/user_xyz/extractions?latest_only=true&min_urgency=3&min_fit=3&orderBy=extracted_at&orderDirection=DESC&limit=5'
  );
  
  recentHot.data.forEach(lead => {
    if (isNewSinceLastCheck(lead.extracted_at)) {
      notifySalesTeam(lead);
    }
  });
}, 60000); // Check every minute
```

---

## Error Handling

### Standard Error Response

```json
{
  "error": "Error Type",
  "message": "Detailed error description",
  "timestamp": "2024-12-12T10:35:00.000Z",
  "correlationId": "abc123"
}
```

### HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 202 | Accepted (for async operations) |
| 400 | Bad Request - Invalid parameters |
| 403 | Forbidden - Resource doesn't belong to user |
| 404 | Not Found - Resource doesn't exist |
| 500 | Internal Server Error |

---

## Notes for Integration

1. **No Authentication Required**: This is an internal API. Authentication is handled at the infrastructure level.

2. **Multi-Tenancy**: All endpoints require `user_id` and automatically filter data by user.

3. **Platform Agnostic**: The same API works for WhatsApp, Instagram, and Webchat. Filter by `phone_number_id` to segment by channel.

4. **Real-time vs Batch**: Extractions happen asynchronously. For real-time needs, use manual extraction trigger or poll the extractions endpoint.

5. **Contact Sync**: Each extraction automatically syncs to the `contacts` table, making lead data available for campaigns.

6. **Event System**: The extraction worker emits `extraction.complete` events that can trigger automated campaigns based on `lead_status_tag`.
