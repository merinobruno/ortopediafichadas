# Local communications implementation plan

**Goal:** Let admin/HR maintain immutable local template revisions, edit communication drafts, prepare deduplicated recipient snapshots and preview employee attendance instructions without dispatch.

**Architecture:** Independent SQLite template/revision, campaign and preparation tables. A preparation freezes campaign revision, recipient identity/phone and rendered text; any edit invalidates the current preparation while retaining historical records. Nothing inserts into WhatsApp outbox. Routes explicitly deny supervisors. React renders plain text, never untrusted HTML.

**Scope:** Approved reference inventory group 3, local preparation only. Spanish professional UI; English implementation. No provider approval, live delivery, email storage, identity verification or digital signature implementation. Channel and signature intent are draft metadata with explicit unavailable integration labels.

## Contract decisions

- Supported variables: `{{nombre}}`, `{{telefono}}`, `{{sedes}}`, `{{empresa}}`, `{{fecha}}`. Declaration is a comma-separated supported-name list; unknown or undeclared placeholders fail validation. Content is plain text; pasted HTML remains literal escaped text.
- Templates have name, description, type (circular/notification/warning/memo/request/other), ordering, subject, body, variable declaration and signature intent. Updates append immutable revisions; archive is audited.
- Campaign recipient selection supports all active employees, active sector members or explicit employees. IDs deduplicate; nonexistent IDs fail; explicitly selected inactive employees fail instead of silently preparing them. All/sector selections omit inactive employees.
- Preparation is idempotent per draft revision. Edit uses expected revision and invalidates preparation. Snapshot remains unchanged after employee/template edits. Preparation is not authorization to send.
- `BOT_PUBLIC_NUMBER` is optional, validated international digits only. Onboarding preview includes authorized active sites and entry/exit/location/missing-exit instructions; it never reports identity verified or terms signed.

## Work

- [x] Add failing domain/API tests for revisions, render validation, recipients, snapshots, invalidation, audit rollback, role denial and unchanged outbox.
- [x] Implement storage and server module/routes; validate optional public number without exposing secrets.
- [x] Add Carahue communications workspace with templates, draft editor, recipient preview/preparation and onboarding instructions.
- [x] Normalize, test/build and document implemented versus pending capabilities.

## Verification

After normalization: `npm test` passed 63 tests (7 communications tests); `npm run build` passed TypeScript, Vite and server/CLI bundling. Communication tests cover template revisions/archive, strict variables and escaped preview, recipient deduplication/inactivity, immutable snapshots and draft invalidation, audit rollback, API role checks, explicit rejection of client provider-status claims, public-number validation and unchanged outbox. Parent owns browser QA and scoped read-only review.

## Scoped UI correction

The saved-draft preview request could finish after another editor change and restore a preview of old saved content. The communications workspace now uses a native disabled fieldset during every operation, covering editor inputs, tab/navigation controls and preparation actions through the delayed preview response. A DOM regression first failed on the editable subject while the request was pending, then verifies disabled controls, no premature preparation action and re-enablement with the saved revision. This adds jsdom only to development dependencies; the runtime-only artifact does not import it.

Scoped correction verification: 64/64 tests passed, full build passed, and `node scripts/verify-production.mjs` confirmed the runtime-only installation and recovery marker behavior after adding the DOM test dependencies. No source changes followed verification.

