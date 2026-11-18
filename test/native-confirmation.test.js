import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeConfirmation } from '../aiui/lib/native-confirmation.js';
const receiptId = '11111111-1111-4111-8111-111111111111', requestKey = '22222222-2222-4222-8222-222222222222';
const fields = { amount: '614', expenseDate: '2026-11-17', currencyCode: 'JPY', merchant: '私人合成商户',
  category: 'food', accountId: '33333333-3333-4333-8333-333333333333', accountName: '合成账户', note: '' };
const record = { id: '44444444-4444-4444-8444-444444444444', receipt_id: receiptId, amount: '614.000000',
  expense_date: fields.expenseDate, currency_code: fields.currencyCode, merchant: fields.merchant,
  category: fields.category, account_id: fields.accountId, note: null, source: 'receipt_ocr' };
const recorded = () => ({ status: 'recorded', receiptId, requestKey, record });
const missing = () => ({ status: 'not_found', receiptId, requestKey });
function rig(options = {}) {
  let raw = options.raw || null, posts = 0, queries = 0, drafts = 0, outcome = missing();
  const events = [];
  const store = { get: () => raw, set: value => { if (options.storageFailure) throw new Error('AUTH_STORAGE_FAILED'); raw = value; }, remove: () => { raw = null; } };
  const api = {
    capabilities: async () => ({ canCreateExpenses: options.permission !== false, authorizationUri: 'https://ledger.zcorw.xyz/receipt-devices?device=synthetic' }),
    getDraft: async () => ({ receiptId, revision: 1, values: fields, requestKey, saved: true }),
    getConfirmation: async () => { queries++; return outcome; },
    confirmReceipt: async payload => {
      posts++; assert.equal(payload.requestKey, requestKey); assert.equal(payload.receiptId, receiptId);
      const journal = JSON.parse(raw); assert.deepEqual(Object.keys(journal).sort(), ['receiptId', 'requestKey', 'resource', 'revision', 'version']);
      assert.ok(!raw.includes(fields.merchant)); outcome = recorded();
      if (options.lost) throw new Error('NETWORK_ERROR');
      return { status: 201, body: outcome };
    }, ...options.api,
  };
  const args = { api, store, makeKey: () => requestKey, saveDraft: async () => { drafts++; return { revision: 1 }; }, notify: value => events.push(value) };
  const confirmation = createNativeConfirmation(args);
  return { confirmation, api, args, events, store, raw: () => raw, counts: () => ({ posts, queries, drafts }), setOutcome: value => { outcome = value; } };
}
test('permission and complete fields are required before a draft or accounting write', async () => {
  const r = rig({ permission: false });
  assert.equal(await r.confirmation.confirm(receiptId, fields), false);
  assert.equal(r.events.at(-1).state, 'permission'); assert.equal(r.counts().posts, 0); assert.equal(r.counts().drafts, 0);
  assert.equal(await r.confirmation.confirm(receiptId, { ...fields, accountId: '' }), false);
  assert.equal(r.events.at(-1).error, 'REVIEW_INCOMPLETE'); assert.equal(r.raw(), null);
});

test('permission checks lock the workflow immediately and cancellation prevents a later save', async () => {
  let resolve; const r = rig({ api: { capabilities: () => new Promise(yes => { resolve = yes; }) } });
  const pending = r.confirmation.confirm(receiptId, fields);
  assert.equal(r.confirmation.isBusy(), true); assert.equal(r.events.at(-1).busy, true);
  assert.equal(await r.confirmation.confirm(receiptId, fields), false);
  r.confirmation.cancel(); resolve({ canCreateExpenses: true });
  assert.equal(await pending, false); assert.equal(r.counts().drafts, 0); assert.equal(r.counts().posts, 0);
});
test('an explicit confirmation journals identifiers, queries first and creates one record', async () => {
  const r = rig(); assert.equal(r.counts().posts, 0);
  assert.equal(await r.confirmation.confirm(receiptId, fields), true);
  assert.equal(r.events.at(-1).state, 'succeeded'); assert.equal(r.counts().posts, 1); assert.equal(r.counts().queries, 1);
  assert.equal(await r.confirmation.confirm(receiptId, fields), false); assert.equal(r.raw(), null);
});
test('a lost committed response recovers after restart without another accounting POST', async () => {
  const r = rig({ lost: true }); assert.equal(await r.confirmation.confirm(receiptId, fields), false);
  assert.equal(r.confirmation.hasPending(), true); assert.equal(r.counts().posts, 1);
  const restarted = createNativeConfirmation(r.args);
  assert.equal(await restarted.recover(), true); assert.equal(r.counts().posts, 1);
  assert.equal(r.events.at(-1).state, 'succeeded'); assert.equal(r.raw(), null);
});
test('uncommitted restart recovery is query-only until another explicit confirmation', async () => {
  const r = rig({ lost: true }); await r.confirmation.confirm(receiptId, fields); r.setOutcome(missing());
  const restarted = createNativeConfirmation(r.args);
  assert.equal(await restarted.recover(), true); assert.equal(r.counts().posts, 1);
  assert.equal(r.events.at(-1).state, 'unknown');
  assert.equal(await restarted.confirm(receiptId, fields), false); assert.equal(r.counts().posts, 2);
});
test('possible duplicates require a second explicit activation with the same key', async () => {
  const flags = []; const r = rig({ api: { confirmReceipt: async payload => {
    flags.push(payload.allowDuplicate);
    return flags.length === 1 ? { status: 409, body: { error: { code: 'POSSIBLE_DUPLICATE' } } } : { status: 201, body: recorded() };
  } } });
  assert.equal(await r.confirmation.confirm(receiptId, fields), false);
  assert.equal(r.events.at(-1).state, 'duplicate_confirmation'); assert.deepEqual(flags, [false]);
  assert.equal(await r.confirmation.confirm(receiptId, fields), true); assert.deepEqual(flags, [false, true]);
});
test('storage failure prevents sending a financial request', async () => {
  const r = rig({ storageFailure: true });
  assert.equal(await r.confirmation.confirm(receiptId, fields), false); assert.equal(r.counts().posts, 0);
});
test('cancellation ignores a late result while retaining the recoverable request', async () => {
  let resolve, signal; const r = rig({ api: { confirmReceipt: (payload, options) => {
    signal = options.signal; return new Promise(yes => { resolve = () => yes({ status: 201, body: recorded() }); });
  } } });
  const pending = r.confirmation.confirm(receiptId, fields);
  while (!resolve) await new Promise(yes => setImmediate(yes));
  r.confirmation.cancel(); assert.equal(signal.aborted, true); resolve(); assert.equal(await pending, false);
  assert.equal(r.events.some(value => value.state === 'succeeded'), false); assert.ok(r.raw());
});
test('a changed server draft requires a fresh review and does not replay the old confirmation', async () => {
  const r = rig({ lost: true }); await r.confirmation.confirm(receiptId, fields); r.setOutcome(missing());
  r.api.getDraft = async () => ({ receiptId, revision: 2, values: { ...fields, amount: '700' }, saved: true, requestKey });
  const restarted = createNativeConfirmation(r.args); await restarted.recover();
  assert.equal(r.events.at(-1).state, 'needs_review'); assert.equal(r.events.at(-1).values.amount, '700');
  assert.equal(r.counts().posts, 1); assert.equal(r.raw(), null);
});
