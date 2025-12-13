# External API Reference (Dashboard Integration)

**For:** Dashboard/Frontend Developers  
**Version:** 2.3.0  
**Last Updated:** December 13, 2025

---

## ⚠️ MIGRATION NOTICE

**The documentation previously showed `/admin/*` endpoints. These require JWT authentication.**

**Dashboard should use `/api/v1/*` endpoints instead - NO AUTHENTICATION REQUIRED.**

### Quick Migration Guide

| Old (Requires Auth) | New (No Auth) |
|---------------------|---------------|
| `GET /admin/templates` | `GET /api/v1/templates?phone_number_id=X` |
| `GET /admin/templates/:id` | `GET /api/v1/templates/:id` |
| `POST /admin/templates` | `POST /api/v1/templates` |
| `POST /admin/templates/:id/submit` | `POST /api/v1/templates/:id/submit` |
| `POST /admin/templates/sync` | `POST /api/v1/templates/sync` |
| `DELETE /admin/templates/:id` | `DELETE /api/v1/templates/:id` |
| `GET /admin/templates/:id/button-clicks` | `GET /api/v1/templates/:id/button-clicks` |
| `GET /admin/button-clicks` | `GET /api/v1/button-clicks?user_id=X` |
| `GET /admin/leads/:phone/button-activity` | `GET /api/v1/leads/:phone/button-activity?user_id=X` |

---

## Overview

This is the **correct** API for dashboard integration. All endpoints are under `/api/v1/*` and require **NO authentication**.

```
┌──────────────┐                    ┌──────────────┐
│   Dashboard  │  ───── HTTP ─────► │  WhatsApp    │
│   (Frontend) │     No Auth!       │   Service    │
│              │                    │  (This API)  │
└──────────────┘                    └──────────────┘
```

### Base URL Configuration

```env
# Frontend .env
VITE_WHATSAPP_SERVICE_URL=http://localhost:4000
```

```typescript
// In your API service
const API_BASE = import.meta.env.VITE_WHATSAPP_SERVICE_URL;

// Example call - NO auth headers needed!
const response = await fetch(`${API_BASE}/api/v1/templates?phone_number_id=pn_123`);
```

---

## API Endpoints

### Quick Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| **Users** | | |
| POST | `/api/v1/users` | Create a new user |
| GET | `/api/v1/users/:userId` | Get user details |
| **Phone Numbers** | | |
| GET | `/api/v1/phone-numbers?user_id=X` | List phone numbers (WhatsApp & Instagram) |
| POST | `/api/v1/phone-numbers` | Add phone number (from Meta setup) |
| GET | `/api/v1/phone-numbers/:id` | Get phone number details |
| PATCH | `/api/v1/phone-numbers/:id` | Update phone number |
| DELETE | `/api/v1/phone-numbers/:id` | Delete phone number |
| **Agents** | | |
| GET | `/api/v1/agents?user_id=X` | List agents |
| POST | `/api/v1/agents` | Create agent (link to phone number) |
| GET | `/api/v1/agents/:agentId` | Get agent details |
| PATCH | `/api/v1/agents/:agentId` | Update agent |
| DELETE | `/api/v1/agents/:agentId` | Delete agent |
| **Templates** | | |
| GET | `/api/v1/templates?phone_number_id=X` | List approved templates |
| GET | `/api/v1/templates/:templateId` | Get template details + variables |
| POST | `/api/v1/templates` | Create template |
| POST | `/api/v1/templates/:templateId/submit` | Submit to Meta |
| POST | `/api/v1/templates/sync` | Sync from Meta |
| DELETE | `/api/v1/templates/:templateId` | Delete template |
| **Button Analytics** | | |
| GET | `/api/v1/templates/:templateId/button-clicks` | Template button stats |
| GET | `/api/v1/button-clicks?user_id=X` | All button clicks |
| GET | `/api/v1/leads/:phone/button-activity?user_id=X` | Lead's button clicks |
| **Messaging** | | |
| POST | `/api/v1/send` | Send template message |
| POST | `/api/v1/campaign` | Create campaign |
| GET | `/api/v1/campaign/:campaignId` | Campaign status |
| **Webchat/Widget** | | |
| POST | `/api/v1/webchat/channels` | Create webchat channel |
| GET | `/api/v1/webchat/channels?user_id=X` | List webchat channels |
| GET | `/api/v1/webchat/channels/:webchatId/embed` | Get widget embed code |
| DELETE | `/api/v1/webchat/channels/:webchatId` | Delete webchat channel |

---

## Users

### Create User

Create a new user account. This is required before adding phone numbers.

```http
POST /api/v1/users
Content-Type: application/json
```

**Request:**
```json
{
  "user_id": "usr_abc123def456",
  "email": "business@example.com",
  "company_name": "Acme Inc"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| user_id | string | Yes | Unique user identifier (from your system) |
| email | string | Yes | Unique email address |
| company_name | string | No | Company/Business name |

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "user_id": "usr_abc123def456",
    "email": "business@example.com",
    "company_name": "Acme Inc",
    "created_at": "2025-12-13T10:00:00.000Z",
    "updated_at": "2025-12-13T10:00:00.000Z"
  },
  "timestamp": "2025-12-13T10:00:00.000Z",
  "correlationId": "req_abc123"
}
```

**Error (409 Conflict):**
```json
{
  "success": false,
  "error": "Conflict",
  "message": "User with this user_id or email already exists",
  "timestamp": "2025-12-13T10:00:00.000Z",
  "correlationId": "req_abc123"
}
```

---

### Get User

```http
GET /api/v1/users/{userId}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user_id": "usr_abc123def456",
    "email": "business@example.com",
    "company_name": "Acme Inc",
    "credits": {
      "remaining_credits": 100,
      "total_used": 50
    },
    "created_at": "2025-12-13T10:00:00.000Z",
    "updated_at": "2025-12-13T10:00:00.000Z"
  },
  "timestamp": "2025-12-13T10:00:00.000Z",
  "correlationId": "req_abc123"
}
```

---

## Phone Numbers

### List Phone Numbers

Returns WhatsApp and Instagram phone numbers/accounts for a user.

```http
GET /api/v1/phone-numbers?user_id={userId}&platform={platform}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| user_id | string | Yes | User identifier |
| platform | string | No | Filter by `whatsapp` or `instagram` |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "pn_abc123def456",
      "user_id": "usr_456",
      "platform": "whatsapp",
      "meta_phone_number_id": "1234567890",
      "display_name": "+1 (234) 567-8900",
      "waba_id": "9876543210",
      "created_at": "2025-12-13T10:00:00.000Z",
      "updated_at": "2025-12-13T10:00:00.000Z"
    },
    {
      "id": "pn_xyz789ghi012",
      "user_id": "usr_456",
      "platform": "instagram",
      "meta_phone_number_id": "17841234567890",
      "display_name": "@yourbusiness",
      "waba_id": null,
      "created_at": "2025-12-13T09:00:00.000Z",
      "updated_at": "2025-12-13T09:00:00.000Z"
    }
  ],
  "timestamp": "2025-12-13T10:00:00.000Z",
  "correlationId": "req_abc123"
}
```

---

### Add Phone Number

Add a WhatsApp Business phone number or Instagram account from Meta setup.

```http
POST /api/v1/phone-numbers
Content-Type: application/json
```

**Request:**
```json
{
  "user_id": "usr_456",
  "platform": "whatsapp",
  "meta_phone_number_id": "1234567890",
  "access_token": "EAAxxxx...",
  "display_name": "+1 (234) 567-8900",
  "waba_id": "9876543210"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| user_id | string | Yes | User identifier |
| platform | string | Yes | `whatsapp` or `instagram` |
| meta_phone_number_id | string | Yes | Meta's phone_number_id (WABA) or Instagram Account ID |
| access_token | string | Yes | Meta access token |
| display_name | string | No | Human-readable name |
| waba_id | string | **Yes for WhatsApp** | WhatsApp Business Account ID (required for template management) |

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": "pn_abc123def456",
    "user_id": "usr_456",
    "platform": "whatsapp",
    "meta_phone_number_id": "1234567890",
    "display_name": "+1 (234) 567-8900",
    "waba_id": "9876543210",
    "created_at": "2025-12-13T10:00:00.000Z",
    "updated_at": "2025-12-13T10:00:00.000Z"
  },
  "timestamp": "2025-12-13T10:00:00.000Z",
  "correlationId": "req_abc123"
}
```

**Error (400 Bad Request - Missing waba_id for WhatsApp):**
```json
{
  "success": false,
  "error": "Bad Request",
  "message": "waba_id is required for WhatsApp phone numbers (needed for template management)",
  "timestamp": "2025-12-13T10:00:00.000Z",
  "correlationId": "req_abc123"
}
```

---

### Get Phone Number

```http
GET /api/v1/phone-numbers/{phoneNumberId}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "pn_abc123def456",
    "user_id": "usr_456",
    "platform": "whatsapp",
    "meta_phone_number_id": "1234567890",
    "display_name": "+1 (234) 567-8900",
    "waba_id": "9876543210",
    "created_at": "2025-12-13T10:00:00.000Z",
    "updated_at": "2025-12-13T10:00:00.000Z",
    "agent": {
      "agent_id": "agt_xyz789",
      "name": "Customer Support",
      "prompt_id": "prompt_abc123",
      "created_at": "2025-12-13T11:00:00.000Z"
    }
  },
  "timestamp": "2025-12-13T10:00:00.000Z",
  "correlationId": "req_abc123"
}
```

---

### Update Phone Number

Update access token, display name, or WABA ID.

```http
PATCH /api/v1/phone-numbers/{phoneNumberId}
Content-Type: application/json
```

**Request:**
```json
{
  "access_token": "EAAxxxx_new_token...",
  "display_name": "Main Business Line"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| access_token | string | No | New Meta access token |
| display_name | string | No | New display name |
| waba_id | string | No | WhatsApp Business Account ID |

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "pn_abc123def456",
    "user_id": "usr_456",
    "platform": "whatsapp",
    "meta_phone_number_id": "1234567890",
    "display_name": "Main Business Line",
    "waba_id": "9876543210",
    "created_at": "2025-12-13T10:00:00.000Z",
    "updated_at": "2025-12-13T12:00:00.000Z"
  },
  "timestamp": "2025-12-13T12:00:00.000Z",
  "correlationId": "req_abc123"
}
```

---

### Delete Phone Number

⚠️ **Cannot delete if an agent is linked.** Delete the agent first.

```http
DELETE /api/v1/phone-numbers/{phoneNumberId}
```

**Response:**
```json
{
  "success": true,
  "message": "Phone number deleted successfully",
  "timestamp": "2025-12-13T10:00:00.000Z",
  "correlationId": "req_abc123"
}
```

**Error (409 Conflict):**
```json
{
  "success": false,
  "error": "Conflict",
  "message": "Cannot delete phone number with an active agent. Delete the agent first.",
  "timestamp": "2025-12-13T10:00:00.000Z",
  "correlationId": "req_abc123"
}
```

---

## Agents

### List Agents

```http
GET /api/v1/agents?user_id={userId}
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "agent_id": "agt_xyz789abc123",
      "user_id": "usr_456",
      "phone_number_id": "pn_abc123def456",
      "prompt_id": "prompt_abc123",
      "name": "Customer Support Agent",
      "phone_number": {
        "platform": "whatsapp",
        "display_name": "+1 (234) 567-8900"
      },
      "created_at": "2025-12-13T10:00:00.000Z",
      "updated_at": "2025-12-13T10:00:00.000Z"
    }
  ],
  "timestamp": "2025-12-13T10:00:00.000Z",
  "correlationId": "req_abc123"
}
```

---

### Create Agent

Link an OpenAI prompt to a phone number/Instagram account.

```http
POST /api/v1/agents
Content-Type: application/json
```

**Request:**
```json
{
  "user_id": "usr_456",
  "phone_number_id": "pn_abc123def456",
  "prompt_id": "prompt_abc123",
  "name": "Customer Support Agent"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| user_id | string | Yes | User identifier |
| phone_number_id | string | Yes | Phone number ID (from `/api/v1/phone-numbers`) |
| prompt_id | string | Yes | OpenAI prompt ID from dashboard |
| name | string | Yes | Human-readable agent name |

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "agent_id": "agt_xyz789abc123",
    "user_id": "usr_456",
    "phone_number_id": "pn_abc123def456",
    "prompt_id": "prompt_abc123",
    "name": "Customer Support Agent",
    "created_at": "2025-12-13T10:00:00.000Z",
    "updated_at": "2025-12-13T10:00:00.000Z"
  },
  "timestamp": "2025-12-13T10:00:00.000Z",
  "correlationId": "req_abc123"
}
```

**Error (409 Conflict):**
```json
{
  "success": false,
  "error": "Conflict",
  "message": "Phone number already has an active agent. Update or delete the existing agent first.",
  "timestamp": "2025-12-13T10:00:00.000Z",
  "correlationId": "req_abc123"
}
```

---

### Get Agent

```http
GET /api/v1/agents/{agentId}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "agent_id": "agt_xyz789abc123",
    "user_id": "usr_456",
    "phone_number_id": "pn_abc123def456",
    "prompt_id": "prompt_abc123",
    "name": "Customer Support Agent",
    "phone_number": {
      "platform": "whatsapp",
      "display_name": "+1 (234) 567-8900",
      "meta_phone_number_id": "1234567890"
    },
    "stats": {
      "total_conversations": 150,
      "active_conversations": 12
    },
    "created_at": "2025-12-13T10:00:00.000Z",
    "updated_at": "2025-12-13T10:00:00.000Z"
  },
  "timestamp": "2025-12-13T10:00:00.000Z",
  "correlationId": "req_abc123"
}
```

---

### Update Agent

Update agent name or linked OpenAI prompt.

```http
PATCH /api/v1/agents/{agentId}
Content-Type: application/json
```

**Request:**
```json
{
  "name": "Sales Agent",
  "prompt_id": "prompt_new456"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | No | New agent name |
| prompt_id | string | No | New OpenAI prompt ID |

**Response:**
```json
{
  "success": true,
  "data": {
    "agent_id": "agt_xyz789abc123",
    "user_id": "usr_456",
    "phone_number_id": "pn_abc123def456",
    "prompt_id": "prompt_new456",
    "name": "Sales Agent",
    "created_at": "2025-12-13T10:00:00.000Z",
    "updated_at": "2025-12-13T12:00:00.000Z"
  },
  "timestamp": "2025-12-13T12:00:00.000Z",
  "correlationId": "req_abc123"
}
```

---

### Delete Agent

```http
DELETE /api/v1/agents/{agentId}
```

**Response:**
```json
{
  "success": true,
  "message": "Agent deleted successfully",
  "timestamp": "2025-12-13T10:00:00.000Z",
  "correlationId": "req_abc123"
}
```

---

## Templates

### List Templates

Returns only **APPROVED** templates ready for sending.

```http
GET /api/v1/templates?phone_number_id={phoneNumberId}
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "template_id": "tpl_abc123",
      "name": "order_confirmation",
      "category": "UTILITY",
      "language": "en",
      "components": [...],
      "variables": [
        {
          "position": 1,
          "variable_name": "customer_name",
          "default_value": "Customer",
          "sample_value": "John"
        }
      ]
    }
  ],
  "timestamp": "2025-12-13T10:00:00.000Z",
  "correlationId": "req_abc123"
}
```

---

### Get Template Details

Returns template with full variable metadata and analytics.

```http
GET /api/v1/templates/{templateId}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "template": {
      "template_id": "tpl_abc123",
      "user_id": "user_456",
      "phone_number_id": "pn_789",
      "name": "order_confirmation",
      "category": "UTILITY",
      "status": "APPROVED",
      "language": "en",
      "components": [
        {
          "type": "BODY",
          "text": "Hi {{1}}! Your order #{{2}} is confirmed."
        }
      ],
      "meta_template_id": "123456789",
      "created_at": "2025-12-01T10:00:00.000Z"
    },
    "variables": [
      {
        "variable_id": "var_001",
        "variable_name": "customer_name",
        "position": 1,
        "component_type": "BODY",
        "extraction_field": null,
        "default_value": "Customer",
        "sample_value": "John",
        "description": "Customer's full name",
        "is_required": false,
        "placeholder": "e.g., John Smith"
      },
      {
        "variable_id": "var_002",
        "variable_name": "order_id",
        "position": 2,
        "component_type": "BODY",
        "default_value": null,
        "sample_value": "12345",
        "description": "Order number",
        "is_required": true
      }
    ],
    "analytics": {
      "total_sends": 150,
      "delivered_count": 145,
      "read_count": 120,
      "failed_count": 5
    }
  },
  "timestamp": "2025-12-13T10:00:00.000Z",
  "correlationId": "req_abc123"
}
```

---

### Create Template

```http
POST /api/v1/templates
Content-Type: application/json
```

**Request:**
```json
{
  "user_id": "user_456",
  "phone_number_id": "pn_789",
  "name": "order_update",
  "category": "UTILITY",
  "language": "en",
  "components": [
    {
      "type": "BODY",
      "text": "Hi {{1}}! Your order #{{2}} status: {{3}}",
      "example": {
        "body_text": [["John", "12345", "shipped"]]
      }
    }
  ],
  "variables": [
    {
      "variable_name": "customer_name",
      "position": 1,
      "description": "Customer's name",
      "default_value": "Customer",
      "sample_value": "John",
      "is_required": false
    },
    {
      "variable_name": "order_id",
      "position": 2,
      "description": "Order number",
      "sample_value": "12345",
      "is_required": true
    },
    {
      "variable_name": "status",
      "position": 3,
      "description": "Order status",
      "default_value": "processing",
      "sample_value": "shipped"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "template_id": "tpl_new123",
    "user_id": "user_456",
    "phone_number_id": "pn_789",
    "name": "order_update",
    "category": "UTILITY",
    "status": "DRAFT",
    "language": "en",
    "created_at": "2025-12-13T10:00:00.000Z"
  },
  "timestamp": "2025-12-13T10:00:00.000Z",
  "correlationId": "req_abc123"
}
```

---

### Submit Template to Meta

Submits a DRAFT template to Meta for approval.

```http
POST /api/v1/templates/{templateId}/submit
```

**Response:**
```json
{
  "success": true,
  "data": {
    "template_id": "tpl_new123",
    "status": "PENDING",
    "meta_template_id": "987654321",
    "submitted_at": "2025-12-13T10:00:00.000Z"
  },
  "timestamp": "2025-12-13T10:00:00.000Z",
  "correlationId": "req_abc123"
}
```

---

### Sync Templates from Meta

Imports existing approved templates from Meta that aren't in the database.

```http
POST /api/v1/templates/sync
Content-Type: application/json
```

**Request:**
```json
{
  "user_id": "user_456",
  "phone_number_id": "pn_789"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "imported": [
      { "template_id": "tpl_imported1", "name": "existing_template" }
    ],
    "updated": [],
    "errors": [],
    "summary": {
      "totalImported": 1,
      "totalUpdated": 0,
      "totalErrors": 0
    }
  },
  "timestamp": "2025-12-13T10:00:00.000Z",
  "correlationId": "req_abc123"
}
```

---

### Delete Template

```http
DELETE /api/v1/templates/{templateId}
```

**Response:**
```json
{
  "success": true,
  "message": "Template deleted successfully",
  "timestamp": "2025-12-13T10:00:00.000Z",
  "correlationId": "req_abc123"
}
```

---

## Button Click Analytics

### Get Template Button Clicks

```http
GET /api/v1/templates/{templateId}/button-clicks
```

**Response:**
```json
{
  "success": true,
  "data": {
    "template_id": "tpl_abc123",
    "template_name": "promo_offer",
    "buttons": [
      {
        "button_id": "get_started",
        "button_text": "Get Started",
        "total_clicks": 45,
        "unique_clicks": 32
      },
      {
        "button_id": "learn_more",
        "button_text": "Learn More",
        "total_clicks": 28,
        "unique_clicks": 25
      }
    ],
    "total_clicks": 73
  },
  "timestamp": "2025-12-13T10:00:00.000Z",
  "correlationId": "req_abc123"
}
```

---

### List All Button Clicks

```http
GET /api/v1/button-clicks?user_id={userId}&template_id={templateId}&limit=50&offset=0
```

| Param | Required | Description |
|-------|----------|-------------|
| `user_id` | **Yes** | Filter by user |
| `template_id` | No | Filter by template |
| `limit` | No | Results per page (default: 50) |
| `offset` | No | Pagination offset |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "click_id": "click_001",
      "template_id": "tpl_abc123",
      "button_id": "get_started",
      "button_text": "Get Started",
      "customer_phone": "+14155551234",
      "clicked_at": "2025-12-13T09:30:00.000Z"
    }
  ],
  "pagination": {
    "total": 150,
    "limit": 50,
    "offset": 0
  },
  "timestamp": "2025-12-13T10:00:00.000Z",
  "correlationId": "req_abc123"
}
```

---

### Get Lead Button Activity

See all buttons a specific lead has clicked.

```http
GET /api/v1/leads/{customerPhone}/button-activity?user_id={userId}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "customer_phone": "+14155551234",
    "buttons_clicked": [
      {
        "template_name": "promo_offer",
        "button_text": "Get Started",
        "clicked_at": "2025-12-13T09:30:00.000Z"
      },
      {
        "template_name": "follow_up",
        "button_text": "Schedule Demo",
        "clicked_at": "2025-12-12T14:20:00.000Z"
      }
    ],
    "total_clicks": 5
  },
  "timestamp": "2025-12-13T10:00:00.000Z",
  "correlationId": "req_abc123"
}
```

---

## Messaging

### Send Single Message

```http
POST /api/v1/send
Content-Type: application/json
```

**Request:**
```json
{
  "phone_number_id": "pn_789",
  "template_id": "tpl_abc123",
  "contact": {
    "phone": "+14155551234",
    "name": "Sarah Johnson",
    "email": "sarah@example.com",
    "company": "TechCorp"
  },
  "variables": {
    "1": "Sarah Johnson",
    "2": "ORD-98765",
    "3": "shipped"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "message_id": "wamid.xxx",
    "contact_id": "contact_456",
    "conversation_id": "conv_789",
    "openai_conversation_id": "resp_xxx",
    "credits_remaining": 99
  },
  "timestamp": "2025-12-13T10:00:00.000Z",
  "correlationId": "req_abc123"
}
```

---

### Create Campaign

```http
POST /api/v1/campaign
Content-Type: application/json
```

**Request:**
```json
{
  "phone_number_id": "pn_789",
  "template_id": "tpl_abc123",
  "name": "Holiday Promo",
  "auto_start": true,
  "contacts": [
    {
      "phone": "+14155551234",
      "name": "Sarah",
      "variables": { "1": "Sarah", "2": "25%" }
    },
    {
      "phone": "+14155555678",
      "name": "John",
      "variables": { "1": "John", "2": "30%" }
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "campaign_id": "camp_123",
    "name": "Holiday Promo",
    "status": "RUNNING",
    "total_recipients": 2,
    "contacts_created": 2,
    "contacts_updated": 0,
    "credits_reserved": 2
  },
  "timestamp": "2025-12-13T10:00:00.000Z",
  "correlationId": "req_abc123"
}
```

---

### Get Campaign Status

```http
GET /api/v1/campaign/{campaignId}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "campaign_id": "camp_123",
    "name": "Holiday Promo",
    "status": "COMPLETED",
    "total_recipients": 100,
    "sent_count": 100,
    "delivered_count": 95,
    "read_count": 72,
    "failed_count": 5,
    "progress_percent": 100,
    "started_at": "2025-12-13T10:00:00.000Z",
    "completed_at": "2025-12-13T10:15:00.000Z",
    "recipient_stats": {
      "pending": 0,
      "sent": 0,
      "delivered": 95,
      "read": 72,
      "failed": 5
    }
  },
  "timestamp": "2025-12-13T10:00:00.000Z",
  "correlationId": "req_abc123"
}
```

---

## Error Handling

### Standard Error Response

```json
{
  "success": false,
  "error": "Bad Request",
  "message": "phone_number_id query parameter is required",
  "timestamp": "2025-12-13T10:00:00.000Z",
  "correlationId": "req_abc123"
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request - Invalid parameters |
| 402 | Payment Required - Insufficient credits |
| 404 | Not Found - Resource doesn't exist |
| 500 | Internal Server Error |

---

## Dashboard TypeScript Service

Complete API service for dashboard integration:

```typescript
// services/whatsappApi.ts

const API_BASE = import.meta.env.VITE_WHATSAPP_SERVICE_URL;

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: string;
  correlationId: string;
}

// Helper for API calls
async function apiCall<T>(
  endpoint: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });
  return response.json();
}

// ============ Phone Numbers ============

export async function listPhoneNumbers(userId: string) {
  return apiCall<PhoneNumber[]>(`/api/v1/phone-numbers?user_id=${userId}`);
}

// ============ Templates ============

export async function listTemplates(phoneNumberId: string) {
  return apiCall<Template[]>(`/api/v1/templates?phone_number_id=${phoneNumberId}`);
}

export async function getTemplate(templateId: string) {
  return apiCall<{ template: Template; variables: Variable[]; analytics: Analytics }>(
    `/api/v1/templates/${templateId}`
  );
}

export async function createTemplate(data: CreateTemplateRequest) {
  return apiCall<Template>('/api/v1/templates', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function submitTemplate(templateId: string) {
  return apiCall<Template>(`/api/v1/templates/${templateId}/submit`, {
    method: 'POST',
  });
}

export async function syncTemplates(userId: string, phoneNumberId: string) {
  return apiCall<SyncResult>('/api/v1/templates/sync', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, phone_number_id: phoneNumberId }),
  });
}

export async function deleteTemplate(templateId: string) {
  return apiCall<void>(`/api/v1/templates/${templateId}`, {
    method: 'DELETE',
  });
}

// ============ Button Analytics ============

export async function getTemplateButtonClicks(templateId: string) {
  return apiCall<ButtonAnalytics>(`/api/v1/templates/${templateId}/button-clicks`);
}

export async function listButtonClicks(userId: string, options?: { templateId?: string; limit?: number; offset?: number }) {
  const params = new URLSearchParams({ user_id: userId });
  if (options?.templateId) params.append('template_id', options.templateId);
  if (options?.limit) params.append('limit', String(options.limit));
  if (options?.offset) params.append('offset', String(options.offset));
  
  return apiCall<ButtonClick[]>(`/api/v1/button-clicks?${params}`);
}

export async function getLeadButtonActivity(customerPhone: string, userId: string) {
  return apiCall<LeadActivity>(`/api/v1/leads/${encodeURIComponent(customerPhone)}/button-activity?user_id=${userId}`);
}

// ============ Messaging ============

export async function sendMessage(data: SendMessageRequest) {
  return apiCall<SendMessageResponse>('/api/v1/send', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function createCampaign(data: CreateCampaignRequest) {
  return apiCall<Campaign>('/api/v1/campaign', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getCampaignStatus(campaignId: string) {
  return apiCall<CampaignStatus>(`/api/v1/campaign/${campaignId}`);
}

// ============ Webchat / Widget ============

export async function createWebchatChannel(data: { user_id: string; prompt_id: string; name: string }) {
  return apiCall<WebchatChannel>('/api/v1/webchat/channels', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function listWebchatChannels(userId: string) {
  return apiCall<{ channels: WebchatChannel[]; count: number }>(`/api/v1/webchat/channels?user_id=${userId}`);
}

export async function getWebchatEmbed(webchatId: string) {
  return apiCall<WebchatEmbed>(`/api/v1/webchat/channels/${webchatId}/embed`);
}

export async function deleteWebchatChannel(webchatId: string) {
  return apiCall<void>(`/api/v1/webchat/channels/${webchatId}`, {
    method: 'DELETE',
  });
}
```

---

## Webchat / Widget Management

### Create Webchat Channel

Create a new webchat channel with an AI agent. Returns embed code for your website.

```http
POST /api/v1/webchat/channels
Content-Type: application/json
```

**Option 1: Create with new prompt_id**
```json
{
  "user_id": "usr_abc123",
  "prompt_id": "prompt_sales_bot_v1",
  "name": "Customer Support Chat"
}
```

**Option 2: Copy from existing agent (reuse AI behavior)**
```json
{
  "user_id": "usr_abc123",
  "agent_id": "agent_whatsapp_xyz",
  "name": "Website Chat (same AI as WhatsApp)"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| user_id | string | Yes | User identifier |
| prompt_id | string | One of | OpenAI Responses API prompt ID (creates new agent) |
| agent_id | string | One of | Existing agent ID to copy prompt from (reuse AI behavior) |
| name | string | Yes | Display name for the chat widget |

> **Note:** Provide either `prompt_id` OR `agent_id`, not both. Using `agent_id` copies the AI behavior (prompt) from an existing agent, allowing you to have the same AI on multiple platforms (WhatsApp, Instagram, Webchat).

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "webchat_id": "webchat_usr_abc123_xyz789",
    "phone_number_id": "pn_webchat_usr_abc123_xyz789",
    "agent_id": "agent_webchat_usr_abc123_xyz789",
    "prompt_id": "prompt_sales_bot_v1",
    "source_agent_id": null,
    "name": "Customer Support Chat",
    "embed_code": "<!-- Customer Support Chat AI Chat Widget -->\n<webchat-widget \n  agent-id=\"webchat_usr_abc123_xyz789\"\n  primary-color=\"#3B82F6\"\n  secondary-color=\"#EFF6FF\">\n</webchat-widget>\n<script src=\"https://your-api.com/widget.js\" async></script>",
    "config_url": "https://your-api.com/widget-config.html?agent_id=webchat_usr_abc123_xyz789",
    "created_at": "2025-12-13T10:00:00.000Z"
  },
  "timestamp": "2025-12-13T10:00:00.000Z",
  "correlationId": "req_abc123"
}
```

---

### List Webchat Channels

```http
GET /api/v1/webchat/channels?user_id={userId}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "channels": [
      {
        "webchat_id": "webchat_usr_abc123_xyz789",
        "phone_number_id": "pn_webchat_usr_abc123_xyz789",
        "agent_id": "agent_webchat_usr_abc123_xyz789",
        "prompt_id": "prompt_sales_bot_v1",
        "name": "Customer Support Chat",
        "embed_code": "...",
        "config_url": "https://your-api.com/widget-config.html?agent_id=webchat_usr_abc123_xyz789",
        "created_at": "2025-12-13T10:00:00.000Z"
      }
    ],
    "count": 1
  },
  "timestamp": "2025-12-13T10:00:00.000Z",
  "correlationId": "req_abc123"
}
```

---

### Get Widget Embed Code

```http
GET /api/v1/webchat/channels/{webchatId}/embed
```

**Response:**
```json
{
  "success": true,
  "data": {
    "webchat_id": "webchat_usr_abc123_xyz789",
    "name": "Customer Support Chat",
    "embed_code": "<!-- Customer Support Chat AI Chat Widget -->\n<webchat-widget \n  agent-id=\"webchat_usr_abc123_xyz789\"\n  primary-color=\"#3B82F6\"\n  secondary-color=\"#EFF6FF\">\n</webchat-widget>\n<script src=\"https://your-api.com/widget.js\" async></script>",
    "config_url": "https://your-api.com/widget-config.html?agent_id=webchat_usr_abc123_xyz789"
  },
  "timestamp": "2025-12-13T10:00:00.000Z",
  "correlationId": "req_abc123"
}
```

---

### Delete Webchat Channel

```http
DELETE /api/v1/webchat/channels/{webchatId}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Webchat channel webchat_usr_abc123_xyz789 deleted successfully",
  "timestamp": "2025-12-13T10:00:00.000Z",
  "correlationId": "req_abc123"
}
```

---

## Migration Checklist

If your dashboard was using `/admin/*` endpoints:

- [ ] Update `VITE_WHATSAPP_SERVICE_URL` if needed
- [ ] Change all `/admin/templates` calls to `/api/v1/templates`
- [ ] Remove any `Authorization: Bearer` headers
- [ ] Update query params: `userId` → `user_id`, `phoneNumberId` → `phone_number_id`
- [ ] Test all template operations (list, get, create, submit, delete)
- [ ] Test button click analytics endpoints
- [ ] Test messaging endpoints

---

## Related Documentation

- [TEMPLATE_API_REFERENCE.md](TEMPLATE_API_REFERENCE.md) - Detailed template system (update paths!)
- [DASHBOARD_VARIABLE_INTEGRATION_GUIDE.md](DASHBOARD_VARIABLE_INTEGRATION_GUIDE.md) - Variable mapping
- [UPDATE_DYNAMIC_VARIABLE_SCHEMA_API.md](UPDATE_DYNAMIC_VARIABLE_SCHEMA_API.md) - Schema changes
