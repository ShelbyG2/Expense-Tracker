// Organization settings (Phase 7C/7D): the warning threshold that turns a
// budget into a warning and the display currency. Every lookup is scoped to the
// session's organization (rule 1) and only an admin may change it.

import { connectDB } from '@/lib/db'
import { httpError } from '@/lib/api-error'
import type { Session } from '@/lib/auth'
import { recordAudit } from '@/services/audit-service'
import { Organization, type IOrganization } from '@/models/organization'
import { BUDGET_THRESHOLDS } from '@/lib/budget-status'
import { DEFAULT_CURRENCY } from '@/lib/constants'
import type { UpdateSettingsInput } from '@/schemas/settings'

export type OrganizationSettings = {
  name: string
  warningThreshold: number
  currency: string
}

// Organizations created before Phase 7C have no warningThreshold; fall back to
// the shared default rather than erroring on read.
export function warningThresholdOf(org: {
  warningThreshold?: number | null
}): number {
  return org.warningThreshold ?? BUDGET_THRESHOLDS.warning
}

// Organizations created before Phase 7D have no currency. Amounts were shown
// without a symbol then, so KES is the documented default.
export function currencyOf(org: { currency?: string | null }): string {
  return org.currency || DEFAULT_CURRENCY
}

function toSettings(org: IOrganization): OrganizationSettings {
  return {
    name: org.name,
    warningThreshold: warningThresholdOf(org),
    currency: currencyOf(org),
  }
}

export async function getOrganizationSettings(
  session: Session,
): Promise<OrganizationSettings> {
  await connectDB()

  const org = await Organization.findOne({ _id: session.organizationId })
    .select('name warningThreshold currency')
    .lean<IOrganization | null>()

  if (!org) throw httpError(404, 'Organization not found')

  return toSettings(org)
}

export async function updateOrganizationSettings(
  session: Session,
  input: UpdateSettingsInput,
): Promise<OrganizationSettings> {
  // Defense in depth: the route already requires the admin role.
  if (session.role !== 'admin') throw httpError(403, 'Forbidden')

  await connectDB()

  // Only the supplied fields are written, so a PATCH can update the threshold
  // without touching the currency (and vice versa).
  const update: Partial<Pick<IOrganization, 'warningThreshold' | 'currency'>> =
    {}
  if (input.warningThreshold !== undefined) {
    update.warningThreshold = input.warningThreshold
  }
  if (input.currency !== undefined) update.currency = input.currency

  const org = await Organization.findOneAndUpdate(
    { _id: session.organizationId },
    { $set: update },
    { new: true, runValidators: true },
  ).lean<IOrganization | null>()

  if (!org) throw httpError(404, 'Organization not found')

  await recordAudit({
    organizationId: session.organizationId,
    userId: session.userId,
    action: 'update',
    entity: 'Organization',
    entityId: String(org._id),
  })

  return toSettings(org)
}
