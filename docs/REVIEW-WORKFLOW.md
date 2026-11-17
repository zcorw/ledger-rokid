# Receipt review workflow

**English** | [简体中文](REVIEW-WORKFLOW.zh-CN.md)

The owner accepted the previous capture/recognition package on 2026-11-17. This increment adds review layout, speech changes, saved drafts and explicitly authorized accounting. Its local tests/package do not establish installation or acceptance on the glasses.

The actual registered capture page contains the review interface. Five labels remain visible when values are missing. Confirmed currency codes distinguish JPY/CNY and USD/CAD; no currency is inferred from an ambiguous symbol. Scroll fields while the three actions remain at the bottom. Direction keys select an action; Enter/tap activates once. Pending financial outcomes lock changes until checked.

Voice edit starts the runtime's `SpeechRecognition` in the user's activation, releases the microphone after a final result, error, timeout or exit, and sends only the transcript/current fields to the backend correction endpoint. Missing runtime support or permission errors preserve the candidate and offer the website as an alternative. The backend model cannot save or submit financial entries. Corrected field labels and warnings are shown. Account names must match one owned active account; ambiguous names are not guessed.

Draft saves the current fields on the existing original receipt. Stable operation keys and optimistic versions protect retries/stale edits. A lost save response is queried. A failed save retains the candidate. The website's Recognized receipts page can filter/search drafts, show the original, edit fields and explicitly create a linked expense. Original OCR fields and original image bytes are preserved separately from the corrected draft.

Confirm requires amount, date, ISO currency, category and account. If accounting is not enabled, the glasses display the phone device-authorization link. Opening it does not authorize anything: the signed-in owner must select the exact device, read the warning, check the acknowledgement and approve. Revocation of accounting does not revoke receipt recognition/draft access. Ordinary asset/administrative APIs remain inaccessible to the device token.

The confirmed draft revision is submitted through the existing verified submission state machine and backend expense writer. An existing linked expense is returned instead of recreated; deleted-record tombstones remain effective. A possible duplicate requests a second explicit activation. Permission checks, draft saving and submission are mutually exclusive with editing. Cancel/hide/exit invalidates late results and preserves financial uncertainty.

Before a financial request, Agent-isolated storage receives only `{version, resource, receiptId, revision, requestKey}`. It contains no image, field values, transcript or provider key. A storage error prevents sending. Restart recovery first queries the server outcome; a committed expense needs no new POST. An uncommitted operation loads the server draft and waits for explicit confirmation to reuse the same key. A changed draft is shown for fresh review. After success, Continue capture starts a new receipt.

Deploy the paired website/backend through migrations `0014_receipt_drafts` and `0015_device_expense_grants`, then install this resource package. Do not auto-enable accounting on existing grants. Use `npm run check`, `npm test` and `node qa/review-layout.mjs` for local checks (`REVIEW_CHROMIUM_PATH` may select an installed Chromium browser). Tests use synthetic data and mocked speech/model replies.

New-package device acceptance must cover: five fields/long text/scroll/focus; microphone permission, real transcription and ambiguous instructions; draft visibility/originals on the website; separate phone accounting consent/revocation; successful confirmation and duplicate warnings; interrupted/late requests and Agent/device restart; no repeated expenses or financial changes from Voice edit/Draft. Record actual firmware and resource-package versions when testing.

Reference: [Rokid speech API](https://open.rokid.com/aiui/api/ai/speech-recognition?lang=en-US&version=0.19.0).
