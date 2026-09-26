# Product
<!-- impeccable:product-schema 1 -->
## Platform
web
## Stack
TypeScript/React basic app on Vercel with Convex backend; retained local Express/SQLite implementation independently supports Telegram and has its own legacy UI build.
## Users
HR staff managing employees across multiple sites; both runtimes use private Telegram bot chats and native location sharing after HR issues a one-time link code. The local server also supports HR operations and an isolated simulator.
## Product Purpose
Record every visit, keep exceptions visible, and eliminate manual attendance transcription.
## Capabilities and Constraints
Per-site entries and exits, multiple daily visits, geofences, HR-issued Telegram link codes, audit corrections. A new-site entry marks the prior open visit exit_unknown and alerts HR in the retained local product.
## Brand Commitments
Carahue artwork: petroleum/emerald, orange, light backgrounds. Argentine Spanish interface.
## Evidence on Hand
Approved attendance design; supplied diseños.zip artwork. All demonstration people and records are synthetic.
## Open decisions
Telegram bot provisioning, HTTPS webhook registration, live end-to-end verification, PostgreSQL deployment for the retained server, and extended reference integrations.
