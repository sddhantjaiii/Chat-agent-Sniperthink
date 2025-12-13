# Credits Integration - External API

This document describes the External API endpoints for managing user credits in the Multi-Channel AI Agent platform.

## Overview

The Credits API allows external systems (e.g., Dashboard, billing systems) to:
- Retrieve user credit balances
- Add credits (e.g., after purchase/subscription)
- Deduct credits (e.g., manual adjustments)
- Set absolute credit values (e.g., credit resets)

**Base URL:** `https://your-api-domain.com/api/v1`

**Authentication:** No authentication required (internal microservice communication). Use `x-user-id` header to identify the user.

---

## Endpoints

### 1. Get User Credits

Retrieve the current credit balance and usage statistics for a user.

**Endpoint:** `GET /api/v1/credits`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| `x-user-id` | string | Yes | The user's unique identifier |

**Response:**

```json
{
  "success": true,
  "data": {
    "user_id": "user_abc123",
    "remaining_credits": 500,
    "total_used": 150,
    "last_updated": "2024-12-13T10:30:00.000Z"
  },
  "timestamp": "2024-12-13T10:35:00.000Z",
  "correlationId": "1702467300000-abc123"
}
```

**Response Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `user_id` | string | The user's unique identifier |
| `remaining_credits` | integer | Current available credits |
| `total_used` | integer | Total credits consumed historically |
| `last_updated` | timestamp | Last time credits were modified |

**Example Request:**

```bash
curl -X GET "https://api.example.com/api/v1/credits" \
  -H "x-user-id: user_abc123"
```

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | Bad Request | Missing `x-user-id` header |
| 500 | Internal Server Error | Database or server error |

---

### 2. Adjust User Credits

Add, deduct, or set credits for a user. Supports three operations for flexible credit management.

**Endpoint:** `POST /api/v1/credits/adjust`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| `x-user-id` | string | Yes | The user's unique identifier |
| `Content-Type` | string | Yes | Must be `application/json` |

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `amount` | number | Yes | Positive number of credits to adjust |
| `operation` | string | Yes | One of: `add`, `deduct`, `set` |
| `reason` | string | No | Optional reason for the adjustment (for audit logs) |

**Operations:**
| Operation | Description |
|-----------|-------------|
| `add` | Add credits to the user's balance. Creates user record if not exists. |
| `deduct` | Subtract credits from balance. Fails if insufficient credits. |
| `set` | Set absolute credit value. Creates user record if not exists. |

**Response:**

```json
{
  "success": true,
  "data": {
    "user_id": "user_abc123",
    "remaining_credits": 600,
    "total_used": 150,
    "last_updated": "2024-12-13T10:40:00.000Z",
    "adjustment": {
      "operation": "add",
      "amount": 100,
      "reason": "Monthly subscription renewal"
    }
  },
  "timestamp": "2024-12-13T10:40:00.000Z",
  "correlationId": "1702467600000-def456"
}
```

**Example Requests:**

#### Add Credits
```bash
curl -X POST "https://api.example.com/api/v1/credits/adjust" \
  -H "x-user-id: user_abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 100,
    "operation": "add",
    "reason": "Monthly subscription renewal"
  }'
```

#### Deduct Credits
```bash
curl -X POST "https://api.example.com/api/v1/credits/adjust" \
  -H "x-user-id: user_abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 25,
    "operation": "deduct",
    "reason": "Manual adjustment - refund processed"
  }'
```

#### Set Credits (Absolute Value)
```bash
curl -X POST "https://api.example.com/api/v1/credits/adjust" \
  -H "x-user-id: user_abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 1000,
    "operation": "set",
    "reason": "Enterprise plan upgrade"
  }'
```

**Error Responses:**

| Status | Error | Condition |
|--------|-------|-----------|
| 400 | Bad Request | Missing `x-user-id` header |
| 400 | Bad Request | Missing or invalid `amount` (must be positive number) |
| 400 | Bad Request | Missing or invalid `operation` |
| 400 | Bad Request | Insufficient credits (for `deduct` operation) |
| 500 | Internal Server Error | Database or server error |

**Insufficient Credits Error Example:**
```json
{
  "success": false,
  "error": "Bad Request",
  "message": "Insufficient credits or user not found",
  "timestamp": "2024-12-13T10:45:00.000Z",
  "correlationId": "1702467900000-ghi789"
}
```

---

## Integration Examples

### TypeScript/JavaScript

```typescript
const API_BASE = 'https://api.example.com/api/v1';

// Get credits
async function getCredits(userId: string) {
  const response = await fetch(`${API_BASE}/credits`, {
    headers: { 'x-user-id': userId }
  });
  return response.json();
}

// Add credits after purchase
async function addCredits(userId: string, amount: number, reason?: string) {
  const response = await fetch(`${API_BASE}/credits/adjust`, {
    method: 'POST',
    headers: {
      'x-user-id': userId,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ amount, operation: 'add', reason })
  });
  return response.json();
}

// Deduct credits
async function deductCredits(userId: string, amount: number, reason?: string) {
  const response = await fetch(`${API_BASE}/credits/adjust`, {
    method: 'POST',
    headers: {
      'x-user-id': userId,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ amount, operation: 'deduct', reason })
  });
  return response.json();
}
```

### Python

```python
import requests

API_BASE = 'https://api.example.com/api/v1'

def get_credits(user_id: str):
    response = requests.get(
        f'{API_BASE}/credits',
        headers={'x-user-id': user_id}
    )
    return response.json()

def adjust_credits(user_id: str, amount: int, operation: str, reason: str = None):
    response = requests.post(
        f'{API_BASE}/credits/adjust',
        headers={
            'x-user-id': user_id,
            'Content-Type': 'application/json'
        },
        json={
            'amount': amount,
            'operation': operation,
            'reason': reason
        }
    )
    return response.json()

# Usage
credits = get_credits('user_abc123')
print(f"Remaining: {credits['data']['remaining_credits']}")

# Add 100 credits
result = adjust_credits('user_abc123', 100, 'add', 'Purchase order #12345')
```

---

## Common Use Cases

### 1. Subscription Renewal
When a user's subscription renews, add their monthly credit allocation:

```bash
curl -X POST "https://api.example.com/api/v1/credits/adjust" \
  -H "x-user-id: user_abc123" \
  -H "Content-Type: application/json" \
  -d '{"amount": 500, "operation": "add", "reason": "Pro plan - monthly renewal"}'
```

### 2. One-Time Purchase
When a user purchases additional credits:

```bash
curl -X POST "https://api.example.com/api/v1/credits/adjust" \
  -H "x-user-id: user_abc123" \
  -H "Content-Type: application/json" \
  -d '{"amount": 1000, "operation": "add", "reason": "Credit pack purchase - order #ORD123"}'
```

### 3. Plan Upgrade with Credit Reset
When upgrading to a higher plan, set credits to the new plan's allocation:

```bash
curl -X POST "https://api.example.com/api/v1/credits/adjust" \
  -H "x-user-id: user_abc123" \
  -H "Content-Type: application/json" \
  -d '{"amount": 2000, "operation": "set", "reason": "Upgraded to Enterprise plan"}'
```

### 4. Refund/Adjustment
When issuing a manual credit adjustment:

```bash
curl -X POST "https://api.example.com/api/v1/credits/adjust" \
  -H "x-user-id: user_abc123" \
  -H "Content-Type: application/json" \
  -d '{"amount": 50, "operation": "add", "reason": "Service disruption compensation"}'
```

### 5. Check Balance Before Action
Before performing a credit-consuming operation, check if user has sufficient credits:

```bash
# Get current balance
curl -X GET "https://api.example.com/api/v1/credits" \
  -H "x-user-id: user_abc123"

# Response shows remaining_credits: 45
# If action requires 50 credits, prompt user to purchase more
```

---

## Database Schema Reference

The credits data is stored in the `credits` table:

| Column | Type | Description |
|--------|------|-------------|
| `user_id` | VARCHAR(50) | Primary key, FK to users table |
| `remaining_credits` | INTEGER | Current available balance (≥0) |
| `total_used` | INTEGER | Lifetime credits consumed (≥0) |
| `last_updated` | TIMESTAMP | Last modification time |

---

## Notes

1. **Credit Consumption:** Credits are automatically deducted by the message processing worker when AI responses are generated. This API is for external credit management only.

2. **New Users:** When a user is created via `POST /api/v1/users`, they are automatically initialized with 100 credits.

3. **Caching:** Credit balances are cached in Redis (5-minute TTL). After adjustments, the cache is invalidated automatically.

4. **Audit Trail:** All credit adjustments are logged with timestamps and reasons. Include meaningful `reason` values for traceability.

5. **Concurrency:** The deduct operation uses atomic database operations to prevent race conditions.
