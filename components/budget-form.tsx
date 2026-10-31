'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { z } from 'zod'
import { CATEGORIES } from '@/lib/constants'
import { currentMonth } from '@/lib/format'
import { CreateBudgetSchema, UpdateBudgetSchema } from '@/schemas/budget'
import { useToast } from '@/components/toast'

type FieldErrors = Record<string, string[]>

export type BudgetFormInitial = {
  category: string
  amount: string
  month: string
  carryOver: boolean
}

const inputClass =
  'mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none dark:border-neutral-700'

export function BudgetForm({
  mode,
  budgetId,
  initial,
  idPrefix = 'budget',
}: {
  mode: 'create' | 'edit'
  budgetId?: string
  initial?: Partial<BudgetFormInitial>
  // The budgets page renders a filter form with the same field names, so the
  // inputs need unique ids.
  idPrefix?: string
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [month, setMonth] = useState(initial?.month ?? currentMonth())
  const [category, setCategory] = useState(initial?.category ?? 'Transport')
  const [amount, setAmount] = useState(initial?.amount ?? '')
  const [carryOver, setCarryOver] = useState(initial?.carryOver ?? false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    const payload = {
      category,
      amount: amount === '' ? amount : Number(amount),
      month,
      carryOver,
    }

    // Client-side validation mirrors the server's shared schema.
    const schema = mode === 'create' ? CreateBudgetSchema : UpdateBudgetSchema
    const parsed = schema.safeParse(payload)
    if (!parsed.success) {
      setFieldErrors(z.flattenError(parsed.error).fieldErrors as FieldErrors)
      return
    }
    setFieldErrors({})

    setBusy(true)
    try {
      const res = await fetch(
        mode === 'create' ? '/api/budgets' : `/api/budgets/${budgetId}`,
        {
          method: mode === 'create' ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const details = data.details?.fieldErrors as FieldErrors | undefined
        if (details) setFieldErrors(details)
        setFormError(data.error ?? 'Unable to save the budget')
        return
      }

      toast(mode === 'create' ? 'Budget created' : 'Changes saved')
      router.push('/budgets')
      router.refresh()
    } catch {
      setFormError('Unable to save the budget. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="max-w-lg space-y-4">
      {formError && (
        <p
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {formError}
        </p>
      )}

      <div>
        <label
          htmlFor={`${idPrefix}-month`}
          className="block text-sm font-medium"
        >
          Month
        </label>
        <input
          id={`${idPrefix}-month`}
          type="month"
          required
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          aria-invalid={!!fieldErrors.month}
          className={inputClass}
        />
        {fieldErrors.month && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            {fieldErrors.month[0]}
          </p>
        )}
      </div>

      <div>
        <label
          htmlFor={`${idPrefix}-category`}
          className="block text-sm font-medium"
        >
          Category
        </label>
        <select
          id={`${idPrefix}-category`}
          required
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-invalid={!!fieldErrors.category}
          className={inputClass}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {fieldErrors.category && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            {fieldErrors.category[0]}
          </p>
        )}
      </div>

      <div>
        <label
          htmlFor={`${idPrefix}-amount`}
          className="block text-sm font-medium"
        >
          Budget amount
        </label>
        <input
          id={`${idPrefix}-amount`}
          type="number"
          inputMode="decimal"
          min="0.01"
          step="0.01"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-invalid={!!fieldErrors.amount}
          className={inputClass}
        />
        {fieldErrors.amount && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            {fieldErrors.amount[0]}
          </p>
        )}
      </div>

      <div className="flex items-start gap-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
        <input
          id={`${idPrefix}-carryover`}
          type="checkbox"
          checked={carryOver}
          onChange={(e) => setCarryOver(e.target.checked)}
          className="mt-0.5"
        />
        <div>
          <label
            htmlFor={`${idPrefix}-carryover`}
            className="text-sm font-medium"
          >
            Carry over unspent budget
          </label>
          <p className="text-xs text-neutral-500">
            Adds the previous month’s unspent amount for this category to this
            month’s available budget.
          </p>
          {fieldErrors.carryOver && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              {fieldErrors.carryOver[0]}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {busy ? 'Saving…' : mode === 'create' ? 'Set budget' : 'Save changes'}
        </button>
        <Link
          href="/budgets"
          className="text-sm text-neutral-600 underline dark:text-neutral-300"
        >
          Cancel
        </Link>
      </div>
    </form>
  )
}
