import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { getSession } from '@/lib/session'
import { getBudget } from '@/services/budget-service'
import { BudgetForm } from '@/components/budget-form'

export const instant = false

export default async function EditBudgetPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  // Only managers change budgets; admins are read-only.
  if (session.role !== 'manager') redirect('/budgets')

  const { id } = await params
  const budget = await getBudget(session, id)
  if (!budget) notFound()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Edit budget</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {budget.category} · {budget.month}
        </p>
      </div>

      <BudgetForm
        mode="edit"
        budgetId={budget.id}
        initial={{
          month: budget.month,
          category: budget.category,
          amount: String(budget.amount),
          carryOver: budget.carryOver,
        }}
      />

      <p className="text-sm">
        <Link href="/budgets" className="underline">
          Back to budgets
        </Link>
      </p>
    </div>
  )
}
