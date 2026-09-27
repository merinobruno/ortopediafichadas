# Carahue attendance design

The production administrator page and Telegram phone page follow the active Carahue Autorizaciones application. Its `app/src/App.tsx`, `AuthGate.tsx`, and `styles.css` are the visual reference. The retained local Express application has its own interface and is outside this production design scope.

## Identity

The Carahue logo is the unchanged `public/brand/carahue-source.jpeg`, shown through an SVG viewBox of `28 27 387 102` with a `1036 × 1036` image. The crop shows only the existing logo artwork. The sidebar's orange and white wave uses the same paths as the reference. Both pages use Segoe UI with Arial fallback.

| Role                       | Value     |
| -------------------------- | --------- |
| Main green                 | `#006955` |
| Dark green                 | `#005443` |
| Action orange              | `#E2720E` |
| Selected navigation accent | `#F8B332` |
| Canvas                     | `#F7F8F5` |
| Text                       | `#263E35` |
| Supporting text            | `#586D62` |
| Border                     | `#DCE5DE` |
| Input border               | `#CBD8CE` |

Primary buttons use orange with dark text. Success, warning, and error states use both text and color: green on `#E8F4EC`, brown on `#FFF2D5`, and red on `#FFF1EF`. Focus is visibly outlined; reduced-motion preferences remove navigation transitions.

## Administrator page

Sign-in uses a green full-page field with a centered white panel up to 470 px wide. The logo block ends in an orange divider, followed by a lock icon, heading, labeled fields, and one orange action. Authentication behavior and field names remain unchanged.

The signed-in desktop page has a fixed 250 px green sidebar (218 px at narrower desktop widths), a white logo cap with the reference wave, and a dark-green selected navigation item with a yellow accent. The main work area has a 75 px breadcrumb bar, title and description, right-aligned primary action, and white bordered work panels. Search stays inside the attendance panel. Tables use pale-green headers and contained horizontal scrolling. Site maps, employee linking, one-time codes, operation review, and all existing controls keep their behavior.

At 800 px and below, navigation becomes a horizontal top row with every section available. Content uses 18 px side padding, forms become one column, and controls retain touch-sized targets. Dense tables scroll within their panel rather than forcing page overflow.

## Telegram phone page and bot

The phone page repeats the green field, centered white panel, logo block, and orange divider. The action area has a clear heading, orange entry button, outlined exit button, and distinct loading, success, and error states. On small screens the card starts near the top, with full-width actions. Its mobile Telegram guard, location workflow, validation, challenge, retry behavior, and error wording are functional contracts independent of styling.

Telegram's native chat remains native. Bot responses use the existing **Fichar** Web App button and short Argentine Spanish instructions. Raw chat locations never register attendance.

## Boundaries

Visual styling does not attest a phone's physical location. Telegram signed launch data authenticates the user; the later location reading is client-reported. The existing server checks the active link, one-use challenge, reported accuracy, and site radius before writing attendance.
