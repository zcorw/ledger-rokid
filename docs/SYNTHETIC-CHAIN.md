# Isolated receipt chain

## Run

Run `npm ci --ignore-scripts`, `npm run check && npm test`, then
`python3 -m http.server 4386 --bind 127.0.0.1`. Open
`http://127.0.0.1:4386/preview/chain.html`.

1. Start the synthetic capture and recognition.
2. Inspect/edit the six fields. Category is deliberately blank; choose a valid
   value such as `food` rather than guessing from OCR.
3. Preview the entire record, then confirm the content.
4. Choose the simulated response and explicitly submit the synthetic record.
5. For `unknown`, reload, verify the same request identifier, select success,
   and explicitly retry. A reload does not automatically retry.
6. In a fresh browser context, choose duplicate: the second confirmation must be
   explicit. Cancellation after an attempted send does not mean rollback.

A successful record stays visible after reload and cannot be submitted again.
Until the next receipt is confirmed, the previous successful journal remains;
reloading during new unconfirmed editing shows that previous success.
An explicit next-receipt action is available after success only. A fresh isolated
browser context can also start a new demonstration. This preview does not
provide a button that discards unresolved operations to get a fresh request key.

## Architecture and privacy boundary

`receipt-flow.js` composes the merged capture, ReceiptCandidate adapter, review
and submission controllers. Dependencies supply camera, recognition, submission,
request-key generation and storage. The web preview supplies a three-byte fake
photo, a static decoded candidate and an in-process response generator. There is
no fetch, camera permission, backend endpoint, credential or real accounting write.
The native Ink pages are unchanged: this preview is not an AIUI runtime and does
not establish that the deployed Agent uses this chain.

The captured image is released after recognition, cancellation or failure; stale
asynchronous responses are ignored. Cancelling recognition permits a new capture;
a pending native camera call itself is not abortable and its capture lock remains
until it settles, preventing concurrent physical camera calls. No image is persisted. Recognition failure
cannot proceed to confirmation. Snapshot values do not silently infer category.

Only a confirmed operation is written to the injected storage. Immediately before
transport, its exact key and payload are synchronously journaled as unknown. A
crash therefore cannot restart as a new intent. Unknown operations require explicit
retry of the same request; duplicate approval also retains the original key.
Storage/validation failures block the chain rather than silently discarding a
possibly sent intent. Successful and unresolved snapshots survive restart.

The provided localStorage adapter is **synthetic test storage only**, not approved
storage for financial or credential data. Production integration still needs
account-scoped authenticated transport, secure durable storage, bounded response
parsing, account-switch/unbind rules and server reconciliation. Do not swap in a
live endpoint without that separate work and consent. Restored data is validated,
but local storage is not an authenticated security boundary.

## Verification

Node regressions exercise the entire chain, missing category, duplicate clicks,
late/cancelled recognition, image release, explicit duplicate confirmation,
pre-transport journaling, crash/restart, corrupt storage and storage write failure.
Chromium CI runs `qa/chain-browser.mjs` for real DOM editing, confirmation, unknown
outcome, reload, stable key replay, success and narrow-screen overflow. It also
retains the earlier review browser test. These tests use synthetic data only.

Native compilation, glasses key/focus delivery, camera/readability, real OCR,
authorization, financial transport and hardware acceptance remain separate gates.
No production deployment or migration is part of this change.
