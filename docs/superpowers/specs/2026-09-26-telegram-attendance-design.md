# Replace WhatsApp attendance with Telegram

Status: approved September 26, 2026. This supersedes the WhatsApp transport and phone-identity decisions in the September 9 attendance design. It describes intended behavior; a live Telegram connection still requires deployment and bot configuration.

Employees will record attendance in a private Telegram bot chat. HR will link each employee to that chat with a short-lived, single-use code. No mobile phone number is needed. The replacement covers the deployed Convex/Vercel path and the retained local server; attendance rules, employee and site records, and recorded attendance remain.

## Employee and HR flow

1. HR creates an active employee without a phone number and generates a linking code. The interface displays the code once, its expiry, and a bot link or instructions to open the bot.
2. The employee starts a private chat and sends the code (either as a `/start` parameter or as a message). The bot confirms which employee was linked. HR can see linked/unlinked status, revoke a link, and issue a replacement code.
3. A linked employee sends `entrada` or `salida`. The bot asks for a current Telegram location. The employee shares location within five minutes. The bot then confirms the recorded action and site or explains a rejection.
4. The retained local bot also accepts its existing HR commands (`pausa`, `finpausa`, leave request, `cancelar`, `ayuda`) from the linked Telegram account. Its simulator selects an employee internally, stays explicitly simulated, and never sends through Telegram.

Only private chats can link or submit attendance. A Telegram username, display name, forwarded message, contact card, or phone number never establishes identity. The sender's stable numeric Telegram user ID is the identity key; the private chat ID is the reply destination. Group and channel updates have no attendance effect.

## Architecture and data

| Boundary | Decision |
| --- | --- |
| Telegram webhook | Replace Meta endpoints with a Telegram HTTPS webhook. Check `X-Telegram-Bot-Api-Secret-Token` against a separately configured random secret before parsing or writing; reject missing, invalid, and oversized payloads. Validate the supported update shape and private chat/sender IDs. Keep the token and bot credential server-side and out of logs. |
| Durable inbound processing | Persist an accepted update before returning success. Deduplicate by Telegram `update_id`; identify each message by `(chat_id, message_id)` as needed. Process each sender's committed updates in deterministic event order even when workers run out of order. Unsupported update types are safely ignored or recorded without attendance effects. |
| Account links | Store one active Telegram user ID and private chat ID per employee, unique across employees. Issue a random, human-enterable 10-character base32 code with a 15-minute expiry; store only its hash. Reveal it once to authorized HR/admin. Rate-limit attempts by Telegram sender and code failures. Atomically consume a valid code and bind the account; expired, used, revoked, or guessed codes cannot bind. A new link to an already linked employee requires HR revocation first, and an account already linked elsewhere cannot be silently reassigned. Deactivation blocks use; revocation invalidates pending actions and codes. Audit issue, revoke, and successful link without logging the code. |
| Attendance domain | Replace phone resolution with the active employee link. Keep explicit command then location, five-minute pending intent, freshness/future checks, site radius checks, open-visit transition rules, and employee/site authorization where present. Rejected location consumes the pending intent. A location alone cannot change attendance. |
| Outbound messages | Queue replies to the linked private chat in the same transaction as the inbound result. Use Telegram `sendMessage` over HTTPS; store provider message ID on a confirmed API success. Classify explicit failures with bounded retries only where the response proves no send occurred. A timeout, broken connection after request, or interrupted `sending` state is uncertain and requires operator review before any resend. Do not turn a successful attendance write into a failure because its confirmation could not be delivered. |

Telegram message `date` is the event time; store receipt time separately. Reject stale, future, or reordered events using the current backend's safety limits, and require attendance timestamps to advance strictly. For equal event seconds, use Telegram update/message ordering as the deterministic tie break. A duplicate update or retry must not create a second event, alert, leave request, or reply. The sender's link must still be active at processing time; a queued message cannot retain access after revocation. Shared coordinates are evidence of a received coordinate, not proof of physical presence.

The Convex tables and actions that currently key inbox, pending conversation, and outbox by phone will key by Telegram identity/chat instead. The retained SQLite server will migrate its employee and transport schemas without changing employee IDs or attendance foreign keys. Preserve unrelated HR records; discard old WhatsApp inbox, pending, outbox, delivery status, and message history, with no migration or replay to Telegram. Remove employee phone validation and phone-derived identity from both paths. Old phone values may be dropped after a migration safeguards employee, site, and attendance records.

## Operator interface and cutover

- Replace employee phone inputs and columns with Telegram link status and HR controls to issue a code or revoke a link. Show the code once and make expiry clear. Authorization is enforced in the backend; supervisors cannot manage links or inspect codes.
- Rename WhatsApp operation/status screens and copy to Telegram. Show useful inbound/outbound states and redacted failure categories without exposing codes, bot credentials, raw message bodies, precise locations, or private chat IDs to routine operators.
- Update onboarding text, bot help, simulator labels, environment examples, deployment notes, and tests. Remove Meta verification, Graph API credentials, phone-number configuration, and `BOT_PUBLIC_NUMBER`. Communications drafts are local preparation only: replace WhatsApp/phone-based choices and `telefono` placeholders with Telegram-appropriate copy or remove them; this change does not add campaign delivery.
- Configure the bot token and independent webhook secret in each backend's private environment, register the HTTPS webhook with Telegram, and restrict allowed update types. Enable outbound sends only after the bot and webhook are tested in a nonproduction environment. No Meta account, business number, or WhatsApp configuration is required.
- Deploy schema/code and UI together, register the Telegram webhook, test link and attendance end to end with a test employee, then enable production sending. Do not replay WhatsApp work. Employees must start the bot and link before it can answer. Readiness and operator checks distinguish a running worker from confirmed Telegram connectivity.

## Verification and acceptance

- [ ] A new employee can be saved without a phone, linked with a valid code in a private chat, and can receive a confirmation. A code fails after use, expiry, revocation, excessive guesses, or an attempt to bind a second employee; a group message cannot link.
- [ ] An unlinked, inactive, or revoked Telegram sender cannot record attendance or use HR commands. Reissued codes and relinking require explicit HR action; old pending actions cannot cross a revocation.
- [ ] A linked employee can enter and leave an authorized site using `entrada`/`salida` plus location within five minutes. Invalid, stale, duplicate, reordered, out-of-radius, and location-only updates leave attendance unchanged. Existing multiple-visit, open-visit, and unknown-exit rules still pass.
- [ ] Duplicate webhook delivery and worker restart yield one domain effect and at most one queued reply. A location worker running first still processes the prior committed command before location.
- [ ] Confirmed Telegram send success records its returned message ID. Explicit retryable failure follows a bounded policy; uncertain or interrupted sends remain visible for human review and are not blindly resent.
- [ ] Convex/Vercel and the retained local server pass their focused backend/UI tests and builds. An end-to-end test proves the registered Telegram webhook, one-time linking, location attendance, and bot response without using Meta or a phone number.
- [ ] Existing employee, site, and attendance records remain readable after migration; WhatsApp transport state is neither replayed nor required by either runtime.

## Outside this change

Telegram group attendance, contact/phone matching, employee self-service account recovery, outbound campaigns, email, provider-guaranteed delivery, and proof against GPS spoofing are outside this replacement. Existing HR and attendance features retain their current scope; this design does not add payroll behavior or change historical attendance facts.
