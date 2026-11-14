# Camera capability spike

This is an AIUI source prototype, not an APK, deployable production app, OCR implementation, or completed device acceptance. No server, credentials, network permission, persistent storage, or automatic billing submission is included. All receipts used for testing must be synthetic.

## Runtime contract

Official reference: https://open.rokid.com/aiui/api/media/media-capture?lang=zh-CN&version=0.19.0

This test build does not gate camera calls by page target. AIUI documents media access after entering `_blank`, disables media capture for `app.config.lifetime === 'cut'`, and requires CAMERA permission. The documented wx camera factory may be unavailable on wasm32 or other unsupported runtimes. Declaring CAMERA does not grant consent. Capture only follows an explicit confirmation or button press, with system preview requested. High quality / telephoto are documented options, not measured framing guarantees.

Encoded photos with image/jpeg, image/png or image/webp MIME types are accepted; the original bytes and MIME type are preserved.

Native capture cancellation is not documented: clearing or hiding invalidates the result, but another native capture is blocked until the original promise settles. The controller holds at most one encoded photo in volatile memory. Clearing drops references; this is not guaranteed secure memory erasure. Camera context has no documented manual disposal method. No invented release API is called.

## Local verification

Use Node.js 22 or newer: `npm run check && npm test`. No dependencies are needed. Tests cover successful capture, missing native API, permission failure, malformed response, cancellation, duplicate requests and teardown. The page script is syntax-checked but the actual Ink renderer and native module are not exercised. GitHub Actions repeats these checks. Passing Node CI is not hardware acceptance.

## Required device acceptance (full checklist pending)

Record device model, firmware, AIUI version and launch mechanism. Load `aiui/` using the official supported development process and test card and full-screen entry separately. Removing the page guard does not establish that either environment supports camera capture.

1. Deny camera consent: no capture/upload; failure is visible and retry is possible.
2. Grant consent and capture a synthetic receipt: system preview appears, encoded bytes arrive, and framing/readability are inspected using a separately reviewed local preview/OCR step. Current UI only displays byte count, not an image preview.
3. Test dim lighting, long receipt and large print. Record measured image dimensions/MIME and readability; do not assume documented nominal resolution matches hardware.
4. Repeated taps do not create concurrent capture. Cancel/hide during capture discards late output. Return and retry after native capture settles.
5. Exit/reopen and repeat at least 20 times: no camera lock, stale photo, or unexpected memory growth. Confirm platform camera privacy indicators turn off.
6. Verify no outgoing traffic and no receipt is persisted.

The Zhixu camera task stays in progress until native runtime and device checks pass. OCR, editable review, authentication/privacy, and confirmed idempotent submission are separate unimplemented tasks. A browser mock cannot prove the native camera contract.

## Capture entry and device navigation

The capture and review pages no longer store or branch on `hostTarget`. This is
a device experiment to determine whether the native camera can be invoked from
the current card entry without first switching to a full-screen container.

Direction keys select an action and Enter executes it without requiring a target
callback. Backspace, GlobalHook and voice wakeup are not intercepted. Repeated
key events are ignored, review inputs retain native keyboard focus, and tap
buttons remain available. Changing target alone no longer clears the photo;
explicit clear/cancel, page hide and unload still invalidate image results.
Native camera availability and permission checks remain in effect.

User-reported glasses verification: the camera returned an ArrayBuffer of 965298
bytes with MIME type image/webp. The original JPEG/PNG-only allowlist rejected
that result. After adding WebP support, the user confirmed capture succeeds.
Device model, firmware and AIUI version were not recorded in this report; the
remaining permission, cancellation, image-quality and repeat-run checks above
are still pending.

Capture failures now show the failing stage (camera creation, native takePhoto,
or returned-photo validation), plus the native error name/code/message when
available. Invalid-photo diagnostics report only result/data types, byte length
and MIME type. The same metadata is logged with the [capture] prefix; image
bytes are not included. Clear/cancel and a new capture reset the diagnostics.

Acceptance on the target glasses must check:
1. Open the current draft in the card and verify the generic entry hint appears.
2. Select capture and confirm once; record whether the system camera preview opens
   or the page reports unsupported/failed capture.
3. Repeat from a full-screen launch and compare results using a synthetic receipt.
4. Verify one activation does not cause duplicate captures, and cancel while busy.
5. Verify hiding or exiting the page discards the image; Backspace/voice still
   behave normally. Confirm that card navigation remains usable when the page
   handles direction and confirmation keys.
6. Record the AIUI version and actual key callbacks. Rebuild and sync the latest
   resource package before comparing results.

The Node page tests execute the actual exported callbacks with a mocked controller.
They do not compile the Ink layout, emulate focus routing, grant camera permission,
or prove physical-device capture. No OCR contract or receipt upload is added.
