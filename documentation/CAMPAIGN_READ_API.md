# Campaign Read API (External)

**Scope:** Read-only campaign data (no create/update)  
**Base URL:** `http://<HOST>:<PORT>/api/v1`  
**Auth:** None (internal/dashboard usage)

This document covers only:
- List campaigns for a user
- Get a campaign status + recipient status breakdown

---

## Common Response Fields

All successful responses include:
- `timestamp` (ISO string)
- `correlationId` (string)

Errors follow the same structure pattern and include:
- `success: false`
- `error` (string)
- `message` (string)
- `timestamp`
- `correlationId`

---

## 1) List Campaigns (User)

**GET** `/campaigns`

### Query Params
- `user_id` (string, required)
- `phone_number_id` (string, optional) – filter campaigns for a specific phone number
- `status` (string, optional) – campaign status filter (e.g. `RUNNING`, `COMPLETED`)
- `limit` (number, optional, default `50`, max `100`)
- `offset` (number, optional, default `0`)

### Example
```bash
curl "http://localhost:4000/api/v1/campaigns?user_id=usr_123&status=RUNNING&limit=20&offset=0"
```

### Response (200)
```json
{
  "success": true,
  "data": [
    {
      "campaign_id": "cmp_abc123",
      "name": "January Promotion",
      "description": "New year promo",
      "status": "RUNNING",
      "template_id": "tpl_welcome_001",
      "template_name": "welcome_message",
      "phone_number_id": "pn_abc123",
      "total_recipients": 100,
      "sent_count": 50,
      "delivered_count": 45,
      "read_count": 30,
      "failed_count": 2,
      "progress_percent": 50,
      "started_at": "2024-01-15T10:00:00.000Z",
      "completed_at": null,
      "created_at": "2024-01-15T09:00:00.000Z"
    }
  ],
  "pagination": {
    "total": 25,
    "limit": 20,
    "offset": 0,
    "has_more": true
  },
  "timestamp": "2024-01-15T10:30:00.000Z",
  "correlationId": "1705312200000-abc123"
}
```

### Notes
- `progress_percent` is computed as: `round((sent_count / total_recipients) * 100)`.
- `template_name` may be `null` if the template was deleted or not found.

### Errors
- **400** if `user_id` is missing
- **500** on internal errors

---

## 2) Get Campaign Status + Recipient Status Breakdown

**GET** `/campaign/:campaignId`

### Path Params
- `campaignId` (string, required)

### Example
```bash
curl "http://localhost:4000/api/v1/campaign/cmp_abc123"
```

### Response (200)
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
    "read_count": 30,
    "failed_count": 2,
    "progress_percent": 50,
    "started_at": "2024-01-15T10:00:00.000Z",
    "completed_at": null,
    "recipient_stats": {
      "PENDING": 48,
      "QUEUED": 0,
      "SENT": 3,
      "DELIVERED": 15,
      "READ": 30,
      "FAILED": 2,
      "SKIPPED": 2
    }
  },
  "timestamp": "2024-01-15T10:30:00.000Z",
  "correlationId": "1705312200000-abc123"
}
```

### Recipient Status Definitions
- `PENDING`: recipient row exists but not yet queued/sent
- `QUEUED`: queued for sending
- `SENT`: accepted by WhatsApp API
- `DELIVERED`: delivered to recipient device
- `READ`: read by recipient
- `FAILED`: send failed
- `SKIPPED`: intentionally skipped (e.g. opted out, invalid phone, duplicate, rate-limited)

### Errors
- **404** if `campaignId` not found
- **500** on internal errors

---

## Campaign Status Values (Campaign-Level)

Common campaign-level statuses:
- `DRAFT`
- `SCHEDULED`
- `RUNNING`
- `PAUSED`
- `COMPLETED`
- `FAILED`
- `CANCELLED`

---

## What This Read API Does NOT Provide

This read-only API does **not** return recipient-level rows (per-contact details like which phone failed/read). It only provides:
- campaign list summaries
- per-campaign aggregate counters
- per-campaign recipient status distribution (`recipient_stats`)

If you want recipient-level detail, a separate endpoint would be needed (example: `GET /api/v1/campaign/:campaignId/recipients?...`).
