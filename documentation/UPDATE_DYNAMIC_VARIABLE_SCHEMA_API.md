# API Update: Dynamic Variable Schema

**Date:** December 13, 2025  
**Version:** 2.3.0  
**Status:** Implemented

---

## Summary

Updated the template variable system to support **client-side dynamic mapping**. The dashboard now has full control over how template variables are resolved, while the server maintains backwards compatibility with server-side auto-fill.

---

## What Changed

### 1. New Database Fields

Migration `023_update_template_variables_dynamic_mapping.sql` adds:

| Field | Type | Description |
|-------|------|-------------|
| `description` | TEXT | Human-readable description for dashboard UI |
| `is_required` | BOOLEAN | Whether variable must have a value |
| `placeholder` | VARCHAR(255) | Placeholder text for input fields |

### 2. `extraction_field` is Now Truly Optional

Previously, the system expected `extraction_field` to be set for auto-fill. Now:

- **Dashboard can leave it empty** - Indicates dashboard will resolve values
- **Server still supports it** - For backwards compatibility and server-side auto-fill
- **Neither is required** - Dashboard sends resolved values at send time

### 3. Variable Resolution Priority Updated

```
1. manualValues[position]        →  "1": "John"         (dashboard sends by position)
2. manualValues[variable_name]   →  "customer_name": "John"  (dashboard sends by name)
3. extraction_field              →  Server auto-fill from extraction data
4. default_value                 →  Fallback value
5. sample_value                  →  Last resort (Meta review sample)
```

---

## New Flow: Client-Side Variable Mapping

### Step 1: Create Template

Dashboard sends template with variable metadata only (no extraction_field needed):

```http
POST ${VITE_WHATSAPP_SERVICE_URL}/api/v1/templates
Content-Type: application/json

{
  "user_id": "user_123",
  "phone_number_id": "pn_456",
  "name": "lead_followup",
  "category": "MARKETING",
  "components": [
    {
      "type": "BODY",
      "text": "Hi {{1}}! Thanks for interest in {{2}}. Your score is {{3}}.",
      "example": {
        "body_text": [["John", "our product", "Hot"]]
      }
    }
  ],
  "variables": [
    {
      "variable_name": "customer_name",
      "position": 1,
      "description": "Lead's name from conversation",
      "default_value": "there",
      "sample_value": "John",
      "placeholder": "Enter customer name",
      "is_required": false
    },
    {
      "variable_name": "interest_topic",
      "position": 2,
      "description": "What the lead is interested in",
      "default_value": "our services",
      "sample_value": "our product",
      "placeholder": "e.g., enterprise pricing"
    },
    {
      "variable_name": "lead_status",
      "position": 3,
      "description": "Lead qualification status",
      "default_value": "Warm",
      "sample_value": "Hot",
      "is_required": true
    }
  ]
}
```

**Note:** No `extraction_field` - dashboard will handle mapping!

---

### Step 2: Fetch Template (Server → Dashboard)

When dashboard fetches template, it receives variable metadata:

```http
GET ${VITE_WHATSAPP_SERVICE_URL}/api/v1/templates/tpl_abc123
```

**Response:**
```json
{
  "success": true,
  "data": {
    "template": {
      "template_id": "tpl_abc123",
      "name": "lead_followup",
      "components": [
        {
          "type": "BODY",
          "text": "Hi {{1}}! Thanks for interest in {{2}}. Your score is {{3}}."
        }
      ]
    },
    "variables": [
      {
        "variable_id": "var_001",
        "variable_name": "customer_name",
        "position": 1,
        "component_type": "BODY",
        "extraction_field": null,
        "default_value": "there",
        "sample_value": "John",
        "description": "Lead's name from conversation",
        "placeholder": "Enter customer name",
        "is_required": false
      },
      {
        "variable_id": "var_002",
        "variable_name": "interest_topic",
        "position": 2,
        "component_type": "BODY",
        "extraction_field": null,
        "default_value": "our services",
        "sample_value": "our product",
        "description": "What the lead is interested in",
        "placeholder": "e.g., enterprise pricing",
        "is_required": false
      },
      {
        "variable_id": "var_003",
        "variable_name": "lead_status",
        "position": 3,
        "component_type": "BODY",
        "extraction_field": null,
        "default_value": "Warm",
        "sample_value": "Hot",
        "description": "Lead qualification status",
        "placeholder": null,
        "is_required": true
      }
    ]
  }
}
```

Dashboard now knows:
- `customer_name` → position 1
- `interest_topic` → position 2  
- `lead_status` → position 3 (required!)

---

### Step 3: Dashboard Maps Variables (Client-Side)

Dashboard has lead data from its own sources:

```typescript
// Dashboard's lead data (from your database, API, etc.)
const leadData = {
  name: "Sarah Johnson",
  email: "sarah@techcorp.com", 
  company: "TechCorp",
  interested_in: "enterprise API",
  qualification: "Hot",
  score: 12,
  // ... any fields dashboard has
};

// Dashboard's mapping configuration (could be stored, or dynamic)
const variableMapping = {
  "customer_name": "name",           // Map to leadData.name
  "interest_topic": "interested_in", // Map to leadData.interested_in
  "lead_status": "qualification",    // Map to leadData.qualification
};

// Dashboard resolves values
function resolveVariables(template, leadData, mapping) {
  const resolved = {};
  
  for (const variable of template.variables) {
    const sourceField = mapping[variable.variable_name];
    const value = leadData[sourceField] || variable.default_value;
    
    // Key by position for sending to server
    resolved[variable.position.toString()] = value;
  }
  
  return resolved;
}

// Result:
// { "1": "Sarah Johnson", "2": "enterprise API", "3": "Hot" }
```

---

### Step 4: Send Message (Dashboard → Server)

Dashboard sends **already resolved** values:

```http
POST ${VITE_WHATSAPP_SERVICE_URL}/api/v1/send
Content-Type: application/json

{
  "phone_number_id": "pn_456",
  "template_id": "tpl_abc123",
  "contact": {
    "phone": "+14155551234",
    "name": "Sarah Johnson",
    "email": "sarah@techcorp.com",
    "company": "TechCorp"
  },
  "variables": {
    "1": "Sarah Johnson",
    "2": "enterprise API",
    "3": "Hot"
  }
}
```

**Server receives pre-resolved values and sends directly to WhatsApp!**

---

## Dashboard UI Recommendations

### Variable Configuration Form (Template Creation)

```
┌─────────────────────────────────────────────────────────────────┐
│ Template Variables                                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Variable {{1}}                                                  │
│ ┌─────────────────────────────────────────────────────────────┐│
│ │ Name:        [ customer_name__________ ]                    ││
│ │ Description: [ Lead's name from conversation_____________ ] ││
│ │ Default:     [ there___________________ ]                   ││
│ │ Placeholder: [ Enter customer name_____ ]                   ││
│ │ Required:    [ ] Yes                                        ││
│ └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│ Variable {{2}}                                                  │
│ ┌─────────────────────────────────────────────────────────────┐│
│ │ Name:        [ interest_topic_________ ]                    ││
│ │ Description: [ What the lead is interested in____________ ] ││
│ │ Default:     [ our services____________ ]                   ││
│ │ Placeholder: [ e.g., enterprise pricing ]                   ││
│ │ Required:    [ ] Yes                                        ││
│ └─────────────────────────────────────────────────────────────┘│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Variable Mapping Form (Before Sending)

When sending a message, dashboard shows mapping interface:

```
┌─────────────────────────────────────────────────────────────────┐
│ Map Variables for: lead_followup                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ customer_name ({{1}})                                           │
│ "Lead's name from conversation"                                 │
│ Source: [▼ Select from lead data  ]   Value: [ Sarah Johnson ] │
│         ├── name ✓                                              │
│         ├── email                                               │
│         ├── company                                             │
│         ├── (custom value)                                      │
│         └── (use default: "there")                              │
│                                                                 │
│ interest_topic ({{2}})                                          │
│ "What the lead is interested in"                                │
│ Source: [▼ interested_in         ]   Value: [ enterprise API ] │
│                                                                 │
│ lead_status ({{3}}) ⚠️ Required                                 │
│ "Lead qualification status"                                     │
│ Source: [▼ qualification         ]   Value: [ Hot____________ ]│
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ Preview:                                                        │
│ "Hi Sarah Johnson! Thanks for interest in enterprise API.       │
│  Your score is Hot."                                            │
│                                                                 │
│                              [ Cancel ]  [ Send Message ]       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Backwards Compatibility

### Server-Side Auto-Fill Still Works

If you still want server-side auto-fill (e.g., for campaigns), you can still use `extraction_field`:

```json
{
  "variables": [
    {
      "variable_name": "customer_name",
      "position": 1,
      "extraction_field": "name",
      "default_value": "Customer"
    }
  ]
}
```

When sending without explicit variables, server will auto-fill from extraction data:

```http
POST /api/v1/send
{
  "phone_number_id": "pn_456",
  "template_id": "tpl_abc123",
  "contact": { "phone": "+14155551234" }
  // No variables - server will use extraction_field if set
}
```

---

## Migration Steps

### For Existing Templates

No changes needed! Existing templates with `extraction_field` continue to work.

### For New Templates (Client-Side Mapping)

1. Create template without `extraction_field`
2. Dashboard stores its own mapping configuration
3. Dashboard resolves variables before sending

### Database Migration

Run the migration:

```bash
npm run migrate
```

This adds new optional fields - no breaking changes to existing data.

---

## API Reference Updates

### Create Template Variable

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `variable_name` | string | Yes | Human-readable name |
| `position` | number | Yes | Maps to {{1}}, {{2}}, etc. |
| `component_type` | string | No | HEADER, BODY, or BUTTON (default: BODY) |
| `extraction_field` | string | No | For server-side auto-fill (optional) |
| `default_value` | string | No | Fallback value |
| `sample_value` | string | No | For Meta review |
| `description` | string | No | **NEW** - UI description |
| `is_required` | boolean | No | **NEW** - Must have value |
| `placeholder` | string | No | **NEW** - Input placeholder |

### Send Message Variables

Variables can be keyed by **position** or **variable_name**:

```json
// By position (recommended)
{
  "variables": {
    "1": "John",
    "2": "enterprise pricing"
  }
}

// By variable_name (also supported)
{
  "variables": {
    "customer_name": "John",
    "interest_topic": "enterprise pricing"
  }
}
```

---

## Files Changed

| File | Change |
|------|--------|
| `migrations/023_update_template_variables_dynamic_mapping.sql` | New migration |
| `src/models/types.ts` | Added `description`, `is_required`, `placeholder` to TemplateVariable |
| `src/services/templateService.ts` | Updated `createTemplateVariable` and `substituteVariables` |

---

## Benefits of Client-Side Mapping

1. **Dashboard has full control** - Map to any data source
2. **No server changes needed** - Add new fields without backend updates
3. **Flexible mapping** - Different campaigns can use different mappings
4. **Simpler server** - Just passes through resolved values
5. **Better UX** - Dashboard shows live preview with actual values

---

## Example: Complete Flow

```typescript
// 1. Dashboard creates template
const template = await createTemplate({
  name: "promo_offer",
  components: [...],
  variables: [
    { variable_name: "name", position: 1, default_value: "Friend" },
    { variable_name: "discount", position: 2, default_value: "10%" }
  ]
});

// 2. Dashboard fetches template for sending
const { variables } = await getTemplate(template.template_id);
// variables: [{ variable_name: "name", position: 1, ... }, ...]

// 3. Dashboard resolves from its lead data
const lead = await getLeadData(leadId);
const resolved = {
  "1": lead.fullName || "Friend",
  "2": lead.vipStatus ? "25%" : "10%"
};

// 4. Dashboard sends with resolved values
await sendMessage({
  template_id: template.template_id,
  contact: { phone: lead.phone },
  variables: resolved  // { "1": "Sarah", "2": "25%" }
});

// 5. Server sends to WhatsApp with exact values provided
```

---

## Questions?

If you have questions about implementing this in the dashboard, the key points are:

1. **Fetch variables** from `GET /api/v1/templates/:id` response
2. **Store your own mapping** (which lead field → which variable_name)
3. **Resolve before sending** - Send already-filled values in `variables`
4. **Use position keys** - `{ "1": "value", "2": "value" }` format
