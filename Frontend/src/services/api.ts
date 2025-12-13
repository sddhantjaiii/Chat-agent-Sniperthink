import axios, { AxiosError, AxiosInstance } from 'axios'
import { useAuthStore } from '@/stores/authStore'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

// Create axios instance
const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().token
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// Response interceptor to handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout()
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// Types
export interface PaginatedResponse<T> {
  success: boolean
  data: T[]
  pagination: {
    total: number
    limit: number
    offset: number
  }
  timestamp: string
  correlationId: string
}

export interface SingleResponse<T> {
  success: boolean
  data: T
  timestamp: string
  correlationId: string
}

export interface ErrorResponse {
  error: string
  message: string
  timestamp: string
  correlationId: string
}

// =====================================
// Auth API
// =====================================

export const authApi = {
  login: async (password: string) => {
    const response = await api.post<{
      success: boolean
      token: string
      expiresIn: number
    }>('/admin/login', { password })
    return response.data
  },

  refresh: async () => {
    const response = await api.post<{
      success: boolean
      token: string
      expiresIn: number
    }>('/admin/refresh')
    return response.data
  },
}

// =====================================
// Dashboard API
// =====================================

export interface DashboardStats {
  totalUsers: number
  totalPhoneNumbers: number
  totalAgents: number
  totalConversations: number
  totalMessages: number
  totalTemplates: number
  totalContacts: number
  totalCampaigns: number
  activeConversations: number
  approvedTemplates: number
  runningCampaigns: number
}

export const dashboardApi = {
  getStats: async () => {
    const response = await api.get<SingleResponse<DashboardStats>>('/admin/dashboard')
    return response.data.data
  },

  getRateLimits: async () => {
    const response = await api.get<SingleResponse<RateLimitStats[]>>('/admin/rate-limits')
    return response.data.data
  },
}

// =====================================
// Users API
// =====================================

export interface User {
  user_id: string
  email: string
  company_name: string | null
  created_at: string
  updated_at: string
}

export interface UserWithDetails extends User {
  phoneNumbers: PhoneNumber[]
  agents: Agent[]
  remainingCredits: number
}

export interface CreateUserData {
  user_id: string
  email: string
  initial_credits?: number
}

export interface UpdateUserData {
  email?: string
}

export const usersApi = {
  list: async (params?: { limit?: number; offset?: number }) => {
    const response = await api.get<PaginatedResponse<User>>('/admin/users', { params })
    return response.data
  },

  get: async (userId: string) => {
    const response = await api.get<SingleResponse<UserWithDetails>>(`/admin/users/${userId}`)
    return response.data.data
  },

  create: async (data: CreateUserData) => {
    const response = await api.post<SingleResponse<{ user: User; initial_credits: number }>>('/admin/users', data)
    return response.data.data
  },

  update: async (userId: string, data: UpdateUserData) => {
    const response = await api.patch<SingleResponse<User>>(`/admin/users/${userId}`, data)
    return response.data.data
  },

  delete: async (userId: string) => {
    await api.delete(`/admin/users/${userId}`)
  },

  addCredits: async (userId: string, amount: number) => {
    const response = await api.post<SingleResponse<{ remaining_credits: number; added: number }>>(`/admin/users/${userId}/credits`, { amount })
    return response.data.data
  },

  addPhoneNumber: async (userId: string, data: CreatePhoneNumberData) => {
    const response = await api.post<SingleResponse<PhoneNumber>>(`/admin/users/${userId}/phone-numbers`, data)
    return response.data.data
  },

  deletePhoneNumber: async (userId: string, phoneNumberId: string) => {
    await api.delete(`/admin/users/${userId}/phone-numbers/${phoneNumberId}`)
  },

  createAgent: async (userId: string, data: CreateAgentData) => {
    const response = await api.post<SingleResponse<Agent>>(`/admin/users/${userId}/agents`, data)
    return response.data.data
  },
}

// =====================================
// Phone Numbers API
// =====================================

export interface PhoneNumber {
  id: string
  user_id: string
  platform: 'whatsapp' | 'instagram' | 'webchat'
  meta_phone_number_id: string
  access_token: string
  display_name: string | null
  waba_id: string | null
  daily_message_limit: number | null
  daily_messages_sent: number | null
  tier: string | null
  limit_reset_at: string | null
  created_at: string
  updated_at: string
  user_email?: string
}

export interface CreatePhoneNumberData {
  platform: 'whatsapp' | 'instagram' | 'webchat'
  meta_phone_number_id: string
  access_token: string
  display_name?: string
  waba_id?: string
}

export interface RateLimitStats {
  phoneNumberId: string
  tier: string
  dailyLimit: number
  dailySent: number
  remaining: number
  resetAt: string
}

export const phoneNumbersApi = {
  list: async (params?: { limit?: number; offset?: number }) => {
    const response = await api.get<PaginatedResponse<PhoneNumber>>('/admin/phone-numbers', { params })
    return response.data
  },

  update: async (
    phoneNumberId: string,
    data: { waba_id?: string; daily_message_limit?: number; tier?: string }
  ) => {
    const response = await api.patch<SingleResponse<PhoneNumber>>(
      `/admin/phone-numbers/${phoneNumberId}`,
      data
    )
    return response.data.data
  },
}

// =====================================
// Agents API
// =====================================

export interface Agent {
  agent_id: string
  user_id: string
  phone_number_id: string
  prompt_id: string
  name: string
  created_at: string
  updated_at: string
  user_email?: string
  phone_display_name?: string
}

export interface CreateAgentData {
  phone_number_id: string
  prompt_id: string
  name: string
}

export const agentsApi = {
  list: async (params?: { limit?: number; offset?: number }) => {
    const response = await api.get<PaginatedResponse<Agent>>('/admin/agents', { params })
    return response.data
  },

  get: async (agentId: string) => {
    const response = await api.get<SingleResponse<Agent>>(`/admin/agents/${agentId}`)
    return response.data.data
  },

  delete: async (agentId: string) => {
    await api.delete(`/admin/agents/${agentId}`)
  },
}

// =====================================
// Conversations API
// =====================================

export interface Conversation {
  conversation_id: string
  agent_id: string
  customer_phone: string
  openai_conversation_id: string | null
  created_at: string
  last_message_at: string
  last_extraction_at: string | null
  is_active: boolean
  agent_name?: string
  user_id?: string
}

export interface Message {
  message_id: string
  conversation_id: string
  sender: 'user' | 'agent'
  text: string
  timestamp: string
  status: 'sent' | 'failed' | 'pending'
  sequence_no: number
  platform_message_id: string | null
}

export const conversationsApi = {
  list: async (params?: {
    limit?: number
    offset?: number
    userId?: string
    isActive?: boolean
  }) => {
    const response = await api.get<PaginatedResponse<Conversation>>('/admin/conversations', {
      params,
    })
    return response.data
  },

  getMessages: async (conversationId: string, params?: { limit?: number; offset?: number }) => {
    const response = await api.get<PaginatedResponse<Message>>(
      `/admin/conversations/${conversationId}/messages`,
      { params }
    )
    return response.data
  },
}

// =====================================
// Templates API
// =====================================

export interface TemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS'
  format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT'
  text?: string
  buttons?: Array<{
    type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'
    text: string
    url?: string
    phone_number?: string
  }>
}

export interface Template {
  template_id: string
  user_id: string
  phone_number_id: string
  name: string
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
  language: string
  status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAUSED' | 'DISABLED'
  components: TemplateComponent[]
  meta_template_id: string | null
  rejection_reason: string | null
  created_at: string
  updated_at: string
}

export interface TemplateVariable {
  variable_id: string
  template_id: string
  variable_name: string
  position: number
  component_type: 'HEADER' | 'BODY'
  extraction_field: string | null
  default_value: string | null
  sample_value: string
}

export interface TemplateAnalytics {
  totalSent: number
  delivered: number
  read: number
  failed: number
  deliveryRate: number
  readRate: number
}

export const templatesApi = {
  list: async (params?: { limit?: number; offset?: number; status?: string }) => {
    const response = await api.get<PaginatedResponse<Template>>('/admin/templates', { params })
    return response.data
  },

  get: async (templateId: string) => {
    const response = await api.get<
      SingleResponse<{
        template: Template
        variables: TemplateVariable[]
        analytics: TemplateAnalytics
      }>
    >(`/admin/templates/${templateId}`)
    return response.data.data
  },

  create: async (data: {
    user_id: string
    phone_number_id: string
    name: string
    category: string
    components: TemplateComponent[]
    variables?: Omit<TemplateVariable, 'variable_id' | 'template_id'>[]
  }) => {
    const response = await api.post<SingleResponse<Template>>('/admin/templates', data)
    return response.data.data
  },

  submit: async (templateId: string) => {
    const response = await api.post<SingleResponse<Template>>(
      `/admin/templates/${templateId}/submit`
    )
    return response.data.data
  },

  sync: async (data: { userId: string; phoneNumberId: string }) => {
    const response = await api.post<SingleResponse<{
      imported: Template[]
      updated: Template[]
      errors: string[]
      summary: { totalImported: number; totalUpdated: number; totalErrors: number }
    }>>('/admin/templates/sync', { user_id: data.userId, phone_number_id: data.phoneNumberId })
    return response.data.data
  },

  delete: async (templateId: string) => {
    await api.delete(`/admin/templates/${templateId}`)
  },
}

// =====================================
// Contacts API
// =====================================

export interface Contact {
  contact_id: string
  user_id: string
  phone: string
  name: string | null
  email: string | null
  company: string | null
  tags: string[]
  source: 'EXTRACTION' | 'IMPORT' | 'MANUAL'
  extraction_id: string | null
  opted_out: boolean
  created_at: string
  updated_at: string
}

export const contactsApi = {
  list: async (params?: { limit?: number; offset?: number; userId?: string }) => {
    const response = await api.get<PaginatedResponse<Contact>>('/admin/contacts', { params })
    return response.data
  },

  import: async (data: {
    userId: string
    contacts: Array<{
      phone: string
      name?: string
      email?: string
      company?: string
    }>
    defaultTags?: string[]
  }) => {
    const response = await api.post<
      SingleResponse<{
        imported: number
        skipped: number
        errors: Array<{ phone: string; reason: string }>
      }>
    >('/admin/contacts/import', data)
    return response.data.data
  },

  delete: async (contactId: string) => {
    await api.delete(`/admin/contacts/${contactId}`)
  },
}

// =====================================
// Campaigns API
// =====================================

export interface CampaignRecipientFilter {
  tags?: string[]
  excludeTags?: string[]
  sources?: string[]
  optedOutOnly?: boolean
}

export interface Campaign {
  campaign_id: string
  user_id: string
  template_id: string
  phone_number_id: string
  name: string
  description: string | null
  recipient_filter: CampaignRecipientFilter | null
  status: 'DRAFT' | 'SCHEDULED' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CANCELLED' | 'FAILED'
  total_recipients: number
  sent_count: number
  delivered_count: number
  failed_count: number
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface CampaignTrigger {
  trigger_id: string
  campaign_id: string
  trigger_type: 'IMMEDIATE' | 'SCHEDULED' | 'EVENT'
  scheduled_at: string | null
  event_type: string | null
  event_config: Record<string, unknown> | null
  is_active: boolean
  last_executed_at: string | null
  created_at: string
}

export interface RecipientStats {
  total: number
  pending: number
  sent: number
  delivered: number
  read: number
  failed: number
  skipped: number
}

export const campaignsApi = {
  list: async (params?: { limit?: number; offset?: number; status?: string; userId?: string }) => {
    const response = await api.get<PaginatedResponse<Campaign>>('/admin/campaigns', { params })
    return response.data
  },

  get: async (campaignId: string) => {
    const response = await api.get<
      SingleResponse<{
        campaign: Campaign
        triggers: CampaignTrigger[]
        recipientStats: RecipientStats
      }>
    >(`/admin/campaigns/${campaignId}`)
    return response.data.data
  },

  create: async (data: {
    user_id: string
    template_id: string
    phone_number_id: string
    name: string
    description?: string
    recipient_filter?: CampaignRecipientFilter
    triggers?: Array<{
      trigger_type: 'IMMEDIATE' | 'SCHEDULED' | 'EVENT'
      scheduled_at?: string
      event_type?: string
      event_config?: Record<string, unknown>
    }>
  }) => {
    const response = await api.post<SingleResponse<Campaign>>('/admin/campaigns', data)
    return response.data.data
  },

  start: async (campaignId: string) => {
    const response = await api.post<SingleResponse<Campaign>>(
      `/admin/campaigns/${campaignId}/start`
    )
    return response.data.data
  },

  pause: async (campaignId: string) => {
    const response = await api.post<SingleResponse<Campaign>>(
      `/admin/campaigns/${campaignId}/pause`
    )
    return response.data.data
  },

  resume: async (campaignId: string) => {
    const response = await api.post<SingleResponse<Campaign>>(
      `/admin/campaigns/${campaignId}/resume`
    )
    return response.data.data
  },

  cancel: async (campaignId: string) => {
    const response = await api.post<SingleResponse<Campaign>>(
      `/admin/campaigns/${campaignId}/cancel`
    )
    return response.data.data
  },

  delete: async (campaignId: string) => {
    await api.delete(`/admin/campaigns/${campaignId}`)
  },
}

export default api
