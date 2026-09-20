---
name: Carahue
description: Emerald brand surfaces and clear everyday HR workspaces
colors:
  brand-emerald: "#006c57"
  action-orange: "#ff8a00"
  action-hover: "#ff9e2b"
  action-ink: "#392000"
  text: "#173f36"
  muted: "#586e65"
  page: "#f5f8f6"
  paper: "#ffffff"
  line: "#dce7e1"
  focus: "#a34800"
typography:
  display:
    fontFamily: "Manrope, sans-serif"
    fontSize: "clamp(38px, 4.1vw, 66px)"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Manrope, sans-serif"
    fontSize: "clamp(25px, 2.4vw, 34px)"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Manrope, sans-serif"
    fontSize: "17px"
    letterSpacing: "-0.4px"
  body:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "14px"
    lineHeight: 1.65
  label:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.5
rounded:
  chip: "5px"
  control: "8px"
  panel: "14px"
  brand-header: "18px 18px 50px 18px"
spacing:
  control-gap: "8px"
  compact: "14px"
  panel: "24px"
  section: "30px"
components:
  button-primary:
    backgroundColor: "{colors.action-orange}"
    textColor: "{colors.action-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "#365a4f"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "#36544a"
    rounded: "{rounded.control}"
    padding: "10px 11px"
  navigation-selected:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.brand-emerald}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  status-chip:
    backgroundColor: "#eef3eb"
    textColor: "#48774e"
    rounded: "{rounded.chip}"
    padding: "5px 8px"
  panel:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.panel}"
---

# Design System: Carahue

## Overview

**Creative North Star: "Carahue's flowing ribbon"**

Carahue pairs confident emerald brand surfaces with orange actions and calm white work areas. Its flowing ribbon carries the visual identity from sign-in into daily HR work; dense records remain legible and exceptions remain explicit.

This documents the approved reference-inspired redesign as implemented in src/styles.css and src/App.tsx. The crescent symbol is an authored approximation inspired by the supplied marketing references, not an extracted official identity asset.

**Key Characteristics:**
- Rich emerald navigation and headers with orange primary actions.
- Organic brand waves around structured, white operational surfaces.
- Locally bundled Manrope headings, DM Sans body, and consistent Lucide icons.

## Colors

Emerald gives the workspace its identity; orange draws attention to actions while white preserves reading space.

### Primary
Brand emerald anchors navigation, sign-in, page headers, and key presence figures.

### Secondary
Action orange fills primary buttons and the brand ribbon. Dark action ink keeps button labels readable. The hover variant is a lighter orange; focus uses the darker orange token.

### Neutral
Page is a faint green-tinted background. Paper is the white work surface. Text and muted distinguish primary and supporting content; line separates rows and panels.

**The Operational Color Rule.** Status labels and written explanations must carry meaning alongside color.

## Typography

Manrope supplies headings and the wordmark; DM Sans supplies body text and controls. Both are bundled locally through @fontsource imports in src/main.tsx.

Display is reserved for the sign-in message. Headline identifies the current work surface. Titles organize panels; body supports concise explanations; labels describe actions and fields. Table headings use compact text (11px). Time columns, presence counts, and site totals use tabular numerals. Heading text balances across lines.

## Layout

Desktop navigation is fixed (254px), with a matching content offset, topbar (70px), and main padding (30px 34px 18px). Panels retain regular separation (24px). The brand header uses generous inset space (30px 32px) and a minimum height (160px).

At tablet widths (781–1100px), navigation narrows (226px), main padding becomes (24px), and overview content stacks. At mobile widths (780px and below), the content uses full width, main padding becomes (18px 14px), the sidebar becomes a toggle drawer, and its close control and backdrop are visible. Dense tables remain horizontally scrollable. The sign-in layout changes from two columns to one.

## Elevation & Depth

Borders, tonal surfaces, and whitespace establish hierarchy. Selected navigation has a restrained shadow (0 3px 8px #003d3220); editors retain a faint shadow (0 10px 30px #1c49340a). Work panels do not rely on deep shadows.

## Shapes

Controls have gently curved corners; panels are more rounded. The page header has one extended corner, and the sign-in icon repeats this asymmetric treatment. Broad SVG waves appear at the edges of sign-in and page headers, remain behind text, ignore pointer events, and are hidden from accessibility APIs.

## Components

Primary buttons use orange with dark labels, compact padding, and a minimum height (41px); the sign-in action is taller (49px). Secondary actions use a white surface with a quiet border. Text actions use emerald.

Fields use white backgrounds, defined borders, and a minimum height (44px) in labeled forms. All interactive elements retain the orange keyboard outline (2px, offset 4px). Disabled controls communicate unavailability with opacity and a not-allowed cursor.

Navigation uses light text over emerald, an emerald hover fill, and a white selected surface. Selection is also exposed with aria-current. Status chips pair short text with a dot and retain distinct pending, corrected, completed, and rejected treatments.

Panels group records on white surfaces. Attention panels use a pale orange surface with an explicit explanation and action. Communications retains its local-only banner, separate preparation tabs, inline editors, and escaped previews.

Navigation background transitions remain brief (0.15s). The reduced-motion media query disables transitions and animation.

## Do's and Don'ts

### Do:
- Do preserve visible keyboard focus and reduced-motion behavior.
- Do keep demo indicators, unknown observations, and external messaging status explicit.
- Do use actual persisted records and preserve role-based access and unsaved-work guards.
- Do retain communications preparation, recipient snapshots, and unavailable channel capabilities as explicit states.

### Don't:
- Don't replace the locally bundled fonts with remote font requests.
- Don't treat the authored crescent as an extracted or verified official logo.
- Don't use decorative waves behind records, inputs, or other dense work content.
- Don't imply that preparation sent messages or that an unknown time is confirmed.
