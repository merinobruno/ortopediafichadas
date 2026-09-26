# Telegram Convex Attendance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the deployed Convex/Vercel attendance app use private Telegram chats and one-time employee linking instead of Meta and phone numbers.

**Architecture:** Keep the existing attendance decision function and authenticated same-origin proxy. Add an HR-managed link service, verified Telegram webhook, durable update inbox, per-user ordered processor, and guarded `sendMessage` outbox; remove the Meta transport after Telegram paths work. The retained SQLite server is covered by the separate legacy plan and is not a dependency of this plan.

**Tech Stack:** TypeScript, Convex, Zod, React, Vitest/convex-test, Vercel proxy, Node 24+.

**Spec:** `docs/superpowers/specs/2026-09-26-telegram-attendance-design.md`

## Implementation progress (2026-09-26)

Tasks 1–5 are implemented in the local source and remain uncommitted pending
the integrated handoff. Test-first red cases were observed for the new link,
parser, ingress, processor, sender, operations, and UI boundaries. Final local
evidence: 13 basic test files/62 tests passed, TypeScript check passed, and
the Vite production build passed. The three new Vercel proxy routes have
explicit forwarding tests. The active schema preserves employee, site, and
attendance IDs; old transport state is isolated for a private bounded cleanup
that has not been run.

Rulings: a queued update records the exact link document identity at receipt
so revoke/relink to the same Telegram ID cannot reauthorize it. An unlinked
onboarding code update can still bind at processing. Deactivation revokes the
link and pending code/intent. Telegram retry_after is honored up to one hour;
larger rate limits require manual review instead of an early resend. The
legacy cleanup handles one table per invocation because Convex permits only
one paginated query per function execution.

Remaining external proof: bot provisioning, private environment configuration,
HTTPS webhook registration, private link/location/reply test, and production
send enablement. All Step 5 commits are intentionally pending the parent
integrated delivery; no live database mutation, deployment, or external
message was performed.

## Delivery record

The five planned per-task commits were consolidated into verified complete-runtime commit `f5e154f`. The checked commit steps refer to that single commit. Live Telegram setup, private cleanup and deployment remain pending.

## Global Constraints

- A Telegram **private** chat and stable numeric `from.id` identify the employee; username, contact and phone never do.
- Linking uses a random 10-character base32 code, stored only as a digest, valid for 15 minutes and usable once. HR/admin issue and revoke it; link uniqueness and revocation are atomic.
- An employee sends `entrada` or `salida`, then a location within five minutes. Preserve current freshness, future, strict attendance ordering, radius, and open-visit checks.
- Deduplicate by `update_id`; commit inbound before acknowledging. Per-sender ordering must not depend on scheduler order.
- Telegram token and independent webhook secret stay server-side. Only explicit, provably unsent failures retry; uncertain sends await human review.
- Preserve employees, sites, and attendance; do not replay or migrate WhatsApp inbox, pending, outbox, or delivery history.
- Product copy is Spanish for the Argentine client; technical artifacts are English. Do not add outbound campaigns or payroll behavior.

## File map and responsibilities

| Path | Responsibility |
| --- | --- |
| `convex/telegramLinks.ts` (new) | Code generation, digest, atomic consumption, uniqueness, revocation, attempt limits, and audit metadata. |
| `convex/telegramUpdate.ts` (new) | Strictly parse one supported private-chat Telegram update into a normalized event. |
| `convex/telegramMessages.ts` (new) | Durable update deduplication, sender-ordered processing, attendance result, and reply enqueue. |
| `convex/telegramSend.ts` (new) | Guarded Telegram API send and explicit/uncertain outcome classification. |
| `convex/telegramOperations.ts` (new) | Authenticated redacted transport status for HR/admin review; no message replay action. |
| `convex/schema.ts` | Link/code/audit/attempt tables and Telegram inbox/outbox; retain attendance and employee IDs. |
| `convex/http.ts`, `convex/data.ts` | Webhook route and authenticated HR API; employee records without required phone. |
| `src/BasicApp.tsx`, `src/basic.css` | Link status, one-time code reveal, revoke, no phone form/column, Telegram copy. |
| `convex/telegram*.test.ts`, `convex/backend.test.ts`, `src/BasicApp.test.tsx` | Security, idempotency, ordering, send outcomes, and UI regression. |
| `docs/BASIC-CONVEX.md`, `docs/ROADMAP.md` | Telegram setup/cutover and honest status. |

## Review Focus

1. A valid code submitted from a group or from a message whose `from.id` differs from private `chat.id` must not link; Task 2 pins this.
2. Two concurrent code submissions or one Telegram account targeting two employees must produce exactly one link; Task 1 pins this.
3. A location update scheduled before its earlier command, including equal Telegram `date` seconds, must still apply the command first; Task 3 pins this.
4. A queued update processed after HR revokes the account must not register attendance; Task 3 pins this.
5. A successful HTTP response with malformed Telegram JSON, or a timeout after sending, must not be treated as a safe retry; Task 4 pins this.

---

### Task 1: HR-issued links and code lifecycle

**Files:** Create `convex/telegramLinks.ts`, `convex/telegramLinks.test.ts`; modify `convex/schema.ts`, `convex/http.ts`, `convex/data.ts`, `convex/backend.test.ts`.

**Interfaces:** Consume the existing authenticated session hash used by `internal.data.saveEmployee`. Produce `issueLinkCode({hash:string,employeeId:Id<"employees">}): Promise<{code:string,expiresAt:number}>`, `revokeLink({hash:string,employeeId:Id<"employees">}): Promise<void>`, and the shared mutation helper `consumeLinkCode(ctx:MutationCtx,{codeHash:string,userId:string,chatId:string,now:number}): Promise<{employeeId:Id<"employees">}|null>` with an internal mutation wrapper for direct tests. Employee API data adds `telegramLinked:boolean`; validated safe integer Telegram IDs become decimal strings. HTTP routes: `POST /api/employees/link-code` body `{employeeId}`, `POST /api/employees/revoke-link` body `{employeeId}`.

- [x] **Step 1: Write failing tests.** In `convex/telegramLinks.test.ts`, use `convexTest(schema, import.meta.glob("./**/*.ts"))`; create two existing-format employees, issue a code, submit it concurrently from two accounts with `Promise.allSettled`, and assert one stored link. Cover repeat use, 15-minute expiry, revoked code, conflicting linked account, inactive employee, and five wrong attempts for one sender. A representative assertion is:

```ts
expect(await t.run(ctx => ctx.db.query("telegramLinks").collect())).toHaveLength(1);
expect(await t.mutation(internal.telegramLinks.consumeCode, { codeHash, userId: "8", chatId: "8", now })).toBeNull();
```

- [x] **Step 2: Confirm red.** Run `npx vitest run convex/telegramLinks.test.ts convex/backend.test.ts`; expect missing link function/table and old required-phone assertions to fail. Do not add production code before seeing the failure.
- [x] **Step 3: Implement the boundary.** Add `telegramLinks` indexed by employee and user ID, `telegramCodes` indexed by digest/employee, `telegramLinkAttempts` indexed by sender/window, and `telegramLinkAudit` with actor/action/time but no raw code. Generate 10 base32 characters with cryptographic random bytes in a Convex action, hash with SHA-256, and store via an internal mutation that rechecks active employee/session, invalidates prior codes, and sets `expiresAt=Date.now()+900_000`. `consumeCode` checks a private-chat-equivalent `userId===chatId`, atomically checks expiry/unused code and uniqueness, increments failed attempts in a 15-minute window, and consumes the code in the link transaction. `revokeLink` removes the active link, invalidates codes, and clears that employee's pending conversation. Reject new issue for a linked or inactive employee. Keep current phone fields compatible until Task 3 removes their consumers.

```ts
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const code = Array.from(crypto.getRandomValues(new Uint8Array(10)), b => alphabet[b & 31]).join("");
const codeHash = await sha256(code);
```

- [x] **Step 4: Confirm green.** Run `npx vitest run convex/telegramLinks.test.ts convex/backend.test.ts` and `npm run check`; expect all new cases to pass. Existing phone-based employee and bot paths remain until Task 3 changes them together.
- [x] **Step 5: Commit.** Stage only Task 1 paths and run `git commit -m "feat: add Telegram employee linking"`.

### Task 2: Verified Telegram ingress

**Files:** Create `convex/telegramUpdate.ts`, `convex/telegramInbox.ts`, `convex/telegramUpdate.test.ts`; modify `convex/http.ts`, `convex/schema.ts`, `convex/http.test.ts`.

**Interfaces:** Produce `parseTelegramUpdate(input:unknown): TelegramEvent | null`, where `TelegramEvent={updateId:number;messageId:number;userId:string;chatId:string;timestamp:number;kind:"text"|"location";text?:string;latitude?:number;longitude?:number}`. `null` means a valid but unsupported update. Produce internal `receiveTelegram({event:TelegramStoredEvent})` in `telegramInbox.ts`, where `TelegramStoredEvent` is `TelegramEvent` with plaintext linking text replaced by `codeHash`. Public route is `POST /webhook/telegram`; remove Meta routes in Task 3 when old worker is retired.

- [x] **Step 1: Write failing tests.** Test missing/wrong secret returns 401 before any database write; >1 MB returns 413; malformed JSON/invalid `update_id` returns 400; valid private text/location returns 200 and one durable inbox row; duplicate `update_id` creates no second row; group, channel, edited, forwarded, contact, and mismatched private sender/chat IDs have no attendance or link effect. Include this fixture:

```ts
const update = { update_id: 41, message: { message_id: 7, date: 1_790_000_000, from: { id: 8 }, chat: { id: 8, type: "private" }, text: "entrada" } };
const response = await t.fetch("/webhook/telegram", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "test-secret" }, body: JSON.stringify(update) });
expect(response.status).toBe(200);
```

- [x] **Step 2: Confirm red.** Run `npx vitest run convex/telegramUpdate.test.ts convex/http.test.ts`; expect missing route/parser failures.
- [x] **Step 3: Implement parsing and ingress.** Validate the secret in constant time, enforce body cap before parse, and use a strict Zod shape for supported `message` updates. Accept only `chat.type==="private"`, safe integer IDs, `from.id===chat.id`, finite date, and either bounded text or valid coordinate ranges. Ignore forwarded/contact updates; reject malformed supported updates with 400 and return 200 for other safely ignored types. Make `update_id` a unique indexed durable key and preserve both `timestamp` and `receivedAt`; acknowledge only after insertion transaction succeeds. In the HTTP action, replace `/start CODE` or standalone linking text with its SHA-256 digest **before** calling the Convex mutation, so neither mutation arguments nor inbox storage contain raw code. Task 3 connects processing and scheduling.

```ts
const event: TelegramEvent = { updateId: input.update_id, messageId: m.message_id, userId: String(m.from.id), chatId: String(m.chat.id), timestamp: m.date * 1000, kind: m.location ? "location" : "text", ...(m.text ? { text: m.text } : {}), ...(m.location ? { latitude: m.location.latitude, longitude: m.location.longitude } : {}) };
```

- [x] **Step 4: Confirm green.** Run `npx vitest run convex/telegramUpdate.test.ts convex/http.test.ts` and `npm run check`; expect accepted updates to persist once, invalid requests to leave inbox empty.
- [x] **Step 5: Commit.** Stage only Task 2 paths and run `git commit -m "feat: accept verified Telegram updates"`.

### Task 3: Linked attendance processing

**Files:** Create `convex/telegramMessages.ts`, `convex/telegramMessages.test.ts`; modify `convex/telegramInbox.ts`, `convex/telegramLinks.ts`, `convex/schema.ts`, `convex/http.ts`, `convex/data.ts`, `convex/core.ts`, `convex/backend.test.ts`; remove `convex/messages.ts` and `convex/whatsapp.ts` after their replacement tests pass.

**Interfaces:** Consume `TelegramEvent`, `telegramInbox.receiveTelegram`, and shared `consumeLinkCode(ctx,input)`; produce `processTelegram({id:Id<"telegramInbox">})` internal mutation and `telegramOutbox` rows `{chatId,text,status,attempts,providerMessageId?}`. The processor emits exactly one result and at most one reply for a unique `updateId`.

- [x] **Step 1: Write failing tests.** Use linked employee fixtures. Submit `entrada` then location within 300 seconds and assert one attendance event with original employee/site IDs; submit `salida` and assert same-site/radius and strict increasing time. Test location-only, expired intent, stale/future events, wrong site, duplicate update, link revocation between enqueue/process, worker processing location first, equal-second message ordering, and code `/start CODE` only in a private chat. Assert an unlinked or inactive sender cannot mutate attendance and no raw code enters inbox result/outbox.

```ts
await t.mutation(internal.telegramInbox.receiveTelegram, { event: command });
await t.mutation(internal.telegramInbox.receiveTelegram, { event: location });
await t.mutation(internal.telegramMessages.processTelegram, { id: locationInboxId });
expect(await t.run(ctx => ctx.db.query("attendance").collect())).toHaveLength(1);
```

- [x] **Step 2: Confirm red.** Run `npx vitest run convex/telegramMessages.test.ts convex/backend.test.ts`; expect missing processor and phone-dependent fixture failures.
- [x] **Step 3: Implement ordered processing.** Connect inbox scheduling to `processTelegram`. Drain pending rows for one `userId` in `(timestamp,updateId,messageId)` order inside a Convex mutation; reject old/future events using current 10-minute/1-minute limits and keep the 5-minute command window. Check the active link at processing time. `/start CODE` or a standalone code uses its stored digest with `consumeLinkCode`; never write raw code into result or reply storage. For linked commands and locations, retain `decideAttendance` rules and strict `timestamp > last attendance timestamp`. Queue a response in the same mutation as inbox/result and attendance changes. Remove phone indexes/API requirements, old Meta routes and obsolete Meta tables/actions only after tests use Telegram identity. Preserve existing employees, sites, attendance and historical IDs; old WhatsApp transport rows are ignored and not replayed.

```ts
const ordered = pending.sort((a,b) => a.timestamp-b.timestamp || a.updateId-b.updateId || a.messageId-b.messageId);
for (const row of ordered) await processOne(ctx,row);
```

- [x] **Step 4: Confirm green.** Run `npx vitest run convex/telegramMessages.test.ts convex/backend.test.ts convex/core.test.ts` and `npm run check`; expect all domain and ordering cases to pass.
- [x] **Step 5: Commit.** Stage only Task 3 paths and run `git commit -m "feat: process linked Telegram attendance"`.

### Task 4: Telegram replies and uncertain-send safety

**Files:** Create `convex/telegramSend.ts`, `convex/telegramSend.test.ts`; modify `convex/telegramMessages.ts`, `convex/schema.ts`.

**Interfaces:** Produce `sendTelegram({id:Id<"telegramOutbox">})` internal action, `claimTelegramSend({id,enabled})` mutation and `finishTelegramSend({id,status,providerMessageId?})` mutation. Config names: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_SEND_ENABLED`.

- [x] **Step 1: Write failing tests.** Stub `fetch`; disabled sends make no call, confirmed `{ok:true,result:{message_id:23}}` records `23`, explicit Telegram 429 `{ok:false}` retries with capped backoff/attempts, explicit permanent 4xx becomes failed, while 5xx, malformed 200 and thrown timeout become `review`. A persisted `sending` row is never automatically reclaimed. Assert a reply cannot target a revoked or changed chat.

```ts
expect(outbox.status).toBe("review");
expect(fetchMock).toHaveBeenCalledTimes(1);
```

- [x] **Step 2: Confirm red.** Run `npx vitest run convex/telegramSend.test.ts`; expect missing sender failures.
- [x] **Step 3: Implement sender.** Claim only a pending/eligible row whose employee link still matches `chatId`; set `sending` before network I/O. Use `POST https://api.telegram.org/bot${token}/sendMessage` with JSON `{chat_id:chatId,text}` and a 15-second timeout. Validate `ok===true` and integer `result.message_id` before marking sent. Retry only an explicit Telegram rate-limit rejection (`429`, `ok:false`) that proves no send occurred, at most five attempts with bounded backoff; store safe reason categories. Treat 5xx, timeout, malformed success body and interrupted `sending` as `review` requiring operator inspection, never blind resend. Keep attendance committed independently of sending.

```ts
const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: row.chatId, text: row.text }), signal: AbortSignal.timeout(15_000) });
```

- [x] **Step 4: Confirm green.** Run `npx vitest run convex/telegramSend.test.ts convex/telegramMessages.test.ts` and `npm run check`; expect no duplicate send after uncertainty.
- [x] **Step 5: Commit.** Stage only Task 4 paths and run `git commit -m "feat: send guarded Telegram confirmations"`.

### Task 5: HR interface, cutover, and full Convex proof

**Files:** Create `convex/telegramOperations.ts`, `convex/telegramOperations.test.ts`; modify `src/BasicApp.tsx`, `src/basic.css`, `src/BasicApp.test.tsx`, `docs/BASIC-CONVEX.md`, `docs/ROADMAP.md`, `convex/http.ts`, `convex/schema.ts`, `convex/backend.test.ts`; regenerate `convex/_generated/*` using Convex CLI if required by changed modules.

**Interfaces:** UI uses `POST /api/employees/link-code`, `POST /api/employees/revoke-link`, `GET /api/data` employee `telegramLinked`, and `GET /api/telegram-operations` returning recent `{updateId,status,receivedAt,reasonCode?}` and `{status,attempts,reasonCode?}` rows without payload, user/chat IDs or message text. These routes remain behind existing session/proxy/origin checks.

- [x] **Step 1: Write failing UI/cutover tests.** In `src/BasicApp.test.tsx`, save an employee without phone, issue code and see one-time code/expiry, reload and confirm code is absent, revoke and show unlinked state. Assert no phone field or WhatsApp copy. In `convex/backend.test.ts`, confirm `/api/data` has link status but no code digest/chat ID, and unauthenticated link routes return 401/403. In `convex/telegramOperations.test.ts`, check 25-row bound, authenticated access, redacted update/outbox metadata, and visibility of `review` without resend capability.

```tsx
expect(screen.queryByLabelText("Teléfono internacional")).toBeNull();
expect(screen.getByText("Telegram vinculado")).toBeTruthy();
```

- [x] **Step 2: Confirm red.** Run `npx vitest run src/BasicApp.test.tsx convex/backend.test.ts`; expect old phone UI and missing link controls to fail.
- [x] **Step 3: Implement UI and operating instructions.** Remove required phone input/column and all Meta labels from the deployed app. Show link status, issue/revoke actions with busy/error states, a one-time copyable code, and expiry without persisting the plaintext code in local storage. Add a small Telegram operations view backed by an authenticated, bounded, redacted status query; show uncertain sends for review without a resend button. Update `docs/BASIC-CONVEX.md` with private `TELEGRAM_*` configuration, `setWebhook` using HTTPS URL and `secret_token`, `allowed_updates:["message"]`, test link/location/send checks, cutover order, and no WhatsApp replay. Keep old attendance rows and employee/site records readable. Document that real Telegram connectivity requires a bot token, deployed HTTPS webhook, and an employee starting the bot; local tests do not prove it.

```tsx
const issued = await request("employees/link-code", { employeeId: employee._id });
setVisibleCode({ employeeId: employee._id, code: issued.code, expiresAt: issued.expiresAt });
```

- [x] **Step 4: Verify the independent deliverable.** Run `npm run test:basic`, `npm run check`, and `npm run build`; expect all pass. Run a focused repository search for active `WHATSAPP_`, `WhatsApp`, `Meta`, and `phone` references in `convex/`, `src/BasicApp.tsx`, and `docs/BASIC-CONVEX.md`; only explicitly historical text may remain. With nonproduction bot credentials, register the webhook and perform private linking, command, location, reply, duplicate-update, and revoked-link checks; record that live check as pending if credentials are unavailable rather than claiming it passed.
- [x] **Step 5: Commit.** Stage only Task 5 paths and run `git commit -m "feat: complete Telegram Convex cutover"`.
