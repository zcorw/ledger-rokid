# 知产 Rokid

Local-only receipt capture capability prototype for Rokid AIUI.

- Explicit camera button with system preview requested.
- In-memory encoded image capture and clear/cancel lifecycle.
- No OCR, receipt upload, credentials, or production integration.
- Node.js 22 checks: `npm run check && npm test`.

See [device acceptance and limitations](docs/DEVICE-ACCEPTANCE.md). This source prototype requires a supported native AIUI runtime; target-device validation is still pending. Main was initialized as an approved empty-repository baseline; implementation is proposed in a draft pull request.

## Synthetic receipt review

A separate demo button opens a one-field-at-a-time edit/review/confirm flow. It does not use the captured image or claim to run OCR. See [review prototype](docs/REVIEW-PROTOTYPE.md) for scope and validation.

Install development dependencies with `npm ci --ignore-scripts`. CI additionally checks the shared review controller through a Chromium preview. This does not replace AIUI compilation or real-device acceptance.

## Isolated end-to-end preview

Open `/preview/chain.html` on the local preview server for a complete **synthetic**
capture → recognition → edit → confirmation → submission sequence. The same
existing controllers are composed, but neither the camera nor financial server is
contacted. Only synthetic operation recovery data is stored in this browser.
See [integration scope and recovery](docs/SYNTHETIC-CHAIN.md).
