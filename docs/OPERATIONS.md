# Operating Carahue

This is preparation for a single-instance deployment, not a live deployment. Node 24+, a local persistent disk and one process per database are required. PostgreSQL, multi-instance workers, managed hosting and live Telegram onboarding remain outstanding.

## Build and start

On a build machine run `npm ci` and `npm run build:legacy`. Copy `build/`, `dist-legacy/`, `package.json` and `package-lock.json` to a release directory. There run `npm ci --omit=dev` and `npm start` with environment variables supplied by the supervisor. Vite and tsx are not production dependencies. `node scripts/verify-production.mjs` rehearses this installation in an isolated temporary directory after a build.

Use `.env.example` as a template for a private configuration file. No dotenv loader runs automatically. Node can load a chosen file explicitly with `node --env-file=/private/carahue.env build/server.mjs`. Set `NODE_ENV=production`, `DEMO_MODE=false`, a strong unique `ADMIN_PASSWORD` (at least 12 characters), and `ADMIN_EMAIL`. Credentials bootstrap only the first account; later password changes use the Accounts screen. Do not log or commit secrets. Keep `TELEGRAM_SEND_ENABLED=false` until the private bot and webhook are deliberately activated and tested. Complete Telegram settings are required when sending is explicitly enabled; their presence does not prove connectivity.

Run from the release directory. `DATABASE_PATH` must be a persistent local file, preferably an absolute path outside release folders. Its parent is created. Do not use a network share or ephemeral container layer. Restrict database, WAL, configuration and backups to the service/operator accounts using OS permissions. Use encrypted storage and transport for backups; the CLI does not configure ACLs or encryption.

Bind to loopback behind a trusted HTTPS reverse proxy. Forward `X-Telegram-Bot-Api-Secret-Token` unchanged. Register the HTTPS `/webhook/telegram` endpoint with Telegram `setWebhook`, its independent `secret_token`, and `allowed_updates:["message"]`. Keep the bot token out of URLs in logs and shell history. Authenticate administration with HTTPS and consistent host/origin forwarding. No real provider messages are sent during automated tests.

## Health and shutdown

`GET /health/live` returns only `{"status":"live"}`. `GET /health/ready` returns `ready` or HTTP 503 `not_ready`; it checks SQLite access, worker progress and draining. Readiness permits ten minutes between worker completions, allowing a twenty-message batch with fifteen-second request timeouts. This is process health, not proof of Telegram delivery. Monitor queue age and failures separately through authorized operations and alert externally on unavailable health endpoints.

Use a supervisor with automatic restart and a shutdown grace period of at least six minutes. SIGINT/SIGTERM stops admission of new HTTP work and worker batches, prevents another outbound row, waits for the current request/worker and HTTP connections, then closes SQLite. Repeated signals share the same shutdown. An interrupted `sending` row becomes `uncertain` on startup; never blindly resend it. Check provider records before deciding whether a human follow-up is required. Provider acceptance is distinct from delivery. Windows process termination may be a hard kill; use a service manager capable of graceful shutdown where possible and rely on startup uncertainty handling after a hard stop.

## Backup and restore rehearsal

Use the built CLI (paths below are illustrative):

```sh
node build/ops.mjs backup /private/live.sqlite /private/backups/snapshot-001.sqlite
node build/ops.mjs verify /private/backups/snapshot-001.sqlite
node build/ops.mjs restore /private/backups/snapshot-001.sqlite /private/rehearsal/restored.sqlite
```

Backup uses SQLite's online backup API for a consistent WAL snapshot. Never copy only a live `.sqlite` file manually. Destination paths must not exist: source aliases, existing files and overwrite attempts are refused. Verification opens read-only without migrations and requires `integrity_check=ok` and no foreign-key violations. A temporary verified database is published atomically without replacing another file. Failed operations may leave a private temporary file after a process/OS crash; inspect before removing it.

Restore always creates a NEW path; it never replaces the running database. The temporary copy is migrated to the phone-free schema before publication. It preserves employee, site, attendance, audit, receipt and unrelated HR records; invalidates sessions and unused link codes; clears pending conversation intentions; and quarantines pending Telegram inbox and queued/sending outbox rows as `recovery_hold`. A recovery marker blocks startup even if sending was accidentally enabled in the environment. Stop the service before switching paths. Inspect the restored data offline, reconcile uncertain messages against provider records, and retain the original database and backup.

After that review, acknowledge the marker offline:

```sh
node build/ops.mjs acknowledge-recovery /private/rehearsal/restored.sqlite
```

Acknowledgement does NOT release quarantined messages or intentions. There is no automatic replay or bulk requeue command. Point `DATABASE_PATH` at the reviewed new file, explicitly keep sending disabled, start, sign in again and verify attendance/report counts against the snapshot. Arrange fresh employee messages instead of replaying historical confirmations. Enable sending only after the intended recovery cutover and provider reconciliation. Rehearse recovery on synthetic data before handling operational backups; periodically test a private backup without contacting Telegram.

## Release rollback

Stop the process gracefully before changing releases. Keep each release immutable with its build artifacts and lockfile. Capture a verified backup before migrations. Roll back code only when its schema compatibility has been checked; otherwise restore to a new database path using the recovery procedure, accepting that records after the snapshot need reconciliation. Do not copy an older database over the active file or its WAL. Keep the restored sender disabled until reviewed. No automatic migration downgrade is provided.

## Receipt storage and private downloads

Receipt PDF bytes are SQLite BLOBs; back up the database using the documented WAL snapshot procedure, never copy only a live main file. The 256 MiB application PDF quota includes archived documents; archival is not erasure or a retention policy. Budget additional disk for SQLite/WAL and private snapshots. Do not place backups or database files under frontend `src`, `shared`, `node_modules` or production `dist`, and apply OS access control and encrypted storage at deployment.

`build/pdf-validator-worker.mjs` is a required production artifact copied by `npm run build:legacy`; retain it together with `build/server.mjs` and runtime dependencies. Two isolated parser workers are allowed, each with a 5-second deadline and V8 heap caps. These are bounded application controls, not malware removal or hard process-wide RSS isolation. Downloads preserve original bytes and require an authenticated admin/HR session. A download audit records HR access only, never employee receipt or signature. No public PDF URL exists.

The development server's private-file guard was tested with synthetic HEAD requests (direct, encoded and `/@fs/` URLs, plus a custom database path/WAL/SHM). No real private file was requested. Production must use the built server behind HTTPS; development protection is defense in depth, not deployment approval.
