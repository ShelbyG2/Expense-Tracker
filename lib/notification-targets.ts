// Notification audience rules (Phase 7E). Pure functions with no database
// imports, so the routing matrix can be unit-tested without a connection.
//
// The audience mirrors the Phase 7B review scopes: a staff expense is reviewed
// by that department's managers, and a manager expense is reviewed by the
// organization's admins.

export type NotificationAudience = {
  organizationId: string
  // `null` means "the organization's admins" — used for manager expenses,
  // whose reviewers are admins rather than department managers.
  departmentId: string | null
}

// Who is told that an expense is awaiting review.
export function audienceForNewExpense(input: {
  role: 'admin' | 'manager' | 'staff'
  departmentId: string | null
  organizationId: string
}): NotificationAudience | null {
  if (input.role === 'staff') {
    // Without a department no manager can see the expense (reviewScope), so
    // there is no appropriate audience.
    if (!input.departmentId) return null
    return {
      organizationId: input.organizationId,
      departmentId: input.departmentId,
    }
  }

  // Manager expenses go to admins; admins cannot submit expenses, but if one
  // ever did there is still no department manager queue for it.
  return { organizationId: input.organizationId, departmentId: null }
}

// Budget threshold notifications go to the managers of the budget's own
// department.
export function audienceForBudgetThreshold(input: {
  budgetDepartmentId: string
  organizationId: string
}): NotificationAudience {
  return {
    organizationId: input.organizationId,
    departmentId: input.budgetDepartmentId,
  }
}

export type BudgetThreshold = 'warning' | 'exceeded'

// Stable identity for one budget + threshold, so an approval storm cannot
// create more than one notification per manager and status change.
export function dedupeKeyForBudgetNotification(
  budgetId: string | { toString(): string },
  threshold: BudgetThreshold,
): string {
  return `budget:${String(budgetId)}:${threshold}`
}
