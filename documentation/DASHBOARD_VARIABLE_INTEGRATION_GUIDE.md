# Dashboard Integration Guide: Dynamic Template Variables

**For:** Frontend/Dashboard Developers  
**Version:** 2.3.0  
**Last Updated:** December 13, 2025

---

## Overview

This guide explains how to integrate the template variable system into the main dashboard, from template creation to sending messages with dynamic variables.

---

## Where Data is Stored

### Database Tables

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        DATABASE SCHEMA                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  templates                         template_variables                   │
│  ──────────────────────           ───────────────────────────          │
│  template_id (PK)                 variable_id (PK)                      │
│  user_id (FK → users)             template_id (FK → templates)          │
│  phone_number_id                  variable_name      ← Human label      │
│  name                             position           ← Maps to {{1}}    │
│  category                         component_type     ← HEADER/BODY      │
│  status                           extraction_field   ← Optional auto-fill│
│  language                         default_value      ← Fallback         │
│  components (JSONB)               sample_value       ← Meta review      │
│  header_type                      description        ← UI help text     │
│  header_media_url                 is_required        ← Validation       │
│  meta_template_id                 placeholder        ← Input hint       │
│  ...                              created_at                            │
│                                   updated_at                            │
│                                                                         │
│  template_sends                   button_clicks                         │
│  ──────────────────────           ───────────────────────────          │
│  send_id (PK)                     click_id (PK)                         │
│  template_id (FK)                 template_id (FK)                      │
│  customer_phone                   button_id                             │
│  variable_values (JSONB)  ←       customer_phone                        │
│     Stores resolved values        clicked_at                            │
│     sent to WhatsApp              user_id                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Storage Location Summary

| Data | Table | Column | Type |
|------|-------|--------|------|
| Variable definitions | `template_variables` | Multiple | Individual columns |
| Variable metadata (name, desc) | `template_variables` | `variable_name`, `description` | VARCHAR, TEXT |
| Position mapping | `template_variables` | `position` | INTEGER (1-10) |
| Default/sample values | `template_variables` | `default_value`, `sample_value` | VARCHAR |
| UI hints | `template_variables` | `placeholder`, `is_required` | VARCHAR, BOOLEAN |
| Sent variable values | `template_sends` | `variable_values` | JSONB |
| Template body with {{N}} | `templates` | `components` | JSONB |

---

## API Endpoints Reference

> **⚠️ Use `/api/v1/*` endpoints (NO authentication required)**

### Base URL

```typescript
const API_BASE = import.meta.env.VITE_WHATSAPP_SERVICE_URL;
// Example: "http://localhost:4000" or "https://api.yourservice.com"
```

### 1. Create Template with Variables

**Endpoint:** `POST ${API_BASE}/api/v1/templates`

```typescript
interface CreateTemplateRequest {
  user_id: string;
  phone_number_id: string;
  name: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  language?: string;  // Default: 'en'
  
  // Template content with {{1}}, {{2}} placeholders
  components: TemplateComponent[];
  
  // Variable definitions
  variables?: CreateVariableInput[];
  
  // Optional media header
  header_type?: 'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION';
  header_media_url?: string;  // Public R2 URL for media
}

interface CreateVariableInput {
  variable_name: string;     // Required: "customer_name"
  position: number;          // Required: 1-10 (maps to {{1}}-{{10}})
  component_type?: string;   // "HEADER" | "BODY" | "BUTTON" (default: "BODY")
  default_value?: string;    // Fallback value
  sample_value?: string;     // For Meta review (required by Meta)
  description?: string;      // UI help text
  is_required?: boolean;     // Must have value before sending
  placeholder?: string;      // Input placeholder hint
  extraction_field?: string; // Optional server auto-fill (see below)
}
```

**Example Request:**

```typescript
const response = await fetch(`${API_BASE}/api/v1/templates`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    user_id: currentUser.id,
    phone_number_id: selectedPhoneNumber.id,
    name: "order_confirmation",
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}! Your order #{{2}} for ${{3}} has been confirmed.",
        example: {
          body_text: [["John", "12345", "99.99"]]
        }
      }
    ],
    variables: [
      {
        variable_name: "customer_name",
        position: 1,
        description: "Customer's full name",
        default_value: "Customer",
        sample_value: "John",
        placeholder: "e.g., John Smith",
        is_required: false
      },
      {
        variable_name: "order_number",
        position: 2,
        description: "Order ID from your system",
        sample_value: "12345",
        is_required: true
      },
      {
        variable_name: "order_total",
        position: 3,
        description: "Total amount",
        default_value: "0.00",
        sample_value: "99.99",
        placeholder: "e.g., 149.99"
      }
    ]
  })
});

const { data } = await response.json();
// data.template_id = "tpl_abc123"
```

---

### 2. Fetch Template with Variables

**Endpoint:** `GET ${API_BASE}/api/v1/templates/:templateId`

**Response Structure:**

```typescript
interface GetTemplateResponse {
  success: true;
  data: {
    template: Template;
    variables: TemplateVariable[];
    buttons: TemplateButton[];
    analytics: {
      total_sends: number;
      delivered_count: number;
      read_count: number;
      // ...
    };
  };
}

interface TemplateVariable {
  variable_id: string;
  template_id: string;
  variable_name: string;      // "customer_name"
  position: number;           // 1 (maps to {{1}})
  component_type: string;     // "BODY"
  extraction_field: string | null;
  default_value: string | null;
  sample_value: string | null;
  description: string | null;
  is_required: boolean | null;
  placeholder: string | null;
  created_at: string;
  updated_at: string;
}
```

**Example Usage:**

```typescript
async function fetchTemplateWithVariables(templateId: string) {
  const response = await fetch(`${API_BASE}/api/v1/templates/${templateId}`);
  const { data } = await response.json();
  
  return {
    template: data.template,
    variables: data.variables,  // Array of variable definitions
    buttons: data.buttons
  };
}

// Result:
// variables = [
//   { variable_name: "customer_name", position: 1, description: "Customer's full name", ... },
//   { variable_name: "order_number", position: 2, description: "Order ID", is_required: true, ... },
//   { variable_name: "order_total", position: 3, ... }
// ]
```

---

### 3. List All Templates

**Endpoint:** `GET ${API_BASE}/api/v1/templates?user_id={userId}&phone_number_id={phoneId}`

```typescript
interface ListTemplatesResponse {
  success: true;
  data: {
    templates: Template[];
    total: number;
  };
}
```

---

### 4. Send Message with Variables

**Endpoint:** `POST ${API_BASE}/api/v1/send`

```typescript
interface SendMessageRequest {
  phone_number_id: string;
  template_id: string;
  contact: {
    phone: string;      // E.164 format: "+14155551234"
    name?: string;
    email?: string;
    company?: string;
  };
  variables: Record<string, string>;  // Position-keyed values
}
```

**Example:**

```typescript
await fetch(`${API_BASE}/api/v1/send`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    phone_number_id: "pn_456",
    template_id: "tpl_abc123",
    contact: {
      phone: "+14155551234",
      name: "Sarah Johnson"
    },
    variables: {
      "1": "Sarah Johnson",    // customer_name
      "2": "ORD-98765",        // order_number
      "3": "149.99"            // order_total
    }
  })
});
```

---

### 5. Send Campaign (Bulk)

**Endpoint:** `POST ${API_BASE}/api/v1/campaign`

```typescript
interface CampaignRequest {
  phone_number_id: string;
  template_id: string;
  name: string;
  contacts: Array<{
    phone: string;
    name?: string;
    variables?: Record<string, string>;  // Per-contact overrides
  }>;
}
```

---

## Dashboard Implementation Flow

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    TEMPLATE VARIABLE LIFECYCLE                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ╔═══════════════════════════════════════════════════════════════════╗  │
│  ║  STEP 1: CREATE TEMPLATE                                          ║  │
│  ╚═══════════════════════════════════════════════════════════════════╝  │
│                                                                         │
│  Dashboard                          Server                     Database │
│  ─────────                          ──────                     ──────── │
│                                                                         │
│  User writes template body:                                             │
│  "Hi {{1}}! Order #{{2}}"                                              │
│           │                                                             │
│           ▼                                                             │
│  Dashboard detects {{1}}, {{2}}                                        │
│  Shows variable config form                                            │
│           │                                                             │
│           ▼                                                             │
│  User fills metadata:                                                   │
│  - variable_name: "customer_name"                                      │
│  - description: "Lead's name"                                          │
│  - default_value: "Customer"                                           │
│           │                                                             │
│           ▼                                                             │
│  POST /api/v1/templates ─────────────► Creates template                 │
│  with variables array                 + variables ────────────► Stored │
│                                                                         │
│                                                                         │
│  ╔═══════════════════════════════════════════════════════════════════╗  │
│  ║  STEP 2: PREPARE TO SEND                                          ║  │
│  ╚═══════════════════════════════════════════════════════════════════╝  │
│                                                                         │
│  User selects template                                                  │
│  User selects lead/contact                                             │
│           │                                                             │
│           ▼                                                             │
│  GET /api/v1/templates/:id ──────────► Returns template                 │
│                                       + variables ◄──────────── Fetched │
│           │                                                             │
│           ▼                                                             │
│  Dashboard receives:                                                    │
│  variables = [                                                         │
│    { variable_name: "customer_name", position: 1, ... },              │
│    { variable_name: "order_id", position: 2, ... }                    │
│  ]                                                                     │
│                                                                         │
│                                                                         │
│  ╔═══════════════════════════════════════════════════════════════════╗  │
│  ║  STEP 3: MAP VARIABLES (CLIENT-SIDE)                              ║  │
│  ╚═══════════════════════════════════════════════════════════════════╝  │
│                                                                         │
│  Dashboard has lead data:                                              │
│  lead = {                                                              │
│    fullName: "Sarah Johnson",                                          │
│    orderNumber: "ORD-98765",                                           │
│    ...                                                                 │
│  }                                                                     │
│           │                                                             │
│           ▼                                                             │
│  Dashboard maps: (YOUR LOGIC)                                          │
│  "customer_name" → lead.fullName                                       │
│  "order_id" → lead.orderNumber                                         │
│           │                                                             │
│           ▼                                                             │
│  Resolved: { "1": "Sarah Johnson", "2": "ORD-98765" }                  │
│                                                                         │
│                                                                         │
│  ╔═══════════════════════════════════════════════════════════════════╗  │
│  ║  STEP 4: SEND MESSAGE                                             ║  │
│  ╚═══════════════════════════════════════════════════════════════════╝  │
│                                                                         │
│  POST /api/v1/send ─────────────────► Server receives                  │
│  {                                    resolved values                   │
│    template_id: "tpl_abc",                    │                         │
│    variables: {                               ▼                         │
│      "1": "Sarah Johnson",            Sends to WhatsApp                │
│      "2": "ORD-98765"                 with exact values                │
│    }                                          │                         │
│  }                                            ▼                         │
│                                       Stores in ──────────► template_sends│
│                                       variable_values        (JSONB)   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Code Examples for Dashboard

### 1. Template Creation Component

```typescript
// types.ts
interface VariableConfig {
  variable_name: string;
  position: number;
  description: string;
  default_value: string;
  sample_value: string;
  placeholder: string;
  is_required: boolean;
}

// TemplateCreator.tsx
function TemplateCreator() {
  const [templateBody, setTemplateBody] = useState('');
  const [variables, setVariables] = useState<VariableConfig[]>([]);

  // Auto-detect variables when body changes
  useEffect(() => {
    const regex = /\{\{(\d+)\}\}/g;
    const matches = [...templateBody.matchAll(regex)];
    const positions = [...new Set(matches.map(m => parseInt(m[1])))].sort();
    
    setVariables(positions.map(pos => ({
      variable_name: '',
      position: pos,
      description: '',
      default_value: '',
      sample_value: '',
      placeholder: '',
      is_required: false
    })));
  }, [templateBody]);

  return (
    <div>
      <textarea
        value={templateBody}
        onChange={(e) => setTemplateBody(e.target.value)}
        placeholder="Hi {{1}}! Your order #{{2}} is ready."
      />
      
      {variables.map((v, idx) => (
        <VariableConfigForm
          key={v.position}
          position={v.position}
          value={v}
          onChange={(updated) => {
            const newVars = [...variables];
            newVars[idx] = updated;
            setVariables(newVars);
          }}
        />
      ))}
      
      <button onClick={() => createTemplate(templateBody, variables)}>
        Create Template
      </button>
    </div>
  );
}

// VariableConfigForm.tsx
function VariableConfigForm({ position, value, onChange }) {
  return (
    <div className="variable-config">
      <h4>Variable {`{{${position}}}`}</h4>
      
      <label>
        Name (internal identifier)
        <input
          value={value.variable_name}
          onChange={(e) => onChange({ ...value, variable_name: e.target.value })}
          placeholder="customer_name"
        />
      </label>
      
      <label>
        Description (for team)
        <input
          value={value.description}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
          placeholder="Customer's full name from lead data"
        />
      </label>
      
      <label>
        Default Value (fallback)
        <input
          value={value.default_value}
          onChange={(e) => onChange({ ...value, default_value: e.target.value })}
          placeholder="Customer"
        />
      </label>
      
      <label>
        Sample Value (for Meta review)
        <input
          value={value.sample_value}
          onChange={(e) => onChange({ ...value, sample_value: e.target.value })}
          placeholder="John"
          required
        />
      </label>
      
      <label>
        <input
          type="checkbox"
          checked={value.is_required}
          onChange={(e) => onChange({ ...value, is_required: e.target.checked })}
        />
        Required (must have value before sending)
      </label>
    </div>
  );
}
```

### 2. Send Message Component with Variable Mapping

```typescript
// SendMessageDialog.tsx
interface Lead {
  id: string;
  phone: string;
  fullName: string;
  email: string;
  company: string;
  // ... your lead fields
}

function SendMessageDialog({ template, lead }: { template: Template; lead: Lead }) {
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState('');

  // Initialize with mapped/default values
  useEffect(() => {
    const initial: Record<string, string> = {};
    
    for (const v of template.variables) {
      // Your mapping logic - customize this!
      const mappedValue = mapVariableToLeadField(v.variable_name, lead);
      initial[v.position.toString()] = mappedValue || v.default_value || '';
    }
    
    setVariableValues(initial);
  }, [template, lead]);

  // Update preview when values change
  useEffect(() => {
    let text = template.components.find(c => c.type === 'BODY')?.text || '';
    
    for (const [pos, value] of Object.entries(variableValues)) {
      text = text.replace(`{{${pos}}}`, value || `[${pos}]`);
    }
    
    setPreview(text);
  }, [variableValues, template]);

  // Your custom mapping function
  function mapVariableToLeadField(variableName: string, lead: Lead): string {
    const mapping: Record<string, keyof Lead> = {
      'customer_name': 'fullName',
      'customer_email': 'email',
      'company_name': 'company',
      // Add your mappings here
    };
    
    const field = mapping[variableName];
    return field ? String(lead[field] || '') : '';
  }

  async function handleSend() {
    // Validate required variables
    for (const v of template.variables) {
      if (v.is_required && !variableValues[v.position.toString()]) {
        alert(`Variable "${v.variable_name}" is required`);
        return;
      }
    }

    await fetch(`${API_BASE}/api/v1/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone_number_id: template.phone_number_id,
        template_id: template.template_id,
        contact: {
          phone: lead.phone,
          name: lead.fullName
        },
        variables: variableValues  // { "1": "Sarah", "2": "ORD-123" }
      })
    });
  }

  return (
    <div className="send-dialog">
      <h3>Send: {template.name}</h3>
      <p>To: {lead.fullName} ({lead.phone})</p>
      
      <div className="variable-inputs">
        {template.variables.map(v => (
          <div key={v.variable_id} className="variable-input">
            <label>
              {v.variable_name} {`{{${v.position}}}`}
              {v.is_required && <span className="required">*</span>}
            </label>
            {v.description && <small>{v.description}</small>}
            
            <input
              value={variableValues[v.position.toString()] || ''}
              onChange={(e) => setVariableValues({
                ...variableValues,
                [v.position.toString()]: e.target.value
              })}
              placeholder={v.placeholder || v.default_value || ''}
            />
          </div>
        ))}
      </div>
      
      <div className="preview">
        <h4>Preview</h4>
        <p>{preview}</p>
      </div>
      
      <button onClick={handleSend}>Send Message</button>
    </div>
  );
}
```

### 3. Variable Mapping Configuration (Reusable)

```typescript
// variableMapping.ts

// Define your standard mappings
export const STANDARD_MAPPINGS: Record<string, string> = {
  // Variable Name → Lead Field
  'customer_name': 'fullName',
  'customer_email': 'email',
  'customer_phone': 'phone',
  'company_name': 'company',
  'lead_status': 'status',
  // Add more as needed
};

// Resolve all variables for a template
export function resolveTemplateVariables(
  variables: TemplateVariable[],
  leadData: Record<string, any>,
  customMappings?: Record<string, string>
): Record<string, string> {
  const mappings = { ...STANDARD_MAPPINGS, ...customMappings };
  const resolved: Record<string, string> = {};

  for (const v of variables) {
    const position = v.position.toString();
    
    // Priority 1: Check if mapping exists
    const mappedField = mappings[v.variable_name];
    if (mappedField && leadData[mappedField]) {
      resolved[position] = String(leadData[mappedField]);
      continue;
    }
    
    // Priority 2: Direct field match
    if (leadData[v.variable_name]) {
      resolved[position] = String(leadData[v.variable_name]);
      continue;
    }
    
    // Priority 3: Default value
    if (v.default_value) {
      resolved[position] = v.default_value;
      continue;
    }
    
    // Priority 4: Sample value (last resort)
    if (v.sample_value) {
      resolved[position] = v.sample_value;
    }
  }

  return resolved;
}

// Usage:
const lead = { fullName: 'Sarah', email: 'sarah@test.com', ... };
const resolved = resolveTemplateVariables(template.variables, lead);
// { "1": "Sarah", "2": "sarah@test.com", ... }
```

---

## Where Metadata is Stored (Summary)

### At Template Creation Time

| What | Where | Column | Example |
|------|-------|--------|---------|
| Variable name | `template_variables` | `variable_name` | "customer_name" |
| Position mapping | `template_variables` | `position` | 1 (for {{1}}) |
| UI description | `template_variables` | `description` | "Lead's full name" |
| Fallback value | `template_variables` | `default_value` | "Customer" |
| Meta review sample | `template_variables` | `sample_value` | "John" |
| Input hint | `template_variables` | `placeholder` | "e.g., John Smith" |
| Validation flag | `template_variables` | `is_required` | true/false |
| Server auto-fill | `template_variables` | `extraction_field` | "name" (optional) |

### At Send Time

| What | Where | Column | Example |
|------|-------|--------|---------|
| Resolved values sent | `template_sends` | `variable_values` | `{"1": "Sarah", "2": "ORD-123"}` |
| Delivery status | `template_sends` | `status` | "DELIVERED" |
| Platform message ID | `template_sends` | `platform_message_id` | "wamid.xxx" |

### Not Stored (Dashboard Responsibility)

| What | Where to Store | Notes |
|------|----------------|-------|
| Your lead data | Your database | Dashboard's responsibility |
| Field-to-variable mappings | Your config/DB | Dashboard decides mapping |
| Custom field sources | Your app state | e.g., dropdown selections |

---

## Quick Reference: API Summary

| Action | Method | Endpoint |
|--------|--------|----------|
| Create template | POST | `/api/v1/templates` |
| Get template + variables | GET | `/api/v1/templates/:templateId` |
| List templates | GET | `/api/v1/templates?user_id=X` |
| Update template | PUT | `/api/v1/templates/:templateId` |
| Delete template | DELETE | `/api/v1/templates/:templateId` |
| Send single message | POST | `/api/v1/send` |
| Send campaign | POST | `/api/v1/campaign` |
| Get button clicks | GET | `/api/v1/templates/:templateId/button-clicks` |
| Get lead button activity | GET | `/api/v1/leads/:phone/button-activity` |

---

## Troubleshooting

### Variable Not Substituted

**Problem:** Message shows `{{1}}` instead of value

**Solution:** Ensure you're passing variables by position:
```typescript
// ✅ Correct
variables: { "1": "John", "2": "Order123" }

// ❌ Wrong (unless server supports name lookup)
variables: { "customer_name": "John" }
```

### Required Variable Missing

**Problem:** Error when sending without required variable

**Solution:** Check `is_required` flag and validate before sending:
```typescript
for (const v of template.variables) {
  if (v.is_required && !resolvedValues[v.position]) {
    throw new Error(`Missing required variable: ${v.variable_name}`);
  }
}
```

### Variables Array Empty

**Problem:** `GET /api/v1/templates/:id` returns empty variables array

**Solution:** Ensure variables were created with the template. Check if template has `{{N}}` placeholders in components.

---

## Related Documentation

- [TEMPLATE_API_REFERENCE.md](TEMPLATE_API_REFERENCE.md) - Full API documentation
- [UPDATE_DYNAMIC_VARIABLE_SCHEMA_API.md](UPDATE_DYNAMIC_VARIABLE_SCHEMA_API.md) - Schema update details
- [database.md](../.github/database.md) - Complete database schema
