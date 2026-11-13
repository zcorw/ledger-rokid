// Isolated state machine: no default transport, credentials, persistence or UI wiring.
import { validate } from './review.js';
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const optional = value => value.trim() || null;
const decimal = value => {
  if (typeof value !== 'string' || !/^\d{1,14}(\.\d{1,6})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return `${whole.replace(/^0+(?=\d)/, '')}.${fraction.padEnd(6, '0')}`;
};

export function buildSubmission(review, requestKey, source) {
  if (!uuid(requestKey) || !['manual', 'receipt_ocr'].includes(source)
      || review?.state !== 'confirmed' || !review.confirmed) throw new Error('INVALID_CONFIRMATION');
  const value = review.confirmed;
  const fields = ['expenseDate', 'amount', 'currencyCode', 'merchant', 'category', 'note'];
  const normalized = { ...value, merchant: value.merchant ?? '', note: value.note ?? '' };
  if (fields.some(key => typeof normalized[key] !== 'string') || validate(normalized).length
      || value.expenseDate.startsWith('0000-')
      || (value.accountId !== null && !uuid(value.accountId))) throw new Error('INVALID_CONFIRMATION');
  return Object.freeze({
    expenseDate: value.expenseDate, amount: value.amount, currencyCode: value.currencyCode,
    category: value.category, merchant: optional(normalized.merchant), note: optional(normalized.note),
    accountId: value.accountId, requestKey, source, allowDuplicate: false,
  });
}

function matchingRecord(body, payload) {
  return body && uuid(body.id) && decimal(body.amount) !== null
    && decimal(body.amount) === decimal(payload.amount)
    && body.expense_date === payload.expenseDate && body.currency_code === payload.currencyCode
    && body.category === payload.category && body.merchant === payload.merchant
    && body.note === payload.note && body.account_id === payload.accountId && body.source === payload.source;
}

// Callers must provide a scoped, authenticated transport in a future integration.
// A promise rejection or ambiguous response NEVER means the server did not save.
export function createSubmission({ transport, newRequestKey }) {
  if (typeof transport !== 'function' || typeof newRequestKey !== 'function') throw new Error('DEPENDENCIES_REQUIRED');
  let state = 'empty', payload = null, recordId = null, generation = 0;
  const snapshot = () => ({ state, payload: payload ? { ...payload } : null, recordId });
  async function send() {
    state = 'submitting';
    const current = ++generation;
    const sent = payload;
    try {
      const result = await transport({ ...sent });
      if (current !== generation) return snapshot();
      if ([200, 201].includes(result?.status) && matchingRecord(result.body, sent)) {
        state = 'succeeded'; recordId = result.body.id;
      } else if (result?.status === 409 && result.body?.error?.code === 'POSSIBLE_DUPLICATE') {
        state = 'duplicate_confirmation';
      } else if (result?.status === 409 && ['IDEMPOTENCY_CONFLICT', 'EXPENSE_ALREADY_DELETED'].includes(result.body?.error?.code)) {
        state = 'conflict';
      } else {
        // Includes invalid success bodies, auth failures and provider/server failures.
        // Keep the original key/content for explicit retry after checking the cause.
        state = 'unknown';
      }
    } catch {
      if (current === generation) state = 'unknown';
    }
    return snapshot();
  }
  return {
    snapshot,
    prepare(review, source) {
      if (!['empty', 'cancelled', 'succeeded'].includes(state)) return false;
      const next = buildSubmission(review, newRequestKey(), source);
      payload = next; recordId = null; state = 'ready'; generation++; return true;
    },
    submit() { return state === 'ready' ? send() : Promise.resolve(snapshot()); },
    retry() { return state === 'unknown' ? send() : Promise.resolve(snapshot()); },
    confirmDuplicate() {
      if (state !== 'duplicate_confirmation') return Promise.resolve(snapshot());
      payload = Object.freeze({ ...payload, allowDuplicate: true });
      return send();
    },
    cancel() {
      generation++;
      if (state === 'submitting' || state === 'unknown') state = 'unknown';
      else if (['ready', 'duplicate_confirmation'].includes(state)) { state = 'cancelled'; payload = null; }
      // Cancellation is local only; it never revokes an in-flight server write.
      return snapshot();
    },
  };
}
