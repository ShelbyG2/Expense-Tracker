// Full demo seed (Phase 6) — `npm run seed`.
//
// Creates the data the master prompt asks for:
//   - 1 organization, 3 departments (Operations, Finance, Outreach)
//   - 8 users: 1 admin, 2 managers, 5 staff (all password `Password123!`)
//   - 3 months of expenses (current + previous two), past months fully
//     approved so the 6-month trend chart has real points
//   - budgets per department/category for each of those months, sized so the
//     current month shows at least one ok, one warning and one exceeded
//     category — i.e. the manager dashboard displays alerts out of the box
//
// Idempotent: re-running rebuilds the demo org's budgets and expenses from
// scratch (manual edits to those are discarded) and repairs the demo users.
// Users, departments and the org itself are matched by name/email and kept.
//
// Usage: npm run seed   (or: npx tsx scripts/seed.mts)
// `.mts` + tsx because the models import the `@/` alias, which Node's native
// loader cannot resolve (see knowledge.md gotchas).

import { loadEnvFile } from 'node:process'

loadEnvFile('.env')
process.env.NODE_ENV = process.env.NODE_ENV ?? 'development'

const { connectDB } = await import('../lib/db.ts')
const { hashPassword } = await import('../lib/password.ts')
const { Organization } = await import('../models/organization.ts')
const { Department } = await import('../models/department.ts')
const { User } = await import('../models/user.ts')
const { Budget } = await import('../models/budget.ts')
const { Expense } = await import('../models/expense.ts')

const ORG_NAME = 'Demo Organization'
const PASSWORD = 'Password123!'
const DEPARTMENTS = ['Operations', 'Finance', 'Outreach'] as const

type Role = 'admin' | 'manager' | 'staff'

const demoUsers: {
  name: string
  email: string
  role: Role
  department: (typeof DEPARTMENTS)[number] | null
}[] = [
  {
    name: 'Alice Admin',
    email: 'admin@example.com',
    role: 'admin',
    department: null,
  },
  {
    name: 'Mia Manager',
    email: 'manager@example.com',
    role: 'manager',
    department: 'Operations',
  },
  {
    name: 'Marcus Manager',
    email: 'manager2@example.com',
    role: 'manager',
    department: 'Finance',
  },
  {
    name: 'Sam Staff',
    email: 'staff@example.com',
    role: 'staff',
    department: 'Operations',
  },
  {
    name: 'Tara Staff',
    email: 'staff2@example.com',
    role: 'staff',
    department: 'Operations',
  },
  {
    name: 'Nina Staff',
    email: 'staff3@example.com',
    role: 'staff',
    department: 'Finance',
  },
  {
    name: 'Noel Staff',
    email: 'staff4@example.com',
    role: 'staff',
    department: 'Finance',
  },
  {
    name: 'Priya Staff',
    email: 'staff5@example.com',
    role: 'staff',
    department: 'Outreach',
  },
]

// One budget map per department, applied to each of the three seeded months.
// Current-month approved spend (below) is sized against these amounts so the
// statuses land as: Transport ok (750/1000), Meals warning (420/500 = 84%),
// Supplies exceeded (250/200) in Operations.
const budgetsByDepartment: Record<string, Record<string, number>> = {
  Operations: { Transport: 1000, Meals: 500, Supplies: 200, Events: 300 },
  Finance: { Transport: 600, Utilities: 300 },
  Outreach: { Events: 800, Supplies: 200 },
}

type Line = {
  department: string
  user: string // email of the author
  category: string
  amount: number
  day: number // day of month, clamped to today for the current month
  status?: 'pending'
  description: string
}

// Expenses by month offset: 0 = current month, 1 = previous, 2 = two back.
const expensesByOffset: Line[][] = [
  // Current month — sized against the budgets above.
  [
    {
      department: 'Operations',
      user: 'staff@example.com',
      category: 'Transport',
      amount: 450,
      day: 3,
      description: 'Taxi to the depot',
    },
    {
      department: 'Operations',
      user: 'staff@example.com',
      category: 'Meals',
      amount: 175,
      day: 5,
      description: 'Team lunch',
    },
    {
      department: 'Operations',
      user: 'staff2@example.com',
      category: 'Transport',
      amount: 300,
      day: 8,
      description: 'Rail fares',
    },
    {
      department: 'Operations',
      user: 'staff2@example.com',
      category: 'Meals',
      amount: 245,
      day: 10,
      description: 'Client coffee meeting',
    },
    {
      department: 'Operations',
      user: 'staff2@example.com',
      category: 'Supplies',
      amount: 250,
      day: 12,
      description: 'Printer paper and toner',
    },
    // Pending lines demonstrate "awaiting approval" in the reports.
    {
      department: 'Operations',
      user: 'staff@example.com',
      category: 'Transport',
      amount: 60,
      day: 14,
      status: 'pending',
      description: 'Bus fares',
    },
    {
      department: 'Operations',
      user: 'staff2@example.com',
      category: 'Events',
      amount: 120,
      day: 15,
      status: 'pending',
      description: 'Workshop catering',
    },
    {
      department: 'Finance',
      user: 'staff3@example.com',
      category: 'Transport',
      amount: 200,
      day: 4,
      description: 'Fuel reimbursement',
    },
    {
      department: 'Finance',
      user: 'staff3@example.com',
      category: 'Utilities',
      amount: 150,
      day: 6,
      description: 'Internet bill',
    },
    {
      department: 'Finance',
      user: 'staff4@example.com',
      category: 'Transport',
      amount: 30,
      day: 13,
      status: 'pending',
      description: 'Parking',
    },
    {
      department: 'Outreach',
      user: 'staff5@example.com',
      category: 'Events',
      amount: 100,
      day: 9,
      description: 'Community fair booth',
    },
  ],
  // Previous month — fully approved.
  [
    {
      department: 'Operations',
      user: 'staff@example.com',
      category: 'Transport',
      amount: 500,
      day: 6,
      description: 'Site visits',
    },
    {
      department: 'Operations',
      user: 'staff2@example.com',
      category: 'Meals',
      amount: 300,
      day: 12,
      description: 'Workshop catering',
    },
    {
      department: 'Operations',
      user: 'staff2@example.com',
      category: 'Supplies',
      amount: 150,
      day: 18,
      description: 'Stationery restock',
    },
    {
      department: 'Finance',
      user: 'staff3@example.com',
      category: 'Transport',
      amount: 250,
      day: 7,
      description: 'Audit travel',
    },
    {
      department: 'Finance',
      user: 'staff3@example.com',
      category: 'Utilities',
      amount: 180,
      day: 15,
      description: 'Electricity bill',
    },
    {
      department: 'Outreach',
      user: 'staff5@example.com',
      category: 'Events',
      amount: 400,
      day: 11,
      description: 'Charity drive supplies',
    },
  ],
  // Two months back — fully approved.
  [
    {
      department: 'Operations',
      user: 'staff@example.com',
      category: 'Transport',
      amount: 620,
      day: 5,
      description: 'Conference travel',
    },
    {
      department: 'Operations',
      user: 'staff2@example.com',
      category: 'Meals',
      amount: 220,
      day: 14,
      description: 'Team breakfasts',
    },
    {
      department: 'Finance',
      user: 'staff4@example.com',
      category: 'Utilities',
      amount: 260,
      day: 9,
      description: 'Quarterly utilities',
    },
    {
      department: 'Outreach',
      user: 'staff5@example.com',
      category: 'Events',
      amount: 50,
      day: 16,
      description: 'Flyers',
    },
    {
      department: 'Outreach',
      user: 'staff5@example.com',
      category: 'Supplies',
      amount: 80,
      day: 20,
      description: 'Banner stands',
    },
  ],
]

// Calendar month key for an offset back from the current month.
function monthKey(offset: number): string {
  const now = new Date()
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1),
  )
  return d.toISOString().slice(0, 7)
}

// UTC-midnight date for a day within a `YYYY-MM` month. For the current
// month the day is clamped to today so no seeded expense is in the future
// (business rule 3), whatever date the seed runs on.
function dateFor(month: string, day: number): Date {
  const [year, mon] = month.split('-').map(Number)
  const clamped =
    month === monthKey(0) ? Math.min(day, new Date().getUTCDate()) : day
  return new Date(Date.UTC(year, mon - 1, clamped))
}

async function main() {
  await connectDB()
  console.log('Connected to MongoDB.')

  // 1) Organization.
  let org = await Organization.findOne({ name: ORG_NAME }).lean()
  if (!org) {
    org = await Organization.create({ name: ORG_NAME })
    console.log(`Created organization "${ORG_NAME}".`)
  } else {
    console.log(`Using existing organization "${ORG_NAME}".`)
  }
  const organizationId = org._id

  // 2) Departments (kept across runs; budgets/expenses are rebuilt below).
  const deptIds = new Map<string, unknown>()
  for (const name of DEPARTMENTS) {
    let dept = await Department.findOne({ organizationId, name }).lean()
    if (!dept) {
      dept = await Department.create({ organizationId, name })
      console.log(`Created department "${name}".`)
    }
    deptIds.set(name, dept._id)
  }

  // 3) Users — upsert by email; existing users keep their password but have
  //    name/role/department repaired to the demo values.
  let created = 0
  for (const u of demoUsers) {
    const departmentId = u.department ? deptIds.get(u.department) : null
    const existing = await User.findOne({ email: u.email }).lean()
    if (existing) {
      await User.updateOne(
        { _id: existing._id },
        { name: u.name, role: u.role, departmentId, isActive: true },
      )
      continue
    }
    await User.create({
      organizationId,
      departmentId,
      name: u.name,
      email: u.email,
      passwordHash: await hashPassword(PASSWORD),
      role: u.role,
      isActive: true,
    })
    created++
  }
  console.log(
    `Users: ${demoUsers.length} total (${created} created, ${demoUsers.length - created} already present).`,
  )

  const idOf = async (email: string) => {
    const user = await User.findOne({ email }).lean<{ _id: unknown }>()
    return user!._id
  }
  // The reviewer for seeded approvals is the department's manager, when the
  // department has one (Outreach deliberately has none).
  const managerEmailByDept: Record<string, string | null> = {
    Operations: 'manager@example.com',
    Finance: 'manager2@example.com',
    Outreach: null,
  }

  // 4) Rebuild budgets: same per-department map for each seeded month.
  await Budget.deleteMany({ organizationId })
  const budgets = []
  for (const offset of [0, 1, 2]) {
    const month = monthKey(offset)
    for (const [department, categories] of Object.entries(
      budgetsByDepartment,
    )) {
      for (const [category, amount] of Object.entries(categories)) {
        budgets.push({
          organizationId,
          departmentId: deptIds.get(department),
          category,
          amount,
          month,
        })
      }
    }
  }
  await Budget.insertMany(budgets)
  console.log(`Budgets: ${budgets.length} inserted (3 months x departments).`)

  // 5) Rebuild expenses.
  await Expense.deleteMany({ organizationId })
  const reviewerCache = new Map<string, unknown | null>()
  const reviewerFor = async (department: string) => {
    if (!reviewerCache.has(department)) {
      const email = managerEmailByDept[department]
      reviewerCache.set(department, email ? await idOf(email) : null)
    }
    return reviewerCache.get(department)
  }

  let expenseCount = 0
  let pendingCount = 0
  for (const [offset, lines] of expensesByOffset.entries()) {
    const month = monthKey(offset)
    for (const line of lines) {
      const date = dateFor(month, line.day)
      const pending = line.status === 'pending'
      if (pending) pendingCount++
      await Expense.create({
        organizationId,
        departmentId: deptIds.get(line.department),
        userId: await idOf(line.user),
        submitterRole: 'staff',
        category: line.category,
        amount: line.amount,
        date,
        description: line.description,
        status: pending ? 'pending' : 'approved',
        reviewedBy: pending ? null : await reviewerFor(line.department),
        reviewedAt: pending ? null : date,
        reviewNote: null,
      })
      expenseCount++
    }
  }
  console.log(
    `Expenses: ${expenseCount} inserted across 3 months (${pendingCount} pending).`,
  )

  // 6) Migration (Phase 7B): expenses recorded before submitterRole existed
  //    were all staff submissions. Backfill them so the review queues and the
  //    role matrix can rely on the field for every historical document.
  const migrated = await Expense.updateMany(
    { submitterRole: { $exists: false } },
    { $set: { submitterRole: 'staff' } },
  )
  if (migrated.modifiedCount) {
    console.log(
      `Migrated ${migrated.modifiedCount} expense(s) to submitterRole "staff".`,
    )
  }

  console.log('\nSeed complete.')
  console.log(`Demo accounts (password: ${PASSWORD}):`)
  for (const u of demoUsers) {
    const scope = u.department ? `${u.role} · ${u.department}` : u.role
    console.log(`  ${u.email.padEnd(24)} ${scope}`)
  }
  console.log(
    '\nCurrent month budget statuses: Operations Transport = ok,' +
      ' Meals = warning, Supplies = exceeded (alerts show on the manager dashboard).',
  )

  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
