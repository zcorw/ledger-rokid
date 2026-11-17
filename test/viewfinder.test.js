import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewfinderController } from '../aiui/lib/viewfinder.js';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
function rig(overrides = {}) {
  const tracks = [], events = [], revoked = [], states = [];
  let requests = 0, shots = 0, urls = 0;
  function stream() {
    const listeners = new Map();
    const track = { stops: 0, readyState: 'live', stop() { this.stops++; this.readyState = 'ended'; events.push('stop'); }, addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); }, end() { listeners.get('ended')?.(); } };
    tracks.push(track); return { getTracks: () => [track], getVideoTracks: () => [track] };
  }
  const c = createViewfinderController({
    requestStream: async constraints => { requests++; assert.equal(constraints.audio, false); return stream(); },
    createPreviewURL: () => 'blob:preview-' + ++urls,
    revokePreviewURL: url => { revoked.push(url); events.push('revoke'); },
    cameraFactory: () => { events.push('camera'); return { takePhoto: async options => { shots++; events.push({ options }); return { data: new Uint8Array([1, 2, 3]).buffer, mimeType: 'image/webp' }; } }; },
    runtimeInfo: () => 'test-runtime/0.19', notify: value => states.push(value),
    ...overrides,
  });
  return { c, tracks, events, revoked, states, stream, counts: () => ({ requests, shots }), async ready() { assert.equal(await c.start(), true); assert.equal(c.snapshot().state, 'previewing'); } };
}

test('live preview without any video playback event remains available for manual confirmation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = rig(); t.after(() => r.c.close());
  assert.equal(await r.c.start(), true);
  t.mock.timers.tick(11000);
  assert.equal(r.c.snapshot().state, 'previewing'); assert.equal(r.c.snapshot().busy, false);
  assert.equal(r.counts().shots, 0); assert.equal(r.tracks[0].stops, 0);
  assert.equal(await r.c.confirm(), true); assert.equal(r.counts().shots, 1);
});

test('playing is an optional diagnostic and is accepted only once for the current video', async t => {
  const r = rig(); t.after(() => r.c.close());
  assert.equal(await r.c.confirm(), false);
  assert.equal(await r.c.start(), true); assert.equal(r.c.snapshot().state, 'previewing'); assert.equal(r.c.snapshot().busy, false);
  assert.equal(r.counts().shots, 0);
  const preview = r.c.snapshot().preview; assert.equal(preview.src, 'blob:preview-1');
  assert.equal(r.c.markPlaying(preview.id), true); assert.equal(r.c.snapshot().state, 'previewing');
  assert.equal(r.c.snapshot().busy, false); assert.equal(r.counts().shots, 0);
  assert.equal(r.c.markPlaying(preview.id), false);
});

test('confirmation releases video resources before acquiring the wx camera and captures WebP once', async () => {
  const r = rig(); await r.ready();
  assert.deepEqual(await Promise.all([r.c.confirm(), r.c.confirm()]), [true, false]);
  assert.deepEqual(r.events.slice(0, 3), ['stop', 'revoke', 'camera']);
  assert.deepEqual(r.events.find(value => typeof value === 'object').options, { quality: 'high', mode: 'telephoto', enableSystemPreview: false });
  assert.equal(r.counts().shots, 1); assert.equal(r.c.snapshot().photo.mimeType, 'image/webp');
  assert.deepEqual([...new Uint8Array(r.c.snapshot().photo.data)], [1, 2, 3]);
  assert.equal(r.c.snapshot().preview, null); assert.equal(r.tracks[0].stops, 1); assert.deepEqual(r.revoked, ['blob:preview-1']); r.c.close();
});

test('cancel and unload during acquisition immediately stop any late stream without creating a URL', async () => {
  for (const method of ['discard', 'close']) {
    const acquisition = deferred(); let urls = 0;
    const r = rig({ requestStream: () => acquisition.promise, createPreviewURL: () => { urls++; return 'blob:late'; } });
    const pending = r.c.start(); r.c[method](); const before = r.states.length;
    assert.equal(await r.c.start(), false); acquisition.resolve(r.stream()); assert.equal(await pending, false);
    assert.equal(r.tracks[0].stops, 1); assert.equal(urls, 0);
    if (method === 'close') assert.equal(r.states.length, before);
    r.c.close();
  }
});

test('cancelled video events cannot unlock or fail a later preview session', async () => {
  const r = rig(); await r.c.start(); const old = r.c.snapshot().preview;
  r.c.discard(); assert.equal(r.tracks[0].stops, 1);
  await r.c.start(); const current = r.c.snapshot().preview;
  assert.notEqual(current.id, old.id); assert.equal(r.c.markPlaying(old.id), false);
  assert.equal(r.c.videoError(old.id, new Error('stale')), false); assert.equal(r.c.snapshot().state, 'previewing');
  assert.equal(r.c.markPlaying(current.id), true); assert.equal(r.counts().shots, 0); r.c.close();
  assert.ok(r.tracks.every(track => track.stops === 1)); assert.equal(r.revoked.length, 2);
});

test('native playback errors release the URL and track and report the failed step and runtime', async () => {
  const r = rig(); await r.c.start(); const id = r.c.snapshot().preview.id;
  assert.equal(r.c.videoError(id, new Error('stream playback unsupported')), true);
  assert.equal(r.c.snapshot().failure.step, 'preview-attached'); assert.equal(r.c.snapshot().failure.runtime, 'test-runtime/0.19');
  assert.equal(r.c.snapshot().preview, null); assert.equal(r.tracks[0].stops, 1); assert.equal(r.revoked.length, 1); r.c.close();
});

test('late video callbacks after confirmation cannot clear a successfully captured photo', async () => {
  const r = rig(); await r.c.start(); const id = r.c.snapshot().preview.id;
  assert.equal(await r.c.confirm(), true); const photo = r.c.snapshot().photo;
  assert.equal(r.c.markPlaying(id), false); assert.equal(r.c.videoError(id, new Error('late')), false);
  assert.equal(r.c.snapshot().photo, photo); assert.equal(r.c.snapshot().state, 'captured');
  assert.equal(r.tracks[0].stops, 1); assert.equal(r.revoked.length, 1); r.c.close();
});

test('unsupported stream URL creation releases the already acquired camera', async () => {
  const r = rig({ createPreviewURL() { throw new TypeError('MediaStream URLs unavailable'); } });
  assert.equal(await r.c.start(), false); assert.equal(r.c.snapshot().failure.step, 'create-preview-url');
  assert.equal(r.tracks[0].stops, 1); assert.equal(r.revoked.length, 0); assert.equal(r.counts().shots, 0); r.c.close();
});

test('cancel during still capture blocks another camera request until the native call settles', async () => {
  const exposure = deferred(); const r = rig({ cameraFactory: () => ({ takePhoto: () => exposure.promise }) });
  await r.ready(); const pending = r.c.confirm(); await flush(); r.c.discard('hidden');
  assert.equal(await r.c.start(), false); exposure.resolve({ data: new ArrayBuffer(3), mimeType: 'image/webp' });
  assert.equal(await pending, false); assert.equal(r.c.snapshot().photo, null); assert.equal(r.c.snapshot().stopReason, 'hidden');
  assert.equal(r.c.snapshot().busy, false); assert.equal(r.tracks[0].stops, 1); assert.equal(r.revoked.length, 1); r.c.close();
});

test('cancellation stops every acquired track and revokes the preview URL exactly once', async () => {
  const stops = [0, 0];
  const tracks = stops.map((_, index) => ({ readyState: 'live', stop() { stops[index]++; } }));
  const r = rig({ requestStream: async () => ({ getTracks: () => tracks, getVideoTracks: () => [tracks[0]] }) });
  await r.ready(); r.c.discard(); r.c.discard(); r.c.close();
  assert.deepEqual(stops, [1, 1]); assert.equal(r.revoked.length, 1);
});

test('a camera disconnect during preview clears playback and all resources', async () => {
  const r = rig(); await r.ready(); r.tracks[0].end();
  assert.equal(r.c.snapshot().state, 'failed'); assert.equal(r.c.snapshot().preview, null);
  assert.equal(r.tracks[0].stops, 1); assert.equal(r.revoked.length, 1); assert.equal(r.counts().shots, 0); r.c.close();
});

test('diagnostic and URL cleanup failures do not interrupt track release', async () => {
  const original = console.log; const r = rig({ revokePreviewURL() { throw new Error('URL cleanup failed'); } });
  try { console.log = () => { throw new Error('logger unavailable'); }; await r.ready(); assert.doesNotThrow(() => r.c.discard()); assert.equal(r.tracks[0].stops, 1); assert.equal(r.c.snapshot().state, 'idle'); }
  finally { console.log = original; r.c.close(); }
});
