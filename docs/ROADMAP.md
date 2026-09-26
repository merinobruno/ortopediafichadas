# Delivery inventory

## Active Convex/Vercel Telegram replacement (local source, not deployed)

The approved basic path now uses HR-issued one-time Telegram linking, a verified
private-chat webhook, a deduplicated ordered inbox, attendance geofencing, guarded
Telegram replies, and redacted operations. Employee/site/attendance identities
remain stable; old phone and WhatsApp transport rows are retained only for a
private, bounded cleanup after cutover, with no replay. Local tests and build
verify source behavior; bot provisioning, HTTPS webhook registration, and a live
link/location/reply check remain pending. The inventory below describes the
retained SQLite product and its separate migration work.

The September 9 attendance design remains the domain baseline; the approved September 26 Telegram design supersedes its transport and phone identity decisions. Reference navigation is evidence of inventory, not completed parity. The reference settings also expose a multiple-fichada option; the user's failure was observed by the user, not diagnosed here.

| Group | Delivered | Remaining |
| --- | --- | --- |
| Attendance foundation | Dashboard, employee/site editing, registered phones, multiple daily visits, geofences, site access, atomic unknown exit alert, audited exit/pause correction and manual historical complete visits, simulator, filtered detail/summary CSV and overall/employee/site net-hour reports | Individual admin/HR/supervisor accounts and assigned-employee scope delivered; employee self-service/onboarding and stronger retention controls remain |
| WhatsApp | Signed webhook, durable inbox/pending/outbox, exact site-name disambiguation, config-gated official sender, delivery status handling, bounded retry, safe uncertain state | Real Meta account/number/configuration, HTTPS deployment, monitoring, template messages and operator recovery UI; no live connection verified |
| HR operations | Leave request/review through shared HTTP/bot creation, administrative and employee bot pauses, effective dated7/14-day cycles, versioned manual weekly date overrides and scoped attendance calendar with rest/leave/holiday/tolerance handling, manual overtime request/review, revision-checked editable/soft-archivable shifts/holidays/taxonomy, enforced site category links and audited employee association removal | Leave balances/accruals/attachments, split shifts and automatic overnight matching, automatic overtime policy |
| Alerts and reports | Unknown-exit queue and audit; configurable in-panel late/absence rules, priority and reviewed/resolved states; overall/employee/site net-hour reports with pauses, Buenos Aires filtering, detail/summary CSV and bounded applied-filter XLSX/PDF exports | External notifications/escalation, payroll policy, payroll-specific reporting |
| Extended integrations | Local immutable template revisions, draft recipient preview/preparation and onboarding instruction previews; private PDF draft/archive batches with manual assignment and authenticated downloads | External communication delivery, invitations, provider-approved templates and signatures; receipt portal/publication, ZIP/automatic mapping and electronic signatures; biometric devices/rejected events; analytics integration; subscription scope clarification |
| Production operations | Local durable SQLite transactions, session cookies, validation, repeatable tests/build; built production entry, redacted health, draining shutdown, verified backup/new-path restore with replay quarantine and operational runbook | PostgreSQL adapter/migrations, MFA/account recovery, privacy retention, external monitoring, storage policy and deployment validation |

Unknown break endings intentionally exclude that visit from net-hour totals even after an exit correction. HR can now confirm unknown pause endings with an audited reason, bounded by the visit exit or next entry. Calendar expectations are not payroll evidence; overnight shifts explicitly require review. Legacy assignments remain inactive drafts until HR defines their dates and cycle. Overtime is manually requested against known complete visits, never inferred or paid automatically. One immutable request per visit prevents repeated approval accumulation.

The implementation is a working initial local product, not a claim to reproduce every reference feature or provide production 24/7 availability.





## Operations preparation delivered

Built Node 24 production entry, explicit configuration validation, redacted liveness/readiness, bounded sender shutdown, WAL-consistent verified backup and new-path restore with session revocation and replay quarantine are implemented. The runbook covers supervision and recovery. Managed deployment, external monitoring, private storage policy, PostgreSQL and live Meta activation still require deployment work; no production availability is claimed.


## In-panel attendance rules delivered

Two configurable disabled-by-default rules detect late arrivals and absences from effective calendar expectations. Priority snapshots, retained activation periods, first-review audit and durable bounded reconciliation are implemented. Dashboard separates these exceptions from unknown departures. External notification delivery, escalations, arbitrary rule builders and payroll deductions are outside this unit.


## Communications preparation delivered and reference observations

Local template revisions/archive, draft editing, active all/sector/individual recipient preview, immutable preparations and attendance-instruction preview are implemented. Plain text intentionally replaces the reference's HTML authoring; pasted markup remains literal. No provider approval, communication sending, employee signature or onboarding verification is claimed.

Read-only reference inspection established this remaining inventory, without importing employee data:

- Communications: six document types, optional local template, WhatsApp/email/both, signature intent and a multi-step recipient/send flow. Actual provider template approval and external dispatch remain separate integration work.
- Onboarding: invitation pending/completed/expired/cancelled states; terms title/version/HTML, optional electronic signature, token expiry and attempt settings, welcome/confirmation messages and branding. The reference's last-three-DNI-digit check is not strong identity proof; no such identity claim is implemented here.
- Receipts: month and liquidation categories, PDF/ZIP upload, manual/filename/PDF-text assignment, originals/copies, employee OTP, employer signature/QR claims, reminder and portal settings. These are observed controls, not verified security or signature guarantees; private PDF staging/manual assignment is implemented; ZIP, automatic assignment, publication, OTP, signatures, QR and reminders remain pending.
- Biometrics: reference showed no agent configured, with a same-network ZkBridge dependency and received/processed/duplicate/rejected/discarded event filters by site/PIN/reason/date. No hardware connection or device correctness was verified.
- Analytics: configurable six-weight performance indicator, thresholds, 30/60/90-day windows, scheduled/recalculate controls and formula help. This does not demonstrate an AI predictor; no employee scoring is implemented.
- Subscription screens describe the reference vendor's billing limits. Their prices, trial restrictions and payment controls are not requirements for Carahue's client application.
- Manual reference attendance can register individual entry/exit marks with optional location and observations. Carahue currently supports deliberately constrained complete historical intervals with overlap checks; individual historical marks remain a parity gap.


## Core employee bot commands delivered

Pausa/finpausa, pending-only leave requests, ayuda and attendance-intention cancellation share the registered-phone receiver. Provider freshness/future guards, pause chronology, original receipt/event timestamps, durable idempotency and atomic reply rollback are covered by tests. The local textual simulator has independent pending/history and never queues outbound provider messages. Provider deployment, live WhatsApp testing and advanced leave policies remain pending.




