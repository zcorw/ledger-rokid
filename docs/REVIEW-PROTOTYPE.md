# Synthetic receipt review prototype

## Scope

The capture page links to an explicitly synthetic example, independent of the camera result. The AIUI review page offers one field at a time: date, amount, currency code, merchant, category and note. Users can navigate fields, edit a complete value, preview the result, return to editing, confirm locally or cancel. Confirmation never submits an expense. No OCR, storage, upload, credentials or backend requests are included.

The controller validates calendar dates, positive decimal amounts (up to 14 integer and 6 fractional digits), uppercase three-letter currency codes, known expense category codes and field lengths. A currency code is only syntactically validated, not checked against backend availability. These fields follow the existing Flow Ledger expense schema. Missing values are not inferred. The controller returns copied snapshots, requires a distinct preview before confirmation, and rejects duplicate confirmation. Cancellation and page hiding clear in-memory review state.

## Validation

- `npm ci --ignore-scripts`
- `npm run check && npm test`
- Browser preview: run `python3 -m http.server 4386 --bind 127.0.0.1`, then visit `/preview/` on that server.
- Browser automation: `npx playwright install chromium && node qa/review-browser.mjs` while the server is running. GitHub Actions installs browser system dependencies and runs this check automatically.

Unit tests exercise validation, editing, confirmation, cancellation, snapshot isolation and the actual AIUI page handlers. Browser tests exercise the same controller with synthetic values at a 320-pixel viewport, block external networking and check navigation, invalid amounts, confirmation, cancellation and horizontal overflow.

## Native acceptance still required

AIUI components follow the official yodaos-project/AIUI documentation: `input` uses `bindinput`, complete replacement values from `event.detail.value`, `maxLength`, and `ink:if` conditional rendering. Navigation uses `wx.navigateTo`.

The web preview is not an AIUI emulator. This change does not establish that native input is comfortable on glasses, compile the AIUI package, validate a device keyboard/voice input, or validate firmware-specific lifecycle behavior. Test native rendering, full-value input, focus, scrolling, page hiding and back navigation on the supported Rokid hardware. Financial submission and durable confirmation receipts require a separate authenticated integration with explicit user consent.

## Combined navigation validation

PR #2 now includes the capture-navigation branch from PR #3 through an additive
merge commit; the shared capture markup conflict was resolved explicitly, not
left for automatic merging. Reviewers should review PR #3 first. No default
branch or deployment is changed by this integration.

In full-screen mode, capture selection cycles through capture, clear and synthetic
review. Opening review clears any in-memory camera result. The review page has
state-specific action selection for previous/next field, preview, return, explicit
local confirmation, cancellation and reload. Native text-input focus preserves
host key routing rather than treating typing as an action. All data remains
synthetic and confirmation still performs no accounting request.

Combined Node tests execute both actual page callback definitions, including
wraparound, repeat suppression, local confirmation, cancellation and input focus.
Chromium validates the separate review-controller preview; it does not execute
Ink or prove glasses key routing. Native compilation, focus/blur event delivery,
text entry, scrolling, screen readability and actual hardware input are still
required before acceptance. In particular this change does not prove that a
hardware-only user can focus the native text editor.
