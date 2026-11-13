# Camera capability spike

This is an AIUI source prototype, not an APK, deployable production app, OCR implementation, or completed device acceptance. No server, credentials, network permission, persistent storage, or automatic billing submission is included. All receipts used for testing must be synthetic.

## Runtime contract

Official reference: https://github.com/yodaos-project/AIUI/blob/cf2908bf95359bfa76a04d0f6abde9313b6c92f1/documentation/3-api/media/media-capture.en-US.md

The application must run in a supported native AIUI runtime with `_blank` lifetime and CAMERA permission. The documented wx camera factory may be unavailable on wasm32 or other unsupported runtimes. Declaring CAMERA does not grant consent. Capture only follows a visible button press, with system preview requested. High quality / telephoto are documented options, not measured framing guarantees.

Native capture cancellation is not documented: clearing or hiding invalidates the result, but another native capture is blocked until the original promise settles. The controller holds at most one encoded photo in volatile memory. Clearing drops references; this is not guaranteed secure memory erasure. Camera context has no documented manual disposal method. No invented release API is called.

## Local verification

Use Node.js 22 or newer: `npm run check && npm test`. No dependencies are needed. Tests cover successful capture, missing native API, permission failure, malformed response, cancellation, duplicate requests and teardown. The page script is syntax-checked but the actual Ink renderer and native module are not exercised. GitHub Actions repeats these checks. Passing Node CI is not hardware acceptance.

## Required device acceptance (not yet executed)

Record device model, firmware, AIUI version and launch mechanism. Load `aiui/` using the official supported development process for that target, with `_blank`; this repository does not guess a packaging command.

1. Deny camera consent: no capture/upload; failure is visible and retry is possible.
2. Grant consent and capture a synthetic receipt: system preview appears, encoded bytes arrive, and framing/readability are inspected using a separately reviewed local preview/OCR step. Current UI only displays byte count, not an image preview.
3. Test dim lighting, long receipt and large print. Record measured image dimensions/MIME and readability; do not assume documented nominal resolution matches hardware.
4. Repeated taps do not create concurrent capture. Cancel/hide during capture discards late output. Return and retry after native capture settles.
5. Exit/reopen and repeat at least 20 times: no camera lock, stale photo, or unexpected memory growth. Confirm platform camera privacy indicators turn off.
6. Verify no outgoing traffic and no receipt is persisted.

The Zhixu camera task stays in progress until native runtime and device checks pass. OCR, editable review, authentication/privacy, and confirmed idempotent submission are separate unimplemented tasks. A browser mock cannot prove the native camera contract.

## Capture entry and device navigation

The previous page exposed tap buttons but did not explain that the conversation card
and full-screen page are different interaction contexts. This is a confirmed guidance
gap, not a confirmed diagnosis of a particular device failure.

The official AIUI documentation at commit
`cf2908bf95359bfa76a04d0f6abde9313b6c92f1` describes:
- [Target](https://github.com/yodaos-project/AIUI/blob/cf2908bf95359bfa76a04d0f6abde9313b6c92f1/documentation/1-framework/open-agent-format/target.en-US.md):
  double-tap the conversation card to enter the full-screen `_blank` container.
- [Events](https://github.com/yodaos-project/AIUI/blob/cf2908bf95359bfa76a04d0f6abde9313b6c92f1/documentation/1-framework/open-agent-format/page-events.en-US.md):
  page `onKeyUp` receives `Enter`, `ArrowUp`, and `ArrowDown`; use
  `preventDefault()` when taking over the host's built-in action.
- Camera access requires `_blank`; declaring CAMERA does not grant OS permission.

The updated page shows entry instructions before the status text. Once the host
reports `_blank`, direction keys switch between capture and clear/cancel, and
Enter executes the displayed selection. Backspace, GlobalHook and voice wakeup
are not intercepted. Repeated key events are ignored. Tap buttons remain available.
A reported inline target blocks capture and returning to inline invalidates pending
image results. If an older host never reports the target, key handling stays with
the host and tap capture still relies on the native API's target/permission checks.

Acceptance on the target glasses must check:
1. Open the current draft; verify the entry hint is visible in the card.
2. Double-tap into full-screen and verify the hint changes to full-screen controls.
3. Move selection and confirm capture with a synthetic receipt, then clear it.
4. Verify one activation does not cause duplicate captures, and cancel while busy.
5. Verify returning to the card discards the image; Backspace/voice still behave normally.
6. Record the AIUI version and whether target/key callbacks actually arrive. If the
   hint never changes, distinguish an old imported build from missing host callbacks.

The Node page tests execute the actual exported callbacks with a mocked controller.
They do not compile the Ink layout, emulate focus routing, grant camera permission,
or prove physical-device capture. No OCR contract or receipt upload is added.
