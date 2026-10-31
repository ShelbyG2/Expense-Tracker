// Shared domain constants. Imported by both server code and client forms,
// so keep this module free of server-only dependencies.

// Fixed category list from the master prompt (rule 3: category must be allowed).
export const CATEGORIES = [
  'Transport',
  'Supplies',
  'Meals',
  'Utilities',
  'Events',
  'Other',
] as const

export type Category = (typeof CATEGORIES)[number]

export const EXPENSE_STATUSES = ['pending', 'approved', 'rejected'] as const

export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number]

// Roles from the master prompt. Lives here (not models/user.ts) so admin
// forms and schemas can use it without pulling mongoose into the browser.
export const USER_ROLES = ['admin', 'manager', 'staff'] as const

export type UserRole = (typeof USER_ROLES)[number]

// Organization currency (Phase 7D): an ISO 4217 code used for display only —
// amounts are never converted. Defaults to KES for organizations created before
// the setting existed or seeded without one.
export const DEFAULT_CURRENCY = 'KES'
export const CURRENCY_PATTERN = /^[A-Z]{3}$/

// Audit trail vocabulary (rule 7). Lives here so admin filters and schemas can
// share it without importing mongoose into the browser.
export const AUDIT_ACTIONS = [
  'create',
  'update',
  'delete',
  'approve',
  'reject',
] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export const AUDIT_ENTITIES = [
  'Budget',
  'Department',
  'Expense',
  'Organization',
  'User',
] as const
export type AuditEntity = (typeof AUDIT_ENTITIES)[number]

// In-app notification vocabulary (Phase 7E). Client-safe so the bell and the
// notifications page can label entries without importing the model.
export const NOTIFICATION_TYPES = [
  'expense_approved',
  'expense_rejected',
  'expense_pending',
  'budget_warning',
  'budget_exceeded',
] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

// Notifications expire automatically once they are this old (TTL index).
export const NOTIFICATION_TTL_DAYS = 90
