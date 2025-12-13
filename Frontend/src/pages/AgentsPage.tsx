import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { agentsApi, usersApi, CreateAgentData } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import { Search, Trash2, Plus, X } from 'lucide-react'

interface CreateAgentForm extends CreateAgentData {
  user_id: string
}

export default function AgentsPage() {
  const [search, setSearch] = useState('')
  const [page, _setPage] = useState(0)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [formData, setFormData] = useState<CreateAgentForm>({
    user_id: '',
    phone_number_id: '',
    prompt_id: '',
    name: '',
  })
  const limit = 20
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data, isLoading } = useQuery({
    queryKey: ['agents', page],
    queryFn: () => agentsApi.list({ limit, offset: page * limit }),
  })

  const { data: usersData } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => usersApi.list({ limit: 100 }),
  })

  const { data: selectedUserData } = useQuery({
    queryKey: ['user', selectedUserId],
    queryFn: () => usersApi.get(selectedUserId),
    enabled: !!selectedUserId,
  })

  const createMutation = useMutation({
    mutationFn: (data: CreateAgentForm) => usersApi.createAgent(data.user_id, {
      phone_number_id: data.phone_number_id,
      prompt_id: data.prompt_id,
      name: data.name,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      toast({ title: 'Agent created successfully' })
      setShowCreateForm(false)
      setFormData({ user_id: '', phone_number_id: '', prompt_id: '', name: '' })
      setSelectedUserId('')
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Failed to create agent', description: error?.response?.data?.message })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: agentsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      toast({ title: 'Agent deleted successfully' })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Failed to delete agent' })
    },
  })

  const handleUserChange = (userId: string) => {
    setSelectedUserId(userId)
    setFormData({ ...formData, user_id: userId, phone_number_id: '' })
  }

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.user_id || !formData.phone_number_id || !formData.prompt_id || !formData.name) {
      toast({ variant: 'destructive', title: 'All fields are required' })
      return
    }
    createMutation.mutate(formData)
  }

  const filteredData = data?.data.filter(
    (agent) =>
      agent.name.toLowerCase().includes(search.toLowerCase()) ||
      agent.agent_id.toLowerCase().includes(search.toLowerCase())
  ) || []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Agents</h2>
          <p className="text-muted-foreground">Manage AI agents across all users</p>
        </div>
        <Button onClick={() => setShowCreateForm(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create Agent
        </Button>
      </div>

      {/* Create Agent Form */}
      {showCreateForm && (
        <Card className="border-primary">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Create New Agent</CardTitle>
              <CardDescription>Create an AI agent for a user's phone number</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setShowCreateForm(false); setSelectedUserId(''); }}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">User *</label>
                  <select
                    className="w-full h-10 px-3 rounded-md border"
                    value={formData.user_id}
                    onChange={(e) => handleUserChange(e.target.value)}
                    required
                  >
                    <option value="">Select user</option>
                    {usersData?.data.map((user) => (
                      <option key={user.user_id} value={user.user_id}>
                        {user.email} ({user.user_id})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Phone Number *</label>
                  <select
                    className="w-full h-10 px-3 rounded-md border"
                    value={formData.phone_number_id}
                    onChange={(e) => setFormData({ ...formData, phone_number_id: e.target.value })}
                    disabled={!selectedUserId || !selectedUserData}
                    required
                  >
                    <option value="">
                      {!selectedUserId ? 'Select user first' : selectedUserData?.phoneNumbers.length === 0 ? 'No phone numbers' : 'Select phone number'}
                    </option>
                    {selectedUserData?.phoneNumbers.map((phone) => (
                      <option key={phone.id} value={phone.id}>
                        {phone.display_name || phone.meta_phone_number_id} ({phone.platform})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Agent Name *</label>
                  <Input
                    placeholder="e.g., Sales Assistant"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">OpenAI Prompt ID *</label>
                  <Input
                    placeholder="e.g., pmpt_abc123..."
                    value={formData.prompt_id}
                    onChange={(e) => setFormData({ ...formData, prompt_id: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Creating...' : 'Create Agent'}
                </Button>
                <Button type="button" variant="outline" onClick={() => { setShowCreateForm(false); setSelectedUserId(''); }}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search agents..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-center text-muted-foreground py-8">Loading...</p>
          ) : (
            <div className="rounded-md border">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left text-sm font-medium">Name</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Agent ID</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">User</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Phone Number</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Created</th>
                    <th className="px-4 py-3 text-right text-sm font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredData.map((agent) => (
                    <tr key={agent.agent_id} className="border-b">
                      <td className="px-4 py-3 text-sm font-medium">{agent.name}</td>
                      <td className="px-4 py-3 text-sm font-mono text-xs">{agent.agent_id}</td>
                      <td className="px-4 py-3 text-sm">{agent.user_email || agent.user_id}</td>
                      <td className="px-4 py-3 text-sm">{agent.phone_display_name || agent.phone_number_id}</td>
                      <td className="px-4 py-3 text-sm">{new Date(agent.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (confirm('Are you sure you want to delete this agent?')) {
                              deleteMutation.mutate(agent.agent_id)
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
