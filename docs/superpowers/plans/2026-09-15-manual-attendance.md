# Manual HR attendance and unknown pause correction

## Contract
Admin/HR may record one confirmed historical complete visit with employee, currently authorized active site, explicit entry/exit and reason. Both timestamps must be real ISO instants; normalize UTC and require entry<exit<=now. Store source manual_hr and status corrected, no fabricated location or provider event. Authenticated actor and before/after are audited in the same transaction.

Use half-open intervals across all sites. Known visits reserve [entry,exit); open visits reserve [entry,infinity); unknown exits reserve [entry,next entry) or infinity if none. Reject overlap atomically; exact adjacency is allowed. Live chronology also respects the latest known completed/corrected exit, so a delayed message cannot overlap a manually recorded interval. Historical manual insertion is not a new live-event watermark.

An end_unknown pause can be completed only with a confirmed end and reason, after its start and no later than known visit exit or next entry (the earliest available bound), and never in the future. Preserve before/after audit and null until valid confirmation. Exit correction cannot precede a known pause start/end. Supervisors read scoped results but all manual/correction mutations are forbidden.

Calendar first-entry observation must remain visible even when the day is unscheduled, rest, holiday or approved leave; those statuses suppress expectations, not actual evidence.

## Steps
- [x] Regression tests for calendar observation, overlap and adjacency, conservative unknown/open intervals, authorization, chronology and pause bounds/audit.
- [x] Transactional manual attendance and pause correction functions/API; server auth defaults deny supervisor.
- [x] Spanish manual form with empty date fields and explicit origin; unknown pause correction form; clear audited provenance.
- [x] Normalize/test/build and update README/ROADMAP; parent review and browser QA.

