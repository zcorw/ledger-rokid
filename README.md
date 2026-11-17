# Flow Ledger for Rokid

**English** | [简体中文](README.zh-CN.md)

A receipt capture and recognition agent for Rokid AIUI, paired with Flow Ledger 2.

The development branch adds a fixed review layout: merchant, amount, date, account and category remain visible even when their values are empty. Confirmed currency codes accompany symbols; an unknown currency is explicitly marked for review. Direction keys select Voice edit, Draft or Confirm. All three actions are connected; see [workflow and acceptance](docs/REVIEW-WORKFLOW.md) and [TODO.md](TODO.md). New-package device acceptance is separate from code completion.

- Opening the agent checks its saved binding first. An unbound device shows the phone binding URL and code before opening the camera. After approval, or with an existing saved binding, the live viewfinder opens automatically with the caption “单击拍照，自动识别账单”.
- One activation releases the preview camera, captures a high-quality photo in `default` mode to preserve the full field of view, and starts recognition automatically. The frozen photo stays visible during recognition. Compare preview and photo framing on the glasses; matching framing is not yet verified.
- First use requires signing in on the phone at the [device authorization page](https://ledger.zcorw.xyz/receipt-devices), entering the code shown on the glasses and explicitly approving it before capture. Receipt-only authorization remains valid until revoked or the account password changes. The credential is saved in Agent-isolated storage and restored after exit or device restart. Clearing Agent data requires authorization again.
- The original JPEG/PNG/WebP bytes are uploaded unchanged over HTTPS and privately archived with the recognition record on the VPS; only a separate server-side copy is converted for recognition. The backend calls its configured recognition service. Validated actual bill fields appear in a full-screen scrolling layout matching `preview/index.html`, with a prominent amount and currency symbol. Unconfirmed fields stay empty, including the amount; no sample values or placeholders are inserted. Expenses are not saved automatically.
- View archived originals at **Daily Expenses → Recognized receipts** on the website; saved expenses can link the same receipt. Existing photos that were never uploaded/stored cannot be recovered.
- **Draft** saves the current candidate against that same original, without another upload or expense. Repeated clicks reuse an operation key; uncertain responses are checked before retry. On the website, filter unposted drafts or search the merchant to continue editing. This requires backend migration `0014_receipt_drafts` and the matching website/backend deployment.
- **Confirm** requires a complete reviewed candidate and a separate phone acknowledgement enabling accounting for this exact device. Existing receipt grants are not upgraded automatically. The server reuses the existing expense writer and freezes the reviewed draft revision; duplicate clicks, retries and restart recovery cannot create another expense for the same receipt. A possible duplicate requires a second explicit confirmation. Local recovery stores only backend-bound receipt/revision/request IDs; it queries the outcome before any explicit retry, never stores bill fields or photos. The permission can be revoked independently on the phone. Successful confirmation offers **Continue capture**.
- Cancel, hide and exit stop the viewfinder, clear local photos and abort network work. This does not delete an original already stored by the server. Recognition failures can retry the same photo or take a new one.
- **Voice edit** starts one microphone speech-recognition session only after activation. The transcript and current candidate go to the authenticated backend for a structured correction; unchanged fields are preserved, ambiguous accounts/currencies require clarification, and failures keep the candidate. No expense or draft is saved by voice editing. This branch declares `RECORD_AUDIO`; unsupported runtimes can continue editing on the website.

Deploy both sides together. Flow Ledger 2 must migrate through `0015_device_expense_grants` and deploy the matching website/API before installing this package. Set `APP_BASE_URL=https://ledger.zcorw.xyz` and configure backend recognition. An older backend cannot serve the new review workflow. See [new workflow](docs/REVIEW-WORKFLOW.md), [agent flow](docs/AGENT-FLOW.md), [API contract](docs/OCR-CONTRACT.md) and [device acceptance](docs/DEVICE-ACCEPTANCE.md).

## Local checks

Use Node.js 22 or newer: `npm run check` and `npm test`. Install development dependencies with `npm ci --ignore-scripts`. Tests use synthetic photos/responses and never contact production recognition. Compile and sync the resource package in a supported native AIUI runtime for device acceptance.

## Independent browser demos

The [receipt review demo](docs/REVIEW-PROTOTYPE.md) retains individual-field editing and explicit confirmation. `/preview/chain.html` composes a complete synthetic capture, recognition, edit and submission sequence. These demos are not registered native routes and do not contact the camera or real backend. Only synthetic recovery data is stored in this browser; see [integration scope](docs/SYNTHETIC-CHAIN.md). Chromium CI checks do not replace device acceptance.
