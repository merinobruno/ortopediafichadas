# Telegram Local Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the retained SQLite/Express app fully usable with Telegram identity, HR linking, attendance, HR bot commands, and a phone-free operator UI.

**Architecture:** Migrate the local SQLite model in place while preserving employee, site, visit, event, alert, and unrelated HR IDs. Replace the Meta webhook/worker with verified Telegram updates, an employee-ID-based bot conversation, and a guarded send queue. Keep the simulator local and isolated from provider inbox/outbox. This runtime is independently testable with `npm run test:legacy` and `npm run build:legacy`; it does not import or wait for the Convex plan.

**Tech Stack:** TypeScript, Node 24 `node:sqlite`, Express 5, Zod, React, Node test runner, esbuild.

**Spec:** `docs/superpowers/specs/2026-09-26-telegram-attendance-design.md`

## Implementation checkpoint

The phone-free SQLite migration, Telegram link/webhook/ordered worker/guarded sender, local HR UI, communications migration, backup quarantine and separate legacy Vite entry are implemented. The obsolete WhatsApp-only bot, sender and operations suites were replaced with Telegram behavioral checks; auth, immutable attendance, freshness, site, HR and reporting coverage was retained. A failed outbox-insert regression proves the sender transaction rolls back attendance and intent, then succeeds exactly once on retry.

Evidence: `npm run check` passed; basic suite 62/62 passed; complete serial legacy suite 115/115 passed before the new rollback test; focused worker suite 5/5 passed afterward. A real Vite bundle test passed with cloud 1589 modules including BasicApp but excluding legacy App, and legacy 1596 modules including App but excluding BasicApp. Final `npm run build` and `npm run build:legacy` both passed, producing distinct cloud and legacy assets plus the local server/ops bundles.

The planned per-task commits are being consolidated into one verified local runtime work unit by the parent. No commit is claimed here until that transaction completes. No deployment, live database cleanup, webhook registration or bot send was performed. Private bot provisioning, HTTPS deployment and live end-to-end checks remain pending.

The original checklist below is retained as planning history. This checkpoint records actual delivery status; unchecked red/commit steps are not claimed as observed or completed.

## Global Constraints

- Private Telegram `from.id` is the identity key and private `chat.id` is the reply destination; neither phone nor username authorizes a bot command.
- Codes are random 10-character base32, hashed at rest, single-use, and expire after 15 minutes. HR/admin issue/revoke; an active link is unique in both directions.
- Keep entry/exit, five-minute location intent, site authorization/radius, open-visit and unknown-exit behavior, existing 15-minute local event freshness, and timestamp chronology.
- Deduplicate by `update_id`, persist before HTTP 200, and process each sender's updates in deterministic order. Simulator IDs/pending/history remain separate from provider state.
- Retry only explicit proved-unsent failures; timeout, malformed success, interrupted sending and other uncertain outcomes require review.
- Preserve employee/site/attendance and unrelated HR data. Discard WhatsApp transport rows and never replay them to Telegram. Remove mobile number requirement and phone field from operator forms.
- Product copy is Spanish for the Argentine client. Communications stay preparation-only; no campaigns or new email/provider delivery.

## File map and responsibilities

| Path | Responsibility |
| --- | --- |
| `server/telegram-links.ts` (new) | HR code issuance/revocation, atomic binding, uniqueness, attempt limits, and audit. |
| `server/telegram-update.ts` (new) | Validate Telegram update and normalize private text/location events. |
| `server/telegram.ts` (new) | Durable inbound processing and guarded `sendMessage` queue worker. |
| `server/employee-bot.ts`, `server/domain.ts` | Employee-ID-based conversation and current attendance/HR commands. |
| `server/store.ts` | Link tables first, then transactional migration from phone-keyed transport tables; retain all attendance and HR rows. |
| `server/app.ts`, `server/index.ts`, `server/config.ts` | Telegram webhook/API, worker wiring, environment and readiness/cutover. |
| `server/telegram-operations.ts` (new) | Redacted queue metadata and review annotation; replaces WhatsApp operations routes. |
| `src/App.tsx`, `src/BotSimulator.tsx`, `src/TelegramOperations.tsx` (new), `src/Communications.tsx`, `src/Reports.tsx`, `src/ManualAttendance.tsx` | Phone-free linking/simulator and Telegram copy. |
| `server/communications.ts`, `.env.example`, `README.md`, `docs/OPERATIONS.md`, `docs/ROADMAP.md` | Phone-free draft/onboarding semantics and operator setup. |
| `tests/telegram*.test.ts`, `tests/employee-bot.test.ts`, `tests/api.test.ts`, `tests/communications.test.ts`, UI tests | Migration, security, bot, send and UI coverage. |

## Review Focus

1. Migrating an older SQLite file with dependent visits, receipts, assignments, and audit must retain those IDs and pass `PRAGMA foreign_key_check`; Task 3 pins this.
2. A group update or private update with sender/chat mismatch must not consume a code or create an attendance action; Task 2 pins this.
3. A simulated employee with no Telegram link must still use the local bot without writing provider inbox/outbox; Task 3 pins this.
4. A location committed after its command but encountered first by the worker must use the command, including equal provider seconds; Task 3 pins this.
5. A timeout or malformed Telegram success response must leave the queue uncertain and never be resent automatically; Task 4 pins this.

---

### Task 1: Local link lifecycle

**Files:** Create `server/telegram-links.ts`, `tests/telegram-links.test.ts`; modify `server/store.ts`, `server/app.ts`, `tests/api.test.ts`.

**Interfaces:** Produce `issueLinkCode(s:Store, employeeId:string, actor:string, now=Date.now()):{code:string;expiresAt:string}`, `consumeLinkCode(s:Store, codeHash:string, userId:string, chatId:string, now=Date.now()):{employeeId:string}|null`, `revokeLink(s:Store,employeeId:string,actor:string,now=Date.now()):void`, and `linkedEmployee(s:Store,userId:string):{id:string;chat_id:string}|null`. HR routes `POST /api/employees/:id/telegram-code` and `POST /api/employees/:id/telegram-revoke` return `Cache-Control: private, no-store`; the one-time code is returned only by issuance.

- [ ] **Step 1: Write failing tests.** Create two existing-format employees and test 15-minute code expiry, one-use consumption, wrong-code rate limit (five failures per sender per 15 minutes), conflicting link attempts, inactive employee, code revocation, and audit with no plaintext code. Test that only authenticated admin/HR can issue/revoke and that the one-time code is not returned by `GET /api/state`. The employee/phone and transport migration is tested and performed in Task 3 so this task stays independently runnable.

```ts
assert.equal(s.all("SELECT * FROM telegram_links").length, 1);
assert.equal(JSON.stringify(s.all("SELECT * FROM audit")).includes(code), false);
```

- [ ] **Step 2: Confirm red.** Run `npx tsx --test tests/telegram-links.test.ts tests/api.test.ts`; expect missing link-route failures.
- [ ] **Step 3: Implement linking.** Add new link/code/attempt tables in `Store` without yet changing the old phone-backed tables: `telegram_links(employee_id PRIMARY KEY REFERENCES employees(id),user_id UNIQUE,chat_id UNIQUE,linked_at)`, `telegram_codes(employee_id,digest,expires_at,issued_by,issued_at)`, and `telegram_link_attempts(user_id,window_start,count)`. Hash code with SHA-256, generate base32 with `randomBytes`, compare digests safely, and use `s.tx` for consume/revoke uniqueness checks. Revoke clears outstanding codes; Task 3 clears provider pending intent when it introduces that table. Use `res.locals.user.role` and existing authenticated actor; deny supervisor before link lookup. Avoid code/digest/chat ID in audit and routine API state. Existing WhatsApp paths remain until Task 3 makes the transport switch.

```ts
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const code = Array.from(randomBytes(10), b => alphabet[b & 31]).join("");
const digest = createHash("sha256").update(code).digest("hex");
```

- [ ] **Step 4: Confirm green.** Run `npx tsx --test tests/telegram-links.test.ts tests/api.test.ts` and `npx tsc --noEmit`; expect link tests to pass.
- [ ] **Step 5: Commit.** Stage only Task 1 paths and run `git commit -m "feat: migrate local employee links to Telegram"`.

### Task 2: Secure webhook and durable Telegram inbox

**Files:** Create `server/telegram-update.ts`, `tests/telegram-webhook.test.ts`; modify `server/app.ts`, `server/store.ts`, `server/config.ts`; remove Meta webhook in Task 3 when the old worker is retired.

**Interfaces:** Produce `parseTelegramUpdate(input:unknown):TelegramEvent|null` with `TelegramEvent={updateId:number;messageId:number;userId:string;chatId:string;timestamp:number;kind:"text"|"location";text?:string;latitude?:number;longitude?:number}`. The route `POST /webhook/telegram` persists a unique `update_id` and `received_at` in one transaction before returning 200. No `GET` verification route remains.

- [ ] **Step 1: Write failing tests.** Use `createApp(new Store(":memory:"))` and a real local HTTP test listener. Test absent/wrong `X-Telegram-Bot-Api-Secret-Token` 401 with zero writes; oversized JSON 413; malformed supported message 400; valid private command 200/one inbox row; duplicate update 200/still one row; group, channel, edit, contact, forwarded and mismatched sender/chat updates have no link or attendance effect. Assert `received_at` is stored separately from event `date`.

```ts
const update = { update_id: 92, message: { message_id: 2, date: 1_790_000_000, from: { id: 8 }, chat: { id: 8, type: "private" }, text: "entrada" } };
assert.equal((await fetch(url, { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "secret", "Content-Type": "application/json" }, body: JSON.stringify(update) })).status, 200);
```

- [ ] **Step 2: Confirm red.** Run `npx tsx --test tests/telegram-webhook.test.ts`; expect no Telegram route/parser.
- [ ] **Step 3: Implement ingress.** Validate webhook secret with `timingSafeEqual` before JSON processing; enforce 1 MB raw body cap. Require safe integer IDs, private chat, `from.id===chat.id`, finite date, bounded text or finite latitude/longitude in legal ranges. Ignore forwarded/contact/unsupported update types with 200; reject malformed supported types with 400. Insert `update_id` as the inbox primary key with normalized payload and `received_at`; duplicate insert becomes an idempotent 200. For `/start CODE` or standalone code, hash before insertion and store only the SHA-256 digest in a `code_hash` field, never plaintext in inbox, operation metadata, or logs. Keep the old Meta route until Task 3 retires its worker.

```ts
const event: TelegramEvent = { updateId: u.update_id, messageId: m.message_id, userId: String(m.from.id), chatId: String(m.chat.id), timestamp: m.date * 1000, kind: m.location ? "location" : "text", ...(m.text ? { text: m.text } : {}), ...(m.location ? { latitude: m.location.latitude, longitude: m.location.longitude } : {}) };
```

- [ ] **Step 4: Confirm green.** Run `npx tsx --test tests/telegram-webhook.test.ts tests/telegram-links.test.ts` and `npx tsc --noEmit`; expect accepted rows committed and all unauthorized/invalid cases empty.
- [ ] **Step 5: Commit.** Stage only Task 2 paths and run `git commit -m "feat: receive verified Telegram updates locally"`.

### Task 3: Phone-free local bot and ordered worker

**Files:** Create `server/telegram.ts`, `tests/telegram-worker.test.ts`; modify `server/employee-bot.ts`, `server/domain.ts`, `server/leaves.ts`, `server/app.ts`, `server/store.ts`, `server/index.ts`, `server/seed.ts`, `tests/employee-bot.test.ts`, `tests/domain.test.ts`, `tests/backup.test.ts`; remove `server/whatsapp.ts` when no imports remain.

**Interfaces:** Produce `processTelegramInbox(s:Store,clock:()=>number=Date.now):void`, `receiveEmployeeMessage(s:Store,m:BotMessage,source:"telegram"|"simulator",now?:number,actor?:string,receivedAt?:string):string`, `simulateEmployeeText(s:Store,employeeId:string,text:string,actor:string,now?:number)` and `simulateEmployeeMessage(s:Store,employeeId:string,content:BotContent,actor:string,now?:number)`. `BotMessage` contains `id:string`, `employeeId:string`, `userId?:string`, `chatId?:string`, `timestamp:number`, `kind:"text"|"location"`, and optional text/coordinates. `BotContent={kind:"text";text:string}|{kind:"location";latitude:number;longitude:number}`. No phone parameter survives.

- [ ] **Step 1: Write failing tests.** Link one active employee; enqueue entry and location, call worker twice, and assert one visit, two results/replies and no duplicate on restart. Enqueue location then process worker with rows committed out of scheduler order; assert `(timestamp,update_id,message_id)` ordering. Test equal-second updates, duplicate inbound, old/future timestamps, radius/site authorization, open visit at another site producing one unknown-exit alert, pause/leave/cancel/help behavior, and revocation between enqueue and processing. Run simulator for an employee with no link and assert local result/visit but zero Telegram inbox/outbox rows. Build a file-backed old SQLite fixture with visits, receipt, assignment, audit and WhatsApp pending/outbox; reopen it under `Store`, assert preserved IDs, empty Telegram queues and empty `PRAGMA foreign_key_check`.

```ts
processTelegramInbox(s);
assert.equal(s.all("SELECT * FROM visits").length, 1);
assert.equal(s.all("SELECT * FROM telegram_outbox").length, 2);
assert.deepEqual(s.all("PRAGMA foreign_key_check"), []);
```

- [ ] **Step 2: Confirm red.** Run `npx tsx --test tests/telegram-worker.test.ts tests/employee-bot.test.ts tests/domain.test.ts`; expect old phone identity and missing worker failures.
- [ ] **Step 3: Implement migration and bot/worker.** Add a versioned `Store` migration: create a phone-free `employees` table for fresh files; for old files rebuild employees with explicit columns and foreign keys off only during the rebuild, restore them afterward, and require empty `PRAGMA foreign_key_check` before startup. Replace phone-keyed pending/inbox/outbox tables and discard their old rows; preserve employee/site/visit/event/alert and unrelated HR IDs. Update `server/app.ts` employee create/update and `server/seed.ts` to use named phone-free columns. Resolve active employee by linked `userId` at processing time; `BotMessage.employeeId` is set server-side after lookup, never trusted from webhook JSON. Consume `/start CODE` or standalone code using a digest stored at ingress, without persisting plaintext code as a bot result or reply. For each sender, drain pending inbox rows in `(timestamp,update_id,message_id)` order in a single `s.tx`; preserve local 15-minute freshness and no-future guard, five-minute pending, exact site-name disambiguation and audited HR actions. Key pending by employee ID plus `telegram:` or `simulator:` namespace; key result by Telegram update ID or simulator UUID. Put inbox state, attendance/HR effect, result and outbox reply in one transaction. A rejected location consumes pending intent; storage failure rolls everything back. The simulator accepts employee ID and never creates provider inbox/outbox rows. Retire Meta routes and update `server/index.ts` to call this worker instead of WhatsApp.

```ts
const rows = s.all("SELECT * FROM telegram_inbox WHERE status='pending' ORDER BY user_id,event_at,update_id,message_id LIMIT 100");
for (const row of rows) processOneInTransaction(s, row, clock());
```

- [ ] **Step 4: Confirm green.** Run `npx tsx --test tests/telegram-worker.test.ts tests/employee-bot.test.ts tests/domain.test.ts tests/hr.test.ts` and `npx tsc --noEmit`; expect domain and simulator cases to pass.
- [ ] **Step 5: Commit.** Stage only Task 3 paths and run `git commit -m "feat: process Telegram attendance and HR commands"`.

### Task 4: Telegram sender and operator review

**Files:** Modify `server/telegram.ts`, `server/index.ts`, `server/config.ts`, `server/store.ts`; create `server/telegram-operations.ts`, `tests/telegram-send.test.ts`, `tests/telegram-operations.test.ts`; remove `server/whatsapp-operations.ts`.

**Interfaces:** Produce `sendTelegramOutbox(s:Store,fetcher:typeof fetch=fetch,env:NodeJS.ProcessEnv=process.env,clock:()=>number=Date.now,stopping:()=>boolean=()=>false):Promise<void>`. Routes `GET /api/telegram-operations` and `POST /api/telegram-operations/review` retain existing admin/HR-only 25-row pagination and append-only annotations; no raw IDs/body/location/code in response.

- [ ] **Step 1: Write failing tests.** Disabled sender makes zero requests. A confirmed `{ok:true,result:{message_id:22}}` marks accepted and records `22`. Explicit Telegram 429 `{ok:false}` retries with bounded backoff and max five attempts; explicit permanent 4xx fails. HTTP 5xx, timeout, malformed 200, and startup `sending` become `uncertain`, never re-enter queued on the next tick. Revoked/changed chat cannot receive queued reply. Operator list excludes `text`, chat ID, Telegram user ID and payload; supervisor gets 403; review annotation cannot send/requeue or change attendance.

```ts
await sendTelegramOutbox(s, fakeFetch, { TELEGRAM_SEND_ENABLED: "true", TELEGRAM_BOT_TOKEN: "test" });
assert.equal(s.one("SELECT status FROM telegram_outbox WHERE id='reply-1'").status, "uncertain");
```

- [ ] **Step 2: Confirm red.** Run `npx tsx --test tests/telegram-send.test.ts tests/telegram-operations.test.ts`; expect missing sender/routes.
- [ ] **Step 3: Implement sender/ops.** Before network I/O, atomically claim queued row as `sending` and recheck active link/chat. POST JSON `{chat_id,text}` to `https://api.telegram.org/bot${token}/sendMessage` with 15-second timeout; accept only `ok===true` with integer `result.message_id`. Retry only an explicit Telegram 429 `{ok:false}` rejection, at most five attempts with bounded delay; redact error strings. HTTP 5xx, timeout, parse failure after 200, and interrupted `sending` become `uncertain`, not queued. Preserve worker stop/drain behavior in `server/index.ts`. Rename operations endpoints/component contract, retaining scoped metadata and immutable human review annotations. Replace `WHATSAPP_*` configuration with `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_SEND_ENABLED`; sending requires all three configured.

```ts
const response = await fetcher(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: row.chat_id, text: row.text }), signal: AbortSignal.timeout(15_000) });
```

- [ ] **Step 4: Confirm green.** Run `npx tsx --test tests/telegram-send.test.ts tests/telegram-operations.test.ts tests/operations.test.ts` and `npx tsc --noEmit`; expect all pass and no automatic resend of uncertain rows.
- [ ] **Step 5: Commit.** Stage only Task 4 paths and run `git commit -m "feat: send Telegram replies with operator review"`.

### Task 5: Local HR UI, communications, and cutover proof

**Files:** Modify `src/App.tsx`, `src/BotSimulator.tsx`, `src/Communications.tsx`, `src/Reports.tsx`, `src/ManualAttendance.tsx`, `server/communications.ts`, `server/app.ts`, `server/seed.ts`, `.env.example`, `README.md`, `docs/OPERATIONS.md`, `docs/ROADMAP.md`, `tests/api.test.ts`, `tests/communications.test.ts`, `tests/communications-ui.test.ts`, `tests/operations.test.ts`; create `src/TelegramOperations.tsx`; remove `src/WhatsAppOperations.tsx`.

**Interfaces:** UI uses employee `telegram_linked` status and the Task 1 code/revoke routes; simulator posts `{employeeId,text}` or `{employeeId,latitude,longitude}`. Communications remain drafts/preparations only: `channel` becomes `telegram|email|both` metadata, `telefono` placeholder is removed, and no provider outbox is written.

- [ ] **Step 1: Write failing tests.** In API/UI tests, save a new employee without phone, display link status, issue code once, confirm code disappears on reload, revoke and confirm unlinked; supervisor cannot issue or see code. Simulator uses employee ID with no Telegram account. Communications preparation has no `telefono` variable or phone snapshot; draft preparation stays local and never writes Telegram outbox. Assert no visible WhatsApp/Meta labels in active screens.

```ts
assert.equal(s.one("SELECT COUNT(*) n FROM telegram_outbox").n, 0);
assert.equal((await request.post("/api/employees").send({ name: "Ana", role: "Empleado", site_ids: ["a"], active: 1 })).status, 200);
```

- [ ] **Step 2: Confirm red.** Run `npx tsx --test tests/api.test.ts tests/communications.test.ts tests/communications-ui.test.ts`; expect phone-dependent API/UI failures.
- [ ] **Step 3: Implement UI/copy and operations handoff.** Replace phone input/column in `src/App.tsx` with linked/unlinked status plus issue/revoke controls; display the code only in the current response and its expiry. Rename operation page/component and route to Telegram. Pass employee IDs to simulator. Remove `BOT_PUBLIC_NUMBER`, phone-based onboarding previews and `telefono` placeholder; migrate old draft channel values to Telegram metadata without sending, or mark old snapshots historical and nonselectable. Update report/manual labels, `.env.example`, `README.md`, `docs/OPERATIONS.md`, and `docs/ROADMAP.md` for bot creation, HTTPS webhook registration with `secret_token` and `allowed_updates:["message"]`, private setup, nonproduction link/location/send test, no WhatsApp replay, and explicit distinction between process health and Telegram connectivity.

```tsx
const response = await fetch(`/api/employees/${employee.id}/telegram-code`, { method: "POST", credentials: "same-origin" });
setVisibleCode(await response.json());
```

- [ ] **Step 4: Verify the independent deliverable.** Run `npm run test:legacy`, `npm run check`, and `npm run build:legacy`; expect pass. Search active `server/`, `src/`, `.env.example`, `README.md`, and operations docs for `WHATSAPP_`, `WhatsApp`, `Meta`, `BOT_PUBLIC_NUMBER`, `telefono`, and phone identity; resolve active uses while allowing historical documentation. Run file-backed migration/backup/restore tests and `PRAGMA foreign_key_check`. With nonproduction bot credentials, register the Telegram webhook and test private linking, attendance location, confirmation, duplicate update, revoked link, and operator uncertainty; if credentials are unavailable, record live verification as pending.
- [ ] **Step 5: Commit.** Stage only Task 5 paths and run `git commit -m "feat: complete local Telegram cutover"`.
