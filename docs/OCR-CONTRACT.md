# Receipt candidate boundary (not a connected OCR feature)

`aiui/lib/receipt-candidate.js` is an isolated, pure adapter. No page imports it yet.
It accepts an HTTP status and an already decoded **Flow Ledger** candidate body.
It does not call OpenAI, upload photographs, store data, choose an account, submit
expenses, or change the existing camera/review prototype.

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
Warnings are copied as untrusted plain text, never instructions or HTML. A future
transport must bound response bytes before JSON parsing and handle network errors.
This adapter is not a provider-response parser or a retry mechanism.

## Remaining blockers

Device-scoped Flow Ledger authentication and authorized transport are not yet
implemented. Do not embed web cookies, account passwords or provider API keys.
No production credentials, photos, paid OCR calls or real financial writes were
used. Camera-to-OCR wiring, lifecycle cancellation, native rendering and hardware
acceptance remain separate. The existing review page still uses synthetic data.

Run `npm run check` and `npm test`. Contract fixtures are synthetic; tests do not
establish remote OCR quality, image readability, deployment or device acceptance.
