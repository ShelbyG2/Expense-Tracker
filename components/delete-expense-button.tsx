'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/toast'

export function DeleteExpenseButton({ expenseId }: { expenseId: string }) {
  const router = useRouter()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    if (!window.confirm('Delete this expense? This cannot be undone.')) return

    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/expenses/${expenseId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Unable to delete the expense')
        return
      }
      toast('Expense deleted')
      router.refresh()
    } catch {
      setError('Unable to delete the expense. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        onClick={handleDelete}
        disabled={busy}
        className="text-sm font-medium text-red-600 underline disabled:opacity-50 dark:text-red-400"
      >
        {busy ? 'Deleting…' : 'Delete'}
      </button>
      {error && (
        <span className="mt-1 text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </span>
  )
}
