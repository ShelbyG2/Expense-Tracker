ROLE
You are continuing work on the Expense Tracker MIS (Next.js, MongoDB, TypeScript). Phases 0-6 in docs/MASTER_PROMPT.md are complete and approved. This is Phase 7: close the known limitations. All master-prompt rules still apply (organizationId scoping, never trust client IDs, Zod validation, { error, details? } envelope, audit log on mutations, business logic in services/, no secrets in git). Work one sub-phase at a time. After each sub-phase: run lint, build, npm test and the existing verify scripts, add or extend verify scripts for new behavior, update knowledge.md, summarize in 5 lines or fewer with files changed and how to test manually, then STOP and wait for my approval. Build only what is listed. If something is ambiguous, ask one short question. Work on a git branch named phase-7 with small conventional commits.

SKILLS TO LOAD
- builder for each sub-phase
- security-reviewer (report only) after 7A and 7B
- test-writer for new logic
- docs-writer at the end of 7F

PHASE 7A - Security and account management
1. Deactivated users: in getSession, also check isActive. If the user is inactive, redirect to a route handler (/api/auth/session-expired) that clears the cookie and redirects to /login?reason=deactivated. This avoids the redirect loop noted in knowledge.md. Show a clear message on the login page.
2. Change own password: new /account page (all roles) with current password, new password, confirm. Zod schema, bcrypt, audit entry. Never return hashes.
3. Admin sets a temporary password: on /admin/users add "Reset password" which generates or accepts a temporary password, sets mustChangePassword=true on the User. After login, a user with mustChangePassword is redirected to /account/change-password and cannot use any other page or API until changed. Audit entry.
4. Rate limiter in MongoDB: replace the in-memory limiter with a collection (key, count, windowStart) using an atomic upsert and a TTL index. Keep the same 5 attempts per minute per IP for login and apply a similar limit to register and password change. Keep the same function interface so call sites barely change.
5. Session renewal: if a valid token has less than 2 hours left, issue a fresh 8-hour token on the next authenticated API call (sliding session). Do not extend beyond a 7-day absolute maximum (store an issuedAt claim).
6. Rename middleware.ts to the Next.js 16 proxy convention (proxy.ts, exported function proxy). Check the installed Next.js docs for the exact signature. Behavior must be identical.
Definition of done: a deactivated user is logged out on the next page load with a message; temporary-password flow blocks everything until changed; login limit works across two server instances (test by resetting module state in a script); middleware warning is gone.

PHASE 7B - Expense roles and approvals
Goal: managers can record their own expenses without approving them themselves.
1. Add submitterRole (staff|manager) to Expense, set from the session at creation, never from the client. Add a migration step in the seed script for existing expenses (default staff).
2. Managers can create, edit and delete their own pending expenses (same rules as staff: owner only, pending only). Manager expenses belong to the manager's department.
3. Review rules: a manager can review only expenses in their own department where submitterRole is staff and userId is not their own. An admin can review only expenses where submitterRole is manager. Nobody can review their own expense. Admin remains read-only for staff expenses.
4. Update expenseScope, reviewScope and their unit tests. Update /approvals so the admin sees a queue of manager expenses.
5. Approved manager expenses count toward their department's budget like any other.
Definition of done: role matrix tests pass; a manager cannot approve their own expense via UI or direct API call; an admin cannot approve a staff expense; verify-phase3 is updated and green.

PHASE 7C - Budgets and reports
1. Unbudgeted spending: in budgetVsActual, add rows for categories that have approved spending but no budget in that month, with budget=null, status "unbudgeted", percent not applicable. Show a distinct badge. Include them in alerts at a lower priority than exceeded. Update CSV export and tests.
2. Configurable thresholds: add warningThreshold (default 0.8, allowed 0.5 to 0.95) to Organization. Admin can edit it on a new /admin/settings page. budgetStatus() takes the thresholds as a parameter, with the config constant remaining the default. Update every call site and tests.
3. Copy budgets: on /budgets a manager can copy all budgets from a chosen previous month to a target month. Skip any category/month that already exists and report how many were created and skipped. Audit entry per created budget.
4. Optional rollover: add an optional per-budget flag carryOver. When true, any unspent approved amount from the previous month is added to that month's available budget. Show "base budget" and "carried over" separately in the table. Keep default false.
5. Export: add XLSX export for summary and budget vs actual (use a well-maintained library such as exceljs) alongside CSV. Add a print stylesheet for /reports so Print > Save as PDF gives a clean report including charts (hide navigation and buttons).
Definition of done: numbers verified by hand-computed fixtures in verify-phase4; thresholds change the status of the seeded Operations categories as expected; XLSX opens correctly.

PHASE 7D - Admin and data integrity
1. Audit log viewer: /admin/audit, admin only, paginated, filter by user, entity, action and date range, shows who did what and when. Read-only.
2. Archive departments: replace delete with archive (isArchived, archivedAt). Archived departments cannot receive new users, budgets or expenses, but keep their name in all historical reports (no more "Unknown department"). Allow unarchive. Hard delete is allowed only when nothing at all references the department, including expenses. Update guards and tests.
3. Organization currency: add currency (ISO code, default KES) to Organization, editable on /admin/settings. Format all amounts with Intl.NumberFormat using that code. Do not convert amounts.
4. Document the email rule: in README and the register/admin forms, state that an email address belongs to one organization.
Definition of done: archived department appears correctly in old reports; currency change updates every amount display and CSV/XLSX header labels.

PHASE 7E - In-app notifications
1. Add a Notification model (organizationId, userId, type, message, link, readAt, createdAt) with an index on (organizationId, userId, readAt, createdAt) and a TTL of 90 days.
2. Create notifications in services (not in components) when: an expense is approved or rejected (to the submitter), a new expense awaits review (to the relevant reviewers), and a budget crosses into warning or exceeded (to the department managers, once per budget per status change, not on every expense).
3. UI: a bell icon in the header with an unread count, a dropdown of the latest 10, mark as read and mark all as read, and a /notifications page with pagination.
Definition of done: crossing the 80% line sends exactly one notification; marking read updates the count; staff never see other users' notifications.

PHASE 7F - Quality, CI and documentation
1. Integration tests with mongodb-memory-server for the services (expense, budget, report, admin, notification, rate limiter) with real aggregation pipelines. Keep existing unit tests.
2. GitHub Actions workflow: on push and pull request run install, lint, format:check, build and test.
3. Run Prettier on the whole repo, fix the pre-existing failures, and make format:check pass.
4. Update README: features by role (new role matrix), setup, API summary for every new route, security notes, and replace the Limitations and Future work sections with the current truth. Remaining limitations should be only: no background jobs, no real email, no receipts (unless 7G is done), single database.
5. Update knowledge.md with where new things live and any gotchas.
Definition of done: all checks green locally and in CI; README matches the code.

PHASE 7G - OPTIONAL stretch: receipt attachments (only if I ask)
Store one image or PDF receipt (max 2 MB, type checked by content, not just extension) per expense in MongoDB GridFS. Serve through an authenticated route that applies the same scope rules as the expense. Delete the file when the expense is deleted. Show a thumbnail or link on the expense page. Do not start this unless I explicitly say so.

NOW
Start with Phase 7A.
