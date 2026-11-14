import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCaptureController } from '../aiui/lib/capture.js';

// Exercise the actual page callbacks without pretending to compile AIUI or use hardware.
const source = await readFile(new URL('../aiui/pages/capture/index.ink', import.meta.url), 'utf8');
const script = source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm, '');
const definition = (await import('data:text/javascript,' + encodeURIComponent(script))).default;
function page() {
  let captures = 0, discards = 0;
  const p = { ...definition, data: { ...definition.data },
    setData(value) { Object.assign(this.data, value); },
    controller: { capture() { captures++; return true; }, discard() { discards++; } },
  };
  return { p, counts: () => ({ captures, discards }) };
}
function key(code, repeat = false) {
  return { code, repeat, prevented: false, preventDefault() { this.prevented = true; } };
}
test('confirm invokes capture without a target callback', () => {
  const { p, counts } = page();
  const event = key('Enter'); p.onKeyUp(event);
  assert.equal(event.prevented, true);
  assert.equal(counts().captures, 1);
});
test('confirm captures once; repeat and unrelated keys do not capture', () => {
  const { p, counts } = page();
  const event = key('Enter'); p.onKeyUp(event);
  assert.equal(event.prevented, true);
  p.onKeyUp(key('Enter', true));
  for (const code of ['Backspace', 'GlobalHook', 'Escape']) {
    const e = key(code); p.onKeyUp(e); assert.equal(e.prevented, false);
  }
  assert.equal(counts().captures, 1);
});
test('direction changes selection, confirm clears, hiding discards image', () => {
  const { p, counts } = page();
  const down = key('ArrowDown'); p.onKeyUp(down);
  assert.equal(down.prevented, true);
  assert.equal(p.data.selectedAction, 'discard');
  p.onKeyUp(key('Enter'));
  assert.deepEqual(counts(), { captures: 0, discards: 1 });
  p.onKeyUp(key('ArrowUp'));
  assert.equal(p.data.selectedAction, 'capture');
  p.onHide();
  assert.equal(counts().discards, 2);
});
test('tap invokes capture without a target callback', () => {
  const { p, counts } = page();
  assert.equal(p.capture(), true);
  assert.equal(counts().captures, 1);
});

test('page shows native error details and separates invalid returned photos from capture errors', async () => {
  const makePage = new Function('wx', 'createCaptureController', script.replace('export default', 'return'));
  for (const [takePhoto, expected] of [
    [async () => { throw { code: 'CAMERA_BUSY', message: 'Camera is busy' }; }, ['拍摄接口', 'CAMERA_BUSY', 'Camera is busy']],
    [async () => ({ data: new Uint8Array(10), mimeType: 'image/jpeg' }), ['照片返回值校验', 'Uint8Array', '字节=10', 'MIME=image/jpeg']],
  ]) {
    const p = makePage({ media: { createCameraContext: () => ({ takePhoto }) } }, createCaptureController);
    p.setData = function(value) { Object.assign(this.data, value); };
    p.onLoad(); assert.equal(await p.capture(), false);
    for (const fragment of expected) assert.ok(p.data.message.includes(fragment), p.data.message);
    assert.equal(p.data.busy, false);
    assert.equal(p.data.message.includes('权限未获准'), false);
    p.discard(); assert.equal(p.controller.snapshot().failure, null);
  }
});

test('page accepts the WebP result reported by the glasses and shows capture success', async () => {
  const result = { data: new ArrayBuffer(965298), mimeType: 'image/webp' };
  const makePage = new Function('wx', 'createCaptureController', script.replace('export default', 'return'));
  const p = makePage({ media: { createCameraContext: () => ({ takePhoto: async () => result }) } }, createCaptureController);
  p.setData = function(value) { Object.assign(this.data, value); };
  p.onLoad();
  assert.equal(await p.capture(), true);
  assert.ok(p.data.message.includes('已收到照片 965298 字节'), p.data.message);
  assert.equal(p.data.busy, false);
  assert.equal(p.controller.snapshot().photo.mimeType, 'image/webp');
  assert.equal(p.controller.snapshot().failure, null);
});
