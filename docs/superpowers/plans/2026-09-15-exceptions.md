# Attendance exception rules

Implement two disabled-by-default in-panel rules (late and absent) using the existing calendar as the only expectation evaluator. Activation is server Buenos Aires today; persisted activation periods prevent retroactive detection. Preserve original priority/evidence and first acknowledgement independently from current condition. Rule disable stops new current-day detection, never invents attendance corrections.

Persist range jobs with one-day and employee cursors. Each worker step evaluates at most 100 employees on one day, transactionally with cursor/results. Completed-day catch-up resumes from activation without the calendar's 93-day range limit. Today is scanned repeatedly. Mutations enqueue affected ranges in their own transaction; existing identities are reevaluated even outside enabled periods. No external notification or payroll consequence.

GET lists/counts are scoped before pagination. Admin/HR manage settings and acknowledge with reasons; supervisors only read their assigned employees. Audit actual changes and first acknowledgement, not unchanged scans.

- [x] Domain/schema/jobs and tests.
- [x] Transactional mutation integration and runtime bounded worker.
- [x] Scoped API and Spanish accessible panel/dashboard.
- [x] Normalize, tests/build and handoff.

## Review ruling and verification

The initial mapper boundary (today plus historically active exceptions on employee edits) was too narrow: deactivation resolved an old identity as inactive, then reactivation skipped it. The scoped correction queues all EXISTING historical identities when activation changes, in the employee transaction with a factual authenticated audit. It does not initiate unconstrained historical backfill; activation periods still constrain new creation. Regression uses the real authenticated employee endpoint with a disabled rule and proves forced job failure rolls the employee/audit changes back.

Configuration audit keeps factual before/after values and session actor. User-entered reasons are required for exception acknowledgement, not for configuration changes; no new configuration-reason requirement was introduced.

Verification after the scoped correction: `npm test` passed all 56 tests; `npm run build` passed TypeScript, frontend and built-server output. Files were normalized before verification. Parent owns the final browser QA and the single scoped correction recheck.
