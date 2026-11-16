import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createViewfinderController } from '../aiui/lib/viewfinder.js';
import { createPhotoDisplayController } from '../aiui/lib/photo-display.js';
import { createReceiptRecognitionController } from '../aiui/lib/receipt-recognition.js';
import { createReceiptCredentialStore } from '../aiui/lib/receipt-credential-store.js';
import { presentBill } from '../aiui/lib/bill-presentation.js';
const source = await readFile(new URL('../aiui/pages/capture/index.ink', import.meta.url), 'utf8');
const script = source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm, '').replace('export default', 'return');
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const result = () => ({ status: 200, body: { amount: '1234.25', expenseDate: '2026-11-13', currencyCode: 'JPY', merchant: '测试商户', warnings: [] } });
const flush = () => new Promise(resolve => setImmediate(resolve));
function key(code, repeat = false) { return { code, repeat, prevented: false, preventDefault() { this.prevented = true; } }; }
function page(overrides = {}) {
  let requests = 0, shots = 0, recognitions = 0, stops = 0, updates = 0, urlCount = 0, time = 1000;
  const events = [], revoked = [], decoded = [], canvasCalls = [], streams = [];
  function stream() {
    const track = { readyState: 'live', stop() { stops++; this.readyState = 'ended'; events.push('stop'); } };
    const value = { getTracks: () => [track], getVideoTracks: () => [track] }; streams.push(value); return value;
  }
  const environment = {
    navigator: { userAgent: 'glasses-test/0.19', mediaDevices: { getUserMedia: async constraints => { requests++; return overrides.requestStream ? overrides.requestStream(constraints) : stream(); } } },
    URL: { createObjectURL(value) { assert.ok(streams.includes(value)); return 'blob:preview-' + ++urlCount; }, revokeObjectURL(value) { revoked.push(value); events.push('revoke'); } },
    Blob, createImageBitmap: async blob => { decoded.push(blob); return overrides.decode ? overrides.decode(blob) : { width: 2016, height: 1512, close() {} }; },
  };
  if (overrides.missingURL) environment.URL = {};
  const wx = {
    media: { createCameraContext() { events.push('camera'); return { takePhoto: async options => { shots++; events.push({ options }); return overrides.takePhoto ? overrides.takePhoto(options) : { data: new ArrayBuffer(965298), mimeType: 'image/webp' }; } }; } },
    createCanvasContext(id) { assert.equal(id, 'captured-photo'); return { clearRect: (...args) => canvasCalls.push(['clear', ...args]), drawImage: (...args) => canvasCalls.push(['draw', ...args]), flush: () => canvasCalls.push(['flush']) }; },
  };
  const recognize = async (photo, options) => { recognitions++; return overrides.recognize ? overrides.recognize(photo, options) : result(); };
  const p = new Function('wx', 'createViewfinderController', 'createPhotoDisplayController', 'createReceiptRecognitionController', 'createReceiptApi', 'createReceiptCredentialStore', 'presentBill', 'globalThis', 'Date', 'console', script)(wx, createViewfinderController, createPhotoDisplayController, createReceiptRecognitionController, options => ({ recognize: (photo, callOptions) => { overrides.authorization?.(options.notifyAuthorization); return recognize(photo, callOptions); }, close: () => overrides.close?.() }), createReceiptCredentialStore, presentBill, environment, { now: () => time }, overrides.hostConsole || { log() {} });
  p.setData = function(value) { updates++; Object.assign(this.data, value); }; p.onLoad();
  return { p, events, revoked, decoded, canvasCalls, stream, advance(ms) { time += ms; }, counts: () => ({ requests, shots, recognitions, stops, updates }) };
}

test('opening the agent automatically previews after ready, without exposing a photo', async t => {
  const r = page(); t.after(() => r.p.onUnload()); r.p.onShow(); assert.equal(r.counts().requests, 0);
  r.p.onKeyUp(key('Enter')); assert.equal(r.counts().shots, 0);
  assert.equal(await r.p.onReady(), true); assert.equal(r.counts().requests, 1); assert.equal(r.p.data.captureState, 'previewing');
  assert.equal(r.p.data.entryHint, '单击拍照，自动识别账单'); assert.equal(r.p.data.message, '');
  r.p.onReady(); r.p.onShow(); assert.equal(r.counts().requests, 1); assert.equal(r.counts().shots, 0);
});

test('the agent launches directly into capture and requests no microphone permission', async () => {
  const config = JSON.parse(await readFile(new URL('../aiui/app.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.pages, ['pages/capture/index']); assert.deepEqual(config.permissions, ['CAMERA']);
});

test('one explicit activation captures, recognizes and shows the bill without another button', async t => {
  const r = page(); t.after(() => r.p.onUnload()); await r.p.onReady();
  r.p.onKeyDown(key('Enter')); const tap = r.p.capture(); const duplicate = r.p.onKeyUp(key('Enter'));
  assert.equal(await tap, true); await duplicate;
  assert.deepEqual(r.events.slice(0, 3), ['stop', 'revoke', 'camera']);
  assert.equal(r.counts().shots, 1); assert.equal(r.counts().recognitions, 1); assert.equal(r.counts().requests, 1);
  assert.equal(r.events.find(item => typeof item === 'object').options.enableSystemPreview, false);
  assert.equal(r.p.data.billVisible, true); assert.equal(r.p.data.bill.amountText, '1,234.25'); assert.equal(r.p.data.bill.currencySymbol, '¥');
  assert.equal(r.p.data.bill.merchant, '测试商户'); assert.equal(r.p.data.bill.expenseDate, '2026-11-13'); assert.equal(r.p.data.bill.category, '');
  assert.equal(r.p.controller.snapshot().photo, null); assert.deepEqual(r.p.data.previewItems, []); assert.equal(r.p.data.photoVisible, false);
  assert.equal(await r.p.capture(), false); r.p.onKeyUp(key('Enter')); assert.equal(r.counts().shots, 1);
  const direction = key('ArrowDown'); r.p.onKeyUp(direction); assert.equal(direction.prevented, false);
});

test('the native photo stays visible during recognition with its original bytes and MIME', async t => {
  const recognition = deferred(); const data = new Uint8Array([10, 20, 30]).buffer;
  const r = page({ takePhoto: async () => ({ data, mimeType: 'image/webp' }), recognize: photo => { assert.equal(photo.data, data); return recognition.promise; } });
  t.after(() => r.p.onUnload()); await r.p.onReady(); const pending = r.p.capture(); await flush();
  assert.equal(r.p.data.recognitionState, 'recognizing'); assert.equal(r.p.data.message, '正在识别账单…'); assert.equal(r.p.data.busy, true);
  assert.equal(r.p.data.photoVisible, true); assert.equal(r.decoded[0].type, 'image/webp');
  assert.deepEqual(new Uint8Array(await r.decoded[0].arrayBuffer()), new Uint8Array(data));
  recognition.resolve(result()); assert.equal(await pending, true); assert.equal(r.p.data.billVisible, true); assert.equal(r.p.data.photoVisible, false);
});

test('the shutter stays inactive while the automatic preview is still acquiring a stream', async t => {
  const acquisition = deferred(); const r = page({ requestStream: () => acquisition.promise }); t.after(() => r.p.onUnload());
  const opening = r.p.onReady(); assert.equal(await r.p.capture(), false); r.p.onKeyUp(key('Enter')); assert.equal(r.counts().shots, 0);
  r.p.onKeyDown(key('Enter')); acquisition.resolve(r.stream()); assert.equal(await opening, true);
  assert.equal(await r.p.onKeyUp(key('Enter')), false); assert.equal(r.counts().shots, 0);
  r.p.onKeyDown(key('Enter')); assert.equal(await r.p.onKeyUp(key('Enter')), true); assert.equal(r.counts().shots, 1);
});

test('returning while an old stream is pending opens a fresh preview after the stale stream is stopped', async t => {
  const acquisition = deferred(); let calls = 0;
  const r = page({ requestStream: () => ++calls === 1 ? acquisition.promise : r.stream() }); t.after(() => r.p.onUnload());
  const opening = r.p.onReady(); r.p.onHide(); r.p.onShow(); acquisition.resolve(r.stream());
  assert.equal(await opening, false); await flush(); assert.equal(r.counts().requests, 2); assert.equal(r.counts().stops, 1);
  assert.equal(r.p.data.captureState, 'previewing'); assert.equal(r.counts().shots, 0);
});

test('unloading before permission resolves stops the late stream without updating the page', async () => {
  const acquisition = deferred(); const r = page({ requestStream: () => acquisition.promise });
  const pending = r.p.onReady(); r.p.onUnload(); const count = r.counts().updates;
  acquisition.resolve(r.stream()); assert.equal(await pending, false); assert.equal(r.counts().stops, 1); assert.equal(r.counts().updates, count);
});

test('cancelled native exposure cannot recognize a late photo and resumes preview on return', async t => {
  const exposure = deferred(); const r = page({ takePhoto: () => exposure.promise }); t.after(() => r.p.onUnload());
  await r.p.onReady(); const pending = r.p.capture(); r.p.onHide(); r.p.onShow(); assert.equal(r.counts().requests, 1);
  exposure.resolve({ data: new ArrayBuffer(10), mimeType: 'image/webp' }); assert.equal(await pending, false); await flush();
  assert.equal(r.counts().requests, 2); assert.equal(r.counts().recognitions, 0); assert.equal(r.p.data.billVisible, false);
});

test('a cancelled recognition cannot replace the fresh preview after returning', async t => {
  const recognition = deferred(); const r = page({ recognize: () => recognition.promise }); t.after(() => r.p.onUnload());
  await r.p.onReady(); const pending = r.p.capture(); await flush(); r.p.onHide(); await r.p.onShow();
  assert.equal(r.counts().requests, 2); recognition.resolve(result()); assert.equal(await pending, false);
  assert.equal(r.p.data.billVisible, false); assert.equal(r.p.data.captureState, 'previewing'); assert.equal(r.p.data.busy, false);
});

test('unloading during recognition closes late decoded pixels and produces no late UI updates', async () => {
  const recognition = deferred(), decode = deferred(); let closes = 0;
  const r = page({ recognize: () => recognition.promise, decode: () => decode.promise });
  await r.p.onReady(); const pending = r.p.capture(); await flush(); r.p.onUnload(); const count = r.counts().updates;
  decode.resolve({ width: 2016, height: 1512, close() { closes++; } }); recognition.resolve(result());
  assert.equal(await pending, false); await flush(); assert.equal(closes, 1); assert.equal(r.canvasCalls.length, 0); assert.equal(r.counts().updates, count);
});

test('recognition failure keeps the photo for retry and never substitutes a success bill', async t => {
  let calls = 0; const r = page({ recognize: async () => ++calls === 1 ? { status: 504 } : result() }); t.after(() => r.p.onUnload());
  await r.p.onReady(); assert.equal(await r.p.capture(), false); assert.equal(r.p.data.canRetry, true); assert.equal(r.p.data.billVisible, false);
  assert.match(r.p.data.message, /识别超时/); assert.ok(r.p.controller.snapshot().photo);
  assert.equal(await r.p.retry(), true); assert.equal(r.counts().shots, 1); assert.equal(r.counts().recognitions, 2); assert.equal(r.p.data.billVisible, true);
});

test('preview and camera failures are visible, retryable and never reach recognition', async () => {
  for (const overrides of [{ missingURL: true }, { requestStream: async () => { throw new Error('Permission denied'); } }, { takePhoto: async () => { throw { code: 'CAMERA_BUSY', message: 'Camera busy' }; } }]) {
    const r = page(overrides); await r.p.onReady(); if (r.p.data.captureState === 'previewing') await r.p.capture();
    assert.equal(r.p.data.canRetry, true); assert.equal(r.p.data.billVisible, false); assert.equal(r.counts().recognitions, 0); assert.ok(r.p.data.message);
    r.p.onUnload();
  }
});

test('a trailing keyup after a fast shutter failure cannot hide the error by reopening preview', async t => {
  const r = page({ takePhoto: async () => { throw new Error('Camera busy'); } }); t.after(() => r.p.onUnload());
  await r.p.onReady(); assert.equal(await r.p.capture(), false); const message = r.p.data.message;
  await r.p.onKeyUp(key('Enter')); assert.equal(r.counts().requests, 1); assert.equal(r.p.data.message, message); assert.equal(r.p.data.canRetry, true);
});

test('old video callbacks cannot stop or relabel a new automatic preview', async t => {
  const r = page(); t.after(() => r.p.onUnload()); await r.p.onReady(); const old = r.p.data.previewItems[0].id;
  r.p.onHide(); await r.p.onShow(); assert.equal(r.p.previewPlaying({ target: { dataset: { session: old } } }), false);
  assert.equal(r.p.previewError({ target: { dataset: { session: old } }, detail: { message: 'stale' } }), false);
  assert.equal(r.p.data.captureState, 'previewing');
});

test('host return clears the camera and bill while leaving the host back action available', async () => {
  for (const phase of ['preview', 'bill']) {
    const r = page(); await r.p.onReady(); if (phase === 'bill') await r.p.capture();
    const event = key('Backspace'); r.p.onKeyUp(event); assert.equal(event.prevented, false);
    assert.equal(r.p.data.billVisible, false); assert.equal(r.p.recognition.snapshot().result, null); assert.equal(r.counts().stops, 1);
    r.p.onUnload();
  }
});

test('phone-code UI is temporary, cancellation aborts recognition, and unload closes the client without deleting saved authorization', async () => {
  let notify, signal, closes = 0; const pending = deferred();
  const r = page({ authorization: callback => { notify = callback; }, recognize: (photo, options) => { signal = options.signal; return pending.promise; }, close: () => closes++ });
  await r.p.onReady(); const run = r.p.capture(); await flush();
  notify({ state: 'pending', userCode: 'ABCD-EFGH', verificationUri: 'https://ledger.zcorw.xyz/receipt-devices' });
  assert.equal(r.p.data.authorizationVisible, true); assert.equal(r.p.data.authorizationCode, 'ABCD-EFGH'); assert.equal(r.counts().stops, 1);
  r.p.onHide(); assert.equal(signal.aborted, true); assert.equal(r.p.data.authorizationVisible, false); assert.equal(r.p.data.authorizationCode, '');
  notify({ state: 'pending', userCode: 'LATE-CODE', verificationUri: 'https://ledger.zcorw.xyz/receipt-devices' }); assert.equal(r.p.data.authorizationVisible, false);
  pending.resolve(result()); assert.equal(await run, false); r.p.onUnload(); assert.equal(closes, 1);
});

test('retaking after recognition failure releases the old photo and opens a fresh preview', async t => {
  const r = page({ recognize: async () => { throw new Error('RECEIPT_NOT_FOUND'); } }); t.after(() => r.p.onUnload());
  await r.p.onReady(); assert.equal(await r.p.capture(), false); assert.match(r.p.data.message, /未识别到账单/);
  assert.equal(await r.p.retake(), true); assert.equal(r.p.controller.snapshot().photo, null); assert.equal(r.p.data.captureState, 'previewing'); assert.equal(r.counts().requests, 2);
});
