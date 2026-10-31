'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/toast'
import { currentMonth, previousMonth } from '@/lib/format'

// Phase 7C: copy a whole month of budgets into another month. Existing
// categories in the target month are skipped, never overwritten.
export function CopyBudgetsForm() {
  const router = useRouter()
  const { toast } = useToast()
  const [fromMonth, setFromMonth] = useState(previousMonth(currentMonth()))
  const [toMonth, setToMonth] = useState(currentMonth())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await fetch('/api/budgets/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromMonth, toMonth }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Unable to copy the budgets')
        return
      }

      const data = (await res.json()) as { created: number; skipped: number }
      toast(
        `Copied ${data.created} budget${data.created === 1 ? '' : 's'} to ${toMonth}` +
          (data.skipped ? `, skipped ${data.skipped} existing` : ''),
      )
      router.refresh()
    } catch {
      setError('Unable to copy the budgets. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label
            htmlFor="copy-from-month"
            className="block text-xs font-medium"
          >
            Copy from
          </label>
          <input
            id="copy-from-month"
            type="month"
            required
            value={fromMonth}
            onChange={(e) => setFromMonth(e.target.value)}
            className="mt-1 rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none dark:border-neutral-700"
          />
        </div>
        <div>
          <label htmlFor="copy-to-month" className="block text-xs font-medium">
            To
          </label>
          <input
            id="copy-to-month"
            type="month"
            required
            value={toMonth}
            onChange={(e) => setToMonth(e.target.value)}
            className="mt-1 rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none dark:border-neutral-700"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          {busy ? 'Copying…' : 'Copy budgets'}
        </button>
      </div>
      <p className="text-xs text-neutral-500">
        Categories that already have a budget in the target month are skipped.
      </p>
    </form>
  )
}
