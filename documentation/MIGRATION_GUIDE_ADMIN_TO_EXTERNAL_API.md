# Migration Guide: Admin API → External API

**Version:** 2.3.0  
**Date:** December 13, 2025  
**Status:** Completed Implementation

---

## Executive Summary

We've migrated all template management functionality from authenticated `/admin/*` endpoints to unauthenticated `/api/v1/*` endpoints. This guide provides step-by-step instructions for updating your dashboard code.

### Why This Change?

| Issue | Old Approach | New Approach |
|-------|--------------|--------------|
| **Authentication** | Required JWT token for every request | No authentication (internal microservice) |
| **Complexity** | Dashboard needed login flow + token refresh | Simple HTTP calls |
| **Error Logs** | `Admin auth failed: no token provided` | Clean requests |
| **Architecture** | Mixed admin/dashboard responsibilities | Clear separation |

---

## What Changed

### New Endpoints Added

```
Server: /api/v1/* (NO AUTH)
─────────────────────────────────────────────────────
GET    /api/v1/templates/:templateId          ← NEW
POST   /api/v1/templates                      ← NEW
POST   /api/v1/templates/:templateId/submit   ← NEW
POST   /api/v1/templates/sync                 ← NEW
DELETE /api/v1/templates/:templateId          ← NEW
GET    /api/v1/templates/:templateId/button-clicks  ← NEW
GET    /api/v1/button-clicks                  ← NEW
GET    /api/v1/leads/:phone/button-activity   ← NEW
─────────────────────────────────────────────────────
Already existed:
GET    /api/v1/phone-numbers
GET    /api/v1/templates                      (list only)
POST   /api/v1/send
POST   /api/v1/campaign
GET    /api/v1/campaign/:campaignId
```

### Files Modified

| File | Changes |
|------|---------|
| `server/src/controllers/externalApiController.ts` | Added 8 new endpoint handlers |
| `server/src/app.ts` | Added routes for new endpoints |
| `documentation/EXTERNAL_API_REFERENCE.md` | New comprehensive documentation |

---

## Migration Steps

### Step 1: Update Environment Variables

No changes needed - same base URL:

```env
# .env (no changes)
VITE_WHATSAPP_SERVICE_URL=http://localhost:4000
```

---

### Step 2: Remove Authentication Code

**Delete any auth token management:**

```typescript
// ❌ DELETE THIS CODE
const loginResponse = await fetch(`${API_BASE}/admin/login`, {
  method: 'POST',
  body: JSON.stringify({ username: 'admin', password: 'xxx' })
});
const { token } = await loginResponse.json();
localStorage.setItem('admin_token', token);

// ❌ DELETE: Token refresh logic
// ❌ DELETE: Auth interceptors
// ❌ DELETE: Token expiry handling
```

---

### Step 3: Update API Service Functions

#### 3.1 List Templates

```typescript
// ❌ BEFORE (required auth)
async function listTemplates(phoneNumberId: string) {
  const token = localStorage.getItem('admin_token');
  const response = await fetch(`${API_BASE}/admin/templates?phone_number_id=${phoneNumberId}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
  return response.json();
}

// ✅ AFTER (no auth needed)
async function listTemplates(phoneNumberId: string) {
  const response = await fetch(
    `${API_BASE}/api/v1/templates?phone_number_id=${phoneNumberId}`
  );
  return response.json();
}
```

#### 3.2 Get Single Template

```typescript
// ❌ BEFORE
async function getTemplate(templateId: string) {
  const token = localStorage.getItem('admin_token');
  const response = await fetch(`${API_BASE}/admin/templates/${templateId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return response.json();
}

// ✅ AFTER
async function getTemplate(templateId: string) {
  const response = await fetch(`${API_BASE}/api/v1/templates/${templateId}`);
  return response.json();
}
```

#### 3.3 Create Template

```typescript
// ❌ BEFORE
async function createTemplate(data: CreateTemplateRequest) {
  const token = localStorage.getItem('admin_token');
  const response = await fetch(`${API_BASE}/admin/templates`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });
  return response.json();
}

// ✅ AFTER
async function createTemplate(data: CreateTemplateRequest) {
  const response = await fetch(`${API_BASE}/api/v1/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return response.json();
}
```

#### 3.4 Submit Template to Meta

```typescript
// ❌ BEFORE
async function submitTemplate(templateId: string) {
  const token = localStorage.getItem('admin_token');
  const response = await fetch(`${API_BASE}/admin/templates/${templateId}/submit`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return response.json();
}

// ✅ AFTER
async function submitTemplate(templateId: string) {
  const response = await fetch(`${API_BASE}/api/v1/templates/${templateId}/submit`, {
    method: 'POST'
  });
  return response.json();
}
```

#### 3.5 Sync Templates from Meta

```typescript
// ❌ BEFORE
async function syncTemplates(userId: string, phoneNumberId: string) {
  const token = localStorage.getItem('admin_token');
  const response = await fetch(`${API_BASE}/admin/templates/sync`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ user_id: userId, phone_number_id: phoneNumberId })
  });
  return response.json();
}

// ✅ AFTER
async function syncTemplates(userId: string, phoneNumberId: string) {
  const response = await fetch(`${API_BASE}/api/v1/templates/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, phone_number_id: phoneNumberId })
  });
  return response.json();
}
```

#### 3.6 Delete Template

```typescript
// ❌ BEFORE
async function deleteTemplate(templateId: string) {
  const token = localStorage.getItem('admin_token');
  const response = await fetch(`${API_BASE}/admin/templates/${templateId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return response.json();
}

// ✅ AFTER
async function deleteTemplate(templateId: string) {
  const response = await fetch(`${API_BASE}/api/v1/templates/${templateId}`, {
    method: 'DELETE'
  });
  return response.json();
}
```

#### 3.7 Get Button Click Analytics

```typescript
// ❌ BEFORE
async function getTemplateButtonClicks(templateId: string) {
  const token = localStorage.getItem('admin_token');
  const response = await fetch(`${API_BASE}/admin/templates/${templateId}/button-clicks`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return response.json();
}

// ✅ AFTER
async function getTemplateButtonClicks(templateId: string) {
  const response = await fetch(`${API_BASE}/api/v1/templates/${templateId}/button-clicks`);
  return response.json();
}
```

#### 3.8 List All Button Clicks

```typescript
// ❌ BEFORE (used userId param name)
async function listButtonClicks(userId: string, options?: { templateId?: string }) {
  const token = localStorage.getItem('admin_token');
  const params = new URLSearchParams({ userId });
  if (options?.templateId) params.append('templateId', options.templateId);
  
  const response = await fetch(`${API_BASE}/admin/button-clicks?${params}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return response.json();
}

// ✅ AFTER (uses user_id param name)
async function listButtonClicks(userId: string, options?: { templateId?: string }) {
  const params = new URLSearchParams({ user_id: userId });
  if (options?.templateId) params.append('template_id', options.templateId);
  
  const response = await fetch(`${API_BASE}/api/v1/button-clicks?${params}`);
  return response.json();
}
```

#### 3.9 Get Lead Button Activity

```typescript
// ❌ BEFORE (used userId param name)
async function getLeadButtonActivity(customerPhone: string, userId: string) {
  const token = localStorage.getItem('admin_token');
  const response = await fetch(
    `${API_BASE}/admin/leads/${encodeURIComponent(customerPhone)}/button-activity?userId=${userId}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  return response.json();
}

// ✅ AFTER (uses user_id param name)
async function getLeadButtonActivity(customerPhone: string, userId: string) {
  const response = await fetch(
    `${API_BASE}/api/v1/leads/${encodeURIComponent(customerPhone)}/button-activity?user_id=${userId}`
  );
  return response.json();
}
```

---

### Step 4: Update Query Parameter Names

The external API uses snake_case for consistency:

| Old (Admin API) | New (External API) |
|-----------------|-------------------|
| `userId` | `user_id` |
| `phoneNumberId` | `phone_number_id` |
| `templateId` | `template_id` |

```typescript
// ❌ BEFORE
`/admin/templates?phoneNumberId=${id}`
`/admin/button-clicks?userId=${id}&templateId=${tid}`

// ✅ AFTER
`/api/v1/templates?phone_number_id=${id}`
`/api/v1/button-clicks?user_id=${id}&template_id=${tid}`
```

---

### Step 5: Complete API Service (Copy-Paste Ready)

Replace your entire template API service with this:

```typescript
// services/templateApi.ts

const API_BASE = import.meta.env.VITE_WHATSAPP_SERVICE_URL;

// Types
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: string;
  correlationId: string;
}

interface Template {
  template_id: string;
  user_id: string;
  phone_number_id: string;
  name: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAUSED' | 'DISABLED';
  language: string;
  components: any[];
  meta_template_id?: string;
  created_at: string;
}

interface TemplateVariable {
  variable_id: string;
  variable_name: string;
  position: number;
  component_type: string;
  extraction_field?: string;
  default_value?: string;
  sample_value?: string;
  description?: string;
  is_required?: boolean;
  placeholder?: string;
}

interface CreateTemplateRequest {
  user_id: string;
  phone_number_id: string;
  name: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  language?: string;
  components: any[];
  variables?: Array<{
    variable_name: string;
    position: number;
    description?: string;
    default_value?: string;
    sample_value?: string;
    is_required?: boolean;
    placeholder?: string;
  }>;
}

// Generic API call helper
async function apiCall<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      ...options,
    });
    return await response.json();
  } catch (error) {
    return {
      success: false,
      error: 'Network Error',
      message: error instanceof Error ? error.message : 'Failed to connect',
      timestamp: new Date().toISOString(),
      correlationId: 'local',
    };
  }
}

// ==================== TEMPLATES ====================

export async function listTemplates(phoneNumberId: string) {
  return apiCall<Template[]>(`/api/v1/templates?phone_number_id=${phoneNumberId}`);
}

export async function getTemplate(templateId: string) {
  return apiCall<{
    template: Template;
    variables: TemplateVariable[];
    analytics: { total_sends: number; delivered_count: number; read_count: number };
  }>(`/api/v1/templates/${templateId}`);
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
  return apiCall<{
    imported: Array<{ template_id: string; name: string }>;
    updated: Array<{ template_id: string; name: string }>;
    errors: string[];
    summary: { totalImported: number; totalUpdated: number; totalErrors: number };
  }>('/api/v1/templates/sync', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, phone_number_id: phoneNumberId }),
  });
}

export async function deleteTemplate(templateId: string) {
  return apiCall<void>(`/api/v1/templates/${templateId}`, {
    method: 'DELETE',
  });
}

// ==================== BUTTON ANALYTICS ====================

export async function getTemplateButtonClicks(templateId: string) {
  return apiCall<{
    template_id: string;
    template_name: string;
    buttons: Array<{
      button_id: string;
      button_text: string;
      total_clicks: number;
      unique_clicks: number;
    }>;
    total_clicks: number;
  }>(`/api/v1/templates/${templateId}/button-clicks`);
}

export async function listButtonClicks(
  userId: string,
  options?: { templateId?: string; limit?: number; offset?: number }
) {
  const params = new URLSearchParams({ user_id: userId });
  if (options?.templateId) params.append('template_id', options.templateId);
  if (options?.limit) params.append('limit', String(options.limit));
  if (options?.offset) params.append('offset', String(options.offset));

  return apiCall<Array<{
    click_id: string;
    template_id: string;
    button_id: string;
    button_text: string;
    customer_phone: string;
    clicked_at: string;
  }>>(`/api/v1/button-clicks?${params}`);
}

export async function getLeadButtonActivity(customerPhone: string, userId: string) {
  return apiCall<{
    customer_phone: string;
    buttons_clicked: Array<{
      template_name: string;
      button_text: string;
      clicked_at: string;
    }>;
    total_clicks: number;
  }>(`/api/v1/leads/${encodeURIComponent(customerPhone)}/button-activity?user_id=${userId}`);
}

// ==================== MESSAGING ====================

export async function sendMessage(data: {
  phone_number_id: string;
  template_id: string;
  contact: { phone: string; name?: string; email?: string; company?: string };
  variables?: Record<string, string>;
}) {
  return apiCall<{
    message_id: string;
    contact_id: string;
    conversation_id: string;
    credits_remaining: number;
  }>('/api/v1/send', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function listPhoneNumbers(userId: string) {
  return apiCall<Array<{
    id: string;
    user_id: string;
    platform: string;
    meta_phone_number_id: string;
    display_name: string;
  }>>(`/api/v1/phone-numbers?user_id=${userId}`);
}
```

---

### Step 6: Update React Hooks (If Using)

```typescript
// ❌ BEFORE: Hook with auth handling
function useTemplates(phoneNumberId: string) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      setError('Not authenticated');
      return;
    }
    
    fetch(`${API_BASE}/admin/templates?phone_number_id=${phoneNumberId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => setTemplates(data.data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [phoneNumberId]);

  return { templates, loading, error };
}

// ✅ AFTER: Simple hook without auth
function useTemplates(phoneNumberId: string) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/v1/templates?phone_number_id=${phoneNumberId}`)
      .then(res => res.json())
      .then(data => {
        if (data.success) setTemplates(data.data);
        else setError(data.message);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [phoneNumberId]);

  return { templates, loading, error };
}
```

---

### Step 7: Clean Up Unused Code

Remove these files/functions if they exist:

```
❌ DELETE: services/authService.ts (or auth-related functions)
❌ DELETE: hooks/useAuth.ts
❌ DELETE: components/LoginForm.tsx (if only for admin auth)
❌ DELETE: middleware/authInterceptor.ts
❌ DELETE: stores/authStore.ts (if only for admin auth)
```

---

## Testing Checklist

### Quick Test Commands

```bash
# Test list templates (replace with your phone_number_id)
curl http://localhost:4000/api/v1/templates?phone_number_id=your_pn_id

# Test get single template
curl http://localhost:4000/api/v1/templates/your_template_id

# Test create template
curl -X POST http://localhost:4000/api/v1/templates \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "your_user_id",
    "phone_number_id": "your_pn_id",
    "name": "test_template",
    "category": "UTILITY",
    "components": [{"type": "BODY", "text": "Hello {{1}}!"}],
    "variables": [{"variable_name": "name", "position": 1, "sample_value": "John"}]
  }'

# Test sync templates
curl -X POST http://localhost:4000/api/v1/templates/sync \
  -H "Content-Type: application/json" \
  -d '{"user_id": "your_user_id", "phone_number_id": "your_pn_id"}'
```

### Functional Tests

| Test | Expected Result | Status |
|------|-----------------|--------|
| List templates without auth | Returns templates array | ☐ |
| Get template by ID | Returns template + variables + analytics | ☐ |
| Create template | Returns new template with DRAFT status | ☐ |
| Submit template to Meta | Status changes to PENDING | ☐ |
| Sync templates from Meta | Returns imported/updated counts | ☐ |
| Delete template | Returns success message | ☐ |
| Get button clicks | Returns click analytics | ☐ |
| List all button clicks | Returns paginated clicks | ☐ |
| Get lead button activity | Returns lead's click history | ☐ |
| Send template message | Returns message_id | ☐ |

### Error Handling Tests

| Test | Expected Result | Status |
|------|-----------------|--------|
| List templates without phone_number_id | 400 with error message | ☐ |
| Get non-existent template | 404 Not Found | ☐ |
| Create template missing required fields | 400 Bad Request | ☐ |
| Button clicks without user_id | 400 Bad Request | ☐ |

---

## Common Issues & Solutions

### Issue 1: Still Getting 401 Unauthorized

**Symptom:** `Admin auth failed: no token provided`

**Cause:** You're still calling `/admin/*` endpoints

**Solution:** Update URL to `/api/v1/*`:
```typescript
// ❌ Wrong
fetch(`${API_BASE}/admin/templates`)

// ✅ Correct
fetch(`${API_BASE}/api/v1/templates?phone_number_id=xxx`)
```

### Issue 2: 400 Bad Request on List Templates

**Symptom:** `phone_number_id query parameter is required`

**Cause:** External API requires `phone_number_id` to filter templates

**Solution:** Always pass `phone_number_id`:
```typescript
// ❌ Wrong (admin API accepted user_id)
fetch(`${API_BASE}/api/v1/templates?user_id=xxx`)

// ✅ Correct
fetch(`${API_BASE}/api/v1/templates?phone_number_id=xxx`)
```

### Issue 3: Different Parameter Names

**Symptom:** Parameters not being recognized

**Cause:** External API uses snake_case

**Solution:** Use correct param names:
```typescript
// Admin API used: userId, phoneNumberId, templateId
// External API uses: user_id, phone_number_id, template_id
```

### Issue 4: CORS Errors

**Symptom:** Cross-origin request blocked

**Cause:** Server CORS config may need updating

**Solution:** Server already allows all origins for `/api/v1/*`. If issues persist, check browser console for specific origin being blocked.

---

## Rollback Plan

If issues arise, you can temporarily revert to admin endpoints:

1. Keep auth code commented (not deleted) initially
2. Admin endpoints still work with proper auth
3. Once external API verified, remove admin auth code

---

## Summary

### Before Migration
```
Dashboard → /admin/* (with JWT) → Server → Meta
          ↑
          └── Login, token refresh, auth errors
```

### After Migration
```
Dashboard → /api/v1/* (no auth) → Server → Meta
          ↑
          └── Simple HTTP calls, no auth complexity
```

### Key Changes

| Aspect | Before | After |
|--------|--------|-------|
| Base path | `/admin/*` | `/api/v1/*` |
| Authentication | JWT Bearer token | None |
| Param naming | camelCase | snake_case |
| Error rate | High (auth issues) | Low |
| Code complexity | High | Simple |

---

## Related Documentation

- [EXTERNAL_API_REFERENCE.md](EXTERNAL_API_REFERENCE.md) - Complete endpoint documentation
- [DASHBOARD_VARIABLE_INTEGRATION_GUIDE.md](DASHBOARD_VARIABLE_INTEGRATION_GUIDE.md) - Variable mapping
- [TEMPLATE_API_REFERENCE.md](TEMPLATE_API_REFERENCE.md) - Template system details
