import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { contactsApi, usersApi, Contact } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import { Search, Trash2, Plus, X } from 'lucide-react'

interface CreateContactForm {
  userId: string
  phone: string
  name: string
  email: string
  company: string
  tags: string
}

export default function ContactsPage() {
  const [search, setSearch] = useState('')
  const [page, _setPage] = useState(0)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [formData, setFormData] = useState<CreateContactForm>({
    userId: '',
    phone: '',
    name: '',
    email: '',
    company: '',
    tags: '',
  })
  const limit = 20
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data, isLoading } = useQuery({
    queryKey: ['contacts', page],
    queryFn: () => contactsApi.list({ limit, offset: page * limit }),
  })

  const { data: usersData } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => usersApi.list({ limit: 100 }),
  })

  const createMutation = useMutation({
    mutationFn: (data: { userId: string; contacts: Array<{ phone: string; name?: string; email?: string; company?: string }>; defaultTags?: string[] }) => 
      contactsApi.import(data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
      toast({ title: `Contact created successfully`, description: `Imported: ${result.imported}, Skipped: ${result.skipped}` })
      setShowCreateForm(false)
      setFormData({ userId: '', phone: '', name: '', email: '', company: '', tags: '' })
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Failed to create contact', description: error?.response?.data?.message })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: contactsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
      toast({ title: 'Contact deleted successfully' })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Failed to delete contact' })
    },
  })

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.userId || !formData.phone) {
      toast({ variant: 'destructive', title: 'User and Phone are required' })
      return
    }
    createMutation.mutate({
      userId: formData.userId,
      contacts: [{
        phone: formData.phone,
        name: formData.name || undefined,
        email: formData.email || undefined,
        company: formData.company || undefined,
      }],
      defaultTags: formData.tags ? formData.tags.split(',').map(t => t.trim()) : undefined,
    })
  }

  const filteredData = data?.data.filter(
    (contact) =>
      contact.phone.includes(search) ||
      contact.name?.toLowerCase().includes(search.toLowerCase()) ||
      contact.email?.toLowerCase().includes(search.toLowerCase())
  ) || []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Contacts</h2>
          <p className="text-muted-foreground">Manage contacts for campaigns</p>
        </div>
        <Button onClick={() => setShowCreateForm(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Contact
        </Button>
      </div>

      {/* Create Contact Form */}
      {showCreateForm && (
        <Card className="border-primary">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Add New Contact</CardTitle>
              <CardDescription>Add a contact to a user's contact list</CardDescription>
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
                    value={formData.userId}
                    onChange={(e) => setFormData({ ...formData, userId: e.target.value })}
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
                  <Input
                    placeholder="+14155551234 (E.164 format)"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Name</label>
                  <Input
                    placeholder="John Doe"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Email</label>
                  <Input
                    type="email"
                    placeholder="john@example.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Company</label>
                  <Input
                    placeholder="Acme Corp"
                    value={formData.company}
                    onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Tags (comma-separated)</label>
                  <Input
                    placeholder="vip, customer, lead"
                    value={formData.tags}
                    onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Creating...' : 'Add Contact'}
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
              placeholder="Search by phone, name, or email..."
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
                    <th className="px-4 py-3 text-left text-sm font-medium">Phone</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Name</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Email</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Tags</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Source</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Status</th>
                    <th className="px-4 py-3 text-right text-sm font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredData.map((contact: Contact) => (
                    <tr key={contact.contact_id} className="border-b">
                      <td className="px-4 py-3 text-sm font-mono">{contact.phone}</td>
                      <td className="px-4 py-3 text-sm">{contact.name || '-'}</td>
                      <td className="px-4 py-3 text-sm">{contact.email || '-'}</td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex flex-wrap gap-1">
                          {contact.tags?.map((tag) => (
                            <span
                              key={tag}
                              className="text-xs px-2 py-0.5 rounded-full bg-muted"
                            >
                              {tag}
                            </span>
                          ))}
                          {(!contact.tags || contact.tags.length === 0) && '-'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm">{contact.source}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs px-2 py-1 rounded-full ${
                            contact.opted_out
                              ? 'bg-red-100 text-red-800'
                              : 'bg-green-100 text-green-800'
                          }`}
                        >
                          {contact.opted_out ? 'Opted Out' : 'Active'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (confirm('Are you sure you want to delete this contact?')) {
                              deleteMutation.mutate(contact.contact_id)
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
