# Approved basic attendance application

The approved scope replaces the expanded HR frontend with administrator login,
Employees, Sites, Attendance, and logout. Legacy source and local data remain
available; no legacy database is read or migrated. Every active employee can
enter any active site within its radius. Exit must use the same site as entry.
WhatsApp requires an explicit `entrada` or `salida`, followed by location.

React/Vite is hosted on Vercel. Its same-origin serverless API proxies to Convex
HTTP actions. Administrators use private provisioning, scrypt passwords and
eight-hour opaque sessions stored as hashes. Browser mutations require matching
origin; cookies are Secure, HttpOnly and SameSite=Strict. All data operations
require an active administrator session. No public signup exists.

Verified Meta messages enter a durable deduplicated inbox before processing.
Attendance records are immutable with historical name snapshots. Stale events,
out-of-order events, invalid locations and invalid attendance transitions fail
closed. Replies use a durable outbox; uncertain sends require manual review.
Sending is disabled unless WHATSAPP_SEND_ENABLED is explicitly true.

## Progress

- Implemented the focused Spanish frontend, secure proxy, private administrator
  bootstrap, authenticated catalogs, immutable attendance, signed webhook and
  durable inbox/outbox. No old HR route is imported into the frontend bundle.
- Verified locally: 31 basic tests (including real convex-test transactions and
  HTTP actions), 113 existing tests, TypeScript and production Vite build.
- Production deployment created: blissful-cheetah-426. Development deployment:
  amicable-bat-774 (carahuefichadas project).
- Parent confirmed production Vercel `CONVEX_SITE_URL` and `APP_ORIGIN`, and
  production Convex `APP_ORIGIN` and `WHATSAPP_SEND_ENABLED=false` are saved.
- External setup still pending: authorized deployment credentials, shared proxy
  secret, code publication, private administrator provisioning and Meta setup.

## Operational handoff

No cloud deployment or Git push is performed by this implementation work unit.
The parent owns account configuration and deployment. Vercel currently uses
Hobby; confirm an appropriate commercial plan before business production use.
No subscription or billing changes were made.

### Configuration

Vercel server-side environment (never prefix secrets with `VITE_`):

| Name              | Value                                                   |
| ----------------- | ------------------------------------------------------- |
| `CONVEX_SITE_URL` | `https://blissful-cheetah-426.convex.site`              |
| `APP_ORIGIN`      | Exact public application origin, without trailing slash |
| `PROXY_SECRET`    | A new random secret shared only with Convex             |

Convex environment:

| Name                       | Purpose                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| `APP_ORIGIN`               | Same exact application origin as Vercel                                                      |
| `PROXY_SECRET`             | Same server-only proxy secret as Vercel                                                      |
| `WHATSAPP_APP_SECRET`      | Meta app secret for raw-body HMAC verification                                               |
| `WHATSAPP_VERIFY_TOKEN`    | Privately chosen webhook verification token                                                  |
| `WHATSAPP_PHONE_NUMBER_ID` | Only this Meta phone account is accepted                                                     |
| `WHATSAPP_SEND_ENABLED`    | Keep `false` until authorized end-to-end send testing                                        |
| `WHATSAPP_ACCESS_TOKEN`    | Meta token, only needed for enabled sends                                                    |
| `WHATSAPP_GRAPH_VERSION`   | Explicit supported Meta Graph version selected in the app dashboard; confirm before enabling |

`CONVEX_DEPLOY_KEY` is a private CLI/build credential, not an application setting
and not a browser variable. Existing legacy `ADMIN_PASSWORD`, database and HR
environment variables are not read by this implementation. No demo password or
public signup exists.

### Build and deploy

1. `npm ci`
2. `npm run test:basic`, `npm run test:legacy`, `npm run build`
3. With authorized Convex credentials selecting the intended deployment, run
   `npx convex deploy` (production) or `npx convex dev --once` (development).
4. Deploy the same source branch to the existing Vercel project; build command
   `npm run build`, output `dist`, Node 24. Its only function is
   `api/[...path].ts`, exposing login/logout/data/employees/sites.
5. Check login, CRUD, session expiry, and signed inbound WhatsApp behavior before
   any production handoff. Meta callback URL is
   `https://blissful-cheetah-426.convex.site/webhook`, subscribing to messages.

The committed Convex `_generated` files were produced by the installed Convex
CLI, using its offline `codegen --system-udfs --typecheck disable` generator after
the normal command could not authenticate. Regenerate using the standard
`npx convex codegen` when deployment credentials are available; never hand-edit
generated files. No components or cloud state are required for the local tests.

`npm run dev` previews the new frontend only. Use `npx vercel dev` with the
project's private environment configuration for the complete same-origin API
locally (the secure cookie requires HTTPS; use the deployed HTTPS preview for
authentication testing). `npm run dev:legacy` and `npm run build:legacy` retain
the old server tooling. Neither is used in the cloud deployment. Legacy source
and local databases are preserved; this work did not inspect local database
contents or migrate legacy records.

### First administrator

After deploying Convex, the owner uses the authenticated Convex Dashboard
function runner for the **internal** action `auth:bootstrapAdmin`, providing
their own `email` and a unique password of 14–128 characters. The action refuses
if any administrator already exists; it saves a random salted scrypt hash and
returns only `{created:true}`. Alternatively an authorized private CLI operator
can invoke that internal action with `npx convex run --prod auth:bootstrapAdmin`
and privately supplied arguments. Prefer the dashboard to avoid a password in
shell history. Do not paste credentials into issues, commits, or chat.

Admin deactivation is a private Convex data operation: set `admins.active=false`;
all associated sessions immediately fail authorization. No account management
or password reset UI is included in this approved basic scope.

### Attendance and recovery contract

- Register international phones with country code. Formatting is stripped;
  the result must match Meta's `from` value. Argentina mobile numbers commonly
  include `549`. No national-number guessing or old employee import occurs.
- Send `entrada` or `salida`, then current WhatsApp location within 5 minutes.
  Accepted events must be within 10 minutes of receipt, no more than 1 minute
  in the future, and not older than the sender's latest processed event.
  Command and location may share a Meta timestamp second. Recorded attendance
  itself must advance strictly, preventing zero-time or reordered movements.
- Per-sender pending messages are drained in timestamp order in one transaction
  even if scheduled workers run out of order. Duplicate Meta IDs cannot produce
  another inbox row, attendance event, or reply.
- Entry chooses the nearest active site containing the location (stable ID tie
  break). Exit uses the open entry site and must remain within its active radius.
  Deactivating or moving an open entry's site can therefore prevent exit; an
  operator must restore the valid site configuration before a fresh exit.
- Rejected events consume the pending intent; send a fresh command and location.
  Unknown/inactive phones are recorded as rejected without sending a reply.
- `inbox` stores status/result. `outbox` stores pending/disabled/sending/sent/
  review/expired. A reply expires from its inbound timestamp before the 24-hour
  messaging window. Network uncertainty is `review`, and a crash after claim
  can leave `sending`: inspect Meta delivery externally before taking any manual
  action. Neither state is blindly retried. Disabled replies remain disabled.
- The UI shows the latest 1,000 immutable movements; data remains in Convex.
  History keeps employee/site names at recording time. No deletion, correction,
  payroll, schedules, HR requests, or local simulator is exposed in the basic UI.

References: [Convex HTTP actions](https://docs.convex.dev/functions/http-actions),
[convex-test](https://docs.convex.dev/testing/convex-test),
[Vercel Node functions](https://vercel.com/docs/functions/runtimes/node-js).
