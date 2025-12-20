# Copilot Instructions for Multi-Channel AI Agent

## Architecture Overview

This is a **multi-tenant chatbot platform** serving WhatsApp, Instagram, and Web Chat via a unified backend. Key architectural decisions:

- **Message Flow**: Webhook → Queue → Worker → OpenAI Responses API → Platform-specific send
- **Multi-tenancy**: All queries filter by `user_id`; each user has phone numbers → agents → conversations
- **Storage**: PostgreSQL for persistence, **in-memory queue** for message processing (no Redis)
- **Workers**: Background processors in `server/src/workers/` handle async message processing with optimized latency (<5s target)

## Project Structure

```
server/src/
├── controllers/     # Express handlers (webhook.ts handles WhatsApp/Instagram, webchat.ts for web)
├── services/        # Business logic (openaiService.ts, conversationService.ts, extractionService.ts)
├── workers/         # Background processors (optimizedMessageWorker.ts - main message handler)
├── models/          # TypeScript interfaces and data models (types.ts is the source of truth)
├── utils/           # Infrastructure (database.ts singleton, messageQueue.ts, sseManager.ts for webchat)
└── middleware/      # Auth, validation (auth.ts has webhook signature verification)
```

## Key Development Commands

```bash
cd server
npm run dev          # Start with hot reload (ts-node-dev)
npm run test:unit    # Unit tests only (mocked dependencies)
npm run test:integration  # Integration tests (longer timeout: 120s)
npm run test:coverage     # Coverage with 80% threshold enforcement
npm run migrate      # Run database migrations
npm run quality-gate # Lint + coverage (CI check)
```

## Critical Patterns

### Database Singleton
Always use the singleton; never create new Pool instances:
```typescript
import { db } from '../utils/database';
await db.query('SELECT...', [params]);
await db.transaction(async (client) => { /* transactional work */ });
```

### Test Mocking Convention
Tests auto-mock `pg`, `redis`, and `openai` in `tests/setup.ts`. Use fixtures from `tests/fixtures/`:
```typescript
import { createMockPool, createMockRequest, createMockResponse } from './fixtures/helpers';
```

### Extraction Service
Lead extraction runs asynchronously via `extractionWorker.ts` after conversations. Key patterns:
- Validates data against schema in `extractionService.ts` (name, email, company, lead scores 1-3)
- Stores in `extractions` table linked to `conversation_id`
- Score fields: `intent_score`, `urgency_score`, `budget_score`, `fit_score`, `engagement_score` (integers 1-3)
- Level fields use strings: `"Low"`, `"Medium"`, `"High"`
- New extraction fields: `requirements`, `custom_cta`, `in_detail_summary`
- `reasoning` JSONB structure: `{ intent, urgency, budget, fit, engagement, cta_behavior }`

### OpenAI Responses API
We use the **Responses API** (not Chat Completions). See `openaiService.ts`:
- Creates conversations via `POST /conversations`
- Sends messages via prompts with `prompt.id` pattern
- Track `openai_conversation_id` on our conversations

### Webhook Handling
WhatsApp and Instagram both POST to `/webhook/meta`. The controller (`webhook.ts`) normalizes payloads:
- WhatsApp: `entry[].changes[].value.messages[]`
- Instagram: `entry[].messaging[]` OR `entry[].changes[].value` (two formats!)

### Error Response Format
Always include `correlationId` and `timestamp` in error responses:
```typescript
res.status(400).json({
  error: 'Error type',
  message: 'Details',
  timestamp: new Date().toISOString(),
  correlationId: req.correlationId,
});
```

## Platform-Specific Notes

| Platform | ID Field | Access Token | Notes |
|----------|----------|--------------|-------|
| WhatsApp | `meta_phone_number_id` | Required | WABA phone_number_id |
| Instagram | `meta_phone_number_id` | Required | Instagram Account ID |
| Webchat | Generated `webchat_id` | Not needed | Uses SSE (`sseManager.ts`) for real-time streaming to browser widgets |

## Database Migrations

Sequential SQL files in `server/migrations/`. See **[.github/database.md](database.md)** for exact table names, columns, and constraints.

Key tables: `users`, `phone_numbers`, `agents`, `conversations`, `messages`, `extractions`, `credits`, `google_calendar_tokens`, `meetings`

Run `npm run migrate` after schema changes.

## Configuration

All config validated via Joi in `server/src/config/index.ts`. Required env vars:
- `DATABASE_URL` - PostgreSQL connection string
- `OPENAI_API_KEY` - Must start with `sk-`
- `WEBHOOK_SECRET` - Min 10 chars, for Meta signature verification
