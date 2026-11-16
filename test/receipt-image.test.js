import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareReceiptImage, MAX_RECEIPT_BYTES } from '../aiui/lib/receipt-image.js';
const photo = (mimeType = 'image/webp', length = 3) => ({ data: new ArrayBuffer(length), mimeType });
function fixture({ width = 2016, height = 1512, blob = new Blob(['jpeg'], { type: 'image/jpeg' }), decode } = {}) {
  const calls = []; let closes = 0;
  const bitmap = { width, height, close() { closes++; } };
  const runtime = { Blob, createImageBitmap: async input => { calls.push(['decode', input]); return decode ? decode(bitmap) : bitmap; }, Canvas: class {
    constructor(w, h) { calls.push(['canvas', w, h]); }
    getContext() { return { fillRect: (...args) => calls.push(['white', ...args]), drawImage: (...args) => calls.push(['draw', ...args]) }; }
    async convertToBlob(options) { calls.push(['encode', options]); return blob; }
  } };
  return { runtime, calls, closes: () => closes };
}
test('accepted PNG/JPEG pass original bytes through without a display thumbnail or re-encoding', async () => {
  for (const type of ['image/png', 'image/jpeg']) { const p = photo(type); assert.equal(await prepareReceiptImage(p, { runtime: {} }), p); }
});
test('WebP is decoded from the original full-size image, flattened white and encoded as JPEG', async () => {
  const f = fixture(), p = photo(); const result = await prepareReceiptImage(p, { runtime: f.runtime });
  assert.equal(result.mimeType, 'image/jpeg'); assert.equal(new TextDecoder().decode(result.data), 'jpeg');
  assert.deepEqual(f.calls[1], ['canvas', 2016, 1512]); assert.deepEqual(f.calls[2], ['white', 0, 0, 2016, 1512]);
  assert.deepEqual(f.calls.at(-1), ['encode', { type: 'image/jpeg', quality: 0.9 }]); assert.equal(f.closes(), 1);
  assert.equal(f.calls[0][1].type, 'image/webp'); assert.equal((await f.calls[0][1].arrayBuffer()).byteLength, p.data.byteLength);
});
test('large original images are scaled proportionally and bounded encoder fallback PNG is accepted', async () => {
  const f = fixture({ width: 5000, height: 3000, blob: new Blob(['png'], { type: 'image/png' }) });
  assert.equal((await prepareReceiptImage(photo(), { runtime: f.runtime })).mimeType, 'image/png'); assert.deepEqual(f.calls[1], ['canvas', 4096, 2458]);
});
test('failed, oversized and cancelled conversions close decoded pixels and never return a photo', async () => {
  for (const [options, code] of [[{ width: 10000, height: 10000 }, 'IMAGE_TOO_LARGE'], [{ blob: new Blob(['bad'], { type: 'image/webp' }) }, 'IMAGE_ENCODING_FAILED'], [{ blob: { type: 'image/jpeg', size: MAX_RECEIPT_BYTES + 1 } }, 'IMAGE_TOO_LARGE']]) {
    const f = fixture(options); await assert.rejects(prepareReceiptImage(photo(), { runtime: f.runtime }), new RegExp(code)); assert.equal(f.closes(), 1);
  }
  const controller = new AbortController(), f = fixture({ decode: bitmap => { controller.abort(); return bitmap; } });
  await assert.rejects(prepareReceiptImage(photo(), { runtime: f.runtime, signal: controller.signal }), /CANCELLED/); assert.equal(f.closes(), 1); assert.equal(f.calls.length, 1);
  await assert.rejects(prepareReceiptImage(photo(), { runtime: {} }), /IMAGE_ENCODING_UNSUPPORTED/);
});
