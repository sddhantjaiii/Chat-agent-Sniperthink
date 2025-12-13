# Campaign External API Documentation

**Version:** 1.0.0  
**Base URL:** `http://localhost:3000/api/v1`

This API allows external systems to send WhatsApp template messages to contacts. It is designed for internal microservice communication (no API key required).

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Endpoints](#endpoints)
   - [List Phone Numbers](#list-phone-numbers)
   - [List Templates](#list-templates)
   - [Send Single Message](#send-single-message)
   - [Create Campaign](#create-campaign)
   - [Get Campaign Status](#get-campaign-status)
4. [Data Models](#data-models)
5. [Error Handling](#error-handling)
6. [Workflow Examples](#workflow-examples)
7. [Rate Limiting & Credits](#rate-limiting--credits)

---

## Overview

### Purpose
This API enables external systems (like your main product) to:
- Send WhatsApp template messages to single contacts
- Create bulk campaigns for multiple contacts
- Track campaign progress and delivery status

### Key Features
- **Credit-based billing**: Each message deducts 1 credit from the user's balance
- **Contact management**: Automatically creates/updates contacts in the database
- **Conversation tracking**: Creates OpenAI conversation context for follow-up responses
- **Batch processing**: Campaigns process 50 contacts per batch with 5-second delays

### Architecture Flow
```
External System → /api/v1/send or /api/v1/campaign
                        ↓
              Credit Check & Deduction
                        ↓
              Create/Update Contact(s)
                        ↓
              Create OpenAI Conversation
                        ↓
              Send via WhatsApp Cloud API
                        ↓
              Campaign Worker (batch processing)
```

---

## Authentication

**No authentication required** - This API is designed for internal microservice communication.

The user is identified via the `phone_number_id` parameter, which maps to a specific user account in the system.

---

## Endpoints

### List Phone Numbers

Get all WhatsApp phone numbers configured for a user.

**Endpoint:** `GET /api/v1/phone-numbers`

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `user_id` | string | Yes | The user ID to list phone numbers for |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "pn_abc123",
      "user_id": "user_xyz",
      "platform": "whatsapp",
      "meta_phone_number_id": "123456789012345",
      "display_name": "Business Support Line"
    }
  ],
  "timestamp": "2024-01-15T10:30:00.000Z",
  "correlationId": "1705312200000-abc123"
}
```

**Example Request:**
```bash
curl "http://localhost:3000/api/v1/phone-numbers?user_id=user_xyz"
```

---

### List Templates

Get all approved WhatsApp templates for a phone number.

**Endpoint:** `GET /api/v1/templates`

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `phone_number_id` | string | Yes | The internal phone number ID |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "template_id": "tpl_welcome_001",
      "name": "welcome_message",
      "category": "MARKETING",
      "language": "en",
      "components": {
        "body": {
          "text": "Hello {{1}}! Welcome to {{2}}."
        }
      },
      "variables": [
        {
          "position": 1,
          "variable_name": "customer_name",
          "default_value": "Customer",
          "sample_value": "John"
        },
        {
          "position": 2,
          "variable_name": "company_name",
          "default_value": "Our Company",
          "sample_value": "Acme Corp"
        }
      ]
    }
  ],
  "timestamp": "2024-01-15T10:30:00.000Z",
  "correlationId": "1705312200000-abc123"
}
```

**Example Request:**
```bash
curl "http://localhost:3000/api/v1/templates?phone_number_id=pn_abc123"
```

---

### Send Single Message

Send a template message to a single contact immediately.

**Endpoint:** `POST /api/v1/send`

**Request Body:**
```json
{
  "phone_number_id": "pn_abc123",
  "template_id": "tpl_welcome_001",
  "contact": {
    "phone": "+14155551234",
    "name": "John Doe",
    "email": "john@example.com",
    "company": "Acme Corp"
  },
  "variables": {
    "1": "John",
    "2": "Acme Corp"
  }
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone_number_id` | string | Yes | Internal phone number ID |
| `template_id` | string | Yes | Template ID to send |
| `contact` | object | Yes | Contact information |
| `contact.phone` | string | Yes | Phone number in E.164 format (e.g., +14155551234) |
| `contact.name` | string | No | Contact's name |
| `contact.email` | string | No | Contact's email |
| `contact.company` | string | No | Contact's company |
| `variables` | object | No | Template variable values (keyed by position) |

**Response:**
```json
{
  "success": true,
  "data": {
    "message_id": "wamid.HBgMNTUxMjM0NTY3ODkwFQIAERgSODA...",
    "contact_id": "ct_contact123",
    "conversation_id": "conv_abc123",
    "openai_conversation_id": "openai_conv_xyz",
    "credits_remaining": 99
  },
  "timestamp": "2024-01-15T10:30:00.000Z",
  "correlationId": "1705312200000-abc123"
}
```

**Example Request:**
```bash
curl -X POST "http://localhost:3000/api/v1/send" \
  -H "Content-Type: application/json" \
  -d '{
    "phone_number_id": "pn_abc123",
    "template_id": "tpl_welcome_001",
    "contact": {
      "phone": "+14155551234",
      "name": "John Doe"
    },
    "variables": {
      "1": "John",
      "2": "Acme Corp"
    }
  }'
```

---

### Create Campaign

Create a bulk messaging campaign for multiple contacts.

**Endpoint:** `POST /api/v1/campaign`

**Request Body:**
```json
{
  "phone_number_id": "pn_abc123",
  "template_id": "tpl_welcome_001",
  "name": "January Promotion",
  "description": "New year promotion for existing customers",
  "contacts": [
    {
      "phone": "+14155551234",
      "name": "John Doe",
      "email": "john@example.com",
      "company": "Acme Corp",
      "variables": {
        "1": "John",
        "2": "special discount"
      }
    },
    {
      "phone": "+14155555678",
      "name": "Jane Smith",
      "variables": {
        "1": "Jane",
        "2": "exclusive offer"
      }
    }
  ],
  "schedule": {
    "type": "IMMEDIATE"
  }
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone_number_id` | string | Yes | Internal phone number ID |
| `template_id` | string | Yes | Template ID to send |
| `name` | string | No | Campaign name (auto-generated if not provided) |
| `description` | string | No | Campaign description |
| `contacts` | array | Yes | Array of contact objects |
| `contacts[].phone` | string | Yes | Phone number in E.164 format |
| `contacts[].name` | string | No | Contact's name |
| `contacts[].email` | string | No | Contact's email |
| `contacts[].company` | string | No | Contact's company |
| `contacts[].variables` | object | No | Per-contact variable values |
| `schedule` | object | No | Schedule configuration |
| `schedule.type` | string | No | `IMMEDIATE` or `SCHEDULED` (default: IMMEDIATE) |
| `schedule.scheduled_at` | string | No | ISO 8601 datetime for SCHEDULED type |

**Limits:**
- Maximum 10,000 contacts per campaign (configurable via `CAMPAIGNS_MAX_RECIPIENTS` env)

**Response:**
```json
{
  "success": true,
  "data": {
    "campaign_id": "cmp_abc123",
    "name": "January Promotion",
    "status": "RUNNING",
    "total_recipients": 2,
    "credits_deducted": 2,
    "credits_remaining": 98,
    "schedule": {
      "type": "IMMEDIATE",
      "scheduled_at": null
    }
  },
  "timestamp": "2024-01-15T10:30:00.000Z",
  "correlationId": "1705312200000-abc123"
}
```

**Example Request:**
```bash
curl -X POST "http://localhost:3000/api/v1/campaign" \
  -H "Content-Type: application/json" \
  -d '{
    "phone_number_id": "pn_abc123",
    "template_id": "tpl_welcome_001",
    "name": "January Promotion",
    "contacts": [
      {
        "phone": "+14155551234",
        "name": "John Doe",
        "variables": { "1": "John" }
      }
    ]
  }'
```

---

### Get Campaign Status

Get the current status and progress of a campaign.

**Endpoint:** `GET /api/v1/campaign/:campaignId`

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `campaignId` | string | Yes | The campaign ID |

**Response:**
```json
{
  "success": true,
  "data": {
    "campaign_id": "cmp_abc123",
    "name": "January Promotion",
    "status": "RUNNING",
    "total_recipients": 100,
    "sent_count": 50,
    "delivered_count": 45,
    "read_count": 20,
    "failed_count": 2,
    "progress_percent": 50,
    "started_at": "2024-01-15T10:30:00.000Z",
    "completed_at": null,
    "recipient_stats": {
      "pending": 50,
      "queued": 0,
      "sent": 3,
      "delivered": 25,
      "read": 20,
      "failed": 2,
      "skipped": 0
    }
  },
  "timestamp": "2024-01-15T10:35:00.000Z",
  "correlationId": "1705312500000-abc123"
}
```

**Campaign Status Values:**
| Status | Description |
|--------|-------------|
| `DRAFT` | Campaign created but not started |
| `SCHEDULED` | Campaign scheduled for future execution |
| `RUNNING` | Campaign is actively sending messages |
| `PAUSED` | Campaign temporarily paused |
| `COMPLETED` | All messages sent successfully |
| `FAILED` | Campaign failed due to an error |
| `CANCELLED` | Campaign was cancelled |

**Example Request:**
```bash
curl "http://localhost:3000/api/v1/campaign/cmp_abc123"
```

---

## Data Models

### Contact Object
```typescript
{
  phone: string;       // Required. E.164 format: +14155551234
  name?: string;       // Optional. Contact's full name
  email?: string;      // Optional. Contact's email
  company?: string;    // Optional. Contact's company
  variables?: {        // Optional. Per-contact template variables
    [position: string]: string
  }
}
```

### Template Variable Object
```typescript
{
  position: number;        // 1-10, maps to {{1}}, {{2}}, etc.
  variable_name: string;   // Human-readable name
  default_value?: string;  // Default if not provided
  sample_value?: string;   // Sample for Meta review
}
```

### Campaign Schedule Object
```typescript
{
  type: 'IMMEDIATE' | 'SCHEDULED';
  scheduled_at?: string;  // ISO 8601 datetime for SCHEDULED type
}
```

---

## Error Handling

### Error Response Format
```json
{
  "success": false,
  "error": "Error Type",
  "message": "Detailed error message",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "correlationId": "1705312200000-abc123"
}
```

### HTTP Status Codes
| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created (for campaigns) |
| 400 | Bad Request - Invalid parameters |
| 402 | Payment Required - Insufficient credits |
| 404 | Not Found - Resource doesn't exist |
| 500 | Internal Server Error |

### Common Error Scenarios

**Insufficient Credits (402):**
```json
{
  "success": false,
  "error": "Payment Required",
  "message": "Insufficient credits. Required: 100, Available: 50",
  "credits_required": 100,
  "credits_available": 50,
  "timestamp": "2024-01-15T10:30:00.000Z",
  "correlationId": "1705312200000-abc123"
}
```

**Template Not Approved (400):**
```json
{
  "success": false,
  "error": "Bad Request",
  "message": "Template not found or not approved",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "correlationId": "1705312200000-abc123"
}
```

**No Agent Configured (400):**
```json
{
  "success": false,
  "error": "Bad Request",
  "message": "No agent configured for this phone number",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "correlationId": "1705312200000-abc123"
}
```

---

## Workflow Examples

### Example 1: Send Welcome Message to New Lead

```javascript
// 1. Get available phone numbers
const phoneNumbers = await fetch('/api/v1/phone-numbers?user_id=user_xyz');

// 2. Get templates for the phone number
const templates = await fetch('/api/v1/templates?phone_number_id=pn_abc123');

// 3. Send welcome message
const response = await fetch('/api/v1/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    phone_number_id: 'pn_abc123',
    template_id: 'tpl_welcome_001',
    contact: {
      phone: '+14155551234',
      name: 'John Doe',
      email: 'john@example.com'
    },
    variables: {
      '1': 'John',
      '2': 'Acme Corp'
    }
  })
});

const result = await response.json();
console.log('Message sent:', result.data.message_id);
```

### Example 2: Create Marketing Campaign

```javascript
// 1. Prepare contacts from your system
const contacts = [
  { phone: '+14155551234', name: 'John', variables: { '1': 'John' } },
  { phone: '+14155555678', name: 'Jane', variables: { '1': 'Jane' } },
  // ... more contacts
];

// 2. Create campaign
const response = await fetch('/api/v1/campaign', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    phone_number_id: 'pn_abc123',
    template_id: 'tpl_promo_001',
    name: 'January Promotion',
    contacts: contacts
  })
});

const campaign = await response.json();
const campaignId = campaign.data.campaign_id;

// 3. Poll for status
const checkStatus = async () => {
  const status = await fetch(`/api/v1/campaign/${campaignId}`);
  return status.json();
};

// Poll every 10 seconds
const interval = setInterval(async () => {
  const status = await checkStatus();
  console.log(`Progress: ${status.data.progress_percent}%`);
  
  if (status.data.status === 'COMPLETED' || status.data.status === 'FAILED') {
    clearInterval(interval);
    console.log('Campaign finished:', status.data);
  }
}, 10000);
```

### Example 3: Schedule Campaign for Later

```javascript
const response = await fetch('/api/v1/campaign', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    phone_number_id: 'pn_abc123',
    template_id: 'tpl_reminder_001',
    name: 'Appointment Reminders',
    contacts: contacts,
    schedule: {
      type: 'SCHEDULED',
      scheduled_at: '2024-01-20T09:00:00.000Z'
    }
  })
});
```

---

## Rate Limiting & Credits

### Credit System
- Each message (single or within campaign) costs **1 credit**
- Credits are deducted **upfront** when creating a campaign
- Failed messages do not refund credits automatically
- Check credits via: `GET /users/:user_id/credits`

### Campaign Processing
- **Batch size:** 50 contacts per batch
- **Delay between batches:** 5 seconds
- **Worker interval:** 10 seconds (checks for pending campaigns)

### WhatsApp Rate Limits
WhatsApp has its own rate limits based on your phone number tier:
- **Tier 1:** 1,000 business-initiated conversations/24h
- **Tier 2:** 10,000 business-initiated conversations/24h
- **Tier 3:** 100,000 business-initiated conversations/24h
- **Tier 4:** Unlimited

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CAMPAIGNS_BATCH_SIZE` | 50 | Contacts per batch |
| `CAMPAIGNS_DELAY_BETWEEN_BATCHES_MS` | 5000 | Delay between batches (ms) |
| `CAMPAIGNS_MAX_RECIPIENTS` | 10000 | Max contacts per campaign |

---

## Best Practices

1. **Validate phone numbers** before sending - use E.164 format (+country code + number)
2. **Use meaningful campaign names** for easier tracking in admin panel
3. **Monitor credits** before large campaigns to avoid partial sends
4. **Poll campaign status** instead of expecting instant delivery
5. **Handle errors gracefully** - some contacts may fail while others succeed
6. **Respect WhatsApp policies** - only send to users who have opted in

---

## Support

For issues or questions:
- Check server logs for detailed error messages
- Use the `correlationId` in responses to trace requests
- Contact the platform administrator for credit additions
