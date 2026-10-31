// Small read-only lookups so pages can show names instead of raw ids.
// Every query is filtered by the session's organizationId (rule 1).

import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import type { Session } from '@/lib/auth'
import { User } from '@/models/user'
import { Department } from '@/models/department'

function validIds(ids: string[]): string[] {
  return ids.filter((id) => mongoose.isValidObjectId(id))
}

export async function userNames(
  session: Session,
  ids: string[],
): Promise<Record<string, string>> {
  const valid = validIds(ids)
  if (valid.length === 0) return {}

  await connectDB()
  const docs = await User.find({
    organizationId: session.organizationId,
    _id: { $in: valid },
  })
    .select('name')
    .lean<{ _id: unknown; name: string }[]>()

  return Object.fromEntries(docs.map((doc) => [String(doc._id), doc.name]))
}

export async function departmentNames(
  session: Session,
  ids: string[],
): Promise<Record<string, string>> {
  const valid = validIds(ids)
  if (valid.length === 0) return {}

  await connectDB()
  const docs = await Department.find({
    organizationId: session.organizationId,
    _id: { $in: valid },
  })
    .select('name')
    .lean<{ _id: unknown; name: string }[]>()

  return Object.fromEntries(docs.map((doc) => [String(doc._id), doc.name]))
}
