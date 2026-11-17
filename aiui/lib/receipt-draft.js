// An idempotency identifier is not a credential. Older AIUI hosts may lack Crypto.
export const newRequestKey = () => globalThis.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const n = Math.floor(Math.random() * 16); return (c === 'x' ? n : (n & 3) | 8).toString(16);
});
export function createDraftSaver({ save, load, notify = () => {}, makeKey = newRequestKey } = {}) {
  let receipt = '', revision = 0, fingerprint = '', key = '', busy = false, run = 0, abort = null;
  return {
    adopt(draft) {
      if (busy || !draft?.saved || !Number.isSafeInteger(draft.revision) || draft.revision < 1 || !draft.values) return false;
      receipt = draft.receiptId; revision = draft.revision; fingerprint = JSON.stringify(draft.values); key = draft.requestKey;
      return true;
    },
    async run(receiptId, values) {
      if (busy) return false;
      if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(receiptId || '')) {
        notify({ state: 'failed', busy: false, error: 'RECEIPT_ID_REQUIRED' }); return false;
      }
      if (receipt !== receiptId) { receipt = receiptId; revision = 0; fingerprint = ''; key = ''; }
      const encoded = JSON.stringify(values);
      if (fingerprint !== encoded) { fingerprint = encoded; key = makeKey(); }
      busy = true; const current = ++run; abort = new AbortController();
      const signal = abort.signal, requestKey = key;
      notify({ state: 'saving', busy: true });
      try {
        let result;
        try { result = await save({ receiptId, values: { ...values }, expectedRevision: revision, requestKey }, { signal }); }
        catch (failure) {
          if (!['NETWORK_ERROR', 'TIMEOUT', 'BACKEND_UNAVAILABLE'].includes(failure?.message) || signal.aborted) throw failure;
          // A lost response is checked by key before the owner chooses whether to retry.
          try { const stored = await load(receiptId, { signal }); if (stored.requestKey === requestKey) result = stored; } catch {}
          if (!result) throw failure;
        }
        if (current !== run) return false;
        if (result?.receiptId !== receiptId || result.requestKey !== requestKey || result.saved !== true || !Number.isSafeInteger(result.revision) || result.revision < 1) throw new Error('INVALID_RESULT');
        revision = result.revision;
        notify({ state: 'saved', busy: false, result });
        return result;
      } catch (failure) {
        if (current === run) notify({ state: 'failed', busy: false, error: failure?.message || 'DRAFT_FAILED' });
        return false;
      } finally { if (current === run) { busy = false; abort = null; } }
    },
    cancel() { run++; abort?.abort(); abort = null; busy = false; },
  };
}
