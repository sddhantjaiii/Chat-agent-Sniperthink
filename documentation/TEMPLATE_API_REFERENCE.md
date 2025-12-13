# WhatsApp Template API Reference

Complete API documentation for managing WhatsApp message templates with full media support (IMAGE, VIDEO, DOCUMENT, LOCATION headers) and button click tracking.

> **⚠️ IMPORTANT:** Use `/api/v1/*` endpoints (NO authentication). See [EXTERNAL_API_REFERENCE.md](EXTERNAL_API_REFERENCE.md) for the correct endpoints.

---

## Table of Contents

1. [Overview](#overview)
2. [Base URL Configuration](#base-url-configuration)
3. [Cloudflare R2 Setup (Dashboard Requirement)](#cloudflare-r2-setup-dashboard-requirement)
4. [Template CRUD Operations](#template-crud-operations)
5. [Template Submission to Meta](#template-submission-to-meta)
6. [Template Syncing](#template-syncing)
7. [Button Click Analytics](#button-click-analytics)
8. [Media Header Types](#media-header-types)
9. [Button Types](#button-types)
10. [Component Structure](#component-structure)
11. [Error Handling](#error-handling)
12. [Webhooks](#webhooks)

---

## Overview

This API enables complete WhatsApp template management:

- **Create templates** with TEXT, IMAGE, VIDEO, DOCUMENT, or LOCATION headers
- **Submit templates** to Meta for approval
- **Sync templates** from Meta to import existing approved templates
- **Track button clicks** for lead engagement analytics
- **Query lead activity** to see which buttons a specific lead has clicked

### Architecture Flow

```
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│   Dashboard  │ ──── │  This Server │ ──── │   Meta API   │
│   (Frontend) │      │  (WhatsApp   │      │  (Graph API) │
│              │      │   Service)   │      │              │
└──────────────┘      └──────────────┘      └──────────────┘
       │                     │
       │  /api/v1/* (no auth)│
       ▼                     ▼
┌──────────────┐      ┌──────────────┐
│ Cloudflare R2│      │  PostgreSQL  │
│ (Media Store)│      │  (Database)  │
│  [TO SETUP]  │      │              │
└──────────────┘      └──────────────┘
```

**Key Points:**
- **No authentication required** - Internal microservice communication
- Dashboard will upload media to R2 and send public URLs to this server
- This server is the sole interface with Meta's Graph API
- Button clicks are automatically tracked via webhooks

---

## Base URL Configuration

The dashboard connects to this WhatsApp service using the environment variable:

```env
# Frontend .env file
VITE_WHATSAPP_SERVICE_URL=http://localhost:4000
```

### Usage in Dashboard Code

```typescript
// services/templateApi.ts
const API_BASE = import.meta.env.VITE_WHATSAPP_SERVICE_URL;

// Example: List templates
const response = await fetch(`${API_BASE}/admin/templates`);
```

### Environment Values

| Environment | `VITE_WHATSAPP_SERVICE_URL` |
|-------------|------------------------------|
| Development | `http://localhost:4000` |
| Staging | `https://staging-whatsapp.yourcompany.com` |
| Production | `https://whatsapp-api.yourcompany.com` |

---

## Cloudflare R2 Setup (Dashboard Requirement)

### ⚠️ Implementation Required in Dashboard

The dashboard needs to implement Cloudflare R2 integration for media template support. This server expects **public URLs** for media files - it does not handle file uploads.

### Why R2?

- **Cost-effective**: No egress fees (unlike S3)
- **S3-compatible**: Easy to integrate with existing S3 libraries
- **Global CDN**: Fast media delivery for Meta to fetch

### What Dashboard Needs to Implement

#### 1. R2 Bucket Setup

```
Cloudflare Dashboard → R2 → Create Bucket
- Bucket name: `whatsapp-media` (or similar)
- Enable public access for the bucket
```

#### 2. Dashboard Environment Variables

```env
# Dashboard .env
VITE_R2_ACCOUNT_ID=your_cloudflare_account_id
VITE_R2_ACCESS_KEY_ID=your_r2_access_key
VITE_R2_SECRET_ACCESS_KEY=your_r2_secret_key
VITE_R2_BUCKET_NAME=whatsapp-media
VITE_R2_PUBLIC_URL=https://pub-xxxxx.r2.dev
```

#### 3. Upload Flow to Implement

```typescript
// Dashboard: services/mediaUpload.ts

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

async function uploadTemplateMedia(file: File): Promise<string> {
  const key = `templates/${Date.now()}-${file.name}`;
  
  await r2Client.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: file,
    ContentType: file.type,
  }));
  
  // Return public URL
  return `${R2_PUBLIC_URL}/${key}`;
}
```

#### 4. Integration with Template Creation

```typescript
// When creating template with media header
async function createTemplateWithImage(templateData: any, imageFile: File) {
  // Step 1: Upload to R2
  const mediaUrl = await uploadTemplateMedia(imageFile);
  
  // Step 2: Send to WhatsApp service with public URL
  const response = await fetch(`${VITE_WHATSAPP_SERVICE_URL}/admin/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...templateData,
      components: [
        {
          type: 'HEADER',
          format: 'IMAGE',
          example: {
            header_handle: [mediaUrl]  // Public R2 URL
          }
        },
        // ... other components
      ]
    })
  });
}
```

### Media Requirements by Type

| Type | Formats | Max Size | Notes |
|------|---------|----------|-------|
| IMAGE | JPG, PNG | 5MB | Meta downloads and re-hosts |
| VIDEO | MP4 | 16MB | Must include audio codec |
| DOCUMENT | PDF | 100MB | Store filename for display |
| LOCATION | N/A | N/A | Sent at runtime, no upload |

### Complete Dashboard Integration Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ User Flow: Creating Template with Image Header                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. User fills template form in dashboard                       │
│  2. User selects image file                                     │
│  3. Dashboard uploads image to R2 → gets public URL             │
│  4. Dashboard calls POST /admin/templates with:                 │
│     - Template data                                             │
│     - Media URL in components                                   │
│  5. WhatsApp Service stores template (status: DRAFT)            │
│  6. User clicks "Submit for Approval"                           │
│  7. Dashboard calls POST /admin/templates/:id/submit            │
│  8. WhatsApp Service submits to Meta                            │
│  9. Meta downloads image from R2 URL                            │
│ 10. Meta processes and returns status (PENDING → APPROVED)      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Template CRUD Operations

### List All Templates

```http
GET ${VITE_WHATSAPP_SERVICE_URL}/admin/templates?limit=50&offset=0&status=APPROVED
```

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | integer | 50 | Results per page |
| `offset` | integer | 0 | Pagination offset |
| `status` | string | - | Filter by status: `DRAFT`, `PENDING`, `APPROVED`, `REJECTED`, `PAUSED`, `DISABLED` |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "template_id": "tpl_abc123",
      "user_id": "user_123",
      "phone_number_id": "pn_456",
      "name": "welcome_message",
      "category": "MARKETING",
      "status": "APPROVED",
      "language": "en",
      "header_type": "IMAGE",
      "header_media_url": "https://media.example.com/welcome.jpg",
      "meta_template_id": "123456789",
      "components": [
        {
          "type": "HEADER",
          "format": "IMAGE",
          "example": {
            "header_handle": ["https://media.example.com/welcome.jpg"]
          }
        },
        {
          "type": "BODY",
          "text": "Hello {{1}}! Welcome to our service.",
          "example": {
            "body_text": [["John"]]
          }
        },
        {
          "type": "BUTTONS",
          "buttons": [
            {
              "type": "QUICK_REPLY",
              "text": "Get Started"
            },
            {
              "type": "QUICK_REPLY",
              "text": "Learn More"
            }
          ]
        }
      ],
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T12:00:00Z"
    }
  ],
  "pagination": {
    "total": 25,
    "limit": 50,
    "offset": 0
  },
  "timestamp": "2024-01-15T14:30:00Z",
  "correlationId": "req_xyz789"
}
```

---

### Get Single Template

```http
GET ${VITE_WHATSAPP_SERVICE_URL}/admin/templates/:templateId
```

**Response:**
```json
{
  "success": true,
  "data": {
    "template": {
      "template_id": "tpl_abc123",
      "name": "welcome_message",
      "category": "MARKETING",
      "status": "APPROVED",
      "header_type": "IMAGE",
      "header_media_url": "https://media.example.com/welcome.jpg",
      "components": [...]
    },
    "variables": [
      {
        "variable_id": "var_123",
        "variable_name": "customer_name",
        "position": 1,
        "component_type": "BODY",
        "extraction_field": "name",
        "default_value": "Customer",
        "sample_value": "John"
      }
    ],
    "analytics": {
      "totalSent": 150,
      "totalDelivered": 145,
      "totalRead": 120,
      "totalFailed": 5,
      "deliveryRate": 96.67,
      "readRate": 80.0
    }
  },
  "timestamp": "2024-01-15T14:30:00Z",
  "correlationId": "req_xyz789"
}
```

---

### Create Template

```http
POST ${VITE_WHATSAPP_SERVICE_URL}/admin/templates
Content-Type: application/json
```

**Request Body:**
```json
{
  "user_id": "user_123",
  "phone_number_id": "pn_456",
  "name": "order_confirmation",
  "category": "UTILITY",
  "components": [
    {
      "type": "HEADER",
      "format": "IMAGE",
      "example": {
        "header_handle": ["https://media.example.com/order-header.jpg"]
      }
    },
    {
      "type": "BODY",
      "text": "Hi {{1}}! Your order #{{2}} has been confirmed. Total: ${{3}}",
      "example": {
        "body_text": [["John", "12345", "99.99"]]
      }
    },
    {
      "type": "FOOTER",
      "text": "Reply HELP for assistance"
    },
    {
      "type": "BUTTONS",
      "buttons": [
        {
          "type": "QUICK_REPLY",
          "text": "Track Order"
        },
        {
          "type": "URL",
          "text": "View Details",
          "url": "https://shop.example.com/orders/{{1}}",
          "example": ["12345"]
        }
      ]
    }
  ],
  "variables": [
    {
      "variable_name": "customer_name",
      "position": 1,
      "component_type": "BODY",
      "extraction_field": "name",
      "default_value": "Customer",
      "sample_value": "John"
    },
    {
      "variable_name": "order_id",
      "position": 2,
      "component_type": "BODY",
      "sample_value": "12345"
    },
    {
      "variable_name": "total",
      "position": 3,
      "component_type": "BODY",
      "sample_value": "99.99"
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
    "name": "order_confirmation",
    "category": "UTILITY",
    "status": "DRAFT",
    "created_at": "2024-01-15T14:30:00Z"
  },
  "timestamp": "2024-01-15T14:30:00Z",
  "correlationId": "req_xyz789"
}
```

---

### Delete Template

```http
DELETE ${VITE_WHATSAPP_SERVICE_URL}/admin/templates/:templateId
```

**Response:**
```json
{
  "success": true,
  "message": "Template deleted successfully",
  "timestamp": "2024-01-15T14:30:00Z",
  "correlationId": "req_xyz789"
}
```

> **Note:** If the template has been submitted to Meta, it will also be deleted from Meta's systems.

---

## Template Submission to Meta

### Submit Template for Approval

```http
POST ${VITE_WHATSAPP_SERVICE_URL}/admin/templates/:templateId/submit
```

**What Happens:**
1. Server retrieves template from database
2. Builds Meta-compliant component structure
3. For media headers: Meta downloads from your R2 URL
4. Submits to Meta Graph API
5. Updates local template with `meta_template_id`
6. Status changes to `PENDING`

**Response:**
```json
{
  "success": true,
  "data": {
    "template_id": "tpl_abc123",
    "meta_template_id": "123456789",
    "status": "PENDING",
    "submitted_at": "2024-01-15T14:30:00Z"
  },
  "timestamp": "2024-01-15T14:30:00Z",
  "correlationId": "req_xyz789"
}
```

**Possible Errors:**

| Error | Cause | Solution |
|-------|-------|----------|
| `Template not found` | Invalid templateId | Check template exists |
| `Template already submitted` | Already has meta_template_id | Use sync to check status |
| `Media URL not accessible` | R2 URL not public | Enable public access on R2 |
| `Invalid component structure` | Missing required fields | Check component format |

---

## Template Syncing

### Sync Templates from Meta

Import existing approved templates from Meta that aren't in your database.

```http
POST ${VITE_WHATSAPP_SERVICE_URL}/admin/templates/sync
Content-Type: application/json

{
  "user_id": "user_123",
  "phone_number_id": "pn_456"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "imported": [
      {
        "template_id": "tpl_imported1",
        "name": "legacy_welcome",
        "meta_template_id": "987654321"
      }
    ],
    "updated": [
      {
        "template_id": "tpl_existing",
        "name": "promo_message",
        "changes": ["status: PENDING -> APPROVED"]
      }
    ],
    "errors": [],
    "summary": {
      "totalImported": 1,
      "totalUpdated": 1,
      "totalErrors": 0
    }
  },
  "timestamp": "2024-01-15T14:30:00Z",
  "correlationId": "req_xyz789"
}
```

---

## Button Click Analytics

### Get Button Clicks for a Template

```http
GET ${VITE_WHATSAPP_SERVICE_URL}/admin/templates/:templateId/button-clicks
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "template_id": "tpl_abc123",
      "template_name": "welcome_message",
      "button_id": "get_started",
      "button_text": "Get Started",
      "total_clicks": 450,
      "unique_leads": 380,
      "click_rate": 25.3
    },
    {
      "template_id": "tpl_abc123",
      "template_name": "welcome_message",
      "button_id": "learn_more",
      "button_text": "Learn More",
      "total_clicks": 280,
      "unique_leads": 250,
      "click_rate": 15.7
    }
  ],
  "timestamp": "2024-01-15T14:30:00Z",
  "correlationId": "req_xyz789"
}
```

---

### List All Button Clicks

```http
GET ${VITE_WHATSAPP_SERVICE_URL}/admin/button-clicks?userId=user_123&templateId=tpl_abc&limit=50&offset=0
```

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | string | **Yes** | Filter by user |
| `templateId` | string | No | Filter by template |
| `limit` | integer | No | Results per page (default: 50) |
| `offset` | integer | No | Pagination offset |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "click_id": "click_123",
      "template_id": "tpl_abc123",
      "button_id": "get_started",
      "button_text": "Get Started",
      "customer_phone": "+14155551234",
      "contact_id": "contact_456",
      "conversation_id": "conv_789",
      "clicked_at": "2024-01-15T14:25:00Z"
    }
  ],
  "pagination": {
    "total": 1250,
    "limit": 50,
    "offset": 0
  },
  "timestamp": "2024-01-15T14:30:00Z",
  "correlationId": "req_xyz789"
}
```

---

### Get Lead Button Activity

See which buttons a specific lead has clicked across all templates.

```http
GET ${VITE_WHATSAPP_SERVICE_URL}/admin/leads/:customerPhone/button-activity?userId=user_123
```

**Response:**
```json
{
  "success": true,
  "data": {
    "customer_phone": "+14155551234",
    "contact_id": "contact_456",
    "contact_name": "John Smith",
    "buttons_clicked": [
      {
        "button_id": "get_started",
        "button_text": "Get Started",
        "template_name": "welcome_message",
        "clicked_at": "2024-01-15T14:25:00Z"
      },
      {
        "button_id": "view_pricing",
        "button_text": "View Pricing",
        "template_name": "promo_offer",
        "clicked_at": "2024-01-14T10:30:00Z"
      }
    ],
    "total_clicks": 2,
    "last_click_at": "2024-01-15T14:25:00Z"
  },
  "timestamp": "2024-01-15T14:30:00Z",
  "correlationId": "req_xyz789"
}
```

---

## Media Header Types

### TEXT Header

```json
{
  "type": "HEADER",
  "format": "TEXT",
  "text": "Hello {{1}}!",
  "example": {
    "header_text": ["John"]
  }
}
```

**Limits:** Max 60 characters

---

### IMAGE Header

```json
{
  "type": "HEADER",
  "format": "IMAGE",
  "example": {
    "header_handle": ["https://media.example.com/promo.jpg"]
  }
}
```

**Requirements:**
- Formats: JPG, PNG
- Max size: 5MB
- Recommended: 800x800 pixels

---

### VIDEO Header

```json
{
  "type": "HEADER",
  "format": "VIDEO",
  "example": {
    "header_handle": ["https://media.example.com/intro.mp4"]
  }
}
```

**Requirements:**
- Format: MP4
- Max size: 16MB
- Must include audio codec

---

### DOCUMENT Header

```json
{
  "type": "HEADER",
  "format": "DOCUMENT",
  "example": {
    "header_handle": ["https://media.example.com/catalog.pdf"]
  }
}
```

**Requirements:**
- Format: PDF
- Max size: 100MB
- Include filename in database for download display

---

### LOCATION Header

```json
{
  "type": "HEADER",
  "format": "LOCATION"
}
```

**Note:** Location data (latitude, longitude, name, address) is sent at **runtime** when sending the template, not stored in the template definition.

**Sending with location:**
```json
{
  "template_id": "tpl_location",
  "customer_phone": "+14155551234",
  "location": {
    "latitude": 37.7749,
    "longitude": -122.4194,
    "name": "Our Store",
    "address": "123 Main St, San Francisco, CA"
  }
}
```

---

## Button Types

### QUICK_REPLY (Trackable)

Used for customer engagement actions. **These are tracked automatically via webhooks.**

```json
{
  "type": "QUICK_REPLY",
  "text": "Get Started"
}
```

**When clicked:**
1. WhatsApp sends webhook to server
2. Server records click in `button_clicks` table
3. Links to contact, conversation, and template

---

### URL Button

Opens a web link. Can include a dynamic suffix variable.

```json
{
  "type": "URL",
  "text": "View Order",
  "url": "https://shop.example.com/orders/{{1}}",
  "example": ["12345"]
}
```

---

### PHONE_NUMBER Button

Initiates a phone call.

```json
{
  "type": "PHONE_NUMBER",
  "text": "Call Support",
  "phone_number": "+14155551234"
}
```

---

### COPY_CODE Button

Copies a code to clipboard (useful for OTP templates).

```json
{
  "type": "COPY_CODE",
  "example": "ABC123"
}
```

---

## Component Structure

### Full Template Example with All Components

```json
{
  "user_id": "user_123",
  "phone_number_id": "pn_456",
  "name": "complete_example",
  "category": "MARKETING",
  "components": [
    {
      "type": "HEADER",
      "format": "IMAGE",
      "example": {
        "header_handle": ["https://media.example.com/banner.jpg"]
      }
    },
    {
      "type": "BODY",
      "text": "Hi {{1}}! 🎉\n\nWe have a special offer just for you:\n\n💰 {{2}}% OFF on all products\n📅 Valid until {{3}}\n\nUse code: {{4}}",
      "example": {
        "body_text": [["John", "25", "January 31", "SAVE25"]]
      }
    },
    {
      "type": "FOOTER",
      "text": "Terms and conditions apply"
    },
    {
      "type": "BUTTONS",
      "buttons": [
        {
          "type": "QUICK_REPLY",
          "text": "Shop Now"
        },
        {
          "type": "QUICK_REPLY",
          "text": "View Catalog"
        },
        {
          "type": "URL",
          "text": "Visit Website",
          "url": "https://shop.example.com"
        }
      ]
    }
  ],
  "variables": [
    {
      "variable_name": "customer_name",
      "position": 1,
      "component_type": "BODY",
      "extraction_field": "name",
      "default_value": "Valued Customer"
    },
    {
      "variable_name": "discount_percent",
      "position": 2,
      "component_type": "BODY",
      "default_value": "20"
    },
    {
      "variable_name": "expiry_date",
      "position": 3,
      "component_type": "BODY"
    },
    {
      "variable_name": "promo_code",
      "position": 4,
      "component_type": "BODY"
    }
  ]
}
```

---

## Error Handling

### Standard Error Response

```json
{
  "error": "Bad Request",
  "message": "Detailed error description",
  "timestamp": "2024-01-15T14:30:00Z",
  "correlationId": "req_xyz789"
}
```

### Common Error Codes

| HTTP Code | Error | Common Causes |
|-----------|-------|---------------|
| 400 | Bad Request | Missing required fields, invalid component structure |
| 401 | Unauthorized | Invalid or expired token |
| 404 | Not Found | Template/resource doesn't exist |
| 409 | Conflict | Template name already exists for this phone number |
| 500 | Internal Server Error | Database or Meta API error |

### Meta API Specific Errors

| Meta Error Code | Meaning | Solution |
|-----------------|---------|----------|
| 100 | Invalid parameter | Check component format |
| 190 | Invalid access token | Refresh Meta token |
| 368 | Template limit reached | Delete unused templates |
| 131047 | Media URL not accessible | Ensure public R2 URL |

---

## Webhooks

### Button Click Webhook Handling

When a customer clicks a Quick Reply button, WhatsApp sends a webhook:

```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "changes": [{
      "value": {
        "messaging_product": "whatsapp",
        "messages": [{
          "from": "14155551234",
          "type": "interactive",
          "interactive": {
            "type": "button_reply",
            "button_reply": {
              "id": "get_started",
              "title": "Get Started"
            }
          },
          "context": {
            "id": "wamid.original_message_id"
          }
        }]
      }
    }]
  }]
}
```

**Server automatically:**
1. Identifies the template and button
2. Records click in `button_clicks` table
3. Links to contact and conversation

---

## API Quick Reference

All endpoints use base URL from `VITE_WHATSAPP_SERVICE_URL` environment variable.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/templates` | List all templates |
| GET | `/admin/templates/:id` | Get template details with variables & analytics |
| POST | `/admin/templates` | Create template (with media URL from R2) |
| POST | `/admin/templates/:id/submit` | Submit to Meta for approval |
| POST | `/admin/templates/sync` | Sync/import templates from Meta |
| DELETE | `/admin/templates/:id` | Delete template (also from Meta) |
| GET | `/admin/templates/:id/button-clicks` | Get button click analytics per template |
| GET | `/admin/button-clicks` | List all button clicks (requires userId) |
| GET | `/admin/leads/:phone/button-activity` | Get lead's button click history |

---

## Dashboard Implementation Checklist

### Required for Template System

- [ ] **R2 Integration** - Upload media files and get public URLs
- [ ] **Template List View** - Fetch and display templates with status badges
- [ ] **Template Create Form** - Support all header types (TEXT, IMAGE, VIDEO, DOCUMENT, LOCATION)
- [ ] **Variable Mapping UI** - Map template variables to extraction fields
- [ ] **Submit to Meta** - Button to submit DRAFT templates
- [ ] **Sync from Meta** - Import existing Meta templates

### Required for Analytics

- [ ] **Button Click Dashboard** - Show click stats per template
- [ ] **Lead Activity View** - Show which buttons a lead clicked
- [ ] **Click Timeline** - Chronological button click history

---

## Template Variable System (Deep Dive)

### Understanding the Problem

WhatsApp templates use positional placeholders like `{{1}}`, `{{2}}`, `{{3}}`:

```
"Hello {{1}}! Your order from {{2}} is ready. Total: ${{3}}"
```

The challenge: **How do we fill these variables automatically without requiring manual input every time?**

### Our Solution: Client-Side Variable Mapping

Dashboard has **full control** over how variables are resolved. Server just stores metadata and passes through values.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     CLIENT-SIDE VARIABLE FLOW                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. Dashboard CREATES template with variable metadata:                  │
│     - variable_name: "customer_name"                                    │
│     - position: 1                                                       │
│     - default_value: "there"                                            │
│     - description: "Lead's name"                                        │
│     - NO extraction_field needed!                                       │
│                                                                         │
│  2. Dashboard FETCHES template → gets variable list                     │
│                                                                         │
│  3. Dashboard MAPS variables to its own data sources:                   │
│     customer_name → lead.fullName                                       │
│     order_total → order.amount                                          │
│                                                                         │
│  4. Dashboard SENDS with already-resolved values:                       │
│     { "1": "John Smith", "2": "$99.99" }                                │
│                                                                         │
│  5. Server just passes values to WhatsApp (no mapping needed!)          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Variable Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `variable_name` | string | Yes | Human-readable identifier |
| `position` | number | Yes | Maps to {{1}}, {{2}}, etc. (1-10) |
| `component_type` | string | No | HEADER, BODY, or BUTTON (default: BODY) |
| `default_value` | string | No | Fallback if no value provided |
| `sample_value` | string | No | For Meta review (required by Meta) |
| `description` | string | No | UI help text |
| `is_required` | boolean | No | Must have a value |
| `placeholder` | string | No | Input placeholder text |
| `extraction_field` | string | No | Optional server-side auto-fill |

### Example: Creating Template with Variables

```json
POST ${VITE_WHATSAPP_SERVICE_URL}/admin/templates
{
  "user_id": "user_123",
  "phone_number_id": "pn_456",
  "name": "order_update",
  "category": "UTILITY",
  "components": [
    {
      "type": "BODY",
      "text": "Hi {{1}}! Your order #{{2}} is {{3}}. Total: ${{4}}",
      "example": {
        "body_text": [["John", "12345", "shipped", "99.99"]]
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
    },
    {
      "variable_name": "total",
      "position": 4,
      "description": "Order total amount",
      "sample_value": "99.99",
      "placeholder": "e.g., 99.99"
    }
  ]
}
```

### Sending with Resolved Variables

Dashboard resolves values from its data and sends by **position**:

```json
POST ${VITE_WHATSAPP_SERVICE_URL}/api/v1/send
{
  "phone_number_id": "pn_456",
  "template_id": "tpl_order",
  "contact": {
    "phone": "+14155551234",
    "name": "Sarah Johnson"
  },
  "variables": {
    "1": "Sarah Johnson",
    "2": "ORD-98765",
    "3": "out for delivery",
    "4": "149.99"
  }
}
```

**Result:** "Hi Sarah Johnson! Your order #ORD-98765 is out for delivery. Total: $149.99"

### Variable Resolution Priority

Server uses this priority when `variables` is provided in send request:

```
1. variables["1"]              →  Direct position value
2. variables["customer_name"]  →  By variable_name (alternative)
3. default_value               →  Fallback
4. sample_value                →  Last resort
```

### Dashboard Implementation

```typescript
// 1. Fetch template
const response = await fetch(`${API_BASE}/admin/templates/${templateId}`);
const { template, variables } = response.data;

// 2. Your lead data (from your database)
const lead = {
  name: "Sarah Johnson",
  order_number: "ORD-98765", 
  order_status: "out for delivery",
  order_total: 149.99
};

// 3. Your mapping configuration
const mapping = {
  "customer_name": "name",
  "order_id": "order_number",
  "status": "order_status",
  "total": "order_total"
};

// 4. Resolve variables
const resolved = {};
for (const v of variables) {
  const sourceField = mapping[v.variable_name];
  const value = lead[sourceField] ?? v.default_value ?? v.sample_value;
  resolved[v.position.toString()] = String(value);
}

// 5. Send with resolved values
await fetch(`${API_BASE}/api/v1/send`, {
  method: 'POST',
  body: JSON.stringify({
    phone_number_id: "pn_456",
    template_id: templateId,
    contact: { phone: lead.phone },
    variables: resolved  // { "1": "Sarah", "2": "ORD-98765", ... }
  })
});
```

### Optional: Server-Side Auto-Fill

For backwards compatibility or campaigns, you can still use `extraction_field`:

```json
{
  "variable_name": "customer_name",
  "position": 1,
  "extraction_field": "name",
  "default_value": "Customer"
}
```

Available `extraction_field` values:
- `name`, `email`, `company`, `customer_phone`
- `intent_level`, `urgency_level`, `lead_status_tag`
- `total_score`, `smart_notification`

When sending without explicit variables, server will auto-fill from AI extraction data.

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-01-15 | Initial template CRUD |
| 2.0.0 | 2024-01-20 | Added media header support (IMAGE, VIDEO, DOCUMENT, LOCATION) |
| 2.1.0 | 2024-01-25 | Added button click tracking and analytics |
| 2.2.0 | 2024-12-13 | Updated for internal microservice (no auth), R2 setup guide |
