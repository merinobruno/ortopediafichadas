# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

TypeScript/React basic app on Vercel with Convex backend; retained local Express/SQLite implementation independently supports Telegram and has its own legacy UI build.

## Users

HR staff managing employees across multiple sites; employees link a private Telegram bot chat with an HR-issued one-time code. Cloud attendance uses a Telegram phone page with LocationManager. The local server supports HR operations and an isolated simulator; raw Telegram chat locations cannot create attendance.

## Product Purpose

Record every visit, keep exceptions visible, and eliminate manual attendance transcription.

## Capabilities and Constraints

Per-site entries and exits, multiple daily visits, geofences, HR-issued Telegram link codes, audit corrections. A new-site entry marks the prior open visit exit_unknown and alerts HR in the retained local product.

## Brand Commitments

Carahue artwork: petroleum/emerald, orange, light backgrounds. Argentine Spanish interface.

## Evidence on Hand

Approved attendance design; supplied diseños.zip artwork. All demonstration people and records are synthetic.

## Open decisions

Live phone-page verification, PostgreSQL deployment for the retained server, and extended reference integrations. Telegram identity does not attest subsequent coordinates or prove physical device presence.
