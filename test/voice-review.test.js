import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceReview } from '../aiui/lib/voice-review.js';
const values = { amount: '972', currencyCode: 'JPY', merchant: 'SEIYU', expenseDate: '', category: '', accountId: '', accountName: '', note: '' };
const segment = (text, isFinal = true) => Object.assign([{ transcript: text }], { isFinal });
const result = (...segments) => ({ results: segments });
const flush = () => new Promise(resolve => setImmediate(resolve));
function rig(correct = async current => ({ values: { ...current, category: 'groceries' }, changedFields: ['category'], warnings: [] })) {
  const events = [], speech = { starts: 0, stops: 0, aborts: 0, start() { this.starts++; }, stop() { this.stops++; }, abort() { this.aborts++; } };
  const voice = createVoiceReview({ speechFactory: () => speech, correct, notify: value => events.push(value), timeout: 1000 });
  return { voice, speech, events };
}
function endManually(r, text = '分类改为日用食品') {
  r.speech.onresult(result(segment(text)));
  assert.equal(r.voice.stop(), true);
  r.speech.onend();
}

test('all spoken clauses remain visible and reach correction only after manual stop and end', async () => {
  const calls = [], r = rig(async (...args) => { calls.push(args); return { values: { ...values, category: 'groceries' }, changedFields: ['category'], warnings: [] }; });
  const complete = r.voice.run(values);
  assert.equal(r.speech.starts, 1); assert.equal(r.speech.continuous, true); assert.equal(r.speech.interimResults, true);
  assert.equal(await r.voice.run(values), false);
  const first = segment('我在SEIYU消费了972日元');
  r.speech.onresult(result(first));
  assert.equal(calls.length, 0); assert.equal(r.events.at(-1).transcript, first[0].transcript);
  r.speech.onresult(result(first, segment('属于日常', false)));
  assert.equal(r.events.at(-1).transcript, '我在SEIYU消费了972日元 属于日常');
  r.speech.onresult(result(first, segment('属于日常分类')));
  r.speech.onresult(result(first, segment('属于日常分类')));
  assert.equal(calls.length, 0);
  assert.equal(r.voice.stop(), true); assert.equal(r.voice.stop(), false);
  r.speech.onresult(result(first, segment('属于日常分类'), segment('支付方式是微信支付')));
  assert.equal(calls.length, 0); r.speech.onend();
  assert.equal((await complete).values.category, 'groceries');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], '我在SEIYU消费了972日元 属于日常分类 支付方式是微信支付');
  assert.equal(r.events.at(-1).transcript, calls[0][1]); assert.equal(values.category, '');
});

test('recording has no silence/listening timeout and a final segment does not close it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = rig(), pending = r.voice.run(values);
  r.speech.onresult(result(segment('先说第一句')));
  t.mock.timers.tick(120_000);
  assert.equal(r.events.at(-1).state, 'listening'); assert.equal(r.speech.stops, 0); assert.equal(r.speech.aborts, 0);
  endManually(r); await pending;
});

test('manual stop flushes late final text instead of aborting the last clause', async () => {
  let transcript;
  const r = rig(async (current, text) => { transcript = text; return { values: current, changedFields: [], warnings: [] }; });
  const pending = r.voice.run(values);
  r.speech.onresult(result(segment('前半句'), segment('后半', false)));
  assert.equal(r.voice.stop(), true); assert.equal(r.speech.stops, 1); assert.equal(r.speech.aborts, 0);
  assert.equal(r.events.at(-1).state, 'stopping');
  r.speech.onresult(result(segment('前半句'), segment('后半句')));
  r.speech.onend(); await pending;
  assert.equal(transcript, '前半句 后半句'); assert.equal(r.voice.stop(), false);
});

test('an unexpected service end preserves text and never automatically submits it', async () => {
  let calls = 0; const r = rig(async () => { calls++; });
  const pending = r.voice.run(values);
  r.speech.onresult(result(segment('还没有说完'))); r.speech.onend();
  assert.equal(await pending, false); assert.equal(calls, 0);
  assert.equal(r.events.at(-1).error, 'SPEECH_ENDED'); assert.equal(r.events.at(-1).transcript, '还没有说完');
});

test('empty or incomplete finalization cannot silently submit only part of the sentence', async () => {
  for (const segments of [[], [segment('还在修订', false)], [segment('完整前句'), segment('未完成后句', false)]]) {
    let calls = 0; const r = rig(async () => { calls++; });
    const pending = r.voice.run(values);
    r.speech.onresult(result(...segments)); r.voice.stop(); r.speech.onend();
    assert.equal(await pending, false); assert.equal(calls, 0);
    assert.equal(r.events.at(-1).error, segments.length ? 'SPEECH_INCOMPLETE' : 'SPEECH_EMPTY');
  }
});

test('microphone permission and recognition errors preserve the candidate', async () => {
  for (const [error, expected] of [['not-allowed', 'SPEECH_PERMISSION'], ['network', 'SPEECH_NETWORK'], ['audio-capture', 'SPEECH_MICROPHONE']]) {
    const r = rig(), pending = r.voice.run(values);
    r.speech.onerror({ error }); assert.equal(await pending, false);
    assert.equal(r.events.at(-1).error, expected); assert.equal(values.amount, '972');
  }
});

test('cancel releases capture, preserves displayed text and ignores late callbacks', async () => {
  let calls = 0; const r = rig(async () => { calls++; });
  const pending = r.voice.run(values);
  r.speech.onresult(result(segment('取消前的文字')));
  const lateResult = r.speech.onresult, lateEnd = r.speech.onend;
  r.voice.cancel(); const count = r.events.length;
  lateResult(result(segment('迟到文字'))); lateEnd();
  assert.equal(await pending, false); assert.equal(calls, 0); assert.equal(r.events.length, count);
  assert.equal(r.events.at(-1).state, 'cancelled'); assert.equal(r.events.at(-1).transcript, '取消前的文字');
  assert.ok(r.speech.aborts > 0);
});

test('cancel aborts inference and an old response cannot overwrite a fresh recording', async () => {
  let resolve, signal; const r = rig((current, text, options) => { signal = options.signal; return new Promise(yes => { resolve = yes; }); });
  const pending = r.voice.run(values); endManually(r); await flush();
  r.voice.cancel(); assert.equal(signal.aborted, true);
  const fresh = r.voice.run(values); assert.equal(r.events.at(-1).transcript, '');
  resolve({ values: { ...values, category: 'food' }, changedFields: ['category'], warnings: [] });
  assert.equal(await pending, false); assert.equal(r.events.at(-1).state, 'listening');
  r.voice.cancel(); assert.equal(await fresh, false);
});

test('only finalization has a timeout and it retains the visible transcript', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0; const r = rig(async () => { calls++; }), pending = r.voice.run(values);
  r.speech.onresult(result(segment('等待最终结束')));
  r.voice.stop(); t.mock.timers.tick(1001);
  assert.equal(await pending, false); assert.equal(calls, 0);
  assert.equal(r.events.at(-1).error, 'SPEECH_TIMEOUT'); assert.equal(r.events.at(-1).transcript, '等待最终结束');
});

test('oversized text is retained for feedback and never sent to correction', async () => {
  let calls = 0; const r = rig(async () => { calls++; }), pending = r.voice.run(values);
  r.speech.onresult(result(segment('字'.repeat(1001))));
  assert.equal(await pending, false); assert.equal(calls, 0); assert.equal(r.events.at(-1).error, 'SPEECH_TOO_LONG');
});

test('malformed correction results do not overwrite the candidate', async () => {
  const r = rig(async () => ({ values: { ...values, amount: 700 }, changedFields: ['amount'], warnings: [] }));
  const pending = r.voice.run(values); endManually(r);
  assert.equal(await pending, false); assert.equal(r.events.at(-1).error, 'INVALID_RESULT');
  assert.equal(r.events.at(-1).transcript, '分类改为日用食品');
});

test('synchronous start/stop rejection cleans up and allows a later attempt', async () => {
  const r = rig(); r.speech.start = () => { throw Object.assign(new Error(), { name: 'NotAllowedError' }); };
  assert.equal(await r.voice.run(values), false); assert.equal(r.events.at(-1).error, 'SPEECH_PERMISSION');
  r.speech.start = () => {}; r.speech.stop = () => { throw new Error('capture failure'); };
  const pending = r.voice.run(values); r.voice.stop();
  assert.equal(await pending, false); assert.equal(r.events.at(-1).error, 'SPEECH_FAILED');
});
