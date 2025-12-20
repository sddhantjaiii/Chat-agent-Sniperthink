# Extraction External API Reference

External APIs for retrieving lead extraction/intelligence data by customer phone number.

---

## Overview

These APIs allow you to retrieve lead intelligence data (extractions) for a specific customer phone number. Extractions contain lead scoring, contact information, and AI-generated insights from conversations.

**Base URL:** `https://your-api-domain.com`

**Authentication:** All requests require the `x-user-id` header for multi-tenant isolation.

---

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/extractions/summaries` | Get lightweight extraction summaries |
| GET | `/api/v1/extractions` | Get full extraction data |

---

## GET /api/v1/extractions/summaries

Returns lightweight extraction summaries for a customer phone number. Ideal for dashboards and list views where you need quick overview data.

### Request

```http
GET /api/v1/extractions/summaries?customer_phone=%2B918979556941
```

### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `x-user-id` | Yes | Your user ID (UUID format) |

### Query Parameters

| Parameter | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `customer_phone` | Yes | string | - | Customer/lead phone number in E.164 format (e.g., `+918979556941`). URL encode the `+` as `%2B` |
| `latest_only` | No | boolean | `true` | Only return the latest extraction per conversation |
| `limit` | No | integer | `50` | Maximum results to return (max: 100) |
| `offset` | No | integer | `0` | Pagination offset |

### Example Request

```bash
curl -X GET "https://api.example.com/api/v1/extractions/summaries?customer_phone=%2B918979556941&latest_only=true&limit=10" \
  -H "x-user-id: 789895c8-4bd6-43e9-bfea-a4171ec47197"
```

**PowerShell:**
```powershell
Invoke-RestMethod -Uri "http://localhost:4000/api/v1/extractions/summaries?customer_phone=%2B918979556941" `
  -Headers @{"x-user-id"="789895c8-4bd6-43e9-bfea-a4171ec47197"}
```

### Success Response (200 OK)

```json
{
  "success": true,
  "data": [
    {
      "extraction_id": "0d72065c-174f-4c7d-9cff-67c3f502d57d",
      "conversation_id": "3a6cbc61-0fec-4944-8853-214c4ffb311b",
      "customer_phone": "+918979556941",
      "in_detail_summary": "Customer discussed pricing options and showed interest in scheduling a discovery call. Asked about enterprise features and integration capabilities.",
      "smart_notification": "Siddhant engaged on pricing and discovery",
      "lead_status_tag": "Warm",
      "total_score": 10,
      "extracted_at": "2025-12-17T19:00:39.366Z",
      "is_latest": true,
      "conversation_active": true
    },
    {
      "extraction_id": "02cd335b-606f-4f08-b9f7-9a93822f50ff",
      "conversation_id": "cbebb5aa-f075-4d0f-b643-53db41988cc2",
      "customer_phone": "+918979556941",
      "in_detail_summary": "Initial exploratory conversation about meeting scheduling and document sharing capabilities.",
      "smart_notification": "Siddhant discussed meetings and docs",
      "lead_status_tag": "Cold",
      "total_score": 7,
      "extracted_at": "2025-12-16T21:08:37.457Z",
      "is_latest": true,
      "conversation_active": true
    }
  ],
  "pagination": {
    "total": 2,
    "limit": 50,
    "offset": 0,
    "hasMore": false
  },
  "timestamp": "2025-12-20T09:51:30.902Z",
  "correlationId": "1766224290595-ulwdkaz"
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `extraction_id` | UUID | Unique extraction identifier |
| `conversation_id` | string | Associated conversation ID |
| `customer_phone` | string | Customer phone number (E.164 format) |
| `in_detail_summary` | string \| null | Detailed AI-generated summary of the conversation |
| `smart_notification` | string \| null | 4-5 word summary for quick notifications |
| `lead_status_tag` | string | Lead classification: `"Hot"`, `"Warm"`, or `"Cold"` |
| `total_score` | integer | Total lead score (5-15, sum of all category scores) |
| `extracted_at` | timestamp | When the extraction was created |
| `is_latest` | boolean | Whether this is the most recent extraction for the conversation |
| `conversation_active` | boolean | Whether the conversation is still active |

---

## GET /api/v1/extractions

Returns full extraction data including all lead scoring fields, contact information, reasoning, and agent details.

### Request

```http
GET /api/v1/extractions?customer_phone=%2B918979556941
```

### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `x-user-id` | Yes | Your user ID (UUID format) |

### Query Parameters

| Parameter | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `customer_phone` | Yes | string | - | Customer/lead phone number in E.164 format (e.g., `+918979556941`). URL encode the `+` as `%2B` |
| `lead_status` | No | string | - | Filter by lead status: `"Hot"`, `"Warm"`, or `"Cold"` |
| `min_score` | No | integer | - | Minimum total score filter (5-15) |
| `latest_only` | No | boolean | `true` | Only return the latest extraction per conversation |
| `limit` | No | integer | `50` | Maximum results to return (max: 100) |
| `offset` | No | integer | `0` | Pagination offset |

### Example Request

```bash
curl -X GET "https://api.example.com/api/v1/extractions?customer_phone=%2B918979556941&lead_status=Warm&min_score=8" \
  -H "x-user-id: 789895c8-4bd6-43e9-bfea-a4171ec47197"
```

**PowerShell:**
```powershell
Invoke-RestMethod -Uri "http://localhost:4000/api/v1/extractions?customer_phone=%2B918979556941" `
  -Headers @{"x-user-id"="789895c8-4bd6-43e9-bfea-a4171ec47197"}
```

### Success Response (200 OK)

```json
{
  "success": true,
  "data": [
    {
      "extraction_id": "0d72065c-174f-4c7d-9cff-67c3f502d57d",
      "conversation_id": "3a6cbc61-0fec-4944-8853-214c4ffb311b",
      "user_id": "789895c8-4bd6-43e9-bfea-a4171ec47197",
      "customer_phone": "+918979556941",
      "extracted_at": "2025-12-17T19:00:39.366Z",
      "is_latest": true,
      "message_count_at_extraction": 24,
      
      "name": "Siddhant",
      "email": "siddhantjaiii@gmail.com",
      "company": null,
      
      "intent_level": "Low",
      "intent_score": 1,
      "urgency_level": "Low",
      "urgency_score": 1,
      "budget_constraint": "Maybe",
      "budget_score": 2,
      "fit_alignment": "Medium",
      "fit_score": 2,
      "engagement_health": "Medium",
      "engagement_score": 2,
      "total_score": 10,
      "lead_status_tag": "Warm",
      
      "demo_book_datetime": null,
      
      "reasoning": {
        "intent": "Pricing inquiry with follow-up call interest",
        "urgency": "Exploration with scheduling potential",
        "budget": "Not discussed explicitly; implied interest in pricing",
        "fit": "Partial overlap (pricing + discovery)",
        "engagement": "Moderate; multiple prompts and scheduling hints",
        "cta_behavior": "Pricing/Discovery CTAs present"
      },
      
      "smart_notification": "Siddhant engaged on pricing and discovery",
      "requirements": "Enterprise features, API integration, custom reporting",
      "custom_cta": "Schedule Demo, View Pricing, Contact Sales",
      "in_detail_summary": "Customer discussed pricing options and showed interest in scheduling a discovery call. Asked about enterprise features and integration capabilities.",
      
      "created_at": "2025-12-17T19:00:39.366Z",
      "updated_at": "2025-12-17T19:00:39.366Z",
      
      "agent_id": "bb176b7c-b4db-43fc-a622-661177cdf16e",
      "conversation_active": true,
      "agent_name": "Bolna agent test",
      "phone_number_id": "e9413a70-bdea-4ba3-92f9-014a0e2435fc",
      "platform": "whatsapp",
      "phone_display_name": "Bolna number"
    }
  ],
  "pagination": {
    "total": 1,
    "limit": 50,
    "offset": 0,
    "hasMore": false
  },
  "timestamp": "2025-12-20T09:51:59.828Z",
  "correlationId": "1766224319625-tmejvw8"
}
```

### Response Fields

#### Core Fields

| Field | Type | Description |
|-------|------|-------------|
| `extraction_id` | UUID | Unique extraction identifier |
| `conversation_id` | string | Associated conversation ID |
| `user_id` | string | Owner user ID |
| `customer_phone` | string | Customer phone number (E.164 format) |
| `extracted_at` | timestamp | When the extraction was created |
| `is_latest` | boolean | Whether this is the most recent extraction for the conversation |
| `message_count_at_extraction` | integer | Number of messages when extraction was performed |

#### Contact Information

| Field | Type | Description |
|-------|------|-------------|
| `name` | string \| null | Extracted contact name |
| `email` | string \| null | Extracted email address |
| `company` | string \| null | Extracted company name |

#### Lead Scoring

| Field | Type | Description |
|-------|------|-------------|
| `intent_level` | string | Intent level: `"Low"`, `"Medium"`, `"High"` |
| `intent_score` | integer | Intent score (1-3) |
| `urgency_level` | string | Urgency level: `"Low"`, `"Medium"`, `"High"` |
| `urgency_score` | integer | Urgency score (1-3) |
| `budget_constraint` | string | Budget indicator: `"Yes"`, `"No"`, `"Maybe"` |
| `budget_score` | integer | Budget score (1-3) |
| `fit_alignment` | string | Product fit: `"Low"`, `"Medium"`, `"High"` |
| `fit_score` | integer | Fit score (1-3) |
| `engagement_health` | string | Engagement level: `"Low"`, `"Medium"`, `"High"` |
| `engagement_score` | integer | Engagement score (1-3) |
| `total_score` | integer | Sum of all scores (5-15) |
| `lead_status_tag` | string | Classification: `"Hot"` (12-15), `"Warm"` (8-11), `"Cold"` (5-7) |

#### AI-Generated Insights

| Field | Type | Description |
|-------|------|-------------|
| `reasoning` | object | Detailed reasoning for each score category |
| `reasoning.intent` | string | Explanation of intent assessment |
| `reasoning.urgency` | string | Explanation of urgency assessment |
| `reasoning.budget` | string | Explanation of budget assessment |
| `reasoning.fit` | string | Explanation of fit assessment |
| `reasoning.engagement` | string | Explanation of engagement assessment |
| `reasoning.cta_behavior` | string | Analysis of CTA interactions |
| `smart_notification` | string \| null | 4-5 word notification summary |
| `requirements` | string \| null | Key requirements extracted from conversation |
| `custom_cta` | string \| null | Comma-separated list of recommended CTAs |
| `in_detail_summary` | string \| null | Comprehensive conversation summary |

#### Scheduling

| Field | Type | Description |
|-------|------|-------------|
| `demo_book_datetime` | timestamp \| null | Scheduled demo/meeting time if booked |

#### Agent & Platform Info

| Field | Type | Description |
|-------|------|-------------|
| `agent_id` | string | ID of the agent that handled the conversation |
| `agent_name` | string | Display name of the agent |
| `phone_number_id` | string | ID of the phone number/channel |
| `platform` | string | Platform: `"whatsapp"`, `"instagram"`, `"webchat"` |
| `phone_display_name` | string | Display name of the phone number |
| `conversation_active` | boolean | Whether the conversation is still active |

#### Timestamps

| Field | Type | Description |
|-------|------|-------------|
| `created_at` | timestamp | When the extraction record was created |
| `updated_at` | timestamp | When the extraction record was last updated |

---

## Error Responses

### 400 Bad Request - Missing Header

```json
{
  "success": false,
  "error": "Bad Request",
  "message": "x-user-id header is required",
  "timestamp": "2025-12-20T10:00:00.000Z",
  "correlationId": "1766224400000-abc123"
}
```

### 400 Bad Request - Missing Parameter

```json
{
  "success": false,
  "error": "Bad Request",
  "message": "customer_phone query parameter is required (e.g., +918979556941)",
  "timestamp": "2025-12-20T10:00:00.000Z",
  "correlationId": "1766224400000-def456"
}
```

### 500 Internal Server Error

```json
{
  "success": false,
  "error": "Internal Server Error",
  "message": "Failed to retrieve extraction summaries",
  "timestamp": "2025-12-20T10:00:00.000Z",
  "correlationId": "1766224400000-ghi789"
}
```

---

## Use Cases

### 1. Dashboard Lead Overview

Use the summaries endpoint for quick dashboard displays:

```bash
GET /api/v1/extractions/summaries?customer_phone=%2B918979556941
```

### 2. Lead Detail View

Use the full extractions endpoint when showing detailed lead information:

```bash
GET /api/v1/extractions?customer_phone=%2B918979556941
```

### 3. Filter Hot Leads Only

```bash
GET /api/v1/extractions?customer_phone=%2B918979556941&lead_status=Hot
```

### 4. Get High-Scoring Leads

```bash
GET /api/v1/extractions?customer_phone=%2B918979556941&min_score=10
```

### 5. Include Historical Extractions

Get all extractions including previous versions:

```bash
GET /api/v1/extractions?customer_phone=%2B918979556941&latest_only=false
```

### 6. Paginated Results

```bash
GET /api/v1/extractions?customer_phone=%2B918979556941&limit=10&offset=0
GET /api/v1/extractions?customer_phone=%2B918979556941&limit=10&offset=10
```

---

## Notes

1. **Phone Number Format**: Always use E.164 format (e.g., `+918979556941`). URL encode the `+` as `%2B`.

2. **Multi-Tenant Isolation**: The `x-user-id` header ensures you only see extractions belonging to your account.

3. **Cross-Agent Results**: These APIs return extractions across ALL agents owned by the user, not just a single agent.

4. **Latest Only Default**: By default, only the most recent extraction per conversation is returned. Set `latest_only=false` to see historical data.

5. **Score Calculation**: `total_score` = `intent_score` + `urgency_score` + `budget_score` + `fit_score` + `engagement_score` (range: 5-15)

6. **Lead Status Thresholds**:
   - **Hot**: total_score 12-15
   - **Warm**: total_score 8-11
   - **Cold**: total_score 5-7
