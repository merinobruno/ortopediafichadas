# Telegram phone check-in trial

Employees open a dedicated `/fichar.html` page from an inline Telegram `web_app` button. The page uses Telegram's `LocationManager` and offers Entrada and Salida. It has no map picker or coordinate input. Ordinary browser access has no employee fallback.

The server validates raw Telegram `initData` against the bot token, requires a signed user and recent `auth_date` (at most five minutes old, no more than 30 seconds in the future), and resolves the current active employee link. It issues a random one-use challenge valid for 60 seconds, bound to that link and the chosen action. Submission consumes the challenge atomically with the attendance write, using server time, active site radius and the reported horizontal accuracy (required, finite, at most 100 metres). The receipt records the source and accuracy. A repeated submission cannot write twice.

Chat locations, including live locations and manually selected pins, never create attendance. Old pending chat intents are ignored and cleared. The retained local Telegram transport follows the same fail-closed rule; its simulator is separate.

Telegram `initData` authenticates the initial Telegram user data. It does **not** authenticate the later coordinates, prove a physical phone, or prevent a modified client from spoofing GPS or accuracy. Telegram platform checks are only a user-experience guard. No Wi-Fi rule is imposed. The trial therefore removes the ordinary map-pin route, but cannot provide attested presence.

Historical attendance records are preserved. An existing open entry prevents
a new Entrada until an authorized, auditable correction is made.

The page initializes Telegram LocationManager only on first use. A later tap
uses its existing initialized state; Telegram's SDK does not call a second
`init` callback. If a native location request times out or the Mini App goes
to the background while a request is pending, the page requires closing and
reopening it from the bot. The SDK retains pending callbacks, so retrying in
that same page could consume an older response. The server enforces the
`initData` age limit and the page gives explicit reopen guidance if it rejects
an expired launch.
