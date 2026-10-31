'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  WARNING_THRESHOLD_MAX,
  WARNING_THRESHOLD_MIN,
} from '@/lib/budget-status'
import { useToast } from '@/components/toast'

// Phase 7C/7D: the organization's warning line and display currency. The
// threshold is stored as a ratio (0.8 = 80%) but edited as a ratio too, so the
// value the admin sees matches the API. Currency is an ISO 4217 code.
export function SettingsForm({
  initialThreshold,
  initialCurrency,
}: {
  initialThreshold: number
  initialCurrency: string
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [threshold, setThreshold] = useState(String(initialThreshold))
  const [currency, setCurrency] = useState(initialCurrency)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const minPercent = Math.round(WARNING_THRESHOLD_MIN * 100)
  const maxPercent = Math.round(WARNING_THRESHOLD_MAX * 100)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const value = Number(threshold)
    if (!Number.isFinite(value)) {
      setError('Enter a percentage between 50 and 95')
      return
    }

    setBusy(true)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warningThreshold: value,
          currency: currency.trim().toUpperCase(),
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Unable to save the settings')
        return
      }

      toast('Settings saved')
      router.refresh()
    } catch {
      setError('Unable to save the settings. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-lg space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <div>
        <label
          htmlFor="warning-threshold"
          className="block text-sm font-medium"
        >
          Warning threshold
        </label>
        <p className="mt-1 text-xs text-neutral-500">
          A budget becomes a warning at this share of its available amount
          (between {minPercent}% and {maxPercent}%). Above 100% is always
          exceeded.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <input
            id="warning-threshold"
            type="number"
            inputMode="decimal"
            min={WARNING_THRESHOLD_MIN}
            max={WARNING_THRESHOLD_MAX}
            step="0.01"
            required
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className="w-28 rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none dark:border-neutral-700"
          />
          <span className="text-sm text-neutral-500">
            = {Math.round(Number(threshold) * 100)}%
          </span>
        </div>
      </div>

      <div>
        <label htmlFor="currency" className="block text-sm font-medium">
          Currency
        </label>
        <p className="mt-1 text-xs text-neutral-500">
          A three-letter ISO code (for example KES, USD, EUR). It changes how
          amounts are displayed and labelled in exports; existing amounts are
          never converted.
        </p>
        <input
          id="currency"
          type="text"
          required
          maxLength={3}
          autoComplete="off"
          value={currency}
          onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          className="mt-2 w-28 rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm uppercase focus:border-neutral-500 focus:outline-none dark:border-neutral-700"
        />
      </div>

      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        {busy ? 'Saving…' : 'Save settings'}
      </button>
    </form>
  )
}
