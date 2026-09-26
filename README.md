# Carahue — Personas y asistencia

A runnable local HR application with Telegram-linked attendance and a separate local simulator. The cloud Basic app has an independent Convex/Vercel backend. Spanish UI; English code and documentation. This source change was not deployed and sent no external messages.

## Run

Requires Node 24 and npm:

```sh
npm install
npm run dev:legacy
```

Open http://127.0.0.1:4381. Local demo email: `admin@carahue.local`. Local demo password: `Carahue-demo-2026` unless ADMIN_PASSWORD is configured. The synthetic seed is inserted only into an empty employee database. Data persists in `data/carahue.sqlite`. Use a separate DATABASE_PATH and DEMO_MODE=false for a clean dataset; never erase a live database to reset demo data.

```sh
npm test
npm run check
npm run build
npm run build:legacy
npm run format
```

For a production-shaped local-server run, build with `npm run build:legacy` first and set NODE_ENV=production, ADMIN_PASSWORD, DEMO_MODE=false, DATABASE_PATH, HOST, PORT. Secure session cookies require HTTPS. NODE_ENV=production does not seed unless DEMO_MODE=true. This remains single-instance SQLite.

## Implemented

- Employee IDs with private Telegram linking, site authorizations, geofences, active flags, editable employee/site records.
- Multiple visits/day, returns to a previous site, duplicate delivery protection. Entry at another authorized site atomically marks the prior visit exit_unknown, creates an alert and opens the new visit. No invented exit.
- Explicit entry/exit intent, five-minute pending location window, overlapping geofence selection by exact site name, stale-message rejection.
- HR unknown-exit correction preserves original observation in audit with actor/reason. Event audit records coordinates, action, site, provider time and receipt time. Report days use Buenos Aires.
- Filtered CSV and report net hours; complete pauses are deducted, unknown intervals/pauses excluded. CSV remains UTC-labeled for original timestamps.
- Leave requests and audited one-time approval/rejection. Shift catalog, effective dated7/14-day cycles with rest slots, immutable shift snapshots and scoped attendance calendar. Overnight shifts require manual review.
- Administrative pause start/end on an open visit; one open pause per visit. Exit requires closing pause. Site change leaves an open pause end_unknown.
- Manual overtime minute requests against completed visits; unique request per visit and audited one-time review. No automatic payroll calculation.
- Organization holidays, sector/tag/category catalogs, employee sector/tag associations. Categories remain descriptive free text on sites; no enforced catalog relationship.
- Responsive HR interface, individual-account cookie sessions, login rate limiting, local simulator clearly marked.

## Telegram configuration

Set `TELEGRAM_WEBHOOK_SECRET` and register the HTTPS `/webhook/telegram` callback with Telegram `setWebhook` and its `secret_token`. Only original private messages with matching numeric sender/chat IDs enter the durable inbox. HR issues a single-use 10-character code valid for 15 minutes; the employee sends `/start CODE` in a private bot chat. Codes are hashed before durable insertion. Link revocation and employee deactivation block queued work, including after relinking to the same account.

The worker runs every two seconds. Inbox, pending intent, attendance, result and reply queue writes share a transaction. `TELEGRAM_SEND_ENABLED=true` also requires `TELEGRAM_BOT_TOKEN` and the webhook secret. Only confirmed Telegram `sendMessage` success is accepted; explicit proved-unsent 429 responses retry with bounded backoff. Timeout, 5xx, malformed success and interrupted sends require operator review and are never blindly resent. Secrets stay server-side. See [the Convex guide](docs/BASIC-CONVEX.md) for the separate cloud deployment.
## Security and operational limits

Individual accounts use salted scrypt password hashes. Admin manages accounts and global operation; HR operates globally but cannot manage accounts; supervisors read assigned employees and approve/reject only their leave/overtime. Every other supervisor mutation is forbidden server-side. PostgreSQL migration, retention tooling, monitoring, backups/restore testing and 24/7 hosting remain required before real employee rollout. Use only one application process and one local database file; do not deploy SQLite on a shared network volume. Location sharing supplies coordinates, not proof against spoofing.

Config: PORT=4381, HOST=127.0.0.1, DATABASE_PATH=data/carahue.sqlite. ADMIN_PASSWORD is mandatory in production. DEMO_MODE defaults on only outside production. Telegram sending defaults disabled.

See docs/ROADMAP.md for the entire reference inventory and remaining scope.

## Accounts and bootstrap

On an empty users table, ADMIN_EMAIL (default admin@carahue.local) and ADMIN_PASSWORD create the first administrator. The password must have 12–256 characters; salts and scrypt digests are stored, plaintext is not. Existing user credentials are never overwritten by environment changes. Production requires explicitly configured ADMIN_PASSWORD at startup and never enables the demo password fallback.

Existing shared sessions have no user binding and become invalid; sign in again. Password-only API login defaults to ADMIN_EMAIL for transition, while UI asks for email. Editing account credentials, role, assignments or active status revokes all sessions for that user. The last active administrator cannot be deactivated/demoted. Admins manage accounts in Usuarios y permisos; deactivate instead of deleting to preserve historical audit identities. Editing your own account requires signing in again.

Supervisor state, reports/CSV, HR records, breaks and audit are filtered on the server; audit with ambiguous ownership is withheld. Supervisors cannot access messaging queues or manage users. Individual audit actors use authenticated account email, not client input. Employee job titles remain separate from access roles. Email recovery, invitations, MFA and self-service passwords are not implemented.

## Effective schedules and calendar

Calendario y rotaciones creates nonoverlapping employee schedules with inclusive from/to dates, cycle anchor and exactly7 or14 shift/rest slots. A shift snapshot retains its name, start/end and tolerance. Canceling from today preserves earlier effective days; future schedules are marked canceled. Creation/cancellation records authenticated audit actor and reason. Admin/HR can edit; supervisors read only their assigned employees.

Calendar queries cover at most93 civil days in Buenos Aires. The first entry across all sites is compared with scheduled start plus tolerance; the exact tolerance boundary is on time. Missing entry is awaiting until scheduled end, absent only afterward. Future days are upcoming. Approved full-day leave and configured holidays suppress late/absent. Rest and unscheduled days do not imply absence. Overnight schedules explicitly require manual review. The calendar never creates attendance timestamps or payroll hours.

Old shift_assignments migrate once to inactive reference drafts. No weekdays, rotations, end dates or past expectations are inferred from that incomplete legacy record. HR must create a full explicit schedule. POST/api/hr/assignment is retired with410; use POST/api/schedules. The original table remains historical reference. Drafts are never used in calendar calculations.

## Manual attendance and pause recovery

HR/admin can record confirmed complete historical visits in Fichadas → Carga manual RRHH. Entry/exit start empty and are entered in the device time zone, then sent as UTC instants. Current employee/site activation and site authorization are required. Entries must precede exits; exits cannot be future. The record is marked manual_hr/corrected, with authenticated actor/reason audit and no invented location/provider event.

Across all sites, half-open visit intervals cannot overlap. An open visit reserves all subsequent time; unknown exits reserve until the next entry or indefinitely. Adjacent intervals are allowed. Live ingestion rejects timestamps before any latest known complete/corrected exit; a historical manual insertion adds no provider event watermark.

Operación de RRHH → Pausas exposes Confirmar fin for unknown pause endings. A confirmed end must follow its start, remain within the known visit exit or next entry, avoid other pauses and not be future. Missing bounds require confirming the visit exit first. Exit corrections cannot truncate known pause starts/ends. Both corrections preserve original null observations in the audit. Supervisors cannot perform these writes, including for their own assigned team.

Calendars retain the first observed entry for unscheduled, rest, holiday and approved-leave days; suppressing an expectation never hides observed attendance.

## Period reports

Reportes uses its own explicit date/employee/site/status/name filters. Consultar reporte applies them; applied filters remain printed above both download links. GET /api/reports/summary, /api/reports/summary.csv and /api/export share the same validated selector and employee authorization before aggregation. Explicit inaccessible employee IDs return403. Invalid civil dates, reversed ranges, periods longer than366 days, invalid statuses and repeated/unknown query keys are rejected. Blank date filters intentionally include all stored history.

Overall, employee and site groups show visits, distinct Buenos Aires entry dates, measurable complete/corrected visits and known net hours, plus separate open visits, unknown exits and closed visits with unknown pause endings. Completed pauses are deducted once. Hours are summed without row rounding and rounded only for display/export; displayed row values can therefore have normal rounding differences from the total. Overnight visits belong wholly to their entry date, with no split or payroll calculation. Approved overtime minutes are separately reported, never automatically added to net hours.

Detail CSV and group summary CSV use the same applied filters as the JSON report. Summaries contain attendance data only, never account credentials, messages, events or audit payloads. Supervisor results contain only assigned employees.

## Operations preparation

The legacy build produces a runtime-only server, operator CLI and separate `dist-legacy` UI. See [the operations runbook](docs/OPERATIONS.md) for configuration, health, graceful shutdown, consistent backups, new-path restoration and replay quarantine. This does not activate hosting or Telegram. Run `node scripts/verify-production.mjs` after building to rehearse an isolated runtime-only installation.


## Attendance exception rules

Late/absence rules are initially disabled and operate only in the panel. Admin/HR enables them from server Buenos Aires today and chooses a priority. Activation periods are retained across disable/re-enable; historical days outside them do not create exceptions. No email, Telegram notifications or payroll penalties are generated.

The calendar is the evaluator: first entry across sites, shift snapshots/tolerance and approved full-day leave/holiday/rest exclusions remain authoritative. Absence begins only after the known shift end; overnight schedules require human calendar review. Acknowledgement records its first actor/time/reason and does not resolve an active condition. Actual changed attendance or expectations can resolve or reactivate the same employee/day/type identity; initial evidence and priority remain immutable.

Reconciliation runs durably in the application worker, one day and at most 100 employees per batch. A persisted range cursor catches up downtime longer than 93 days, while today is reevaluated periodically. Relevant mutations enqueue ranges in their transaction, including old exceptions while rules are off. Lists/counts and audit access respect assigned-employee supervisor scope; supervisors cannot change rules or acknowledge. The UI indicates pending reconciliation, so counts may change until affected work completes. This is eventual reconciliation, not a synchronous notification SLA.

## Local communications and onboarding instructions

Admin/HR can create local templates with immutable revisions, archive/restore them, and prepare drafts for all active employees, a sector or individual employees. Supported placeholders are `{{nombre}}`, `{{sedes}}`, `{{empresa}}` and `{{fecha}}`; declare the used names in the form. Unknown/undeclared placeholders fail validation. Content is plain text: pasted HTML is displayed literally, never executed.

Saving a draft invalidates its current preparation. Preparing freezes its revision, recipient IDs/names and rendered subject/body, while preserving earlier preparations. Repeated preparation of the same revision is idempotent. Existing snapshots do not change when employees or templates change. Explicit inactive recipients are rejected; all/sector selection omits inactive employees. Supervisors cannot access these APIs.

**Prepared does not mean sent, signed or provider-approved.** No communication operation queues Telegram messages or calls a provider. Telegram/email/both and signature requirement are planning metadata only. Existing phone-based draft templates are archived and incompatible drafts cannot be prepared; historical preparation snapshots remain intact. Email addresses, signatures, external dispatch and delivery tracking remain unimplemented.

HR's onboarding preview explains private Telegram linking, entry, exit, native location sharing, authorized sites and unknown-exit behavior. It does not create invitations, verify DNI/identity, obtain terms acceptance or complete employee onboarding.

## Employee Telegram HR commands

The receiver now supports `pausa`, `finpausa`, `ayuda`, `cancelar`, and a one-message leave request:

```text
solicitar licencia 17/09/2026 18/09/2026 | Vacaciones anuales | Viaje familiar confirmado
```

Requests remain pending for HR/supervisor review; employees cannot approve their requests or nominate another employee. Identity comes only from the active private Telegram link. HTTP and bot requests share civil-date validation and audited creation. Pause commands reuse the visit-bound service with entry/known-pause chronology checks; unknown endings still require HR confirmation.

Complete or explicitly cancel a pending attendance/location selection before HR commands. An exact authorized site name takes precedence, including a site named `Pausa`. `cancelar` discards only the pending attendance intention, not visits, pauses or leave requests. Help preserves the conversation.

Provider timestamps must exist, parse, be no later than the processing clock and no more than 15 minutes old. These guards cover entry, location and HR commands. Provider event time and original inbox receipt time are stored separately. Message identity, domain mutations, audit, persisted bot result, inbox status and reply outbox share the existing transaction; replay cannot repeat a successful effect.

The Simulador page also offers a local text conversation and simulated location sharing for an admin/HR-selected employee. Its pending namespace and persisted history are distinct from the provider conversation. It never creates provider inbox messages, messaging windows or outbox rows, even if external sending is later enabled. Records retain `simulator` provenance. These local paths do not verify real Telegram delivery or location authenticity.

## Private PDF receipt preparation

The **Recibos privados** page lets admin/HR create dated draft batches, upload a single-person PDF, assign or reassign an existing employee with an audited reason, download privately, and archive a batch without deleting bytes. Supervisors cannot access receipt APIs, downloads or receipt audit entries. Staging does not publish, send, sign or acknowledge a receipt.

Limits are 5 MiB and 40 pages per PDF, 20 PDFs / 50 MiB per batch and 256 MiB total including archived batches. The runtime `pdf-lib` parser runs in a separate worker with a 5-second deadline, two-validator concurrency limit and V8 heap limits (128 MiB old / 16 MiB young generation). This is structural validation, not PDF sanitization or an OS memory sandbox. Encrypted/malformed PDFs and ZIP files are rejected. Original immutable bytes, SHA256 and metadata are stored in SQLite and included in verified backups. Authenticated downloads are attachments with private/no-store and nosniff headers; opening an untrusted PDF still requires an appropriately secured viewer.

Development frontend serving now uses a filesystem allowlist with real-path checks and configured database/WAL/SHM exclusions. Keep private databases and backups outside frontend source directories and never use the development server as a production exposure boundary. The production build copies its parser worker next to the built server; `node scripts/verify-production.mjs` installs only runtime dependencies into an isolated fixture and uploads/downloads the fictional PDF to verify this path.

QA fixture: `tests/fixtures/recibo-ficticio-qa.pdf` explicitly contains fictional data and no signature or valid payroll amounts. Automatic mapping, ZIP import, employee portal/OTP, electronic signatures, QR verification and reminders remain unimplemented.

## HR catalog lifecycle

Shifts, sectors, tags, site categories and holidays now support revision-checked editing and soft archival with authenticated actor/reason audit. Existing schedule slots and communication preparations keep their original snapshots. Archived shifts cannot be newly scheduled; archived sectors/tags cannot receive new employee associations. HR can explicitly remove an association (including a sector membership); retained preparations are unaffected. Archived sectors are unavailable for new previews/preparations, while their saved preparation history remains readable.

Site category migration links only exact nonempty legacy labels and preserves their original `sites.category` text. Similar spellings are not merged. Current site labels derive the linked category ID; new assignments validate an active category ID. A site's existing archived category may remain during unrelated edits or be explicitly cleared. Use the categories editor in Operación de RRHH before assigning a category in Sedes. Migration is one-time and does not recreate explicitly cleared associations.

Holiday date correction archives the old row and creates a new date only if no row already exists there (including archived dates). Archival/correction transactionally enqueues attendance-exception reconciliation for the affected dates. Historical visit timestamps never change. Archive is intentionally one-way in this unit; retained records and audit history are not deleted. Manual weekly overrides are described below; automatic planning remains separate work.

## Manual weekly planning

**Plan semanal** adds explicit per-date overrides without replacing dated rotations: inherit the underlying rotation, rest, or a shift with an optional planned site. Current employee/day revisions are monotonic; returning to inherit retains a tombstone instead of deleting/resetting the revision. Append-only revision history stores the server-built shift/site label snapshots, authenticated actor, common reason and timestamp. Catalog edits/archives never rewrite these saved snapshots.

A week begins on a validated Monday. Admin/HR submit only changed cells, at most 50 distinct employees / 350 cells, in one transaction with expected revisions. Duplicate dates, out-of-week cells, stale versions, unauthorized/inactive sites or shifts and client-provided snapshots are rejected; all mutations/audits/reconciliation jobs roll back together. New planned sites must be currently authorized for the employee, but they are expectations only: every other authorized site remains valid for actual attendance. No visits, events, breaks or measured report hours are changed.

The existing calendar evaluator applies overrides before rotation fallback, then retains holiday/approved-leave suppression, first arrival across all sites, tolerance, future/end-of-day absence handling and explicit overnight review. Changed dates enqueue the same eventual exception reconciliation. Supervisor week totals/rows/history are scoped to assigned employees before pagination, and supervisors cannot save plans. The editor keeps pending changes visible, locks navigation during requests/pending changes, requires explicit discard, and reports conflicts without silently overwriting the loaded version.

## XLSX and PDF report files

Authenticated `/api/reports/summary.xlsx` and `.pdf` download the applied report snapshot, using the same employee authorization, filters and shared totals as JSON/CSV. Both dates are mandatory and the inclusive range is at most 366 days; history-only CSV remains available. SQL scopes and limits visits before dependent records, and uses the shared IANA Buenos Aires civil-day calculation, including historical daylight-saving offsets. Oversized results are rejected, never silently truncated.

Excel has four sheets: summary, employees, sites and detail. Metrics are numeric, timestamps are UTC date cells, Buenos Aires entry dates are separate, and labels are literal strings rather than formulas. Unknown hours are blank; zero remains numeric. PDF uses landscape A4, wrapped rows, repeated headers and page numbers. Its current Latin font supports Spanish accents; unsupported scripts return a clear 422 error recommending XLSX rather than silently corrupting labels. Approved overtime remains separate and neither export calculates payroll.

Rendering runs from an immutable read-transaction snapshot in a database-free worker: 10,000 detail rows for XLSX / 2,000 for PDF, 20 MiB output, 30-second deadline, one active worker per account and two globally, with V8 heap bounds and disconnect cleanup. These are application bounds, not an OS memory sandbox. Attachments are authenticated, private/no-store and nosniff. The runtime-only verification script exercises both compiled-worker exports with synthetic attendance. QA files under `tmp/reports` contain fictional data and are not production receipts.

## Telegram operator review

Admin/HR can inspect reception and outbound metadata in **Operación Telegram**, with status/review filters and 25-record cursor pages. Raw payloads, message bodies, locations, Telegram account IDs, provider identifiers and arbitrary error strings are not exposed by this endpoint. Employee names are linked only where the existing outbound employee ID safely identifies a registered record. Existing status represents the latest stored transport/provider delivery state; no last-attempt or delivery timestamp is invented.

Review annotations are append-only revisions with authenticated actor, reason and optimistic conflict checking, audited atomically. Reviewed or dismissed means reviewed/removed from human review only: it does not retry, cancel, requeue, edit attendance or release recovery holds. Existing automatic sender policy is unchanged; uncertain outcomes remain blocked from blind resend. The view explicitly refreshes and preserves pending forms on errors. Supervisors are denied before any operator lookup.
