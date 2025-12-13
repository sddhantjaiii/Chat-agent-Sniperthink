import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { phoneNumbersApi, usersApi, CreatePhoneNumberData } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import { Search, Edit2, Plus, X, Trash2 } from 'lucide-react'

interface CreatePhoneForm extends CreatePhoneNumberData {
  user_id: string
}

export default function PhoneNumbersPage() {
  const [search, setSearch] = useState('')
  const [page, _setPage] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editData, setEditData] = useState({ waba_id: '', daily_message_limit: '', tier: '' })
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [formData, setFormData] = useState<CreatePhoneForm>({
    user_id: '',
    platform: 'whatsapp',
    meta_phone_number_id: '',
    access_token: '',
    display_name: '',
    waba_id: '',
  })
  const limit = 20
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data, isLoading } = useQuery({
    queryKey: ['phone-numbers', page],
    queryFn: () => phoneNumbersApi.list({ limit, offset: page * limit }),
  })

  const { data: usersData } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => usersApi.list({ limit: 100 }),
  })

  const createMutation = useMutation({
    mutationFn: (data: CreatePhoneForm) => usersApi.addPhoneNumber(data.user_id, {
      platform: data.platform,
      meta_phone_number_id: data.meta_phone_number_id,
      access_token: data.access_token,
      display_name: data.display_name,
      waba_id: data.waba_id,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['phone-numbers'] })
      toast({ title: 'Phone number added successfully' })
      setShowCreateForm(false)
      setFormData({ user_id: '', platform: 'whatsapp', meta_phone_number_id: '', access_token: '', display_name: '', waba_id: '' })
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Failed to add phone number', description: error?.response?.data?.message })
    },
  })

  const updateMutation = useMutation({
    mutationFn: (params: { id: string; data: any }) => phoneNumbersApi.update(params.id, params.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['phone-numbers'] })
      setEditingId(null)
      toast({ title: 'Phone number updated successfully' })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Failed to update phone number' })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (params: { userId: string; phoneNumberId: string }) => 
      usersApi.deletePhoneNumber(params.userId, params.phoneNumberId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['phone-numbers'] })
      toast({ title: 'Phone number deleted successfully' })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Failed to delete phone number' })
    },
  })

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.user_id || !formData.meta_phone_number_id || !formData.access_token) {
      toast({ variant: 'destructive', title: 'User, Phone Number ID, and Access Token are required' })
      return
    }
    createMutation.mutate(formData)
  }

  const filteredData = data?.data.filter(
    (phone) =>
      phone.display_name?.toLowerCase().includes(search.toLowerCase()) ||
      phone.meta_phone_number_id.includes(search)
  ) || []

  const handleEdit = (phone: any) => {
    setEditingId(phone.id)
    setEditData({
      waba_id: phone.waba_id || '',
      daily_message_limit: phone.daily_message_limit?.toString() || '',
      tier: phone.tier || '',
    })
  }

  const handleSave = () => {
    if (!editingId) return
    updateMutation.mutate({
      id: editingId,
      data: {
        waba_id: editData.waba_id || undefined,
        daily_message_limit: editData.daily_message_limit ? parseInt(editData.daily_message_limit) : undefined,
        tier: editData.tier || undefined,
      },
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Phone Numbers</h2>
          <p className="text-muted-foreground">Manage WhatsApp, Instagram, and Webchat channels</p>
        </div>
        <Button onClick={() => setShowCreateForm(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Phone Number
        </Button>
      </div>

      {/* Create Phone Number Form */}
      {showCreateForm && (
        <Card className="border-primary">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Add Phone Number</CardTitle>
              <CardDescription>Connect a WhatsApp, Instagram, or Webchat channel</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowCreateForm(false)}>
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
                    onChange={(e) => setFormData({ ...formData, user_id: e.target.value })}
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
                  <label className="text-sm font-medium mb-1 block">Platform *</label>
                  <select
                    className="w-full h-10 px-3 rounded-md border"
                    value={formData.platform}
                    onChange={(e) => setFormData({ ...formData, platform: e.target.value as any })}
                  >
                    <option value="whatsapp">WhatsApp</option>
                    <option value="instagram">Instagram</option>
                    <option value="webchat">Webchat</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Meta Phone Number ID *</label>
                  <Input
                    placeholder="e.g., 123456789012345"
                    value={formData.meta_phone_number_id}
                    onChange={(e) => setFormData({ ...formData, meta_phone_number_id: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Access Token *</label>
                  <Input
                    placeholder="Meta access token"
                    value={formData.access_token}
                    onChange={(e) => setFormData({ ...formData, access_token: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Display Name</label>
                  <Input
                    placeholder="e.g., Business WhatsApp"
                    value={formData.display_name}
                    onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">WABA ID</label>
                  <Input
                    placeholder="WhatsApp Business Account ID"
                    value={formData.waba_id}
                    onChange={(e) => setFormData({ ...formData, waba_id: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Adding...' : 'Add Phone Number'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowCreateForm(false)}>
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
              placeholder="Search phone numbers..."
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
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left text-sm font-medium">Display Name</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Platform</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">WABA ID</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Daily Limit</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Tier</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">User</th>
                    <th className="px-4 py-3 text-right text-sm font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredData.map((phone) => (
                    <tr key={phone.id} className="border-b">
                      <td className="px-4 py-3 text-sm">
                        {phone.display_name || phone.meta_phone_number_id}
                      </td>
                      <td className="px-4 py-3 text-sm capitalize">{phone.platform}</td>
                      <td className="px-4 py-3 text-sm">
                        {editingId === phone.id ? (
                          <Input
                            value={editData.waba_id}
                            onChange={(e) => setEditData({ ...editData, waba_id: e.target.value })}
                            className="h-8"
                          />
                        ) : (
                          phone.waba_id || '-'
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {editingId === phone.id ? (
                          <Input
                            type="number"
                            value={editData.daily_message_limit}
                            onChange={(e) => setEditData({ ...editData, daily_message_limit: e.target.value })}
                            className="h-8 w-24"
                          />
                        ) : (
                          phone.daily_message_limit?.toLocaleString() || '-'
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {editingId === phone.id ? (
                          <select
                            value={editData.tier}
                            onChange={(e) => setEditData({ ...editData, tier: e.target.value })}
                            className="h-8 rounded border px-2"
                          >
                            <option value="">Select tier</option>
                            <option value="TIER_1K">TIER_1K</option>
                            <option value="TIER_10K">TIER_10K</option>
                            <option value="TIER_100K">TIER_100K</option>
                            <option value="TIER_UNLIMITED">TIER_UNLIMITED</option>
                          </select>
                        ) : (
                          phone.tier || '-'
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">{phone.user_email || phone.user_id}</td>
                      <td className="px-4 py-3 text-right">
                        {editingId === phone.id ? (
                          <div className="flex gap-2 justify-end">
                            <Button size="sm" onClick={handleSave}>Save</Button>
                            <Button variant="outline" size="sm" onClick={() => setEditingId(null)}>Cancel</Button>
                          </div>
                        ) : (
                          <div className="flex gap-1 justify-end">
                            <Button variant="ghost" size="sm" onClick={() => handleEdit(phone)}>
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                if (confirm('Delete this phone number?')) {
                                  deleteMutation.mutate({ userId: phone.user_id, phoneNumberId: phone.id })
                                }
                              }}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        )}
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
