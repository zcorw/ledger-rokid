# Agent flow

The baseline below describes the previously accepted capture/recognition package. The development branch now adds the fixed review page, Voice edit, Draft and separately authorized Confirm actions; use [the current workflow](REVIEW-WORKFLOW.md) for the new behavior and its pending device acceptance.

## Current flow

1. Opening the agent goes directly to the capture page and checks its saved
   binding. Without one, it shows the phone binding URL and code immediately,
   before requesting any camera stream. Phone approval saves the grant and then
   automatically opens the viewfinder. A saved binding opens it directly.
2. Below the preview, a single small caption reads `单击拍照，自动识别账单`.
   There is no separate open-preview button or synthetic-review shortcut.
3. A tap on the preview or an Enter confirmation stops the preview and takes
   one photo using the verified wx camera path. Duplicate callbacks do not
   produce another exposure or recognition request.
4. The captured image is displayed while `正在识别账单…` is shown. Recognition
   runs automatically, with no second confirmation button.
5. The result replaces the camera view with bill content only: large amount,
   currency symbol, merchant, date and any returned optional bill fields.
   The original photo and its canvas pixels are then cleared.

Recognition uses the receipt-only Flow Ledger 2 API at https://ledger.zcorw.xyz.
The phone owner must sign in, enter the matching code at /receipt-devices and
explicitly approve once. The receipt-only grant has no automatic expiry. Its
credential is restored from Agent-isolated storage before opening the camera after
exit or device restart. This local check does not contact the backend when a valid
saved grant exists. If recognition returns 401/403, the grant and photo are cleared
and the next retry binds again before opening the camera.
Phone revocation or an account password change invalidates it; clearing Agent
data requires authorization again. Original JPEG/PNG/WebP bytes are uploaded unchanged and archived with the candidate in the VPS database. A separate server-side copy is normalized for recognition; the display thumbnail is never uploaded. The X-Receipt-Id header links the result to the stored original. Upload and response sizes are bounded, requests
use HTTPS without cookies or redirects, and failure never generates a sample bill.
The agent does not submit expenses. Both backend migration/API and phone UI must
be deployed before real recognition works. See [contract](OCR-CONTRACT.md).

Binding failures keep the camera closed and offer a binding retry. Failures during
recognition show a short error and a retry action. A recognition retry reuses the
captured photo rather than taking another picture; retake opens a fresh preview.
Hiding, returning or unloading clears the preview, image and bill, aborts pending
network work and invalidates recognition. Exiting clears the in-memory client while retaining the saved authorization. Returning
to the capture page opens a fresh preview. Direction and back keys remain with
the host for scrolling and navigation.

## Deferred work

- [ ] Deploy the paired backend/frontend and validate actual OCR on glasses.
- [ ] Implement voice changes to bill values: select a field, speak the new value,
  review it and explicitly confirm. Keep the normal bill view free of instruction
  text. No voice-edit control, microphone permission or recording is implemented.

## Target-device checks

On an unbound device, open the updated agent and verify the phone binding prompt
appears before any camera access. Approve on the phone and verify preview opens
automatically with only the caption below it. Reopen with a saved binding and
verify no new code is requested. Confirm the camera does not expose until a
separate activation. Tap once; verify the frozen photo, recognition status and
actual returned bill appear in sequence. Exit or background during binding,
camera acquisition, photo capture
and recognition, then return and verify a fresh preview without stale results.
The Node checks execute the real page callbacks with mocked native APIs; they do
not compile Ink or prove target-device rendering or key delivery.
