'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { z } from 'zod'
import { CATEGORIES } from '@/lib/constants'
import { todayDateOnly } from '@/lib/format'
import { CreateExpenseSchema, UpdateExpenseSchema } from '@/schemas/expense'
import { useToast } from '@/components/toast'

type FieldErrors = Record<string, string[]>

export type ExpenseFormInitial = {
  category: string
  amount: string
  date: string
  description: string
}

const inputClass =
  'mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none dark:border-neutral-700'

export function ExpenseForm({
  mode,
  expenseId,
  initial,
}: {
  mode: 'create' | 'edit'
  expenseId?: string
  initial?: ExpenseFormInitial
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [category, setCategory] = useState(initial?.category ?? 'Transport')
  const [amount, setAmount] = useState(initial?.amount ?? '')
  const [date, setDate] = useState(initial?.date ?? todayDateOnly())
  const [description, setDescription] = useState(initial?.description ?? '')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    const payload = {
      category,
      amount: amount === '' ? amount : Number(amount),
      date,
      description,
    }

    // Client-side validation mirrors the server's shared schema.
    const schema = mode === 'create' ? CreateExpenseSchema : UpdateExpenseSchema
    const parsed = schema.safeParse(payload)
    if (!parsed.success) {
      setFieldErrors(z.flattenError(parsed.error).fieldErrors as FieldErrors)
      return
    }
    setFieldErrors({})

    setBusy(true)
    try {
      // The schema turns `date` into a Date; the API expects `YYYY-MM-DD`, so
      // send the raw input value rather than the normalized one.
      const res = await fetch(
        mode === 'create' ? '/api/expenses' : `/api/expenses/${expenseId}`,
        {
          method: mode === 'create' ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...parsed.data, date }),
        },
      )

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const details = data.details?.fieldErrors as FieldErrors | undefined
        if (details) setFieldErrors(details)
        setFormError(data.error ?? 'Unable to save the expense')
        return
      }

      toast(mode === 'create' ? 'Expense created' : 'Changes saved')
      router.push('/expenses')
      router.refresh()
    } catch {
      setFormError('Unable to save the expense. Please try again.')
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
        <label htmlFor="category" className="block text-sm font-medium">
          Category
        </label>
        <select
          id="category"
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
        <label htmlFor="amount" className="block text-sm font-medium">
          Amount
        </label>
        <input
          id="amount"
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

      <div>
        <label htmlFor="date" className="block text-sm font-medium">
          Date
        </label>
        <input
          id="date"
          type="date"
          required
          max={todayDateOnly()}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-invalid={!!fieldErrors.date}
          className={inputClass}
        />
        {fieldErrors.date && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            {fieldErrors.date[0]}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium">
          Description <span className="text-neutral-500">(optional)</span>
        </label>
        <textarea
          id="description"
          rows={3}
          maxLength={200}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-invalid={!!fieldErrors.description}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-neutral-500">
          {description.length}/200 characters
        </p>
        {fieldErrors.description && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            {fieldErrors.description[0]}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {busy
            ? 'Saving…'
            : mode === 'create'
              ? 'Create expense'
              : 'Save changes'}
        </button>
        <Link
          href="/expenses"
          className="text-sm text-neutral-600 underline dark:text-neutral-300"
        >
          Cancel
        </Link>
      </div>
    </form>
  )
}
