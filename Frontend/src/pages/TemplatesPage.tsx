import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { templatesApi, Template, phoneNumbersApi, PhoneNumber } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import { Search, Plus, Trash2, Send, Eye, RefreshCw, X } from 'lucide-react'

const statusColors: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-800',
  PENDING: 'bg-yellow-100 text-yellow-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  PAUSED: 'bg-orange-100 text-orange-800',
  DISABLED: 'bg-gray-100 text-gray-600',
}

export default function TemplatesPage() {
  const [search, setSearch] = useState('')
  const [page, _setPage] = useState(0)
  const [syncDialogOpen, setSyncDialogOpen] = useState(false)
  const [selectedPhoneNumber, setSelectedPhoneNumber] = useState<string>('')
  const limit = 20
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data, isLoading } = useQuery({
    queryKey: ['templates', page],
    queryFn: () => templatesApi.list({ limit, offset: page * limit }),
  })

  const submitMutation = useMutation({
    mutationFn: templatesApi.submit,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      toast({ title: 'Template submitted to Meta for review' })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Failed to submit template' })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: templatesApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      toast({ title: 'Template deleted successfully' })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Failed to delete template' })
    },
  })

  // Fetch phone numbers for sync
  const { data: phoneNumbersData } = useQuery({
    queryKey: ['phoneNumbers'],
    queryFn: () => phoneNumbersApi.list({ limit: 100 }),
  })

  const syncMutation = useMutation({
    mutationFn: (data: { userId: string; phoneNumberId: string }) => templatesApi.sync(data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      setSyncDialogOpen(false)
      setSelectedPhoneNumber('')
      toast({
        title: 'Templates synced from Meta',
        description: `Imported: ${result.summary.totalImported}, Updated: ${result.summary.totalUpdated}${result.summary.totalErrors > 0 ? `, Errors: ${result.summary.totalErrors}` : ''}`,
      })
    },
    onError: (error: Error) => {
      toast({
        variant: 'destructive',
        title: 'Failed to sync templates',
        description: error.message,
      })
    },
  })

  const whatsappPhoneNumbers = phoneNumbersData?.data.filter(
    (pn: PhoneNumber) => pn.platform === 'whatsapp'
  ) || []

  const filteredData = data?.data.filter(
    (template) =>
      template.name.toLowerCase().includes(search.toLowerCase())
  ) || []

  return (
    <div className="space-y-6">
      {/* Sync Modal */}
      {syncDialogOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">Sync Templates from Meta</h3>
                <p className="text-sm text-muted-foreground">
                  Import existing approved templates from your WhatsApp Business Account.
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSyncDialogOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Select Phone Number</label>
                <select
                  value={selectedPhoneNumber}
                  onChange={(e) => setSelectedPhoneNumber(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md bg-background text-foreground"
                >
                  <option value="">Choose a phone number...</option>
                  {whatsappPhoneNumbers.map((pn: PhoneNumber) => (
                    <option key={pn.id} value={pn.id}>
                      {pn.display_name || pn.meta_phone_number_id}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                className="w-full"
                disabled={!selectedPhoneNumber || syncMutation.isPending}
                onClick={() => {
                  const pn = whatsappPhoneNumbers.find((p: PhoneNumber) => p.id === selectedPhoneNumber)
                  if (pn) {
                    syncMutation.mutate({ userId: pn.user_id, phoneNumberId: pn.id })
                  }
                }}
              >
                {syncMutation.isPending ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Sync Templates
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Templates</h2>
          <p className="text-muted-foreground">Manage WhatsApp message templates</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setSyncDialogOpen(true)}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Sync from Meta
          </Button>
          <Link to="/templates/new">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Create Template
            </Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search templates..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-center text-muted-foreground py-8">Loading...</p>
          ) : filteredData.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No templates found</p>
              <Link to="/templates/new">
                <Button className="mt-4">Create your first template</Button>
              </Link>
            </div>
          ) : (
            <div className="rounded-md border">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left text-sm font-medium">Name</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Category</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Status</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Created</th>
                    <th className="px-4 py-3 text-right text-sm font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredData.map((template: Template) => (
                    <tr key={template.template_id} className="border-b">
                      <td className="px-4 py-3">
                        <p className="font-medium">{template.name}</p>
                        <p className="text-xs text-muted-foreground">{template.template_id}</p>
                      </td>
                      <td className="px-4 py-3 text-sm">{template.category}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-1 rounded-full ${statusColors[template.status]}`}>
                          {template.status}
                        </span>
                        {template.rejection_reason && (
                          <p className="text-xs text-destructive mt-1">{template.rejection_reason}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {new Date(template.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link to={`/templates/${template.template_id}`}>
                            <Button variant="ghost" size="sm">
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Link>
                          {template.status === 'DRAFT' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => submitMutation.mutate(template.template_id)}
                            >
                              <Send className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (confirm('Are you sure you want to delete this template?')) {
                                deleteMutation.mutate(template.template_id)
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
          )}
        </CardContent>
      </Card>
    </div>
  )
}
