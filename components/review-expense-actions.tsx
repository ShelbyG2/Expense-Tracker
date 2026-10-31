'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/toast'

// Approve or reject a pending expense. Rejecting reveals an optional reason,
// which the API stores on the expense so staff can see why it was rejected.
export function ReviewExpenseActions({ expenseId }: { expenseId: string }) {
  const router = useRouter()
  const { toast } = useToast()
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function review(action: 'approve' | 'reject') {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/expenses/${expenseId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          action === 'reject' ? { action, reason } : { action },
        ),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Unable to review the expense')
        return
      }
      setRejecting(false)
      setReason('')
      toast(action === 'approve' ? 'Expense approved' : 'Expense rejected')
      router.refresh()
    } catch {
      setError('Unable to review the expense. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      {rejecting ? (
        <div className="w-56 space-y-2">
          <label
            htmlFor={`reason-${expenseId}`}
            className="block text-xs font-medium"
          >
            Reason <span className="text-neutral-500">(optional)</span>
          </label>
          <textarea
            id={`reason-${expenseId}`}
            rows={2}
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm focus:border-neutral-500 focus:outline-none dark:border-neutral-700"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => review('reject')}
              className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Confirm reject'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setRejecting(false)}
              className="text-xs text-neutral-600 underline dark:text-neutral-300"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => review('approve')}
            className="rounded-md border border-green-600 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50 dark:text-green-400 dark:hover:bg-green-950/40"
          >
            {busy ? 'Saving…' : 'Approve'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setRejecting(true)}
            className="text-xs font-medium text-red-600 underline disabled:opacity-50 dark:text-red-400"
          >
            Reject
          </button>
        </div>
      )}
      {error && (
        <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
      )}
    </div>
  )
}
