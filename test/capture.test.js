import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCaptureController } from '../aiui/lib/capture.js';
const image = () => ({ data: new ArrayBuffer(10), mimeType: 'image/jpeg' });
test('successful capture uses documented options and retains only in memory', async () => {
  let options;
  const c = createCaptureController({ cameraFactory: () => ({ takePhoto: async value => { options = value; return image(); } }) });
  assert.equal(await c.capture(), true);
  assert.deepEqual(options, { quality: 'high', mode: 'telephoto', enableSystemPreview: true });
  assert.equal(c.snapshot().state, 'captured');
  c.discard(); assert.equal(c.snapshot().photo, null);
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
test('manifest has camera only and page uses controller lifecycle', () => {
  const app = JSON.parse(readFileSync(new URL('../aiui/app.json', import.meta.url)));
  assert.deepEqual(app.permissions, ['CAMERA']);
  const page = readFileSync(new URL('../aiui/pages/capture/index.ink', import.meta.url), 'utf8');
  assert.match(page, /onHide\(\).*discard/); assert.match(page, /onUnload\(\).*close/);
  const script = page.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm, '').replace('export default', 'return');
  const definition = new Function('wx', 'createCaptureController', script)({}, createCaptureController);
  assert.equal(typeof definition.onLoad, 'function');
});
