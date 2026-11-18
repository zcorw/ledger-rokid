// Reuse the verified submission state machine. Only a receipt ID, revision and
// request key are journaled locally; fields/photos remain on the server.
import { buildSubmission, createSubmission } from './submission.js';
import { newRequestKey } from './receipt-draft.js';

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
const fromRecord = record => ({ amount: record.amount, expenseDate: record.expense_date, currencyCode: record.currency_code,
  merchant: record.merchant || '', category: record.category, note: record.note || '', accountId: record.account_id, accountName: '' });

export function createNativeConfirmation({ api, saveDraft, restoreDraft = () => {}, store, notify = () => {}, makeKey = newRequestKey, resource = 'https://ledger.zcorw.xyz/api/v1/receipt-devices' }) {
  let machine = null, pending = null, busy = false, generation = 0, journaled = false;
  let state = 'idle', values = null, fingerprint = '', lastOutcome = null, lastError = '';
  let controller = null;
  const emit = (next, detail = {}) => { state = next; notify({ state, busy, pending: journaled, values, receiptId: pending?.receiptId || '', ...detail }); };
  function clearJournal() { store.remove(); journaled = false; }
  function validRecord(outcome) {
    if (outcome?.status !== 'recorded' || outcome.receiptId !== pending?.receiptId || !uuid(outcome.record?.id) || outcome.record.receipt_id !== pending.receiptId) return false;
    try { buildSubmission({ state: 'confirmed', confirmed: fromRecord(outcome.record) }, pending.requestKey, outcome.record.source); return true; } catch { return false; }
  }
  function recorded(outcome) {
    const accountName = values?.accountId === outcome.record.account_id ? values.accountName : '';
    values = { ...fromRecord(outcome.record), accountName }; busy = false;
    try { clearJournal(); } catch { /* Recovery will read the already committed outcome again. */ }
    emit('succeeded', { recordId: outcome.record.id });
    return true;
  }
  function initialize(restoring = false) {
    const snapshot = buildSubmission({ state: 'confirmed', confirmed: values }, pending.requestKey, 'receipt_ocr');
    machine = createSubmission({ newRequestKey: () => pending.requestKey, transport: async payload => {
      store.set(JSON.stringify(pending)); journaled = true;
      const signal = controller?.signal;
      try {
        lastOutcome = await api.getConfirmation(pending.requestKey, pending.receiptId, { signal });
        if (lastOutcome.status === 'deleted') return { status: 409, body: { error: { code: 'EXPENSE_ALREADY_DELETED' } } };
        if (lastOutcome.status === 'recorded') return { status: 200, body: lastOutcome.record };
        if (lastOutcome.status !== 'not_found') throw new Error('INVALID_RESULT');
        const response = await api.confirmReceipt({ receiptId: pending.receiptId, revision: pending.revision, requestKey: pending.requestKey, confirmed: true, allowDuplicate: payload.allowDuplicate }, { signal });
        if ([200, 201].includes(response.status)) { lastOutcome = response.body; return { status: response.status, body: response.body?.record }; }
        lastError = response.body?.error?.code || 'CONFIRMATION_UNKNOWN';
        // An explicit rejected request did not create an expense. Keep in-memory
        // duplicate confirmation, but allow editing or permission correction.
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) clearJournal();
        return response;
      } catch (error) { lastError = error?.message || 'CONFIRMATION_UNKNOWN'; throw error; }
    } });
    if (restoring) machine.restore({ state: 'unknown', payload: snapshot, recordId: null });
    else machine.prepare({ state: 'confirmed', confirmed: values }, 'receipt_ocr');
  }
  return {
    isBusy: () => busy,
    hasPending: () => journaled,
    async recover() {
      if (busy) return false;
      const current = ++generation;
      try {
        const raw = store.get();
        if (!raw) return false;
        if (typeof raw !== 'string' || raw.length > 1024) throw new Error('RECOVERY_UNAVAILABLE');
        pending = JSON.parse(raw); journaled = true;
        if (pending.version !== 1 || pending.resource !== resource || !uuid(pending.receiptId) || !uuid(pending.requestKey) || !Number.isSafeInteger(pending.revision) || pending.revision < 1 || Object.keys(pending).length !== 5) throw new Error('RECOVERY_UNAVAILABLE');
        busy = true; controller = new AbortController(); emit('checking');
        const outcome = await api.getConfirmation(pending.requestKey, pending.receiptId, { signal: controller.signal });
        if (current !== generation) return true;
        if (validRecord(outcome)) return recorded(outcome);
        if (outcome.status === 'deleted') { clearJournal(); busy = false; emit('conflict', { error: 'EXPENSE_ALREADY_DELETED' }); return true; }
        if (outcome.status !== 'not_found') throw new Error('INVALID_RESULT');
        const draft = await api.getDraft(pending.receiptId, { signal: controller.signal });
        if (current !== generation) return true;
        if (!draft.values) throw new Error('DRAFT_VERSION_CONFLICT');
        restoreDraft(draft);
        if (draft.revision !== pending.revision) {
          const receiptId = pending.receiptId;
          clearJournal(); values = { ...draft.values }; pending = null; machine = null; fingerprint = ''; busy = false;
          emit('needs_review', { receiptId, error: 'DRAFT_VERSION_CONFLICT' }); return true;
        }
        values = { ...draft.values }; fingerprint = JSON.stringify(values); initialize(true);
        busy = false; emit('unknown', { error: 'CONFIRMATION_UNKNOWN' }); return true;
      } catch (error) {
        if (current === generation) { busy = false; journaled = true; emit('unknown', { error: error?.message || 'RECOVERY_UNAVAILABLE' }); }
        return true;
      } finally { if (current === generation) { busy = false; controller = null; } }
    },
    async confirm(receiptId, candidate) {
      if (busy || state === 'succeeded') return false;
      if (journaled && !machine) return this.recover();
      busy = true; const current = ++generation; controller = new AbortController();
      emit('checking_permission');
      try {
        if (!journaled && (pending?.receiptId !== receiptId || fingerprint !== JSON.stringify(candidate) || !machine)) {
          const key = makeKey();
          if (!uuid(receiptId) || !candidate?.accountId || !candidate?.category) throw new Error('REVIEW_INCOMPLETE');
          buildSubmission({ state: 'confirmed', confirmed: candidate }, key, 'receipt_ocr');
          const capabilities = await api.capabilities({ signal: controller.signal });
          if (current !== generation) return false;
          if (!capabilities.canCreateExpenses) { busy = false; emit('permission', { authorizationUri: capabilities.authorizationUri, error: 'EXPENSE_PERMISSION_REQUIRED' }); return false; }
          emit('preparing');
          const draft = await saveDraft(receiptId, candidate);
          if (current !== generation) return false;
          if (!draft) throw new Error('DRAFT_FAILED');
          pending = { version: 1, resource, receiptId, revision: draft.revision, requestKey: key };
          values = { ...candidate }; fingerprint = JSON.stringify(candidate); initialize();
        }
        emit('submitting'); lastError = ''; lastOutcome = null;
        const before = machine.snapshot().state;
        const result = await (before === 'duplicate_confirmation' ? machine.confirmDuplicate() : before === 'unknown' ? machine.retry() : machine.submit());
        if (current !== generation) return false;
        if (validRecord(lastOutcome)) return recorded(lastOutcome);
        busy = false;
        if (result.state === 'duplicate_confirmation') emit('duplicate_confirmation', { error: 'POSSIBLE_DUPLICATE' });
        else if (result.state === 'conflict') { try { clearJournal(); } catch {} emit('conflict', { error: lastError || 'EXPENSE_ALREADY_DELETED' }); }
        else { if (!journaled) machine = null; emit('unknown', { error: lastError || 'CONFIRMATION_UNKNOWN' }); }
        return false;
      } catch (error) {
        if (current === generation) { busy = false; emit('failed', { error: error?.message === 'INVALID_CONFIRMATION' ? 'REVIEW_INCOMPLETE' : error?.message || 'CONFIRMATION_UNKNOWN' }); }
        return false;
      } finally { if (current === generation) { busy = false; controller = null; } }
    },
    cancel() { generation++; controller?.abort(); controller = null; machine?.cancel(); busy = false; },
    reset() {
      if (journaled) return false;
      machine = null; pending = null; values = null; fingerprint = ''; state = 'idle'; return true;
    },
  };
}
