import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceReview } from '../aiui/lib/voice-review.js';
const values = { amount: '614', currencyCode: 'JPY', merchant: '', expenseDate: '', category: '', accountId: '', accountName: '', note: '' };
const final = text => ({ results: [Object.assign([{ transcript: text }], { isFinal: true })] });
const flush = () => new Promise(resolve => setImmediate(resolve));
function rig(correct = async current => ({ values: { ...current, amount: '700' }, changedFields: ['amount'], warnings: [] })) {
  const events = [], speech = { starts: 0, aborts: 0, start() { this.starts++; }, abort() { this.aborts++; } };
  const voice = createVoiceReview({ speechFactory: () => speech, correct, notify: value => events.push(value), timeout: 1000 });
  return { voice, speech, events };
}
test('explicit voice activation starts synchronously and only final text goes to correction', async () => {
  const calls = [], r = rig(async (...args) => { calls.push(args); return { values: { ...values, amount: '700' }, changedFields: ['amount'], warnings: [] }; });
  const pending = r.voice.run(values); assert.equal(r.speech.starts, 1);
  assert.equal(await r.voice.run(values), false);
  r.speech.onresult({ results: [Object.assign([{ transcript: '中间' }], { isFinal: false })] });
  assert.equal(calls.length, 0); r.speech.onresult(final('金额改为700'));
  assert.equal((await pending).values.amount, '700');
  assert.equal(values.amount, '614'); assert.equal(calls.length, 1); assert.equal(calls[0][1], '金额改为700');
  assert.equal(r.events.at(-1).state, 'corrected'); assert.ok(r.speech.aborts > 0);
});
test('permission denial and an empty session keep the candidate unchanged', async () => {
  for (const event of ['error', 'end']) {
    const r = rig(); const pending = r.voice.run(values);
    event === 'error' ? r.speech.onerror({ error: 'not-allowed' }) : r.speech.onend();
    assert.equal(await pending, false); assert.equal(r.events.at(-1).state, 'failed');
    assert.equal(values.amount, '614');
  }
});
test('cancel aborts speech or inference and ignores late results', async () => {
  let resolve; const r = rig(() => new Promise(yes => { resolve = yes; }));
  const pending = r.voice.run(values); r.speech.onresult(final('改为700')); await flush();
  r.voice.cancel(); resolve({ values: { ...values, amount: '700' }, changedFields: ['amount'], warnings: [] });
  assert.equal(await pending, false); assert.equal(r.events.some(x => x.state === 'corrected'), false);
  const next = r.voice.run(values); r.voice.cancel(); assert.equal(await next, false);
});
test('malformed server fields fail without overwriting values', async () => {
  const r = rig(async () => ({ values: { ...values, amount: 700 }, changedFields: ['amount'], warnings: [] }));
  const pending = r.voice.run(values); r.speech.onresult(final('改为700'));
  assert.equal(await pending, false); assert.equal(r.events.at(-1).error, 'INVALID_RESULT');
});

test('synchronous microphone rejection releases the session and allows retry', async () => {
  const r = rig(); r.speech.start = () => { throw Object.assign(new Error(), { name: 'NotAllowedError' }); };
  assert.equal(await r.voice.run(values), false); assert.equal(r.events.at(-1).error, 'SPEECH_PERMISSION');
  assert.equal(await r.voice.run(values), false); assert.ok(r.speech.aborts >= 2);
});
