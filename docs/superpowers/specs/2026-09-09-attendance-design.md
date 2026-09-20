# Record every site visit through WhatsApp

Status: approved design (user approval: "suena bien"), September 9, 2026. This document describes intended behavior and delivery scope; it does not establish that any feature is implemented or any WhatsApp connection is live.

Employees will record arrival and departure at authorized sites through WhatsApp. HR will manage people, sites, attendance exceptions, and reports in a Carahue-branded administration panel. The core requirement is multiple visits and sites per employee per day, with an auditable record even when a departure is missing.

## Confirmed behavior

| Requirement | Expected outcome |
| --- | --- |
| Employees identified by registered phone number | Incoming WhatsApp messages resolve to a known employee. |
| Native location sharing | A text such as “presente” accompanies a WhatsApp shared location. |
| Arrival and departure at each site | Every visit has separate entry and exit records; multiple daily visits are supported. |
| Different sites during one day | The same employee can visit multiple configured sites. |
| New entry while a previous visit remains open | A valid entry at another authorized site marks the previous visit `exit_unknown`, creates an HR alert, and opens the new visit in one transaction. No departure timestamp is invented. |

## Proposed employee flow

1. The employee sends “presente” or selects an entry/departure action. The bot asks for explicit intent whenever the message is ambiguous; location alone never toggles attendance state.
2. The bot requests a native shared location and associates it with that employee's pending action for a short, configurable period.
3. The service validates the phone, action, location, site geofence, and employee authorization. If multiple authorized sites match, the bot asks the employee to select one before recording anything.
4. The bot records the result and confirms the action, site, and local time. Failed validation explains what the employee can correct.

Site configuration includes coordinates, a radius in meters, and employee access. A shared coordinate proves receipt of that coordinate, not physical presence or immunity to location spoofing. Missing, expired, malformed, or out-of-range locations cannot complete an action or close an existing visit. Unknown phone numbers create no attendance records.

### Visit transitions

| Current state and validated action | Proposed result |
| --- | --- |
| No open visit; entry at A | Open visit A. |
| Open visit A; departure at A | Close A with a known departure. |
| Open visit A; entry at B | Mark A `exit_unknown`, alert HR, and open B atomically. This is confirmed behavior. |
| Open visit A; another entry at A | Explain that A is already open and request the intended action; do not create overlapping visits. |
| No open visit; departure | Keep attendance unchanged and offer HR exception handling. |
| Open visit A; departure at B | Keep attendance unchanged and request clarification; a departure cannot silently become an entry. |
| Any state; invalid or unauthorized location | Keep visits unchanged and request a valid location. |

The explicit-intent flow, duplicate-entry handling, and exception handling above are proposals. The same business rules will serve WhatsApp and the local simulator.

## HR workspace and visual direction

Use petroleum/emerald green, orange, and white from the supplied Carahue promotional artwork. The artwork is a brand reference, not a supplied interface design. Prioritize legible tables, clear attendance statuses, accessible contrast, and a visible queue of exceptions requiring action. Product copy should be appropriate for the Argentine client; the documentation remains in English.

The first usable panel provides employees and registered numbers, authorized sites and geofences, today's visits, attendance history, an exception queue, and filtered export. HR can correct an unknown departure with a reason. Preserve original events, record the editor and correction time, and distinguish corrected values from original observations. Visits with an unknown departure are excluded from worked-hour totals and reported as incomplete until resolved.

## Proposed architecture

Use a modular TypeScript application with a web administration UI, backend API, asynchronous worker, and PostgreSQL. Keep attendance rules independent of WhatsApp transport and UI. Begin with a single deployment architecture rather than separate services for every module.

| Boundary | Responsibility |
| --- | --- |
| WhatsApp adapter | Verify incoming webhook signatures, normalize messages, and deliver confirmations through the provider. Official WhatsApp integration is proposed, subject to provider setup and documentation verification. |
| Durable inbox and outbox | Persist accepted events before acknowledging them; process and retry safely; persist outgoing messages with delivery state and bounded retry handling. |
| Attendance domain | Resolve intent, authorize sites, validate location, and apply visit transitions. |
| PostgreSQL | Store employees, phone mappings, sites, authorizations, pending actions, visits, attendance events, alerts, correction history, inbox/outbox, users, and role permissions. |
| HR application | Authenticate administrators, enforce role permissions server-side, and expose management, review, and reporting workflows. |

Use provider message IDs as unique idempotency keys. Serialize transitions per employee and use one database transaction for the old visit, alert, and new visit. Database constraints must prevent more than one open visit per employee. Duplicate delivery returns the existing result; delayed or out-of-order events must not rewrite a newer visit silently and should enter exception handling when they cannot be safely applied.

Store timestamps in UTC, including provider event time and receipt time. Report in `America/Argentina/Buenos_Aires`. Establish and display which time is used for each attendance record; suspiciously delayed events need review. Do not derive payroll-ready hours from incomplete intervals.

Protect employee location and phone data through least-privilege roles, scoped access, secret management, audit history, and configurable retention. Logs should avoid unnecessary raw location/message payloads. Production readiness includes backups, restore verification, health monitoring, retry visibility, and alerting for failed webhook or message processing.

## Reference feature inventory and delivery sequence

The observed reference navigation is tracked below as scope to investigate and implement. Navigation labels establish the inventory, not verified behavior or completed parity. Advanced screens require detailed inspection before their contracts can be finalized; AI features presented as forthcoming in the reference are not proven working capabilities.

| Delivery group | Tracked features |
| --- | --- |
| 1. Attendance foundation | Dashboard; employees and onboarding; attendance; sites; alerts; basic reports; authentication, roles, and settings; WhatsApp flow and local simulator. |
| 2. HR operations | Pauses; leave; overtime and approvals; shifts, templates, and rotations; site categories, sectors, and tags; alert rules; calendar and holidays; expanded reports. |
| 3. Extended parity and integrations | Communications, bulk invitations, and templates; receipt batches and pending receipts; biometric device status and rejected records; AI analytics; subscription controls. |

Each group needs concrete acceptance criteria as its reference screens are inspected. Keep the entire inventory visible during delivery; phasing does not remove features from the requested scope. The meaning and integration requirements of receipts, biometric devices, subscription controls, and AI analytics remain to be established.

## Acceptance scenarios

- [x] A registered employee can enter A, leave A, enter B, and leave B on the same day, producing two complete visits.
- [x] The employee can return to A later that day and record another independent visit.
- [x] A valid entry at B with A still open creates one `exit_unknown` visit, one HR alert, and one open visit B, with no fabricated exit time.
- [x] Invalid location or lack of authorization at B leaves the open visit A unchanged.
- [x] Duplicate delivery of an entry creates no additional visit, attendance event, or alert.
- [ ] Concurrent actions for one employee cannot leave two open visits.
- [ ] An ambiguous action or overlapping geofences asks for clarification before mutating attendance.
- [x] An unknown phone cannot register attendance or access another employee's information.
- [x] HR corrections preserve original observations and require an actor and reason.
- [x] Unknown departures appear as incomplete and do not silently contribute estimated working hours.
- [x] A worker restart can resume persisted messages without losing or duplicating attendance effects.
- [x] The simulator clearly identifies simulated messages and demonstrates the same attendance rules without claiming a live WhatsApp connection.

Evidence: `tests/domain.test.ts` covers repeated visits, returns, unknown exits, authorization, deduplication and corrections; `tests/whatsapp.test.ts` covers persisted worker restart; `tests/reporting.test.ts` and `tests/summary.test.ts` cover unknown-hour exclusions. Browser QA confirmed simulator labels, site transitions and HR resolution on synthetic data. Concurrency and overlapping-geofence acceptance remain unchecked here pending direct scenario evidence.

## Deployment dependency

A real 24/7 bot requires a deployed public HTTPS webhook, running worker, durable database, Meta business portfolio, WhatsApp Business Account, registered business phone number, access token, app webhook subscription, and operational monitoring. The local simulator enables review while those dependencies are arranged; a local demonstration is not production availability. Confirm provider-specific messaging and onboarding requirements before implementing the adapter.

Meta's [official Cloud API collection](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api) documents bot integration, account prerequisites, access tokens, and webhook subscriptions. Its [receiving-messages guide](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/receivingMessages/) supports the HTTPS webhook requirement; this is a conceptual reference, not a recommendation to adopt that SDK.

