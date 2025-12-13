# Webchat Widget External API

**For:** Dashboard/Frontend Developers  
**Version:** 1.0.0  
**Last Updated:** December 13, 2025

---

## Overview

The Webchat External API allows you to create and manage web chat widgets that can be embedded on any website. Each widget is powered by an AI agent that can handle customer conversations.

**Key Features:**
- Create webchat widgets with customizable AI agents
- Reuse existing AI agents across multiple platforms (WhatsApp → Webchat)
- Get embeddable widget code with color customization
- Visual configuration page for non-technical users

---

## Base URL

```
Production: https://your-api-domain.com
Development: http://localhost:4000
```

**No authentication required** - These are internal microservice endpoints.

---

## Complete Flow

### Option A: Create New Webchat with New AI Agent

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Create User (if not exists)                                 │
│     POST /api/v1/users                                          │
├─────────────────────────────────────────────────────────────────┤
│  2. Create Webchat Channel with NEW prompt_id                   │
│     POST /api/v1/webchat/channels                               │
│     Body: { user_id, prompt_id, name }                          │
├─────────────────────────────────────────────────────────────────┤
│  3. Get embed_code from response                                │
│     Copy HTML to your website                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Option B: Create Webchat Reusing Existing AI Agent

```
┌─────────────────────────────────────────────────────────────────┐
│  1. List existing agents to find one to copy                    │
│     GET /api/v1/agents?user_id=X                                │
├─────────────────────────────────────────────────────────────────┤
│  2. Create Webchat Channel copying existing agent               │
│     POST /api/v1/webchat/channels                               │
│     Body: { user_id, agent_id, name }                           │
├─────────────────────────────────────────────────────────────────┤
│  3. Get embed_code from response                                │
│     Copy HTML to your website                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/agents?user_id=X` | List all agents (to find one to copy) |
| POST | `/api/v1/webchat/channels` | Create webchat channel |
| GET | `/api/v1/webchat/channels?user_id=X` | List webchat channels |
| GET | `/api/v1/webchat/channels/:webchatId/embed` | Get widget embed code |
| DELETE | `/api/v1/webchat/channels/:webchatId` | Delete webchat channel |

---

## 1. List Existing Agents

Get all agents for a user to find one to reuse. Useful for copying AI behavior from WhatsApp/Instagram to Webchat.

```http
GET /api/v1/agents?user_id={userId}
```

### cURL Example

```bash
curl "http://localhost:4000/api/v1/agents?user_id=usr_abc123"
```

### Response

```json
{
  "success": true,
  "data": [
    {
      "agent_id": "agent_whatsapp_sales",
      "user_id": "usr_abc123",
      "phone_number_id": "pn_whatsapp_123",
      "prompt_id": "prompt_sales_bot_v1",
      "name": "WhatsApp Sales Bot",
      "phone_number": {
        "platform": "whatsapp",
        "display_name": "+1234567890"
      },
      "created_at": "2025-12-10T10:00:00.000Z"
    },
    {
      "agent_id": "ag_m5k2x8f_a1b2c3",
      "user_id": "usr_abc123",
      "phone_number_id": "pn_m5k2x8f_a1b2c3",
      "prompt_id": "prompt_support_v2",
      "name": "Website Support Chat",
      "phone_number": {
        "platform": "webchat",
        "display_name": "Support Widget"
      },
      "created_at": "2025-12-13T15:30:00.000Z"
    }
  ],
  "timestamp": "2025-12-13T15:35:00.000Z",
  "correlationId": "req_abc123"
}
```

---

## 2. Create Webchat Channel

Create a new webchat widget. You can either:
- Provide `prompt_id` to create a new AI agent
- Provide `agent_id` to copy the AI behavior from an existing agent

```http
POST /api/v1/webchat/channels
Content-Type: application/json
```

### Option A: Create with New Prompt ID

Use this when you want to create a brand new AI agent with specific behavior.

```bash
curl -X POST http://localhost:4000/api/v1/webchat/channels \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "usr_abc123",
    "prompt_id": "prompt_sales_bot_v1",
    "name": "Customer Support Chat"
  }'
```

### Option B: Copy from Existing Agent

Use this when you want the **same AI behavior** on your website as your WhatsApp/Instagram bot.

```bash
curl -X POST http://localhost:4000/api/v1/webchat/channels \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "usr_abc123",
    "agent_id": "agent_whatsapp_sales",
    "name": "Website Chat (same AI as WhatsApp)"
  }'
```

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| user_id | string | Yes | User identifier |
| prompt_id | string | One of | OpenAI Responses API prompt ID (creates new agent) |
| agent_id | string | One of | Existing agent ID to copy prompt from |
| name | string | Yes | Display name for the chat widget |

> ⚠️ **Important:** Provide either `prompt_id` OR `agent_id`, not both.

### Response (201 Created)

```json
{
  "success": true,
  "data": {
    "webchat_id": "wc_m5k2x8f_a1b2c3",
    "phone_number_id": "pn_m5k2x8f_a1b2c3",
    "agent_id": "ag_m5k2x8f_a1b2c3",
    "prompt_id": "prompt_sales_bot_v1",
    "source_agent_id": null,
    "name": "Customer Support Chat",
    "embed_code": "<!-- Customer Support Chat AI Chat Widget -->\n<webchat-widget \n  agent-id=\"wc_m5k2x8f_a1b2c3\"\n  primary-color=\"#3B82F6\"\n  secondary-color=\"#EFF6FF\">\n</webchat-widget>\n<script src=\"https://your-api.com/widget.js\" async type=\"text/javascript\"></script>",
    "config_url": "https://your-api.com/widget-config.html?agent_id=wc_m5k2x8f_a1b2c3",
    "created_at": "2025-12-13T15:30:00.000Z"
  },
  "timestamp": "2025-12-13T15:30:00.000Z",
  "correlationId": "req_abc123"
}
```

### Response Fields

| Field | Description |
|-------|-------------|
| webchat_id | Unique ID for this webchat channel (used in widget) |
| phone_number_id | Internal phone number record ID |
| agent_id | New agent ID created for this webchat |
| prompt_id | OpenAI prompt ID being used |
| source_agent_id | Agent ID that was copied (null if using prompt_id) |
| embed_code | **Ready-to-use HTML** - copy this to your website |
| config_url | URL to visual color customization page |

---

## 3. List Webchat Channels

Get all webchat channels for a user.

```http
GET /api/v1/webchat/channels?user_id={userId}
```

### cURL Example

```bash
curl "http://localhost:4000/api/v1/webchat/channels?user_id=usr_abc123"
```

### Response

```json
{
  "success": true,
  "data": {
    "channels": [
      {
        "webchat_id": "wc_m5k2x8f_a1b2c3",
        "phone_number_id": "pn_m5k2x8f_a1b2c3",
        "agent_id": "ag_m5k2x8f_a1b2c3",
        "prompt_id": "prompt_sales_bot_v1",
        "name": "Customer Support Chat",
        "embed_code": "...",
        "config_url": "https://your-api.com/widget-config.html?agent_id=wc_m5k2x8f_a1b2c3",
        "created_at": "2025-12-13T15:30:00.000Z",
        "updated_at": "2025-12-13T15:30:00.000Z"
      }
    ],
    "count": 1
  },
  "timestamp": "2025-12-13T15:35:00.000Z",
  "correlationId": "req_abc123"
}
```

---

## 4. Get Widget Embed Code

Get the embed code for a specific webchat channel.

```http
GET /api/v1/webchat/channels/{webchatId}/embed
```

### cURL Example

```bash
curl "http://localhost:4000/api/v1/webchat/channels/wc_m5k2x8f_a1b2c3/embed"
```

### Response

```json
{
  "success": true,
  "data": {
    "webchat_id": "wc_m5k2x8f_a1b2c3",
    "name": "Customer Support Chat",
    "embed_code": "<!-- Customer Support Chat AI Chat Widget -->\n<webchat-widget \n  agent-id=\"wc_m5k2x8f_a1b2c3\"\n  primary-color=\"#3B82F6\"\n  secondary-color=\"#EFF6FF\">\n</webchat-widget>\n<script src=\"https://your-api.com/widget.js\" async type=\"text/javascript\"></script>",
    "config_url": "https://your-api.com/widget-config.html?agent_id=wc_m5k2x8f_a1b2c3"
  },
  "timestamp": "2025-12-13T15:35:00.000Z",
  "correlationId": "req_abc123"
}
```

---

## 5. Delete Webchat Channel

Delete a webchat channel and its associated agent.

```http
DELETE /api/v1/webchat/channels/{webchatId}
```

### cURL Example

```bash
curl -X DELETE "http://localhost:4000/api/v1/webchat/channels/wc_m5k2x8f_a1b2c3"
```

### Response

```json
{
  "success": true,
  "message": "Webchat channel wc_m5k2x8f_a1b2c3 deleted successfully",
  "timestamp": "2025-12-13T15:40:00.000Z",
  "correlationId": "req_abc123"
}
```

---

## Widget Integration

### Basic Embed Code

Copy the `embed_code` from the API response and paste it into your website's HTML:

```html
<!-- Customer Support Chat AI Chat Widget -->
<webchat-widget 
  agent-id="wc_m5k2x8f_a1b2c3"
  primary-color="#3B82F6"
  secondary-color="#EFF6FF">
</webchat-widget>
<script src="https://your-api.com/widget.js" async type="text/javascript"></script>
```

### Color Customization

You can customize colors directly in the HTML:

```html
<webchat-widget 
  agent-id="wc_m5k2x8f_a1b2c3"
  primary-color="#10B981"
  secondary-color="#D1FAE5">
</webchat-widget>
```

| Attribute | Description | Default |
|-----------|-------------|---------|
| agent-id | Webchat channel ID (required) | - |
| primary-color | Buttons & user message bubbles | #3B82F6 (blue) |
| secondary-color | Background accents | #EFF6FF (light blue) |

### Visual Configuration

For non-technical users, share the `config_url`:

```
https://your-api.com/widget-config.html?agent_id=wc_m5k2x8f_a1b2c3
```

This opens a visual editor where users can:
- Pick colors with a color picker
- Preview the widget in real-time
- Copy updated embed code

---

## How the Widget Works

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Website    │     │  Your API    │     │   OpenAI     │
│   (Widget)   │     │   Server     │     │ Responses API│
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       │ 1. Load widget.js  │                    │
       │<───────────────────│                    │
       │                    │                    │
       │ 2. User sends msg  │                    │
       │───────────────────>│                    │
       │                    │ 3. Forward to AI   │
       │                    │───────────────────>│
       │                    │                    │
       │                    │ 4. AI Response     │
       │                    │<───────────────────│
       │ 5. Stream response │                    │
       │<───────────────────│ (via SSE)          │
       │                    │                    │
```

1. **Widget loads** from your API server (`/widget.js`)
2. **User sends message** via REST API
3. **Server processes** message through OpenAI Responses API
4. **AI generates** response using the configured prompt
5. **Response streams** back to widget via Server-Sent Events (SSE)

---

## TypeScript SDK Example

```typescript
const API_BASE = 'http://localhost:4000';

// List agents to find one to copy
async function listAgents(userId: string) {
  const res = await fetch(`${API_BASE}/api/v1/agents?user_id=${userId}`);
  return res.json();
}

// Create webchat with new prompt
async function createWebchatWithPrompt(userId: string, promptId: string, name: string) {
  const res = await fetch(`${API_BASE}/api/v1/webchat/channels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, prompt_id: promptId, name }),
  });
  return res.json();
}

// Create webchat copying existing agent
async function createWebchatFromAgent(userId: string, agentId: string, name: string) {
  const res = await fetch(`${API_BASE}/api/v1/webchat/channels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, agent_id: agentId, name }),
  });
  return res.json();
}

// List webchat channels
async function listWebchatChannels(userId: string) {
  const res = await fetch(`${API_BASE}/api/v1/webchat/channels?user_id=${userId}`);
  return res.json();
}

// Get embed code
async function getEmbedCode(webchatId: string) {
  const res = await fetch(`${API_BASE}/api/v1/webchat/channels/${webchatId}/embed`);
  return res.json();
}

// Delete webchat channel
async function deleteWebchatChannel(webchatId: string) {
  const res = await fetch(`${API_BASE}/api/v1/webchat/channels/${webchatId}`, {
    method: 'DELETE',
  });
  return res.json();
}
```

---

## Error Responses

### 400 Bad Request

```json
{
  "success": false,
  "error": "Bad Request",
  "message": "Either prompt_id or agent_id is required",
  "timestamp": "2025-12-13T15:30:00.000Z",
  "correlationId": "req_abc123"
}
```

### 404 Not Found

```json
{
  "success": false,
  "error": "Not Found",
  "message": "Agent agent_xyz not found for user usr_abc123",
  "timestamp": "2025-12-13T15:30:00.000Z",
  "correlationId": "req_abc123"
}
```

### 500 Internal Server Error

```json
{
  "success": false,
  "error": "Internal Server Error",
  "message": "Failed to create webchat channel",
  "timestamp": "2025-12-13T15:30:00.000Z",
  "correlationId": "req_abc123"
}
```

---

## Environment Configuration

Set these environment variables for production:

```env
# Required: URL where widget.js is served
WEBCHAT_WIDGET_URL=https://your-production-domain.com
```

The widget automatically detects the API URL from the script source, so no additional configuration is needed on the frontend.

---

## Related Documentation

- [External API Reference](./EXTERNAL_API_REFERENCE.md) - Full API documentation
- [Webchat API](./WEBCHAT_API.md) - Internal webchat endpoints
- [API Reference](./API_REFERENCE.md) - Complete API reference
