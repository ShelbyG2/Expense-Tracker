import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { getSession } from '@/lib/session'
import { getExpense } from '@/services/expense-service'
import { ExpenseForm } from '@/components/expense-form'

export const instant = false

export default async function EditExpensePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  if (session.role === 'admin') redirect('/expenses')

  const { id } = await params
  const expense = await getExpense(session, id)

  // Out of scope, nonexistent and somebody else's expense all resolve to 404
  // (no ID enumeration). A manager can read their department's expenses, but
  // may only edit their own (Phase 7B).
  if (!expense || expense.userId !== session.userId) notFound()

  if (expense.status !== 'pending') {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Expense cannot be edited
        </h1>
        <p className="text-sm text-neutral-500">
          Only pending expenses can be edited. This one is{' '}
          <span className="font-medium capitalize">{expense.status}</span>.
        </p>
        <p className="text-sm">
          <Link href="/expenses" className="underline">
            Back to expenses
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Edit expense</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Changes are saved as pending.
        </p>
      </div>

      <ExpenseForm
        mode="edit"
        expenseId={expense.id}
        initial={{
          category: expense.category,
          amount: String(expense.amount),
          date: expense.date.slice(0, 10),
          description: expense.description,
        }}
      />

      <p className="text-sm">
        <Link href="/expenses" className="underline">
          Back to expenses
        </Link>
      </p>
    </div>
  )
}
