# 知产 Rokid

Local-only receipt capture capability prototype for Rokid AIUI.

- Explicit camera button with system preview requested.
- In-memory encoded image capture and clear/cancel lifecycle.
- No OCR, receipt upload, credentials, or production integration.
- Node.js 22 checks: `npm run check && npm test`.

See [device acceptance and limitations](docs/DEVICE-ACCEPTANCE.md). This source prototype requires a supported native AIUI runtime; target-device validation is still pending. Main was initialized as an approved empty-repository baseline; implementation is proposed in a draft pull request.
