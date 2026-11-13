// Dependency-injected integration. The bundled preview uses synthetic data only.
import { createCaptureController } from './capture.js';
import { adaptReceiptResponse } from './receipt-candidate.js';
import { createReview } from './review.js';
import { createSubmission } from './submission.js';

export function createReceiptFlow({ cameraFactory, recognize, transport, newRequestKey, storage, notify = () => {} }) {
  const capture = createCaptureController({ cameraFactory });
  const review = createReview();
  let state = 'idle', error = '', busy = false, generation = 0;
  let submission;
  const persist = value => storage.set(JSON.stringify({ version: 1, ...value }));
  // Persist uncertainty BEFORE handing off to transport. A restart can never
  // silently issue a new key or claim that an interrupted send was not saved.
  submission = createSubmission({ newRequestKey, transport: async payload => {
    persist({ state: 'unknown', payload, recordId: null });
    return transport(payload);
  } });
  try {
    const raw = storage.get();
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved.version !== 1) throw new Error('INVALID_RECOVERY');
      if (saved.state === 'cancelled' && saved.payload === null) state = 'cancelled';
      else {
        if (!submission.restore(saved)) throw new Error('INVALID_RECOVERY');
        state = 'submission';
      }
    }
  } catch { state = 'recovery_error'; error = 'RECOVERY_UNAVAILABLE'; }
  const snapshot = () => ({ state, error, busy, hasPhoto: !!capture.snapshot().photo, review: review.snapshot(), submission: submission.snapshot() });
  const emit = () => { notify(snapshot()); return snapshot(); };
  const save = () => {
    try { persist(submission.snapshot()); return true; }
    catch { error = 'RECOVERY_UNAVAILABLE'; state = 'recovery_error'; return false; }
  };
  async function send(method) {
    if (busy || state !== 'submission') return snapshot();
    busy = true;
    const current = ++generation;
    const pending = submission[method](); emit();
    await pending;
    if (current !== generation) return snapshot();
    save(); busy = false;
    return emit();
  }
  return {
    snapshot,
    async start() {
      if (busy || !['idle', 'failed', 'cancelled'].includes(state)) return snapshot();
      busy = true; error = ''; const current = ++generation; state = 'capturing'; emit();
      try {
        const ok = await capture.capture();
        if (current !== generation) return snapshot();
        if (!ok) throw new Error('CAPTURE_FAILED');
        state = 'recognizing'; emit();
        const result = await recognize(capture.snapshot().photo);
        if (current !== generation) return snapshot();
        const candidate = adaptReceiptResponse(result.status, result.body);
        if (!candidate.ok) throw new Error(candidate.code);
        review.load(candidate.values); state = 'editing';
      } catch (e) {
        if (current === generation) { state = 'failed'; error = ['AUTH_REQUIRED', 'RATE_LIMITED', 'TIMEOUT', 'INVALID_RESULT', 'CAPTURE_FAILED'].includes(e?.message) ? e.message : 'RECOGNITION_FAILED'; }
      } finally {
        if (current === generation || (state === 'cancelled' && busy && capture.snapshot().busy === false)) { capture.discard(); busy = false; emit(); }
      }
      return snapshot();
    },
    move(delta) { if (state === 'editing') review.move(delta); return emit(); },
    edit(value) { if (state === 'editing') review.edit(value); return snapshot(); },
    preview() { if (state === 'editing' && review.preview()) state = 'review'; return emit(); },
    back() { if (state === 'review') { review.back(); state = 'editing'; } return emit(); },
    confirm() {
      if (state !== 'review' || !review.confirm()) return snapshot();
      submission.prepare(review.snapshot(), 'receipt_ocr'); state = 'submission'; save(); return emit();
    },
    submit: () => send('submit'), retry: () => send('retry'), confirmDuplicate: () => send('confirmDuplicate'),
    next() {
      if (state === 'submission' && submission.snapshot().state === 'succeeded' && !busy) { review.cancel(); state = 'idle'; }
      return emit();
    },
    cancel() {
      const wasRecognizing = state === 'recognizing';
      generation++; capture.discard(); review.cancel();
      if (wasRecognizing) busy = false;
      if (state === 'recovery_error') return emit();
      if (state === 'submission') {
        submission.cancel(); busy = false; save();
        if (state !== 'recovery_error' && submission.snapshot().state === 'cancelled') state = 'cancelled';
      }
      else state = 'cancelled';
      return emit();
    },
  };
}
