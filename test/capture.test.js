import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCaptureController } from '../aiui/lib/capture.js';
import { createViewfinderController } from '../aiui/lib/viewfinder.js';
const image = () => ({ data: new ArrayBuffer(10), mimeType: 'image/jpeg' });
test('successful JPEG, PNG and WebP capture preserves bytes, MIME and documented options', async () => {
  for (const mimeType of ['image/jpeg', 'image/png', 'image/webp']) {
    let options;
    const result = { data: new ArrayBuffer(10), mimeType };
    const c = createCaptureController({ cameraFactory: () => ({ takePhoto: async value => { options = value; return result; } }) });
    assert.equal(await c.capture(), true);
    assert.deepEqual(options, { quality: 'high', mode: 'telephoto', enableSystemPreview: true });
    assert.equal(c.snapshot().state, 'captured');
    assert.equal(c.snapshot().photo.data, result.data);
    assert.equal(c.snapshot().photo.mimeType, mimeType);
    assert.equal(c.snapshot().failure, null);
    c.discard(); assert.equal(c.snapshot().photo, null);
  }
});

test('unsupported camera and denied permission are explicit failures', async () => {
  for (const [factory, state] of [[() => undefined, 'unsupported'], [() => ({ takePhoto: async () => { throw new Error('denied'); } }), 'failed']]) {
    const c = createCaptureController({ cameraFactory: factory });
    assert.equal(await c.capture(), false); assert.equal(c.snapshot().state, state); assert.equal(c.snapshot().busy, false);
  }
});
test('rejects empty or non-image results', async () => {
  for (const result of [{ data: new ArrayBuffer(0), mimeType: 'image/jpeg' }, { data: 'bad', mimeType: 'image/jpeg' }, { data: new ArrayBuffer(1), mimeType: 'text/plain' }]) {
    const c = createCaptureController({ cameraFactory: () => ({ takePhoto: async () => result }) });
    assert.equal(await c.capture(), false); assert.equal(c.snapshot().photo, null);
  }
});
test('cancel invalidates pending photo and prevents overlapping native calls', async () => {
  let resolve; let calls = 0;
  const c = createCaptureController({ cameraFactory: () => ({ takePhoto: () => { calls++; return new Promise(r => { resolve = r; }); } }) });
  const pending = c.capture(); c.discard();
  assert.equal(await c.capture(), false); assert.equal(calls, 1);
  resolve(image()); assert.equal(await pending, false); assert.equal(c.snapshot().photo, null); assert.equal(c.snapshot().busy, false);
});
test('close releases references and prevents late notifications or new capture', async () => {
  let resolve; let notifications = 0;
  const c = createCaptureController({ cameraFactory: () => ({ takePhoto: () => new Promise(r => { resolve = r; }) }), notify: () => notifications++ });
  const pending = c.capture(); c.close(); const before = notifications;
  resolve(image()); assert.equal(await pending, false); assert.equal(notifications, before); assert.equal(await c.capture(), false); assert.equal(c.snapshot().photo, null);
});
test('manifest has camera only and page lifecycle clears camera, image and recognition', () => {
  const app = JSON.parse(readFileSync(new URL('../aiui/app.json', import.meta.url)));
  assert.deepEqual(app.permissions, ['CAMERA']);
  const page = readFileSync(new URL('../aiui/pages/capture/index.ink', import.meta.url), 'utf8');
  const script = page.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm, '').replace('export default', 'return');
  const definition = new Function('wx', 'createViewfinderController', script)({}, createViewfinderController);
  assert.equal(typeof definition.onLoad, 'function');
  const calls = []; definition.captureRun = 0;
  definition.recognition = { cancel() { calls.push('recognition-cancel'); }, close() { calls.push('recognition-close'); } };
  definition.controller = { discard(reason) { calls.push('camera-' + reason); }, close(reason) { calls.push('camera-' + reason); } };
  definition.photoDisplay = { clear() { calls.push('photo-clear'); }, close() { calls.push('photo-close'); } };
  definition.onHide(); assert.deepEqual(calls, ['recognition-cancel', 'camera-hidden', 'photo-clear']);
  definition.onUnload(); assert.deepEqual(calls.slice(3), ['recognition-close', 'camera-unload', 'photo-close']);
  assert.equal(definition.pageHidden, true); assert.equal(definition.pageClosed, true);
});

test('native rejection preserves its stage, code and message without guessing permission failure', async () => {
  const c = createCaptureController({ cameraFactory: () => ({ takePhoto: async () => { throw { errCode: 42, errMsg: 'capture failed' }; } }) });
  assert.equal(await c.capture(), false);
  assert.deepEqual(c.snapshot().failure, { stage: 'takePhoto', name: '', code: '42', message: 'capture failed' });
  c.discard(); assert.equal(c.snapshot().failure, null);
});

test('invalid photo diagnostics describe the result without retaining its data', async () => {
  const c = createCaptureController({ cameraFactory: () => ({ takePhoto: async () => ({ data: new Uint8Array(10), mimeType: 'image/jpeg' }) }) });
  assert.equal(await c.capture(), false);
  assert.equal(c.snapshot().failure.stage, 'validate');
  assert.equal(c.snapshot().failure.dataType, 'Uint8Array');
  assert.equal(c.snapshot().failure.byteLength, 10);
  assert.equal(c.snapshot().failure.mimeType, 'image/jpeg');
  assert.equal(c.snapshot().failure.isArrayBuffer, false);
  assert.equal(c.snapshot().photo, null);
  assert.equal('data' in c.snapshot().failure, false);
});

test('retry clears diagnostics, and a late rejected capture cannot restore discarded errors', async () => {
  let attempt = 0;
  const c = createCaptureController({ cameraFactory: () => ({ takePhoto: async () => { if (++attempt === 1) throw new Error('temporary failure'); return image(); } }) });
  assert.equal(await c.capture(), false);
  assert.equal(await c.capture(), true);
  assert.equal(c.snapshot().failure, null);
  let reject;
  const pendingController = createCaptureController({ cameraFactory: () => ({ takePhoto: () => new Promise((_, r) => { reject = r; }) }) });
  const pending = pendingController.capture(); pendingController.discard();
  reject(new Error('late failure')); await pending;
  assert.equal(pendingController.snapshot().failure, null);
  assert.equal(pendingController.snapshot().state, 'idle');
});
