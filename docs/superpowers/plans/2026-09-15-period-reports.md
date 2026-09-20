# Period attendance reports

## Contract
One shared summary function consumes the exact filtered, scoped visit set plus its breaks. Overall and employee/site groups report visit count, distinct Buenos Aires entry dates, measurable complete/corrected visits, unrounded known net hours, open visits, unknown exits and closed visits with unknown pause endings separately. Sum before display rounding. Overnight visits belong wholly to their entry day, without payroll/day splitting. Approved overtime minutes are shown separately and never added to worked hours.

All report endpoints and detail/summary CSV share validated from/to/employee/site/status/search filters. Civil dates must exist; from<=to; bounded explicit periods up to366 days. Empty date filters mean all stored history. Unknown status or malformed/repeated query parameters fail. Supervisor scope is applied before grouping; an explicit inaccessible employee is403. Summaries never disclose users, message queues, events or audit.

Report UI owns separate filter state and shows every filter used, plus actual applied-filter downloads. It displays overall metrics, employee/site group tables and visit details. Empty results have zeros and no fabricated groups.

## Steps
- [x] Test aggregation, multi-site returns, pauses/unknown states, BA day boundaries, empty and rounding.
- [x] Shared validated server report selector and JSON/CSV routes with permission tests; route old detail export through same selector.
- [x] Dedicated Spanish report surface with explicit filters, group/detail tables and matching CSV links.
- [x] Normalize/test/build, update docs, hand off stable candidate for parent QA.

