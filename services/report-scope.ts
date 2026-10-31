// Read scope for report queries, derived only from the verified session.
//
// Reports aggregate department-level figures (budget status is department
// data, per the roles section of the master prompt), so staff and managers
// both see their own department and admins see the whole organization.
// Kept free of runtime dependencies (type-only imports) so the rule can be
// unit-tested without a database connection. Every query must also be
// filtered by the session's organizationId — this is only the per-role part.

import type { Session } from '@/lib/auth'

// `{}` means no department filter (whole organization). A user without a
// department gets a filter that matches nothing rather than `departmentId:
// null`, which would expose every unassigned user's records.
export type ReportScope = { departmentId?: string | { $in: [] } }

export function reportScope(session: Session): ReportScope {
  if (session.role === 'admin') return {}
  return { departmentId: session.departmentId ?? { $in: [] } }
}
