import { adaptReceiptResponse } from './receipt-candidate.js';

export function createReceiptRecognitionController({ recognize, notify = () => {} } = {}) {
  if (typeof recognize !== 'function') throw new Error('RECOGNIZER_REQUIRED');
  let generation = 0, closed = false, busy = false, active = null;
  let state = 'idle', result = null, error = '';
  const snapshot = () => ({ state, busy, error, result: result ? { ...result, values: { ...result.values }, missingFields: [...result.missingFields], warnings: [...result.warnings] } : null });
  const emit = () => { if (!closed) notify(snapshot()); };
  return {
    snapshot,
    async run(photo) {
      if (closed || busy || !(photo?.data instanceof ArrayBuffer) || !photo.data.byteLength) return false;
      const current = ++generation;
      const controller = new AbortController(); active = controller;
      busy = true; state = 'recognizing'; result = null; error = ''; emit();
      try {
        const response = await recognize(photo, { signal: controller.signal });
        if (closed || current !== generation) return false;
        const candidate = adaptReceiptResponse(response?.status, response?.body);
        if (!candidate.ok) throw new Error(candidate.code);
        result = { ...candidate, ...(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(response.receiptId || '') ? { receiptId: response.receiptId } : {}) }; state = 'recognized';
        return true;
      } catch (failure) {
        if (!closed && current === generation) {
          state = 'failed';
          const codes = ['RECEIPT_ARCHIVE_FAILED', 'AUTH_REQUIRED', 'AUTH_STORAGE_UNAVAILABLE', 'AUTH_STORAGE_FAILED', 'RATE_LIMITED', 'TIMEOUT', 'INVALID_RESULT', 'NETWORK_ERROR', 'BACKEND_UNAVAILABLE', 'BACKEND_REDIRECT', 'BACKEND_CONFIG', 'BACKEND_NOT_CONFIGURED', 'RUNTIME_UNSUPPORTED', 'DEVICE_ENDPOINT_UNAVAILABLE', 'DEVICE_ACCESS_DENIED', 'DEVICE_CODE_EXPIRED', 'DEVICE_CODE_USED', 'DEVICE_RATE_LIMIT', 'IMAGE_TOO_LARGE', 'IMAGE_ENCODING_UNSUPPORTED', 'IMAGE_ENCODING_FAILED', 'RECEIPT_NOT_FOUND'];
          error = codes.includes(failure?.message) ? failure.message : 'RECOGNITION_FAILED';
        }
        return false;
      } finally {
        if (!closed && current === generation) { active = null; busy = false; emit(); }
      }
    },
    cancel() {
      if (closed) return;
      generation++; busy = false; state = 'idle'; result = null; error = ''; emit();
      active?.abort(); active = null;
    },
    close() { closed = true; generation++; active?.abort(); active = null; busy = false; state = 'closed'; result = null; error = ''; },
  };
}
