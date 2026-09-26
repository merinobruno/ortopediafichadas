# Basic Convex attendance: Telegram cutover

The Vercel basic app and Convex backend now implement private Telegram linking
and attendance. The retained SQLite server has its own migration plan. Local
tests do not contact Telegram or configure a live webhook; deployment and
activation steps are below.

Administrators create employees without phone numbers and issue a 10-character,
single-use code valid for 15 minutes. They show it once to the employee, who
starts a private bot chat and sends the code or /start CODE. A linked employee
sends entrada or salida, then a current Telegram location within five
minutes. The app shows linked status and redacted transport operations.

## Private configuration

Vercel server-side environment:

| Name            | Purpose                                     |
| --------------- | ------------------------------------------- |
| CONVEX_SITE_URL | Intended deployment's HTTPS Convex site URL |
| APP_ORIGIN      | Exact HTTPS application origin              |
| PROXY_SECRET    | Shared private proxy secret                 |

Convex environment:

| Name                    | Purpose                                                    |
| ----------------------- | ---------------------------------------------------------- |
| APP_ORIGIN              | Same exact application origin                              |
| PROXY_SECRET            | Same shared private proxy secret                           |
| TELEGRAM_BOT_TOKEN      | Private credential for this environment's bot              |
| TELEGRAM_WEBHOOK_SECRET | Independent random secret sent as Telegram secret_token    |
| TELEGRAM_SEND_ENABLED   | Keep false until end-to-end testing; set true deliberately |

Never prefix these secrets with VITE_ or place them in browser storage,
source, logs, issues, or chat. The bot username may be shared with employees;
the bot token and webhook secret may not. The former Meta/WhatsApp settings are
unused by the Convex path.

## Safe deployment sequence

1. Back up or export the employee, site, and attendance collections under the
   deployment's normal recovery procedure. Confirm the intended Convex
   deployment and Vercel project. Disable the old Meta webhook before cutover.
2. Deploy the Convex schema/functions and matching Vercel UI/proxy together.
   The employee phone field remains optional so old documents and IDs are
   readable. Old inbox/outbox tables remain defined solely for private
   cleanup; no old message is replayed or sent to Telegram.
3. Set the private Telegram values in the intended Convex environment, with
   TELEGRAM_SEND_ENABLED=false. In the authenticated Convex Dashboard function
   runner for that deployment, run the **internal**
   `telegramSetup:webhookStatus` action with
   `{"expectedUsername":"OrtopediaFichadas_bot"}`. Then run the **internal**
   `telegramSetup:registerWebhook` action with the same argument and run status
   again. Both actions verify the bot identity. Registration uses only this
   deployment's built-in `CONVEX_SITE_URL` plus `/webhook/telegram`, the
   independent `secret_token`, `allowed_updates:["message"]`, and preserves
   pending updates. The result reports a match and pending count without
   exposing the URL, token, secret, or Telegram error text. A matching status
   cannot verify the secret token; registration must return `registered` to
   confirm Telegram accepted it. If registration returns
   `registration_unconfirmed`, check status and investigate privately before
   another attempt because the first request may have succeeded. A private CLI
   operator can use the following commands after selecting the correct
   deployment:

   ```powershell
   npx convex run --deployment blissful-cheetah-426 telegramSetup:webhookStatus '{"expectedUsername":"OrtopediaFichadas_bot"}'
   npx convex run --deployment blissful-cheetah-426 telegramSetup:registerWebhook '{"expectedUsername":"OrtopediaFichadas_bot"}'
   ```

   Never place the bot token or webhook secret in command arguments, shell
   history, or logs.

4. In nonproduction, create a test employee, issue a code, start the bot in a
   private chat, and verify one-time linking. Send entrada and a location
   within five minutes, then salida and a location. Confirm the same
   employee/site IDs, one event per update, and rejected group, duplicate,
   stale, and revoked-link updates. Check the redacted operations screen.
5. Enable outbound sending in nonproduction and confirm Telegram responses
   arrive. Verify confirmed message_id storage. Test an explicit 429 retry
   and an uncertain result staying in review without automatic resend.
   Only then enable production sending and repeat a production test employee
   flow. Existing employees must start the bot and link before it can reply.
6. After the old webhook is off and the new path is stable, a deployment
   operator may invoke the internal telegramCleanup:clearLegacyTransport
   mutation privately, one table phase per call with limit at most 100.
   Drain inbox and outbox with repeated calls until done is true.
   Sweep employees and conversations with the returned cursor until
   done is true. This removes old phone values and pending transport state
   while preserving employee, site, and attendance IDs and historical facts.
   Do not perform this cleanup during deployment or replay the old rows.
   Review counts first; no cleanup was run in this work unit.
   Once all legacy counts are zero and verified, a later schema release may
   remove the empty legacy tables and optional phone field.

## Processing and recovery

The webhook checks X-Telegram-Bot-Api-Secret-Token before parsing or writing,
rejects bodies over 1 MB, and acknowledges only after the unique update_id
is committed. Only original private messages whose numeric sender and chat IDs
match can link or affect attendance. Link codes become SHA-256 digests before
the inbox mutation and are never stored in plaintext. A code cannot be reused.
Repeated guesses are limited per sender. HR revocation invalidates codes and
pending intent.

The worker drains each sender's committed updates in event time, update ID,
then message ID order, including equal-second command/location pairs. A
pre-revocation update records the exact link identity at receipt; relinking to
the same Telegram ID cannot authorize it. Locations alone do not create
attendance. Events older than 10 minutes or more than 1 minute in the future
are rejected. The final attendance timestamp must strictly increase; entry,
exit, active site, and radius rules remain in decideAttendance.

A reply is queued in the same transaction as processing. The sender checks
that the exact link is still active before network I/O. Confirmed Telegram
success records the returned numeric message ID. Only an explicit Telegram
429 with ok:false retries, up to five attempts with bounded backoff.
Timeouts, 5xx responses, malformed success bodies, and interrupted sending
rows require operator review. The operations screen shows only bounded
status, times, attempt counts, update IDs, and safe reason codes. It cannot
resend. Attendance remains recorded if its confirmation is uncertain.

## Local verification

Run npm run test:basic, npm run check, and npm run build. These check
local code, not Telegram connectivity. The actual webhook and bot response
require private bot credentials and a deployed HTTPS endpoint. No live
end-to-end verification is claimed by this source change.

## Administrator bootstrap, sessions, and proxy

The Vercel serverless API proxies same-origin requests to Convex HTTP actions.
Its allowlist includes login, logout, data, employee, site, Telegram link, and
redacted operation endpoints. Browser mutations require the matching
`APP_ORIGIN`. Cookies are Secure, HttpOnly, and SameSite=Strict; opaque
administrator sessions expire after eight hours. There is no public signup.

After deploying Convex, the owner uses the authenticated Convex Dashboard
function runner for the **internal** `auth:bootstrapAdmin` action with a
private email and unique password of 14–128 characters. It refuses if an
administrator exists, stores a salted scrypt hash, and returns only
`{created:true}`. An authorized private CLI operator can instead invoke
`npx convex run --prod auth:bootstrapAdmin` with privately supplied
arguments. Prefer the Dashboard to avoid shell history. Setting
`admins.active=false` privately invalidates that administrator's sessions.
The basic app has no account management or password reset screen.

## Build and deployment context

`CONVEX_DEPLOY_KEY` is a private CLI/build credential, never an application or
browser variable. The previously configured production-only key has
`deployment:deploy` permission for the documented Vercel build. This source
change did not run a cloud deployment or inspect current remote settings.
The earlier operational handoff recorded Vercel Hobby; confirm an appropriate
plan before business production use. No billing change was made.

1. Run `npm ci`, `npm run test:basic`, `npm run check`, and `npm run build`
   locally.
2. With authorized credentials selecting the intended deployment, run
   `npx convex deploy` for production or `npx convex dev --once` for
   development.
3. Deploy the same source branch to Vercel. The repository build command is
   `node scripts/vercel-build.ts`, output `dist`, Node 24. In production,
   that command runs `npx convex deploy --cmd "npm run build"` using the
   production-only deploy key. Preview/development builds run
   `npm run build` without deploying Convex.
4. Check login, session expiry, employee/site CRUD, Telegram linking, webhook,
   and operations against the intended HTTPS deployment before enabling send.

The committed Convex `_generated` files were produced by the installed
Convex CLI offline generator. Regenerate with `npx convex codegen` when
deployment credentials are available; do not hand-edit generated files.
`npm run dev` previews the basic frontend only. `npx vercel dev` with
private configuration serves the complete proxy locally; test secure cookies
on HTTPS. The SQLite server uses `npm run dev:legacy` and
`npm run build:legacy`, with its own Telegram tables and `dist-legacy` UI.

## Site location map

The site editor uses Leaflet and OpenStreetMap tiles. Click or tap selects a
point; dragging the marker changes it. The radius input updates the visible
circle. Existing coordinates retain exact saved values until explicitly
changed. The Cipolletti/Neuquén starting view is not a selection: a new site
requires an operator choice. Keyboard users can pan and zoom the map and
choose its center; a collapsed manual coordinate option is available. Saving
locks the controls.

Tiles use `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, visible
attribution, native browser caching, and a
`strict-origin-when-cross-origin` referrer policy. There is no prefetch,
geocoding, paid service, key, or device location permission. Tile failure
preserves selected coordinates and leaves numeric selection available.
For local browser QA, `npm run dev` serves
`/tests/fixtures/site-map.html`; that fixture is not emitted to `dist`.

References: [Leaflet](https://leafletjs.com/reference.html),
[OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/).
