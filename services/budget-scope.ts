// Read scope for budget queries, derived only from the verified session.
//
// Kept free of runtime dependencies (type-only imports) so the permission rules
// can be unit-tested without a database connection. Every query must also be
// filtered by the session's organizationId — this is only the per-role part.

import type { FilterQuery } from 'mongoose'
import type { Session } from '@/lib/auth'
import type { IBudget } from '@/models/budget'

// manager -> their department, admin -> whole org, staff -> no access.
// `null` means "not allowed at all" so callers can answer 403 instead of 200
// with an empty list.
export function budgetScope(session: Session): FilterQuery<IBudget> | null {
  if (session.role === 'manager') {
    // Same reasoning as expenses: a manager without a department has no
    // department scope, so match nothing rather than null-department rows.
    return { departmentId: session.departmentId ?? { $in: [] } }
  }
  if (session.role === 'admin') return {}
  return null
}
