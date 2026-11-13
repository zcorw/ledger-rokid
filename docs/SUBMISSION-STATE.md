# Isolated expense submission state machine

`aiui/lib/submission.js` is a tested boundary/controller only. No Page imports it.
It supplies no fetch implementation, endpoint, credential, persistence, automatic
retry, OCR connection or accounting write. Tests inject synthetic transports.
The existing confirmation screen still confirms a local demo, not a saved expense.

## Contract evidence

Reviewed against `zcorw/flow-ledger-2` on 2026-11-13:

- `backend/app/schemas/expense.py` (`dbc9bb8df9ff4c8f576db33c88175e0f80f74a33`): ExpenseCreate aliases, decimal/date constraints, category enum and explicit source.
- `backend/app/api/expenses.py` (`7b048c333ca8a657d66d8ed138e8cc75cce748a5`): create/replay and duplicate behavior; responses use snake_case.
- `backend/app/core/errors.py` (`d1a083316a330a056a73dda8713c0e8553ff7871`): nested error.code envelope.

A confirmed review snapshot and an explicit `manual` or `receipt_ocr` source are
required. Future integration must supply a fresh UUID for each newly confirmed
intent, using a secure platform generator; the module does not guess a source or
account. Amounts remain strings. It does not determine enabled currencies or
account ownership; the server remains authoritative.

`prepare` freezes the request. `submit` sends once; repeated submission while
pending or after success does nothing. A matching 200 replay or 201 creation
returns only the validated record ID. Responses must match the confirmed values,
including exact decimal equivalence without floating point conversion.

A rejected promise, invalid success response or other ambiguous HTTP result becomes
`unknown`. Explicit `retry` reuses the same immutable content and request key.
No automatic retry or fresh-key escape is provided. A caller must resolve the
cause (including authentication failure) before retrying; raw errors are not shown.
A transport that never settles stays submitting until locally cancelled.

`POSSIBLE_DUPLICATE` requires a separate `confirmDuplicate` call representing a new
explicit human decision. Only then is `allowDuplicate` set to true, keeping the
same key and all financial fields. This matches the server hash, which excludes
`allow_duplicate`. A timeout afterward retains that exact duplicate-confirmed
payload for replay. Key conflict and already-deleted responses require external
reconciliation and cannot automatically restart the operation.

Cancellation before sending discards the local intent. Cancellation while sending
or uncertain leaves the outcome unknown and retains the original request. Late
responses cannot mark it successful. Cancellation is NOT a server rollback.
The controller is in-memory only: app restart recovery is not implemented. A future
integration needs safe durable operation storage, authenticated reconciliation,
account isolation and a clear unknown-outcome UX before any live write is enabled.

## Validation and limits

Run `npm run check && npm test`. Synthetic tests cover duplicate clicks, explicit
duplicate confirmation, stable-key timeout replay, invalid/mismatched success,
conflicts, cancellation/late replies, caller/transport mutation and exact decimals.
CI also runs the existing Chromium review preview, not an actual submission UI.

Device-scoped Flow Ledger authorization is not implemented. Current service auth
uses browser session cookies; do not copy those or account passwords to glasses.
No real photo, financial record, credential, provider call or target device was used.
No deployment, security setting change or production migration is included.
