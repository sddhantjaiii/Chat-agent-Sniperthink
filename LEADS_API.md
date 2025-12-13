# Leads API Reference

The Leads API provides a unified view of all customer interactions across WhatsApp, Instagram, and Webchat platforms. It aggregates data from conversations and template message sends to give you a complete picture of your leads.

## Base URL

```
/users/:user_id/leads
```

---

## Endpoints Overview

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/users/:user_id/leads` | List all leads with filtering and pagination |
| GET | `/users/:user_id/leads/stats` | Get lead statistics |
| GET | `/users/:user_id/leads/:customer_phone` | Get a single lead by phone |
| GET | `/users/:user_id/leads/:customer_phone/messages` | Get all messages for a lead |

---

## 1. List All Leads

Retrieve all leads for a user with comprehensive filtering, sorting, and pagination.

### Request

```
GET /users/:user_id/leads
```

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `user_id` | string | Yes | The unique identifier of the user |

### Query Parameters

#### Filtering

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `platform` | string | Filter by platform(s). Comma-separated | `whatsapp`, `instagram,webchat` |
| `lead_status` | string | Filter by lead status(es). Comma-separated | `Hot`, `Hot,Warm` |
| `has_extraction` | boolean | Filter leads with/without extraction data | `true`, `false` |
| `has_email` | boolean | Filter leads with/without email | `true`, `false` |
| `min_total_score` | integer | Minimum total lead score (5-15) | `10` |
| `max_total_score` | integer | Maximum total lead score (5-15) | `12` |
| `days` | integer | Filter leads active within N days | `7`, `30` |
| `from_date` | ISO 8601 | Filter leads from this date | `2025-01-01` |
| `to_date` | ISO 8601 | Filter leads until this date | `2025-12-31` |
| `search` | string | Search in name, email, company, phone | `siddhant` |
| `customer_phone` | string | Filter by exact customer phone | `918979556941` |

#### Sorting

| Parameter | Type | Default | Options |
|-----------|------|---------|---------|
| `sort_by` | string | `last_message_at` | `last_message_at`, `first_contact_at`, `total_messages`, `total_score`, `name` |
| `sort_order` | string | `desc` | `asc`, `desc` |

#### Pagination

| Parameter | Type | Default | Max | Description |
|-----------|------|---------|-----|-------------|
| `limit` | integer | `50` | `100` | Number of results per page |
| `offset` | integer | `0` | - | Number of results to skip |

### Response

```json
{
  "success": true,
  "data": [
    {
      "customer_phone": "918979556941",
      "name": "Siddhant",
      "email": "sddhantjaiii@gmail.com",
      "company": null,
      "lead_status": "Cold",
      "total_score": 7,
      "intent_score": 1,
      "urgency_score": 1,
      "budget_score": 2,
      "fit_score": 2,
      "engagement_score": 2,
      "platforms": ["whatsapp"],
      "conversation_count": 1,
      "total_messages": 37,
      "template_sends_count": 0,
      "last_message_at": "2025-12-12T09:07:38.656Z",
      "last_message_text": "No problem, Siddhant. If you'd like, I can share a quick feature overview or pricing details. Which would you prefer?",
      "last_message_sender": "agent",
      "first_contact_at": "2025-10-05T06:21:34.662Z",
      "has_extraction": true,
      "extraction_id": "791a2e81-4706-4703-9532-842a2fd16e0c",
      "conversations": [
        {
          "conversation_id": "b1a93252-f8c6-448f-a765-195eea996d9a",
          "agent_id": "test-agent-001",
          "agent_name": "Test AI Agent",
          "platform": "whatsapp",
          "phone_number_id": "test-phone-001",
          "message_count": 37,
          "is_active": true,
          "created_at": "2025-10-05T06:21:34.662Z",
          "last_message_at": "2025-12-12T09:07:38.656Z"
        }
      ]
    }
  ],
  "pagination": {
    "total": 4,
    "limit": 50,
    "offset": 0,
    "hasMore": false
  },
  "timestamp": "2025-12-12T20:55:31.163Z",
  "correlationId": "1765572930366-lpk7lz5tm"
}
```

### Response Fields

#### Lead Object

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `customer_phone` | string | No | Unique identifier for the lead (WhatsApp phone or Instagram PSID) |
| `name` | string | Yes | Contact name extracted from conversations |
| `email` | string | Yes | Contact email extracted from conversations |
| `company` | string | Yes | Company name extracted from conversations |
| `lead_status` | string | Yes | Lead classification: `"Hot"`, `"Warm"`, or `"Cold"` |
| `total_score` | integer | Yes | Combined lead score (5-15) |
| `intent_score` | integer | Yes | Intent score (1-3) |
| `urgency_score` | integer | Yes | Urgency score (1-3) |
| `budget_score` | integer | Yes | Budget score (1-3) |
| `fit_score` | integer | Yes | Fit alignment score (1-3) |
| `engagement_score` | integer | Yes | Engagement health score (1-3) |
| `platforms` | string[] | No | List of platforms this lead has interacted on |
| `conversation_count` | integer | No | Number of conversations with this lead |
| `total_messages` | integer | No | Total messages exchanged across all conversations |
| `template_sends_count` | integer | No | Number of template messages sent to this lead |
| `last_message_at` | ISO 8601 | Yes | Timestamp of the most recent message |
| `last_message_text` | string | Yes | Content of the most recent message |
| `last_message_sender` | string | Yes | Who sent the last message: `"user"` or `"agent"` |
| `first_contact_at` | ISO 8601 | No | Timestamp of first interaction |
| `has_extraction` | boolean | No | Whether extraction data exists for this lead |
| `extraction_id` | UUID | Yes | ID of the most recent extraction |
| `conversations` | array | No | List of conversation summaries |

#### Conversation Summary Object

| Field | Type | Description |
|-------|------|-------------|
| `conversation_id` | string | Unique conversation identifier |
| `agent_id` | string | AI agent handling this conversation |
| `agent_name` | string | Display name of the agent |
| `platform` | string | Platform: `"whatsapp"`, `"instagram"`, or `"webchat"` |
| `phone_number_id` | string | Phone number/channel configuration ID |
| `message_count` | integer | Number of messages in this conversation |
| `is_active` | boolean | Whether the conversation is currently active |
| `created_at` | ISO 8601 | When the conversation started |
| `last_message_at` | ISO 8601 | When the last message was exchanged |

#### Pagination Object

| Field | Type | Description |
|-------|------|-------------|
| `total` | integer | Total number of leads matching the filter |
| `limit` | integer | Number of results per page |
| `offset` | integer | Number of results skipped |
| `hasMore` | boolean | Whether more results are available |

### Example Requests

#### Get all leads
```bash
curl "http://localhost:4000/users/789895c8-4bd6-43e9-bfea-a4171ec47197/leads"
```

#### Get hot leads only
```bash
curl "http://localhost:4000/users/789895c8-4bd6-43e9-bfea-a4171ec47197/leads?lead_status=Hot"
```

#### Get WhatsApp leads from last 7 days
```bash
curl "http://localhost:4000/users/789895c8-4bd6-43e9-bfea-a4171ec47197/leads?platform=whatsapp&days=7"
```

#### Search leads by name
```bash
curl "http://localhost:4000/users/789895c8-4bd6-43e9-bfea-a4171ec47197/leads?search=siddhant"
```

#### Paginated results
```bash
curl "http://localhost:4000/users/789895c8-4bd6-43e9-bfea-a4171ec47197/leads?limit=10&offset=20"
```

---

## 2. Get Lead Statistics

Get aggregate statistics about leads.

### Request

```
GET /users/:user_id/leads/stats
```

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `user_id` | string | Yes | The unique identifier of the user |

### Response

```json
{
  "success": true,
  "data": {
    "total_leads": 4,
    "leads_with_extraction": 3,
    "hot_leads": 0,
    "warm_leads": 0,
    "cold_leads": 3,
    "by_platform": {
      "whatsapp": 4,
      "instagram": 0,
      "webchat": 0
    },
    "leads_last_7_days": 2,
    "leads_last_30_days": 2
  },
  "timestamp": "2025-12-12T20:55:44.081Z",
  "correlationId": "1765572940614-5t6yrm5w4"
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `total_leads` | integer | Total number of unique leads |
| `leads_with_extraction` | integer | Leads that have extraction/scoring data |
| `hot_leads` | integer | Leads with `lead_status = "Hot"` |
| `warm_leads` | integer | Leads with `lead_status = "Warm"` |
| `cold_leads` | integer | Leads with `lead_status = "Cold"` |
| `by_platform` | object | Lead counts broken down by platform |
| `by_platform.whatsapp` | integer | Leads on WhatsApp |
| `by_platform.instagram` | integer | Leads on Instagram |
| `by_platform.webchat` | integer | Leads on Webchat |
| `leads_last_7_days` | integer | Leads active in the last 7 days |
| `leads_last_30_days` | integer | Leads active in the last 30 days |

### Example Request

```bash
curl "http://localhost:4000/users/789895c8-4bd6-43e9-bfea-a4171ec47197/leads/stats"
```

---

## 3. Get Single Lead

Retrieve detailed information about a specific lead by their phone number.

### Request

```
GET /users/:user_id/leads/:customer_phone
```

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `user_id` | string | Yes | The unique identifier of the user |
| `customer_phone` | string | Yes | The lead's phone number (URL encoded if needed) |

### Response

```json
{
  "success": true,
  "data": {
    "customer_phone": "918979556941",
    "name": "Siddhant",
    "email": "sddhantjaiii@gmail.com",
    "company": null,
    "lead_status": "Cold",
    "total_score": 7,
    "intent_score": 1,
    "urgency_score": 1,
    "budget_score": 2,
    "fit_score": 2,
    "engagement_score": 2,
    "platforms": ["whatsapp"],
    "conversation_count": 1,
    "total_messages": 37,
    "template_sends_count": 0,
    "last_message_at": "2025-12-12T09:07:38.656Z",
    "last_message_text": "No problem, Siddhant. If you'd like, I can share a quick feature overview or pricing details. Which would you prefer?",
    "last_message_sender": "agent",
    "first_contact_at": "2025-10-05T06:21:34.662Z",
    "has_extraction": true,
    "extraction_id": "791a2e81-4706-4703-9532-842a2fd16e0c",
    "conversations": [
      {
        "conversation_id": "b1a93252-f8c6-448f-a765-195eea996d9a",
        "agent_id": "test-agent-001",
        "agent_name": "Test AI Agent",
        "platform": "whatsapp",
        "phone_number_id": "test-phone-001",
        "message_count": 37,
        "is_active": true,
        "created_at": "2025-10-05T06:21:34.662Z",
        "last_message_at": "2025-12-12T09:07:38.656Z"
      }
    ]
  },
  "timestamp": "2025-12-12T20:55:49.295Z",
  "correlationId": "1765572948913-g33rg055b"
}
```

### Error Response (Lead Not Found)

```json
{
  "error": "Not Found",
  "message": "Lead not found",
  "timestamp": "2025-12-12T20:56:00.000Z",
  "correlationId": "1765572960000-abc123"
}
```

### Example Request

```bash
curl "http://localhost:4000/users/789895c8-4bd6-43e9-bfea-a4171ec47197/leads/918979556941"
```

---

## 4. Get Lead Messages

Retrieve all messages for a specific lead across all their conversations.

### Request

```
GET /users/:user_id/leads/:customer_phone/messages
```

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `user_id` | string | Yes | The unique identifier of the user |
| `customer_phone` | string | Yes | The lead's phone number |

### Query Parameters

#### Filtering

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `platform` | string | Filter messages by platform(s). Comma-separated | `whatsapp` |
| `sender` | string | Filter by message sender | `user`, `agent` |
| `from_date` | ISO 8601 | Messages from this date | `2025-01-01` |
| `to_date` | ISO 8601 | Messages until this date | `2025-12-31` |
| `conversation_id` | string | Filter to a specific conversation | `b1a93252-f8c6-448f-a765-195eea996d9a` |

#### Pagination

| Parameter | Type | Default | Max | Description |
|-----------|------|---------|-----|-------------|
| `limit` | integer | `50` | `200` | Number of messages per page |
| `offset` | integer | `0` | - | Number of messages to skip |

### Response

```json
{
  "success": true,
  "data": {
    "customer_phone": "918979556941",
    "lead_info": {
      "name": "Siddhant",
      "email": "sddhantjaiii@gmail.com",
      "company": null,
      "lead_status": "Cold",
      "total_score": 7
    },
    "messages": [
      {
        "message_id": "wamid.HBgMOTE4OTc5NTU2OTQxFQIAEhgUM0ZBMDM4RkM0QTg5NkI1ODIzRTgA",
        "conversation_id": "b1a93252-f8c6-448f-a765-195eea996d9a",
        "agent_id": "test-agent-001",
        "agent_name": "Test AI Agent",
        "platform": "whatsapp",
        "phone_number_id": "test-phone-001",
        "sender": "user",
        "text": "hi my name is siddhant",
        "timestamp": "2025-10-05T06:21:35.197Z",
        "status": "sent",
        "sequence_no": 1
      },
      {
        "message_id": "out-1759645300741-hij9fvlyv",
        "conversation_id": "b1a93252-f8c6-448f-a765-195eea996d9a",
        "agent_id": "test-agent-001",
        "agent_name": "Test AI Agent",
        "platform": "whatsapp",
        "phone_number_id": "test-phone-001",
        "sender": "agent",
        "text": "Thanks, Siddhant! How can I help you today? May I have your email to send detailed docs? Quick one — what's your budget range for this?",
        "timestamp": "2025-10-05T06:21:42.667Z",
        "status": "sent",
        "sequence_no": 2
      }
    ],
    "pagination": {
      "total": 37,
      "limit": 5,
      "offset": 0,
      "hasMore": true
    }
  },
  "timestamp": "2025-12-12T20:55:55.107Z",
  "correlationId": "1765572954465-eeh5x4k32"
}
```

### Response Fields

#### Lead Info Object

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Lead's name |
| `email` | string | Lead's email |
| `company` | string | Lead's company |
| `lead_status` | string | Lead classification |
| `total_score` | integer | Combined lead score |

#### Message Object

| Field | Type | Description |
|-------|------|-------------|
| `message_id` | string | Unique message identifier |
| `conversation_id` | string | Conversation this message belongs to |
| `agent_id` | string | Agent handling the conversation |
| `agent_name` | string | Display name of the agent |
| `platform` | string | Platform: `"whatsapp"`, `"instagram"`, or `"webchat"` |
| `phone_number_id` | string | Phone number/channel configuration ID |
| `sender` | string | Who sent the message: `"user"` or `"agent"` |
| `text` | string | Message content |
| `timestamp` | ISO 8601 | When the message was sent |
| `status` | string | Message status: `"sent"`, `"pending"`, or `"failed"` |
| `sequence_no` | integer | Message sequence number within the conversation |

### Example Requests

#### Get all messages for a lead
```bash
curl "http://localhost:4000/users/789895c8-4bd6-43e9-bfea-a4171ec47197/leads/918979556941/messages"
```

#### Get only user messages
```bash
curl "http://localhost:4000/users/789895c8-4bd6-43e9-bfea-a4171ec47197/leads/918979556941/messages?sender=user"
```

#### Paginated messages
```bash
curl "http://localhost:4000/users/789895c8-4bd6-43e9-bfea-a4171ec47197/leads/918979556941/messages?limit=10&offset=0"
```

---

## Error Responses

All endpoints return consistent error responses:

```json
{
  "error": "Error Type",
  "message": "Detailed error message",
  "timestamp": "2025-12-12T20:56:00.000Z",
  "correlationId": "unique-correlation-id"
}
```

### HTTP Status Codes

| Status | Description |
|--------|-------------|
| `200` | Success |
| `400` | Bad Request - Invalid parameters |
| `404` | Not Found - Lead not found |
| `500` | Internal Server Error |

---

## Lead Scoring System

Leads are scored based on 5 dimensions, each rated 1-3:

| Dimension | Score Range | Description |
|-----------|-------------|-------------|
| Intent | 1-3 | How strong is the buying intent? |
| Urgency | 1-3 | How urgent is the need? |
| Budget | 1-3 | Does budget align with offering? |
| Fit | 1-3 | How well does the lead fit ideal customer profile? |
| Engagement | 1-3 | How engaged is the lead? |

**Total Score**: Sum of all 5 dimensions (range: 5-15)

**Lead Status Classification**:
- **Hot**: High total score, strong buying signals
- **Warm**: Moderate engagement, potential opportunity  
- **Cold**: Low engagement or poor fit

---

## Data Sources

The Leads API aggregates data from multiple sources:

1. **Conversations**: Leads who have had actual conversations with your AI agents
2. **Template Sends**: Leads who have only received template messages (no conversation yet)
3. **Extractions**: AI-extracted contact info and lead scores from conversations
4. **Contacts**: Additional contact metadata if available

---

## Platform Identifiers

| Platform | `customer_phone` Format | Example |
|----------|-------------------------|---------|
| WhatsApp | Phone number (with country code, no +) | `918979556941` |
| Instagram | Instagram-Scoped ID (PSID) | `17841473561175244` |
| Webchat | Generated session ID | `web-abc123-def456` |

**Note**: The same person on WhatsApp and Instagram will appear as **two separate leads** since they have different identifiers.

---

## Rate Limits

- Default: 100 requests per minute per user
- Bulk operations: Consider pagination for large datasets

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-12-12 | Initial release with 4 endpoints |
