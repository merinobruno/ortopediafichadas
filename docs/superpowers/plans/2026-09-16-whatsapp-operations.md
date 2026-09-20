# WhatsApp operator review

Add an admin/HR-only metadata queue view, bounded to 25 records per cursor page. Existing transport status remains authoritative; provider delivery shares the existing status column and no missing timestamps/history are inferred. Unknown error text is replaced by a safe category. Recovery holds remain visible and immutable.

Append review revisions with authenticated actor, reason and optimistic expected revision in the same transaction as audit. Review is independent of transport and cannot send, retry, cancel, release quarantine or modify attendance/intents. Three focused tests cover metadata/privacy/authorization, revision/audit isolation, and pagination; run those tests, typecheck and one final build only.
