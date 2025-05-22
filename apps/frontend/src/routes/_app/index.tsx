import { createFileRoute } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { Button } from '~/lib/components/ui/button'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

const syncFiles = async () => {
  const response = await fetch('/api/sync-files', {
    method: 'POST',
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to sync files')
  }
  return response.json()
}

const Home = () => {
  const syncMutation = useMutation({
    mutationFn: syncFiles,
    onSuccess: () => {
      toast.success('Files synced successfully')
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  return (
    <div className="flex-1 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Home</h2>
        <Button
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
        >
          {syncMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Syncing...
            </>
          ) : (
            'Sync Files'
          )}
        </Button>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_app/')({
  component: Home,
})
