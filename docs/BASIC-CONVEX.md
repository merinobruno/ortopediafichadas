# Basic Convex attendance: Telegram cutover

The Vercel basic app and Convex backend now implement private Telegram linking
and attendance. The source change is local until deployed. The retained SQLite
server has its own migration plan. No bot, webhook, or external send was
configured or exercised by local tests.

Administrators create employees without phone numbers and issue a 10-character,
single-use code valid for 15 minutes. They show it once to the employee, who
starts a private bot chat and sends the code or /start CODE. A linked employee
sends entrada or salida, then a current Telegram location within five
minutes. The app shows linked status and redacted transport operations.

## Private configuration

Vercel server-side environment:

| Name | Purpose |
| --- | --- |
| CONVEX_SITE_URL | Intended deployment's HTTPS Convex site URL |
| APP_ORIGIN | Exact HTTPS application origin |
| PROXY_SECRET | Shared private proxy secret |

Convex environment:

| Name | Purpose |
| --- | --- |
| APP_ORIGIN | Same exact application origin |
| PROXY_SECRET | Same shared private proxy secret |
| TELEGRAM_BOT_TOKEN | Private credential for this environment's bot |
| TELEGRAM_WEBHOOK_SECRET | Independent random secret sent as Telegram secret_token |
| TELEGRAM_SEND_ENABLED | Keep false until end-to-end testing; set true deliberately |

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
   TELEGRAM_SEND_ENABLED=false. Register the bot webhook at
   https://<deployment>.convex.site/webhook/telegram using Telegram's
   setWebhook method, the independent secret_token, HTTPS, and
   allowed_updates:["message"]. Use a private credential workflow; the bot
   token appears in the Telegram API URL and must not be pasted into shell
   history or logs. Check Telegram's returned webhook status.
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
