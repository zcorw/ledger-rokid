import test from 'node:test';
import assert from 'node:assert/strict';
import { createReview, syntheticReceipt } from '../aiui/lib/review.js';
import { buildSubmission, createSubmission } from '../aiui/lib/submission.js';
const key = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
function confirmed() {
  const review = createReview(); review.load({ ...syntheticReceipt, amount: '99999999999999.123456' });
  assert.equal(review.preview(), true); assert.equal(review.confirm(), true); return review.snapshot();
}
function response(p, status = 201) {
  return { status, body: { id, expense_date: p.expenseDate, amount: p.amount,
    currency_code: p.currencyCode, category: p.category, merchant: p.merchant,
    account_id: p.accountId, note: p.note, source: p.source } };
}
const error = code => ({ status: 409, body: { error: { code } } });
function harness(transport) {
  const calls = []; let keys = 0;
  const machine = createSubmission({ transport: p => { calls.push({ ...p }); return transport(p); }, newRequestKey: () => { keys++; return key; } });
  return { machine, calls, keys: () => keys };
}
test('requires explicit confirmed review and source; preserves decimal strings', () => {
  const review = confirmed(); const p = buildSubmission(review, key, 'manual');
  assert.equal(p.amount, '99999999999999.123456'); assert.equal(p.requestKey, key);
  assert.equal(p.allowDuplicate, false); assert.equal(p.accountId, null); assert.ok(Object.isFrozen(p));
  review.confirmed.amount = '1'; assert.equal(p.amount, '99999999999999.123456');
  for (const state of ['empty', 'editing', 'review', 'cancelled']) assert.throws(() => buildSubmission({ ...confirmed(), state }, key, 'manual'));
  assert.throws(() => buildSubmission(confirmed(), key));
  assert.throws(() => buildSubmission(confirmed(), 'not-uuid', 'manual'));
  for (const patch of [{ amount: 1 }, { expenseDate: '0000-01-01' }, { accountId: 'secret' }, { category: 'invalid' }]) {
    const r = confirmed(); Object.assign(r.confirmed, patch); assert.throws(() => buildSubmission(r, key, 'manual'));
  }
});
test('double submit shares one attempted write and success is not resubmitted', async () => {
  let resolve; const h = harness(p => new Promise(r => { resolve = () => r(response(p)); }));
  h.machine.prepare(confirmed(), 'manual'); const first = h.machine.submit();
  assert.equal((await h.machine.submit()).state, 'submitting'); assert.equal(h.calls.length, 1);
  resolve(); assert.equal((await first).state, 'succeeded');
  await h.machine.submit(); await h.machine.retry(); assert.equal(h.calls.length, 1);
});
test('timeout retains exact payload and key; retry may recover 200 replay', async () => {
  let fail = true; const h = harness(p => { if (fail) { fail = false; throw new Error('private transport error'); } return response(p, 200); });
  h.machine.prepare(confirmed(), 'manual'); assert.equal((await h.machine.submit()).state, 'unknown');
  assert.equal(h.machine.prepare(confirmed(), 'manual'), false); assert.equal(h.keys(), 1);
  const copy = h.machine.snapshot(); copy.payload.amount = '1';
  assert.equal((await h.machine.retry()).state, 'succeeded'); assert.deepEqual(h.calls[1], h.calls[0]);
  assert.equal(JSON.stringify(h.machine.snapshot()).includes('private transport'), false);
});
test('only explicit duplicate confirmation allows duplication with the same key', async () => {
  const h = harness(p => p.allowDuplicate ? response(p) : error('POSSIBLE_DUPLICATE'));
  h.machine.prepare(confirmed(), 'manual'); assert.equal((await h.machine.submit()).state, 'duplicate_confirmation');
  await h.machine.retry(); await h.machine.submit(); assert.equal(h.calls.length, 1);
  assert.equal((await h.machine.confirmDuplicate()).state, 'succeeded');
  assert.deepEqual(h.calls[1], { ...h.calls[0], allowDuplicate: true }); assert.equal(h.keys(), 1);
});
test('duplicate confirmation timeout retry retains allowDuplicate and key', async () => {
  let count = 0; const h = harness(p => { count++; if (count === 1) return error('POSSIBLE_DUPLICATE'); if (count === 2) throw Error(); return response(p, 200); });
  h.machine.prepare(confirmed(), 'manual'); await h.machine.submit(); await h.machine.confirmDuplicate(); await h.machine.retry();
  assert.deepEqual(h.calls[1], h.calls[2]); assert.equal(h.machine.snapshot().state, 'succeeded');
});
test('conflict and deleted record require reconciliation, not a fresh automatic key', async () => {
  for (const code of ['IDEMPOTENCY_CONFLICT', 'EXPENSE_ALREADY_DELETED']) {
    const h = harness(() => error(code)); h.machine.prepare(confirmed(), 'manual');
    assert.equal((await h.machine.submit()).state, 'conflict'); await h.machine.retry(); await h.machine.confirmDuplicate();
    h.machine.cancel(); assert.equal(h.machine.prepare(confirmed(), 'manual'), false); assert.equal(h.calls.length, 1);
  }
});
test('cancel before sending discards locally; cancel in flight preserves unknown outcome', async () => {
  let resolve; const h = harness(p => new Promise(r => { resolve = () => r(response(p)); }));
  h.machine.prepare(confirmed(), 'manual'); assert.equal(h.machine.cancel().state, 'cancelled');
  await h.machine.submit(); assert.equal(h.calls.length, 0);
  h.machine.prepare(confirmed(), 'manual'); const pending = h.machine.submit();
  const cancelled = h.machine.cancel(); assert.equal(cancelled.state, 'unknown'); assert.equal(cancelled.payload.requestKey, key);
  assert.equal(h.machine.prepare(confirmed(), 'manual'), false); resolve(); await pending;
  assert.equal(h.machine.snapshot().state, 'unknown'); assert.equal(h.machine.snapshot().recordId, null);
});
test('invalid successes and HTTP failures remain unknown without reflecting response data', async () => {
  for (const result of [null, { status: 200, body: {} }, { status: 201, body: { id } }, { status: 401 }, { status: 422 }, { status: 500 }, error('UNKNOWN')]) {
    const h = harness(() => result); h.machine.prepare(confirmed(), 'manual');
    assert.equal((await h.machine.submit()).state, 'unknown'); assert.equal(h.keys(), 1);
  }
});
test('successful response must match frozen request; exact decimal padding is accepted', async () => {
  for (const patch of [{ amount: '1' }, { amount: 12 }, { currency_code: 'USD' }, { account_id: id }, { source: 'receipt_ocr' }]) {
    const h = harness(p => { const r = response(p); Object.assign(r.body, patch); return r; });
    h.machine.prepare(confirmed(), 'manual'); assert.equal((await h.machine.submit()).state, 'unknown');
  }
  const h = harness(p => ({ ...response(p), body: { ...response(p).body, amount: '12.000000' } }));
  const r = confirmed(); r.confirmed.amount = '12'; h.machine.prepare(r, 'manual');
  assert.equal((await h.machine.submit()).state, 'succeeded');
});
test('transport cannot mutate the private retry payload', async () => {
  const h = harness(p => { p.amount = '1'; throw Error(); });
  h.machine.prepare(confirmed(), 'manual'); await h.machine.submit(); await h.machine.retry();
  assert.equal(h.calls[1].amount, '99999999999999.123456');
});
