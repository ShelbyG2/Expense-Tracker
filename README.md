# Expense Tracker

A small-organization **Management Information System (MIS)** for expenses: staff record spending, managers set budgets and approve expenses, and admins manage people and departments. Every figure (totals, budget status, alerts, trends) is computed in MongoDB aggregation pipelines, never in the UI.

## MIS explanation

The system closes the classic plan / do / observe / act loop:

| Stage | What happens |
| --- | --- |
| **Input** | Staff enter expenses (category, amount, date, description). Managers enter budgets per department, category and month, and can copy a month's plan forward. |
| **Processing** | MongoDB aggregation pipelines total approved spending by category and department, compare it with budgets (including one-level carry-over), and derive a status (ok / warning / exceeded / unbudgeted) from the organization's warning threshold. Pending expenses are counted separately. |
| **Output** | A summary report, a budget vs actual table, 6-month trend and category charts, CSV and XLSX exports, a printable report page, and role-specific dashboards. |
| **Feedback** | Managers get an alerts banner and are notified when a budget crosses a threshold; approvals and rejections notify the submitter; reviewers are notified when work is waiting. Every mutation is written to an audit log that admins can filter and browse. |

## Features by role

| Role | Can do | Cannot do |
| --- | --- | --- |
| **staff** | Create, edit and delete their own expenses while pending; filter, sort and page through their own history; see their department's budget status (read-only); track approval status and reasons; read their own notifications | Set budgets, approve expenses, view reports, manage users |
| **manager** | Create, edit and delete budgets for their own department (including copy-month and carry-over); approve or reject **staff** expenses in their own department with an optional reason; record and manage their own expenses; view reports, charts, alerts and exports; read their own notifications | Review their own spending, review another department, manage users or departments |
| **admin** | Manage users (create, assign role/department, reset passwords, deactivate/reactivate) and departments (create, rename, archive/unarchive, delete when unused); browse the organization's audit log at `/admin/audit` (filter by user, entity, action and date; read-only, newest first, paginated); set the warning threshold and currency; approve or reject **manager** expenses; view every department's expenses, budgets and reports read-only; read their own notifications | Approve or reject staff expenses (their department manager does that), review their own expenses, change their own role or status |

Every user has an in-app notification bell in the header (unread badge, latest 10, mark one or all as read) and a paginated `/notifications` page. Notifications are created by the services when an expense needs review, is approved or rejected, or when an approval pushes a budget across its warning or exceeded line; they are always scoped to one recipient.

Registration creates a new organization and its first admin, so every organization's data is isolated (multi-tenant: every query is filtered by the session's `organizationId`).

An email address belongs to **one organization**: addresses are unique across the whole database, so an address that already has an account cannot register a second organization.

## Getting started

### Prerequisites

- Node.js 20+
- A MongoDB database (local or Atlas)

### 1. Install

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

| Variable | Required | Description |
| --- | --- | --- |
| `MONGODB_URI` | yes | MongoDB connection string (`mongodb://` or `mongodb+srv://`) |
| `JWT_SECRET` | yes | Secret used to sign the session JWT; any long random string |
| `NODE_ENV` | no | `development` (default), `production` or `test` |

`.env` is gitignored; `.env.example` is the committed template. Missing `MONGODB_URI` or `JWT_SECRET` makes the app fail fast at startup.

### 3. Seed the demo data

```bash
npm run seed
```

Creates 1 organization ("Demo Organization"), 3 departments (Operations, Finance, Outreach), 8 users (1 admin, 2 managers, 5 staff), budgets and 3 months of expenses. The current month is arranged so Operations shows one ok, one warning and one exceeded category, so the manager dashboard displays alerts immediately. Re-running rebuilds the demo budgets and expenses and backfills `submitterRole` on older documents.

### 4. Run

```bash
npm run dev
```

Open http://localhost:3000. Health check: http://localhost:3000/api/health.

### Demo accounts

All use password `Password123!`:

| Email | Role | Department |
| --- | --- | --- |
| `admin@example.com` | admin | (organization-wide) |
| `manager@example.com` | manager | Operations |
| `manager2@example.com` | manager | Finance |
| `staff@example.com` | staff | Operations |
| `staff2@example.com` | staff | Operations |
| `staff3@example.com` | staff | Finance |
| `staff4@example.com` | staff | Finance |
| `staff5@example.com` | staff | Outreach |

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run seed` | Create/refresh the demo data |
| `npm run lint` | ESLint |
| `npm run format` / `npm run format:check` | Prettier write/check |
| `npm test` / `npm run test:watch` | Vitest unit and integration tests |

`npm test` runs 124 unit tests plus 16 integration tests against a real MongoDB started by `mongodb-memory-server` (the first run downloads a mongod binary, ~120 MB). CI runs lint, format check, build and the full suite on every push and pull request (`.github/workflows/ci.yml`).

End-to-end checks (dev server must be running): `npx tsx scripts/verify-phase7e.mts`, `scripts/verify-phase3.mts`, `scripts/verify-phase4.mts`, `scripts/verify-phase5.mts`, `scripts/verify-phase7a.mts`, `scripts/verify-phase7d.mts`, `scripts/verify-seed.mts`. Each creates throwaway organizations, asserts the behavior against fixtures, cleans up and exits non-zero on failure.

## Project structure

```
app/          # App Router: pages and API route handlers
components/   # React components (forms, tables, charts, toasts)
lib/          # Cross-cutting utilities (db, auth, session, guard, format)
models/       # Mongoose schemas and indexes
schemas/      # Shared Zod schemas (client and server)
services/     # Business logic, scoping rules, aggregation pipelines
tests/        # Vitest unit tests and tests/integration (real mongod)
docs/         # Master build plan
scripts/      # Seed and verification scripts
```

Business logic lives in `services/`; route handlers only validate, guard and shape responses; components only render.

## API summary

All routes are under `/api`. Errors use a consistent envelope: `{ "error": string, "details"?: any }`. Session is an HTTP-only cookie; mutations require it plus the role shown below.

### Health

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/api/health` | public | `{ status, db }` |

### Authentication and account

| Method | Path | Role | Body / notes |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | public | `{ organizationName, name, email, password }`; creates the org and its first admin |
| POST | `/api/auth/login` | public | `{ email, password }`; generic 401 message, rate limited to 5 attempts/minute per IP |
| POST | `/api/auth/logout` | any session | Clears the cookie |
| GET | `/api/auth/me` | any session | Current session, or 401 |
| GET | `/api/auth/session-expired` | any session | Clears the cookie and redirects to `/login?reason=deactivated` |
| POST | `/api/account/password` | any session | `{ currentPassword, newPassword, confirmPassword }`; the only route allowed while a temporary password is pending |

### Expenses

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/api/expenses` | admin, manager, staff | Filters `category`, `status`, `from`, `to`; paging via `page`/`pageSize` (max 100), sorting via `sortBy` (`date`, `amount`, `createdAt`) and `sortDir`; scope: staff own, manager department + own, admin all |
| POST | `/api/expenses` | staff, manager | `{ category, amount, date, description }`; amount > 0, date not in the future, description max 200; a manager needs a department |
| GET | `/api/expenses/:id` | admin, manager, staff | 404 outside the caller's scope |
| PATCH | `/api/expenses/:id` | staff, manager (owner, pending only) | 403 for others, 409 once reviewed |
| DELETE | `/api/expenses/:id` | staff, manager (owner, pending only) | As above |
| POST | `/api/expenses/:id/review` | manager (staff expenses, own department), admin (manager expenses) | `{ action: approve, reason? }` or `{ action: reject, reason? }`; 404 for your own or another queue |

### Budgets

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/api/budgets` | manager, admin | `month` and `category` filters; manager sees own department, admin sees all |
| POST | `/api/budgets` | manager | `{ category, amount, month, carryOver? }` for the manager's own department; 409 for a duplicate department/category/month |
| POST | `/api/budgets/copy` | manager | `{ fromMonth, toMonth }`; copies budgets into a month, skipping existing categories; returns `{ month, created, skipped }` |
| GET | `/api/budgets/:id` | manager, admin | 404 outside scope |
| PATCH | `/api/budgets/:id` | manager (own department) | Partial update |
| DELETE | `/api/budgets/:id` | manager (own department) | |

### Reports

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/api/reports/export?report=summary\|budget&month=YYYY-MM&format=csv\|xlsx` | admin, manager | Download (CSV by default); `month` defaults to the current month |

Report data itself is server-rendered on `/reports`; charts are Recharts components and the page has a print stylesheet.

### Notifications

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/api/notifications` | any session | The caller's own inbox, newest first; `page`/`pageSize` (max 50); includes `unreadCount` |
| POST | `/api/notifications` | any session | `{ ids: [...] }` or `{ all: true }` marks the caller's own notifications as read; returns `{ updatedCount }` |

### Admin

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/api/admin/users` | admin | List with department names |
| POST | `/api/admin/users` | admin | `{ name, email, password, role, departmentId }` (use `null` for no department); 409 on a duplicate email |
| PATCH | `/api/admin/users/:id` | admin | any of `{ name?, email?, role?, departmentId?, isActive? }`; cannot change own role/status, org must keep one active admin |
| POST | `/api/admin/users/:id/reset-password` | admin | `{}` for a generated temporary password or `{ password }`; returns it once and forces a change on next login |
| GET | `/api/admin/audit` | admin | Read-only audit trail; filters `userId`, `entity`, `action`, `from`, `to`; paged `page`/`pageSize` (max 100), newest first |
| GET | `/api/admin/departments` | admin | Includes user, budget and expense counts |
| POST | `/api/admin/departments` | admin | `{ name }`; 409 on a duplicate name in the org |
| PATCH | `/api/admin/departments/:id` | admin | Rename |
| POST | `/api/admin/departments/:id/archive` / `unarchive` | admin | Archives a department: its name stays in history, new users/budgets/expenses are refused |
| DELETE | `/api/admin/departments/:id` | admin | 409 while users, budgets or expenses reference it (archive instead) |
| GET | `/api/admin/settings` | admin | `{ name, warningThreshold, currency }` |
| PATCH | `/api/admin/settings` | admin | `{ warningThreshold?, currency? }`; threshold 0.5–0.95, currency ISO 4217 |

## Security notes

- Passwords are hashed with bcryptjs and never returned or logged. Admins hand out temporary passwords (generated or chosen) that must be changed before any other page or API works.
- Sessions are JWTs in an HTTP-only, SameSite=Lax, Secure-in-production cookie. The token lasts 8 hours, renews on use when under 2 hours remain, and is never allowed past 7 days from first issue.
- `role`, `departmentId`, `isActive` and `mustChangePassword` are re-read from the database on every page and API call, so deactivation and role changes apply immediately.
- Every API route re-checks the session and role server-side; `proxy.ts` additionally guards pages.
- Login returns one generic error and is rate limited (5/minute per IP). The limiter is stored in MongoDB, so it holds across instances and restarts.
- Security headers on every response: CSP (no `unsafe-eval` in production), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS in production.
- Every create, update, delete, approve and reject writes an `AuditLog` entry; the viewer is admin-only and scoped to the organization.
- Notifications are one document per recipient, queried by `(organizationId, userId)`, so one user can never read or mark another user's inbox.
- An email address belongs to one organization only: uniqueness is global across the database, not per organization.

## Limitations

- Single database, single deployment: no background jobs, queues or scheduled reports; alerts, trends and notifications are computed on request.
- No real email delivery: notifications are in-app only, and an admin must pass a temporary password to the user out of band.
- No receipt or file attachments; expenses are amounts plus a text description.
- Data lives in one MongoDB database; there is no archive/sharding story beyond department archiving.

## Future work

- Password reset and invitation emails (which would also remove the out-of-band temporary password).
- Receipt attachments stored in GridFS and served through an authenticated, scope-checked route.
- Scheduled report delivery and a digest of unread notifications.
- Per-organization branding.

## License

University class project.
