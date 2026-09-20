# Carahue Attendance Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task.

**Goal:** Deliver a runnable HR workspace and shared WhatsApp/simulator attendance engine.
**Architecture:** React client consumes authenticated Express APIs; a pure attendance domain runs inside SQLite immediate transactions. Signed webhook inbox and queued outbox are durable. SQLite is a local single-process starting point; production PostgreSQL migration and operating requirements remain explicit.
**Tech Stack:** Node 24, TypeScript, React, Vite, Express, node:sqlite.
**Spec:** docs/superpowers/specs/2026-09-09-attendance-design.md

## Global constraints
Multiple visits each day, explicit intent, geofence and employee authorization, no invented departure, idempotent transitions, unknown intervals excluded from hours. Spanish UI, English code/docs. No live connection claims or external messaging without configuration.

## Tasks
- [x] Domain and persistence: create server/domain.ts, server/store.ts and tests/domain.test.ts. Tests use in-memory SQLite and applyAction(store, input); prove A entry/exit/B entry, missing exit, failed authorization, duplication, corrections. Run npm test red then green.
- [x] Transport and administration: server/app.ts + server/index.ts. Authenticated cookie sessions; employee/site CRUD, audit corrections, report CSV, simulator; signed WhatsApp inbox with explicit intent and durable pending state; persisted outbox kept queued without sending. Integration tests verify unauthorized API, login, webhook signature and persisted message restart behavior.
- [x] HR workspace: src/App.tsx, src/styles.css, index.html and vite.config.ts. Sidebar, dashboard, attendance filtering/export, staff/site editors, exception correction, reports and simulator. Functional controls, loading/empty/error states and responsive layout.
- [x] Normalize and verify: npm run format, npm test, npm run build. Launch local server for parent desktop/mobile inspection. README contains exact local commands and integration limitations; docs/ROADMAP.md tracks whole reference inventory.

No commits: directory is not a Git checkout and user requested product implementation.
