import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceiptFlow } from '../aiui/lib/receipt-flow.js';
const key = '11111111-1111-4111-8111-111111111111';
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { resolve, promise }; };
const candidate = { amount: '12.30', expenseDate: '2026-11-13', currencyCode: 'JPY', merchant: 'Synthetic', warnings: [] };
const success = p => ({ status: 200, body: { id: key, amount: p.amount, expense_date: p.expenseDate, currency_code: p.currencyCode, category: p.category, merchant: p.merchant, note: p.note, account_id: p.accountId, source: p.source } });
function setup(extra = {}) {
  let saved = null; const calls = [];
  const storage = { get: () => saved, set: s => { saved = s; } };
  const deps = { cameraFactory: () => ({ takePhoto: async () => ({ data: new ArrayBuffer(3), mimeType: 'image/jpeg' }) }), recognize: async photo => { assert.equal(photo.data.byteLength, 3); return { status: 200, body: candidate }; }, transport: async p => { calls.push(p); return success(p); }, newRequestKey: () => key, storage, ...extra };
  return { flow: createReceiptFlow(deps), deps, calls, saved: () => saved };
}
async function prepare(f) {
  await f.start(); assert.equal(f.snapshot().hasPhoto, false);
  for (let i = 0; i < 4; i++) f.move(1);
  f.edit('food'); f.preview(); f.confirm();
}
test('runnable chain releases image, requires edit, preview, confirmation and explicit submit', async () => {
  const { flow: f, calls } = setup(); await f.start();
  assert.equal(f.snapshot().hasPhoto, false); f.preview(); f.confirm(); await f.submit(); assert.equal(calls.length, 0);
  for (let i = 0; i < 4; i++) f.move(1);
  f.edit('food'); f.preview(); f.back(); f.preview(); f.confirm(); f.confirm();
  assert.equal(calls.length, 0); await Promise.all([f.submit(), f.submit()]);
  assert.equal(calls.length, 1); assert.equal(f.snapshot().submission.state, 'succeeded');
});
test('restart after ambiguous write keeps exact key/content and requires explicit retry', async () => {
  const ctx = setup({ transport: async () => { throw new Error('timeout'); } }); await prepare(ctx.flow); await ctx.flow.submit();
  const before = JSON.parse(ctx.saved()); const calls = [];
  const resumed = createReceiptFlow({ ...ctx.deps, transport: async p => { calls.push(p); return success(p); } });
  assert.equal(resumed.snapshot().submission.state, 'unknown'); assert.equal(calls.length, 0);
  await resumed.submit(); assert.equal(calls.length, 0); await resumed.retry();
  assert.deepEqual(calls[0], before.payload); assert.equal(resumed.snapshot().submission.state, 'succeeded');
});
test('crash while sending persists unknown before transport and canceled late success stays unknown', async () => {
  const pending = deferred(); const ctx = setup({ transport: () => pending.promise }); await prepare(ctx.flow);
  const sending = ctx.flow.submit(); assert.equal(JSON.parse(ctx.saved()).state, 'unknown'); ctx.flow.cancel();
  const recovered = createReceiptFlow(ctx.deps); assert.equal(recovered.snapshot().submission.state, 'unknown');
  pending.resolve(success(JSON.parse(ctx.saved()).payload)); await sending;
  assert.equal(ctx.flow.snapshot().submission.state, 'unknown');
});
test('duplicate decision is separate and its exact content survives restart', async () => {
  const ctx = setup({ transport: async () => ({ status: 409, body: { error: { code: 'POSSIBLE_DUPLICATE' } } }) });
  await prepare(ctx.flow); await ctx.flow.submit(); const calls = [];
  const f = createReceiptFlow({ ...ctx.deps, transport: async p => { calls.push(p); throw new Error('timeout'); } });
  await f.submit(); await f.retry(); assert.equal(calls.length, 0); await f.confirmDuplicate();
  assert.equal(calls[0].allowDuplicate, true); assert.equal(calls[0].requestKey, key);
  const recovered = createReceiptFlow({ ...ctx.deps, transport: async p => { assert.deepEqual(p, calls[0]); return success(p); } });
  await recovered.retry(); assert.equal(recovered.snapshot().submission.state, 'succeeded');
});
test('cancelled recognition permits new capture and stale completion cannot overwrite it', async () => {
  const pending = deferred(); let recognized = 0;
  const { flow: f } = setup({ recognize: () => ++recognized === 1 ? pending.promise : Promise.resolve({ status: 200, body: candidate }) });
  const start = f.start(); await new Promise(resolve => setImmediate(resolve));
  f.cancel(); await f.start(); assert.equal(recognized, 2);
  assert.equal(f.snapshot().state, 'editing');
  pending.resolve({ status: 200, body: { ...candidate, merchant: 'stale' } }); await start;
  assert.equal(f.snapshot().state, 'editing'); assert.equal(f.snapshot().review.values.merchant, 'Synthetic');
  assert.equal(f.snapshot().hasPhoto, false);
});
test('storage failure prevents transport, malformed recovery never silently starts a fresh intent', async () => {
  let fail = false, calls = 0;
  const { flow: f } = setup({ storage: { get: () => null, set: () => { if (fail) throw new Error('full'); } }, transport: async p => { calls++; return success(p); } });
  await prepare(f); fail = true; await f.submit(); assert.equal(calls, 0); assert.equal(f.snapshot().state, 'recovery_error');
  const ctx = setup({ storage: { get: () => '{bad', set() {} } }); await ctx.flow.start();
  assert.equal(ctx.flow.snapshot().state, 'recovery_error');
});
test('cancel before submission survives reload without sending; source candidates never persisted', async () => {
  const ctx = setup(); await prepare(ctx.flow); ctx.flow.cancel();
  assert.equal(JSON.parse(ctx.saved()).payload, null);
  const resumed = createReceiptFlow(ctx.deps); assert.equal(resumed.snapshot().state, 'cancelled');
  await resumed.submit(); assert.equal(ctx.calls.length, 0);
});
test('cancel never-settling transport permits same-key retry and ignores old completion', async () => {
  const first = deferred(), second = deferred(); let attempts = 0;
  const ctx = setup({ transport: () => ++attempts === 1 ? first.promise : second.promise });
  await prepare(ctx.flow); const old = ctx.flow.submit(); ctx.flow.cancel();
  assert.equal(ctx.flow.snapshot().busy, false);
  const retry = ctx.flow.retry(); assert.equal(attempts, 2);
  first.resolve(success(JSON.parse(ctx.saved()).payload)); await old;
  assert.equal(ctx.flow.snapshot().busy, true);
  second.resolve(success(JSON.parse(ctx.saved()).payload)); await retry;
  assert.equal(ctx.flow.snapshot().submission.state, 'succeeded');
});
test('cancelled unsent operation and successful operation allow explicit next receipt', async () => {
  const ctx = setup(); await prepare(ctx.flow); ctx.flow.cancel();
  assert.equal(ctx.flow.snapshot().state, 'cancelled'); await prepare(ctx.flow);
  await ctx.flow.submit(); ctx.flow.next(); assert.equal(ctx.flow.snapshot().state, 'idle');
  await ctx.flow.start(); assert.equal(ctx.flow.snapshot().state, 'editing');
});
