# Receipt recognition contract

The paired backend adds `GET /review-options` (version 1; complete categories, enabled currencies and active owned accounts) and optional `targetField` on `POST /review-correction`. Scoped replies add `fieldOutcome`: `matched`, `unchanged`, `ambiguous` or `unmatched`. Client/server both enforce the field boundary. Enumerated fields use exact normalized labels/aliases, unique contained names, then conservative text similarity (at least 0.72 with a 0.15 lead); close competitors/negations require clarification. This is not general phonetic/semantic matching. Free fields use the existing model with an explicit target; other returned fields are discarded. There are no financial writes. Choices stay in memory and clear on hide/exit. Deploy this backend increment before installing the native package; unavailable/invalid choices fail explicitly. Existing requests without a target retain their earlier behavior.

The recognition response remains the same five-field contract. Review corrections, versioned drafts, opt-in accounting and minimal-journal recovery are separate additions described in [the review workflow](REVIEW-WORKFLOW.md); they do not mount the old isolated authorization experiment.

`aiui/lib/receipt-candidate.js` is a pure adapter used by the native agent's
real recognition controller and the independent browser chain.
It accepts an HTTP status and an already decoded **Flow Ledger** candidate body.
It does not call OpenAI, upload photographs, store data, choose an account, submit
expenses, or implement an authenticated backend connection.

## Verified source contract

Reviewed on 2026-11-13 against `zcorw/flow-ledger-2`:

- `backend/app/schemas/receipt.py`, blob `b38e3e22e86677760fbd5407b5208f43079398ad`: response strings `amount`, `expenseDate`, `currencyCode`, `merchant`, plus string array `warnings`.
- `backend/app/services/receipt.py`, blob `f80cc469802af53ef243bb3bf4ea5a17183160ac`: uncertain values become empty strings; amount is positive with at most 14 integer/6 decimal digits, date is a canonical local calendar date, currency has three uppercase letters. Category is explicitly chosen by the user. Provider warnings are capped at six; the service can add four warnings.
- `backend/app/api/expenses.py`, blob `7b048c333ca8a657d66d8ed138e8cc75cce748a5`: authenticated receipt recognition; bounded raw PNG/JPEG upload and `X-Receipt-Upload: 1` are required. This is not a public glasses endpoint.

Amounts remain strings, without rounding, separators, conversion or a guessed total.
Invalid/empty amount, date or currency stays blank and appears in `missingFields`.
Category is always blank and missing. Merchant may be blank. All results require
human confirmation even if every recognized field looks valid. Three uppercase
currency letters match the current backend contract, not proof of an enabled or
valid ISO currency; future submission must validate against the account's enabled
currencies. Nothing in this module determines OCR confidence or correctness.

Malformed shape/types, missing or extra fields and oversized fields fail closed.
HTTP failures never become candidates and their raw bodies are not reflected.
Warnings are copied as untrusted plain text, never instructions or HTML. The HTTPS transport must bound response bytes before JSON parsing and handle network errors.
This adapter is not a provider-response parser or a retry mechanism.

## Connected device transport

The agent uses HTTPS /api/v1/receipt-devices with phone-approved, receipt-only
device grants. POST /pairings starts authorization, POST /pairings/token polls,
and POST /receipt-recognition accepts a bearer grant plus X-Receipt-Upload: 1.
The page calls receiptApi.authorize() at entry, before requesting the camera.
Without a saved grant, phone binding must finish before preview/capture; this
operation does not encode or upload a photo. With a saved grant it makes no
network request. Recognition still validates authorization at the backend; a
401/403 clears the grant and photo and requires binding again before preview.
See the Flow Ledger 2 docs/receipt-devices.md for owner approval and revocation.
Pairings last 10 minutes. New grants return expiresAt: null and remain valid
until revocation/password change. Finite grants from older deployments keep
their original expiry. Native credentials are scoped to backend origin/API,
persisted with wx storage and restored after Agent/device restart. Closing the
client never deletes saved authorization. A 401/403 response removes it; network
errors retain it. Corrupt, wrong-resource and expired records are not uploaded.
Storage failures are shown explicitly; no silent memory-only fallback is used.
The adapter uses the [official AIUI Agent-isolated storage APIs](https://github.com/yodaos-project/AIUI/blob/c490609a5018152aef52ebcee912e4534e4f4bca/documentation/3-api/storage-api.md).
The normal web cookie is neither copied nor sent by the glasses.

JPEG/PNG/WebP originals up to 8 MiB pass through unchanged. The server archives the original bytes and candidate in PostgreSQL, then normalizes a separate copy for OCR. X-Receipt-Id carries the archive UUID outside the existing five-field candidate JSON. The recognition controller and page retain this identifier; old servers without the header remain compatible. Never upload the
400x180 photo-display canvas. Responses are streamed with a 16 KiB bound before
JSON parsing. Requests time out after 15 seconds (55 for OCR); hiding/exiting
aborts polling and upload. No mock fallback, provider key or local photo persistence is present. Cancelling does not delete originals already received and saved on the server. Warnings are not rendered as bill content; missing fields stay blank.

Both backend/frontend deployment and target-device acceptance remain required.
Local tests use synthetic responses, no paid OCR or real financial writes.

Run `npm run check` and `npm test`. Contract fixtures are synthetic; tests do not
establish remote OCR quality, image readability, deployment or device acceptance.
