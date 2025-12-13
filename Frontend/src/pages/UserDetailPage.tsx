import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usersApi, CreatePhoneNumberData, CreateAgentData } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import { ArrowLeft, Phone, Bot, CreditCard, Plus, X, Trash2 } from 'lucide-react'

export default function UserDetailPage() {
  const { userId } = useParams<{ userId: string }>()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  // Form states
  const [showAddPhoneForm, setShowAddPhoneForm] = useState(false)
  const [showAddAgentForm, setShowAddAgentForm] = useState(false)
  const [showAddCreditsForm, setShowAddCreditsForm] = useState(false)
  
  const [phoneFormData, setPhoneFormData] = useState<CreatePhoneNumberData>({
    platform: 'whatsapp',
    meta_phone_number_id: '',
    access_token: '',
    display_name: '',
    waba_id: '',
  })
  
  const [agentFormData, setAgentFormData] = useState<CreateAgentData>({
    phone_number_id: '',
    prompt_id: '',
    name: '',
  })
  
  const [creditsAmount, setCreditsAmount] = useState<number>(0)

  const { data, isLoading, error } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => usersApi.get(userId!),
    enabled: !!userId,
  })

  // Mutations
  const addPhoneMutation = useMutation({
    mutationFn: (data: CreatePhoneNumberData) => usersApi.addPhoneNumber(userId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user', userId] })
      toast({ title: 'Phone number added successfully' })
      setShowAddPhoneForm(false)
      setPhoneFormData({ platform: 'whatsapp', meta_phone_number_id: '', access_token: '', display_name: '', waba_id: '' })
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Failed to add phone number', description: error?.response?.data?.message })
    },
  })

  const deletePhoneMutation = useMutation({
    mutationFn: (phoneNumberId: string) => usersApi.deletePhoneNumber(userId!, phoneNumberId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user', userId] })
      toast({ title: 'Phone number deleted successfully' })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Failed to delete phone number' })
    },
  })

  const addAgentMutation = useMutation({
    mutationFn: (data: CreateAgentData) => usersApi.createAgent(userId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user', userId] })
      toast({ title: 'Agent created successfully' })
      setShowAddAgentForm(false)
      setAgentFormData({ phone_number_id: '', prompt_id: '', name: '' })
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Failed to create agent', description: error?.response?.data?.message })
    },
  })

  const addCreditsMutation = useMutation({
    mutationFn: (amount: number) => usersApi.addCredits(userId!, amount),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user', userId] })
      toast({ title: 'Credits added successfully' })
      setShowAddCreditsForm(false)
      setCreditsAmount(0)
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Failed to add credits', description: error?.response?.data?.message })
    },
  })

  const handleAddPhone = (e: React.FormEvent) => {
    e.preventDefault()
    if (!phoneFormData.meta_phone_number_id || !phoneFormData.access_token) {
      toast({ variant: 'destructive', title: 'Phone Number ID and Access Token are required' })
      return
    }
    addPhoneMutation.mutate(phoneFormData)
  }

  const handleAddAgent = (e: React.FormEvent) => {
    e.preventDefault()
    if (!agentFormData.phone_number_id || !agentFormData.prompt_id || !agentFormData.name) {
      toast({ variant: 'destructive', title: 'All fields are required' })
      return
    }
    addAgentMutation.mutate(agentFormData)
  }

  const handleAddCredits = (e: React.FormEvent) => {
    e.preventDefault()
    if (creditsAmount <= 0) {
      toast({ variant: 'destructive', title: 'Enter a valid amount' })
      return
    }
    addCreditsMutation.mutate(creditsAmount)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Loading user details...</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-destructive">Failed to load user details</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/users">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Users
          </Button>
        </Link>
      </div>

      <div>
        <h2 className="text-3xl font-bold tracking-tight">{data.email}</h2>
        <p className="text-muted-foreground">User ID: {data.user_id}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Credits</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.remainingCredits.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Remaining balance</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => setShowAddCreditsForm(true)}>
              <Plus className="h-3 w-3 mr-1" /> Add Credits
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Phone Numbers</CardTitle>
            <Phone className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.phoneNumbers.length}</div>
            <p className="text-xs text-muted-foreground">Connected channels</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Agents</CardTitle>
            <Bot className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.agents.length}</div>
            <p className="text-xs text-muted-foreground">AI agents</p>
          </CardContent>
        </Card>
      </div>

      {/* Add Credits Form */}
      {showAddCreditsForm && (
        <Card className="border-primary">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Add Credits</CardTitle>
              <CardDescription>Add credits to user's balance</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowAddCreditsForm(false)}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAddCredits} className="flex gap-4 items-end">
              <div className="flex-1">
                <label className="text-sm font-medium mb-1 block">Amount</label>
                <Input
                  type="number"
                  placeholder="Enter credit amount"
                  value={creditsAmount || ''}
                  onChange={(e) => setCreditsAmount(parseInt(e.target.value) || 0)}
                />
              </div>
              <Button type="submit" disabled={addCreditsMutation.isPending}>
                {addCreditsMutation.isPending ? 'Adding...' : 'Add Credits'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Phone Numbers</CardTitle>
              <CardDescription>Connected WhatsApp/Instagram channels</CardDescription>
            </div>
            <Button size="sm" onClick={() => setShowAddPhoneForm(true)}>
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </CardHeader>
          <CardContent>
            {showAddPhoneForm && (
              <form onSubmit={handleAddPhone} className="mb-4 p-4 border rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Add Phone Number</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowAddPhoneForm(false)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div>
                  <label className="text-sm mb-1 block">Platform *</label>
                  <select
                    className="w-full h-10 px-3 rounded-md border"
                    value={phoneFormData.platform}
                    onChange={(e) => setPhoneFormData({ ...phoneFormData, platform: e.target.value as any })}
                  >
                    <option value="whatsapp">WhatsApp</option>
                    <option value="instagram">Instagram</option>
                    <option value="webchat">Webchat</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm mb-1 block">Meta Phone Number ID *</label>
                  <Input
                    placeholder="e.g., 123456789012345"
                    value={phoneFormData.meta_phone_number_id}
                    onChange={(e) => setPhoneFormData({ ...phoneFormData, meta_phone_number_id: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-sm mb-1 block">Access Token *</label>
                  <Input
                    placeholder="Meta access token"
                    value={phoneFormData.access_token}
                    onChange={(e) => setPhoneFormData({ ...phoneFormData, access_token: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-sm mb-1 block">Display Name</label>
                  <Input
                    placeholder="e.g., Business WhatsApp"
                    value={phoneFormData.display_name}
                    onChange={(e) => setPhoneFormData({ ...phoneFormData, display_name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-sm mb-1 block">WABA ID</label>
                  <Input
                    placeholder="WhatsApp Business Account ID"
                    value={phoneFormData.waba_id}
                    onChange={(e) => setPhoneFormData({ ...phoneFormData, waba_id: e.target.value })}
                  />
                </div>
                <Button type="submit" disabled={addPhoneMutation.isPending} className="w-full">
                  {addPhoneMutation.isPending ? 'Adding...' : 'Add Phone Number'}
                </Button>
              </form>
            )}
            {data.phoneNumbers.length === 0 && !showAddPhoneForm ? (
              <p className="text-muted-foreground">No phone numbers connected</p>
            ) : (
              <div className="space-y-2">
                {data.phoneNumbers.map((phone) => (
                  <div key={phone.id} className="flex items-center justify-between p-3 rounded-lg border">
                    <div>
                      <p className="font-medium">{phone.display_name || phone.meta_phone_number_id}</p>
                      <p className="text-sm text-muted-foreground capitalize">{phone.platform}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-1 rounded-full bg-muted">
                        {phone.tier || 'No tier'}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (confirm('Delete this phone number?')) {
                            deletePhoneMutation.mutate(phone.id)
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Agents</CardTitle>
              <CardDescription>AI agents linked to phone numbers</CardDescription>
            </div>
            <Button size="sm" onClick={() => setShowAddAgentForm(true)} disabled={data.phoneNumbers.length === 0}>
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </CardHeader>
          <CardContent>
            {showAddAgentForm && (
              <form onSubmit={handleAddAgent} className="mb-4 p-4 border rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Create Agent</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowAddAgentForm(false)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div>
                  <label className="text-sm mb-1 block">Name *</label>
                  <Input
                    placeholder="e.g., Sales Assistant"
                    value={agentFormData.name}
                    onChange={(e) => setAgentFormData({ ...agentFormData, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-sm mb-1 block">Phone Number *</label>
                  <select
                    className="w-full h-10 px-3 rounded-md border"
                    value={agentFormData.phone_number_id}
                    onChange={(e) => setAgentFormData({ ...agentFormData, phone_number_id: e.target.value })}
                  >
                    <option value="">Select phone number</option>
                    {data.phoneNumbers.map((phone) => (
                      <option key={phone.id} value={phone.id}>
                        {phone.display_name || phone.meta_phone_number_id} ({phone.platform})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm mb-1 block">OpenAI Prompt ID *</label>
                  <Input
                    placeholder="e.g., pmpt_abc123..."
                    value={agentFormData.prompt_id}
                    onChange={(e) => setAgentFormData({ ...agentFormData, prompt_id: e.target.value })}
                  />
                </div>
                <Button type="submit" disabled={addAgentMutation.isPending} className="w-full">
                  {addAgentMutation.isPending ? 'Creating...' : 'Create Agent'}
                </Button>
              </form>
            )}
            {data.agents.length === 0 && !showAddAgentForm ? (
              <p className="text-muted-foreground">
                {data.phoneNumbers.length === 0 
                  ? 'Add a phone number first to create an agent' 
                  : 'No agents created'}
              </p>
            ) : (
              <div className="space-y-2">
                {data.agents.map((agent) => (
                  <div key={agent.agent_id} className="flex items-center justify-between p-3 rounded-lg border">
                    <div>
                      <p className="font-medium">{agent.name}</p>
                      <p className="text-sm text-muted-foreground font-mono">{agent.agent_id}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>User Information</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Company</dt>
              <dd className="text-sm">{data.company_name || '-'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Created</dt>
              <dd className="text-sm">{new Date(data.created_at).toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Last Updated</dt>
              <dd className="text-sm">{new Date(data.updated_at).toLocaleString()}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  )
}
