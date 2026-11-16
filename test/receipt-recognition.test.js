import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceiptRecognitionController } from '../aiui/lib/receipt-recognition.js';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const photo = () => ({ data: new Uint8Array([1, 2, 3]).buffer, mimeType: 'image/webp' });
const response = () => ({ status: 200, body: { amount: '1234', expenseDate: '2026-11-13', currencyCode: 'JPY', merchant: '商店', warnings: [] } });

test('recognition receives the captured bytes and returns a copied, validated bill candidate', async () => {
  const pending = deferred(), source = photo(), states = [];
  const controller = createReceiptRecognitionController({ recognize: value => { assert.equal(value, source); return pending.promise; }, notify: value => states.push(value) });
  const run = controller.run(source); assert.equal(controller.snapshot().state, 'recognizing'); assert.equal(controller.snapshot().busy, true);
  assert.equal(await controller.run(source), false); pending.resolve(response()); assert.equal(await run, true);
  const result = controller.snapshot().result; assert.equal(result.values.amount, '1234'); assert.equal(result.values.category, ''); assert.equal(result.values.note, '');
  result.values.amount = '9'; result.warnings.push('changed'); assert.equal(controller.snapshot().result.values.amount, '1234'); assert.deepEqual(controller.snapshot().result.warnings, []);
  assert.deepEqual(states.map(value => value.state), ['recognizing', 'recognized']); controller.close();
});

test('cancellation and unloading ignore late recognition results and late failures', async () => {
  for (const method of ['cancel', 'close']) {
    for (const outcome of ['resolve', 'reject']) {
      const pending = deferred(), states = [];
      const controller = createReceiptRecognitionController({ recognize: () => pending.promise, notify: value => states.push(value) });
      const run = controller.run(photo()); controller[method](); const count = states.length;
      pending[outcome](outcome === 'resolve' ? response() : new Error('late failure'));
      assert.equal(await run, false); assert.equal(controller.snapshot().result, null); assert.equal(states.length, count); assert.equal(controller.snapshot().busy, false);
    }
  }
});

test('a new recognition can complete while an old cancelled result is still pending', async () => {
  const previous = deferred(); let calls = 0;
  const controller = createReceiptRecognitionController({ recognize: () => ++calls === 1 ? previous.promise : Promise.resolve(response()) });
  const old = controller.run(photo()); controller.cancel(); assert.equal(await controller.run(photo()), true);
  previous.resolve({ status: 500 }); assert.equal(await old, false); assert.equal(controller.snapshot().state, 'recognized'); controller.close();
});

test('invalid candidates and HTTP errors never become mock-success bills', async () => {
  for (const [value, code] of [[{ status: 429 }, 'RATE_LIMITED'], [{ status: 401 }, 'AUTH_REQUIRED'], [{ status: 200, body: { amount: '1234' } }, 'INVALID_RESULT']]) {
    const controller = createReceiptRecognitionController({ recognize: async () => value });
    assert.equal(await controller.run(photo()), false); assert.equal(controller.snapshot().error, code); assert.equal(controller.snapshot().result, null); controller.close();
  }
});

test('empty photos do not invoke recognition', async () => {
  let calls = 0; const controller = createReceiptRecognitionController({ recognize: () => { calls++; return response(); } });
  assert.equal(await controller.run(null), false); assert.equal(await controller.run({ data: new ArrayBuffer(0) }), false); assert.equal(calls, 0); controller.close();
});

test('recognition requires a provider and aborts its transport on cancel or close', async () => {
  assert.throws(() => createReceiptRecognitionController(), /RECOGNIZER_REQUIRED/);
  for (const method of ['cancel', 'close']) {
    let signal; const pending = deferred();
    const controller = createReceiptRecognitionController({ recognize: (photo, options) => { signal = options.signal; return pending.promise; } });
    const run = controller.run(photo()); assert.equal(signal.aborted, false); controller[method](); assert.equal(signal.aborted, true);
    pending.resolve(response()); assert.equal(await run, false);
  }
});
