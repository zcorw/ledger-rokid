# Camera and agent flow acceptance

## Reported device results

The glasses returned an ArrayBuffer of 965298 bytes with MIME type image/webp.
The original JPEG/PNG-only allowlist rejected that result; accepting WebP fixed
the still-photo path. The user later reported that the camera tests passed.
Device model, firmware and complete AIUI version were not recorded.

The device reported create-image-capture/unsupported, so live preview uses
getUserMedia, a MediaStream object URL and a native video component. It does not
require ImageCapture or Canvas. The user saw moving video followed by our former
wait-video timeout: a missing or unrecognized playing event was not evidence of
failed playback. That callback is now optional diagnostic information, and no
playback-callback timeout closes a working preview.

These reports cover the earlier camera/display work. The new automatic entry
and real recognition/persistent authorization flow still needs target-device verification.

## Current flow

Opening the agent goes directly to the capture page. After its first frame is
ready, a live viewfinder opens automatically. The only normal caption below it
is `单击拍照，自动识别账单`. There is no open-preview button, test heading,
action selector or separate synthetic-review shortcut. A tap or Enter activation
captures once, displays the photo while recognition runs, and then shows only
the bill content with a large amount and currency symbol.

Recognition uses the real Flow Ledger 2 HTTPS API after explicit phone approval.
New receipt-only grants remain valid until revoked or the account password changes;
the credential is stored in Agent-isolated native storage and restored after exit
or device restart. Photos and bill contents are never persisted. Voice editing
and accounting submission remain deferred. See [agent flow](AGENT-FLOW.md).

## Native contract and resource handling

Official references:

- [Media capture](https://open.rokid.com/aiui/api/media/media-capture?lang=zh-CN&version=0.19.0)
- [Native stream preview example](https://github.com/yodaos-project/AIUI/blob/c490609a5018152aef52ebcee912e4534e4f4bca/samples/capabilities/pages/scanner/index.ink)
- [Photo decoding example](https://github.com/yodaos-project/AIUI/blob/c490609a5018152aef52ebcee912e4534e4f4bca/samples/capabilities/pages/image_apis/index.ink)

The app declares CAMERA permission. The manifest does not grant operating-system
consent. AIUI documents media access after entering `_blank`, disables media
capture for `app.config.lifetime === 'cut'`, and may omit the wx camera factory
on unsupported runtimes. This device experiment has no hostTarget gate; removing
that gate alone does not establish card/full-screen camera support.

Automatic preview is restricted to a ready, visible page. Exposure still requires
an explicit activation. Direction, system back and voice wakeup stay with the
host; Backspace and Escape clear resources before the normal return action.
Repeated key events and duplicate activation callbacks do not cause another
exposure. Stale playing/error events cannot affect a later preview session.

Shutter confirmation stops all preview tracks and revokes the stream URL before
acquiring the wx still-photo camera, with enableSystemPreview disabled. JPEG,
PNG and WebP bytes and their MIME type are preserved in memory. Native exposure
is not abortable: cancellation invalidates its result, and another physical
capture waits for the original call to settle. A stream arriving after a cancelled
permission request is stopped immediately.

The frozen photo is decoded through Blob/createImageBitmap and drawn into the
mounted 400 by 180 canvas using wx.createCanvasContext('captured-photo'), followed
by flush(). It is centered and scaled to fit without cropping. Each decoded bitmap
is closed after drawing. A display failure does not turn a successful exposure
into a camera failure. The original photo and canvas are cleared after the bill
appears. Cancel, hide and unload invalidate pending recognition and decoding;
late results never restore an old bill or photo. Returning opens a fresh preview.

Camera failures retain the failing stage and native code/message in the display
and diagnostic logs. Logs never include image bytes. Recognition failure displays
an error and allows retry with the same photo, without an extra exposure.

## Target-device checklist

1. Open from the card and full-screen entry separately. Verify preview appears
   automatically and the short caption fits below it without scrolling.
2. Leave preview open beyond 10 seconds. Verify moving frames remain visible
   and no exposure occurs until a separate tap/confirmation.
3. Tap once. Verify one exposure, the frozen photo and recognition status, then
   first-use phone authorization and the actual returned bill with a large amount
   and currency symbol. Confirm amount, date, merchant and currency against the receipt.
4. Repeat taps and key callbacks during exposure and recognition. Verify one
   exposure and one recognition operation. Inspect native framing/readability
   separately because preview and telephoto still framing may differ.
5. Exit/background during permission acquisition, exposure and recognition. Return
   and verify a fresh preview with no stale image or bill. Camera privacy
   indicators must turn off on exit.
6. Deny permission and test unavailable camera/video APIs. Verify a visible error,
   retry behavior and no unconfirmed exposure or fake success on a failure path.
7. Repeat exit/reopen at least 20 times and inspect camera locks and memory growth.
   Verify HTTPS traffic goes only to the configured backend; no photo or receipt
   persists locally. The saved credential must survive Agent exit and device restart
   without another code. Test pairing-code expiry and phone revocation; exit must
   cancel a pending authorization/upload. Deploy both sides and run migration first.
8. Record device, firmware, AIUI version and actual key callbacks. Rebuild and sync
   the latest resource package before comparing results.

## Local checks

Use Node.js 22 or newer: `npm run check && npm test`. Tests run the real page
callbacks and controllers with mocked camera/stream/decoder/recognition APIs.
They cover automatic start, duplicate activation, permission/camera errors,
recognition retries, cancellation, late results, image cleanup and bill fields.
They do not compile Ink, grant permission or prove native rendering and input.
The independent browser review/chain tests are not AIUI emulators.
