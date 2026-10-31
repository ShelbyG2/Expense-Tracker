// Dev-only seed: creates an organization plus one admin, one manager and one
// staff user so all three roles can be demoed. The manager and staff user share
// a demo department so budgets and approvals work in Phase 3. This is NOT the
// full business seed — that arrives in Phase 6 (`npm run seed`).
//
// Usage:  node scripts/seed-dev-users.ts
// (Node >= 22.6 runs TypeScript directly via --experimental-strip-types;
// Node 23+ enables it by default. Uses only relative imports so no path
// aliases are needed at run time.)

import { loadEnvFile } from 'node:process'

// Load .env before anything reads process.env.
// (Node >= 20.12 provides process.loadEnvFile / the loadEnvFile export.)
loadEnvFile('.env')

process.env.NODE_ENV = process.env.NODE_ENV ?? 'development'

const { connectDB } = await import('../lib/db.ts')
const { hashPassword } = await import('../lib/password.ts')
const { Organization } = await import('../models/organization.ts')
const { Department } = await import('../models/department.ts')
const { User } = await import('../models/user.ts')

const ORG_NAME = 'Demo Organization'
const DEPT_NAME = 'Operations'

const users = [
  { name: 'Alice Admin', email: 'admin@example.com', role: 'admin' as const },
  {
    name: 'Mia Manager',
    email: 'manager@example.com',
    role: 'manager' as const,
  },
  { name: 'Sam Staff', email: 'staff@example.com', role: 'staff' as const },
]

// Admins manage the whole organization, so they are not tied to a department.

const PASSWORD = 'Password123!'

async function main() {
  await connectDB()
  console.log('Connected to MongoDB.')

  // Reuse or create the demo organization.
  let org = await Organization.findOne({ name: ORG_NAME }).lean()
  if (!org) {
    org = await Organization.create({ name: ORG_NAME })
    console.log(`Created organization "${ORG_NAME}".`)
  } else {
    console.log(`Using existing organization "${ORG_NAME}".`)
  }

  let dept = await Department.findOne({
    organizationId: org._id,
    name: DEPT_NAME,
  }).lean()
  if (!dept) {
    dept = await Department.create({ organizationId: org._id, name: DEPT_NAME })
    console.log(`Created department "${DEPT_NAME}".`)
  }

  // Managers/staff belong to the demo department. Re-running the seed also
  // repairs users created before departments existed.
  const departmentFor = (role: string) => (role === 'admin' ? null : dept._id)

  for (const u of users) {
    const departmentId = departmentFor(u.role)
    const existing = await User.findOne({ email: u.email }).lean()
    if (existing) {
      if (departmentId && !existing.departmentId) {
        await User.updateOne({ _id: existing._id }, { departmentId })
        console.log(
          `- ${u.role.padEnd(7)} ${u.email} assigned to ${DEPT_NAME}.`,
        )
      } else {
        console.log(
          `- ${u.role.padEnd(7)} ${u.email} already exists, skipping.`,
        )
      }
      continue
    }
    const passwordHash = await hashPassword(PASSWORD)
    await User.create({
      organizationId: org._id,
      departmentId,
      name: u.name,
      email: u.email,
      passwordHash,
      role: u.role,
      isActive: true,
    })
    console.log(`- ${u.role.padEnd(7)} ${u.email} created.`)
  }

  console.log('\nDemo accounts (password: ' + PASSWORD + '):')
  for (const u of users) console.log(`  ${u.role.padEnd(7)} ${u.email}`)
  console.log(`\nManager and staff belong to department "${DEPT_NAME}".`)

  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
