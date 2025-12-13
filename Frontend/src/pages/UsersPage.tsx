import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usersApi, CreateUserData } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import { Trash2, Eye, Search, Plus, X } from 'lucide-react'

export default function UsersPage() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [formData, setFormData] = useState<CreateUserData>({ user_id: '', email: '', initial_credits: 0 })
  const limit = 20
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data, isLoading } = useQuery({
    queryKey: ['users', page],
    queryFn: () => usersApi.list({ limit, offset: page * limit }),
  })

  const createMutation = useMutation({
    mutationFn: usersApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast({ title: 'User created successfully' })
      setShowCreateForm(false)
      setFormData({ user_id: '', email: '', initial_credits: 0 })
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Failed to create user', description: error?.response?.data?.message || 'Unknown error' })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: usersApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast({ title: 'User deleted successfully' })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Failed to delete user' })
    },
  })

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.user_id || !formData.email) {
      toast({ variant: 'destructive', title: 'User ID and Email are required' })
      return
    }
    createMutation.mutate(formData)
  }

  const filteredUsers = data?.data.filter(
    (user) =>
      user.email.toLowerCase().includes(search.toLowerCase()) ||
      user.user_id.toLowerCase().includes(search.toLowerCase())
  ) || []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Users</h2>
          <p className="text-muted-foreground">
            Manage all registered users
          </p>
        </div>
        <Button onClick={() => setShowCreateForm(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create User
        </Button>
      </div>

      {/* Create User Form */}
      {showCreateForm && (
        <Card className="border-primary">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Create New User</CardTitle>
              <CardDescription>Add a new user to the system</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowCreateForm(false)}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">User ID *</label>
                  <Input
                    placeholder="e.g., user_123"
                    value={formData.user_id}
                    onChange={(e) => setFormData({ ...formData, user_id: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Email *</label>
                  <Input
                    type="email"
                    placeholder="user@example.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Initial Credits</label>
                  <Input
                    type="number"
                    placeholder="0"
                    value={formData.initial_credits || ''}
                    onChange={(e) => setFormData({ ...formData, initial_credits: parseInt(e.target.value) || 0 })}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Creating...' : 'Create User'}
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
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by email or ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-center text-muted-foreground py-8">Loading...</p>
          ) : filteredUsers.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No users found</p>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md border">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-4 py-3 text-left text-sm font-medium">User ID</th>
                      <th className="px-4 py-3 text-left text-sm font-medium">Email</th>
                      <th className="px-4 py-3 text-left text-sm font-medium">Company</th>
                      <th className="px-4 py-3 text-left text-sm font-medium">Created</th>
                      <th className="px-4 py-3 text-right text-sm font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((user) => (
                      <tr key={user.user_id} className="border-b">
                        <td className="px-4 py-3 text-sm font-mono">{user.user_id}</td>
                        <td className="px-4 py-3 text-sm">{user.email}</td>
                        <td className="px-4 py-3 text-sm">{user.company_name || '-'}</td>
                        <td className="px-4 py-3 text-sm">
                          {new Date(user.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Link to={`/users/${user.user_id}`}>
                              <Button variant="ghost" size="sm">
                                <Eye className="h-4 w-4" />
                              </Button>
                            </Link>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                if (confirm('Are you sure you want to delete this user?')) {
                                  deleteMutation.mutate(user.user_id)
                                }
                              }}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {data && data.pagination.total > limit && (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Showing {page * limit + 1} to {Math.min((page + 1) * limit, data.pagination.total)} of{' '}
                    {data.pagination.total} users
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => p + 1)}
                      disabled={(page + 1) * limit >= data.pagination.total}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
