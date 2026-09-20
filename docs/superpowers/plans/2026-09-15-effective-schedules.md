# Effective schedules and attendance calendar

## Contract
A schedule belongs to an active employee and has inclusive effective dates, an anchor date, and a 7- or 14-day repeating sequence of shift/rest slots. Persist a snapshot of each assigned shift's name/start/end/tolerance so later catalog edits do not rewrite expectations. Reject overlapping effective ranges. Cancellation preserves the schedule and audit. Changes require cancellation followed by a new range. No implicit historical assignments.

Calendar dates are Buenos Aires civil dates, bounded to 93 days per query. Derive unscheduled/rest/holiday/leave/upcoming/awaiting/on_time/late/absent from assigned snapshots and first entry across all sites. Absence only after scheduled end. Exact tolerance boundary is on_time. Approved leave and configured holidays suppress late/absent. Future dates remain upcoming even if an invalid future visit exists. Overnight schedules are explicitly review_required rather than matching visits unsafely. Never create visits/exits or payroll hours.

Legacy current shift assignments migrate once as inactive reference drafts, with no configured effective cycle or expectations. HR must create explicit slots and effective dates. No inferred past or workdays. The old current-assignment endpoint returns410 and directs changes to effective schedules. Supervisor reads only assigned employees and cannot mutate schedules. Admin/HR may create/cancel with reasons and authenticated audit actor.

## Steps
- [x] Write boundary, rotation, overlap, holiday/leave/future and scope tests.
- [x] Add migration/table, snapshot schedule domain, calendar derivation and API with explicit server scope.
- [x] Add Spanish schedule creator and period calendar UI; old current assignment UI marked legacy.
- [x] Normalize, test/build and parent browser QA; update docs and limitations.

