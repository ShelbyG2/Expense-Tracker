// Read scope for expense queries, derived only from the verified session.
//
// Kept free of runtime dependencies (type-only imports) so the permission rules
// can be unit-tested without a database connection. Every query must also be
// filtered by the session's organizationId — this scope is only the per-role
// part of that filter.

import type { FilterQuery } from 'mongoose'
import type { Session } from '@/lib/auth'
import type { IExpense } from '@/models/expense'

// Review scope for pending approvals (Phase 7B). Nobody may review their own
// spending, so the two queues are disjoint:
//   - a manager reviews STAFF expenses in their own department, never their own
//     (their own manager expenses go to an admin);
//   - an admin reviews MANAGER expenses, organization-wide;
//   - staff never review, and get `null` so callers answer 403 rather than
//     "not found".
export function reviewScope(session: Session): FilterQuery<IExpense> | null {
  if (session.role === 'admin') return { submitterRole: 'manager' }
  if (session.role !== 'manager') return null

  return {
    departmentId: session.departmentId ?? { $in: [] },
    submitterRole: 'staff',
    userId: { $ne: session.userId },
  }
}

// staff -> own records; manager -> their department plus their own records (a
// manager who changes department keeps sight of what they submitted); admin ->
// whole org.
export function expenseScope(session: Session): FilterQuery<IExpense> {
  if (session.role === 'staff') return { userId: session.userId }
  if (session.role === 'manager') {
    const own = { userId: session.userId }
    // A manager without a department has no department scope, so only their
    // own records remain. Falling back to `departmentId: null` would expose
    // every unassigned user's expenses instead of just "their department".
    if (!session.departmentId) return own
    return { $or: [{ departmentId: session.departmentId }, own] }
  }
  return {}
}
