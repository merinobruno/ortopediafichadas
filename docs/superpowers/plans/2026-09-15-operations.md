# Operational preparation

## Contract

Build a production server artifact that runs with Node24 and runtime dependencies only; dev Vite is dynamically imported. Validate port, production admin password and explicit WhatsApp sending config before storage/listen. Create the configured database parent, reject directories/URI/memory production paths. No secret logging or automatic env-file loading.

Public liveness/readiness return status only. Readiness checks DB, draining flag, worker last progress with a threshold longer than one20x15-second sender batch; it never implies a real Meta connection. SIGINT/SIGTERM stop new batches/rows, await the current worker/request and HTTP closure, then close DB exactly once.

Operator backup uses node:sqlite.backup from a read-only connection (WAL-consistent), refuses existing destinations and aliases, verifies integrity/FKs without migrations. Restore copies only to a new destination, revokes sessions, quarantines queued/in-flight outbox, pending inbox and intents. A durable recovery-required marker blocks application startup until an explicit operator acknowledgement; acknowledgement never requeues quarantined messages. Never write to source or a live destination.

Test only synthetic temporary databases; prove corruption/FK rejection, nooverwrite, sessions/queues recovery, worker drain/readiness/config redaction. Build and bootstrap in isolated runtime-only npm ci fixture on its own ephemeral port, never existing application ports.

## Steps

- [x] Tests config/lifecycle/backup behavior.
- [x] Runtime configuration, health/worker/shutdown, built server/start and operationsCLI.
- [x] .env.example and operational runbook with HTTPS, supervision, SQLite limits, backup/recovery/rollback.
- [x] Normalize, fulltest/build, isolated omitdev startup rehearsal, parent review.

## Verification evidence

- `npm test`: 46 tests passed, including configuration, redacted health, worker drain, in-flight sender stop, WAL restore preservation of attendance/audit, revoked sessions and quarantined replay state, corruption/FK checks and overwrite/alias refusal.
- `npm run build`: TypeScript check, Vite assets and built server/operator CLI succeeded.
- `node scripts/verify-production.mjs`: isolated `npm ci --omit=dev` without Vite/tsx, ephemeral-port production boot, nested DB creation, health/HTML and no password logging passed. Built CLI backed up the running synthetic WAL database and restored to a new path; a second process with sending enabled and synthetic complete provider settings was blocked by the recovery marker before listening/sending. The owned fixture was removed afterward.
- Parent ordinary backend review found no Important/Critical findings; independent focused operations/backup/WhatsApp tests passed.
- Windows process termination in the fixture is not proof of POSIX signal delivery: graceful in-flight behavior is exercised by lifecycle/sender tests and code inspection. Deployment supervision and live Meta behavior remain unverified.
