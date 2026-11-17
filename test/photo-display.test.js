import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoDisplayController } from '../aiui/lib/photo-display.js';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const photo = () => ({ data: new Uint8Array([1, 2, 3]).buffer, mimeType: 'image/webp' });
function rig(options = {}) {
  const calls = [], states = [], bitmaps = [];
  const context = { clearRect: (...args) => calls.push(['clear', ...args]), drawImage: (...args) => calls.push(['draw', ...args]), flush: () => calls.push(['flush']) };
  function bitmap(width = 2016, height = 1512) {
    const value = { width, height, closes: 0, close() { this.closes++; } }; bitmaps.push(value); return value;
  }
  let decodes = 0;
  const display = createPhotoDisplayController({ decode: async value => { decodes++; return options.decode ? options.decode(value) : bitmap(); }, contextFactory: () => context, notify: value => states.push(value), ...options });
  return { display, calls, states, bitmaps, bitmap, decodes: () => decodes };
}

test('landscape and portrait photos fit completely inside the frame and release decoded pixels', async () => {
  for (const [width, height, rectangle] of [[2016, 1512, [80, 0, 240, 180]], [1512, 2016, [132.5, 0, 135, 180]]]) {
    const r = rig(); const image = r.bitmap(width, height); const source = photo();
    const display = createPhotoDisplayController({ decode: async value => { assert.equal(value, source); return image; }, contextFactory: () => ({ clearRect() {}, drawImage: (...args) => r.calls.push(args), flush: () => r.calls.push('flush') }) });
    assert.equal(await display.show(source), true);
    assert.deepEqual(r.calls[0], [image, ...rectangle]); assert.equal(r.calls[1], 'flush');
    assert.equal(image.closes, 1); assert.equal(display.snapshot().state, 'visible'); display.close();
  }
});

test('repeated notifications reuse the display; clear removes pixels and permits displaying again', async () => {
  const r = rig(); const source = photo();
  await r.display.show(source); assert.equal(await r.display.show(source), true); assert.equal(r.decodes(), 1);
  r.display.clear(); assert.deepEqual(r.calls.slice(-2), [['clear', 0, 0, 400, 180], ['flush']]);
  assert.equal(r.display.snapshot().state, 'idle'); await r.display.show(source); assert.equal(r.decodes(), 2);
  r.display.close(); assert.ok(r.bitmaps.every(value => value.closes === 1));
});

test('clear and close prevent a late decoded photo from drawing or updating the page', async () => {
  for (const method of ['clear', 'close']) {
    const decode = deferred(); const r = rig({ decode: () => decode.promise });
    const pending = r.display.show(photo()); r.display[method](); const before = r.states.length;
    const image = r.bitmap(); decode.resolve(image); assert.equal(await pending, false);
    assert.equal(r.calls.length, 0); assert.equal(image.closes, 1); assert.equal(r.states.length, before);
    r.display.close(); assert.equal(await r.display.show(photo()), false);
  }
});

test('a retake wins over an earlier unfinished decode', async () => {
  const old = photo(), current = photo(), decoding = deferred(); const r = rig();
  const oldImage = r.bitmap(), newImage = r.bitmap();
  const display = createPhotoDisplayController({ decode: value => value === old ? decoding.promise : Promise.resolve(newImage), contextFactory: () => ({ clearRect() {}, drawImage: value => r.calls.push(value), flush() {} }) });
  const previous = display.show(old); assert.equal(await display.show(current), true);
  decoding.resolve(oldImage); assert.equal(await previous, false);
  assert.deepEqual(r.calls, [newImage]); assert.equal(oldImage.closes, 1); assert.equal(newImage.closes, 1); display.close();
});

test('decode, canvas and drawing failures remain display errors and release any decoded bitmap', async () => {
  for (const kind of ['decode', 'context', 'draw', 'dimensions']) {
    const r = rig(); const image = r.bitmap(kind === 'dimensions' ? 0 : 100, 100);
    const display = createPhotoDisplayController({
      decode: async () => { if (kind === 'decode') throw new Error('cannot decode WebP'); return image; },
      contextFactory: () => kind === 'context' ? null : { clearRect() {}, drawImage() { if (kind === 'draw') throw new Error('draw failed'); }, flush() {} },
    });
    assert.equal(await display.show(photo()), false); assert.equal(display.snapshot().state, 'failed'); assert.ok(display.snapshot().error);
    assert.equal(image.closes, kind === 'decode' ? 0 : 1); display.close();
  }
});
