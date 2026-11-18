import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceiptApi, receiptApiConfig } from '../aiui/lib/receipt-api.js';
const origin = 'https://ledger.zcorw.xyz', prefix = origin + '/api/v1/receipt-devices';
const photo = { data: new Uint8Array([1, 2, 3]).buffer, mimeType: 'image/jpeg' };
const candidate = { amount: '19.88', expenseDate: '2026-11-16', currencyCode: 'CNY', merchant: '真实返回商户', warnings: [] };
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
function memoryStore(initial = null) {
  let value = initial;
  return { read: () => value, write: (resource, next) => { value = next; }, remove: () => { value = null; } };
}
const saved = (extra = {}) => JSON.stringify({ version: 1, resource: prefix, accessToken: 's'.repeat(43), scope: 'receipt:recognize', expiresAt: null, ...extra });
test('native WebP bytes are uploaded unchanged and the archive identifier stays outside the candidate', async () => {
  const raw = new Uint8Array([82, 73, 70, 70, 1, 2, 3]).buffer;
  const id = 'e4f82d1a-00d4-40d3-a25c-302f55d1f331';
  let upload;
  const api = createReceiptApi({ credentialStore: memoryStore(saved()), fetchImpl: async (url, options) => {
    upload = options; return json(candidate, 200, { 'X-Receipt-Id': id });
  } });
  const response = await api.recognize({ data: raw, mimeType: 'image/webp' });
  assert.equal(upload.body, raw); assert.equal(upload.headers['Content-Type'], 'image/webp');
  assert.equal(response.receiptId, id); assert.deepEqual(response.body, candidate);
});
function fixture(overrides = {}) {
  let clock = Date.parse('2026-11-16T00:00:00Z'), pending = 1, starts = 0;
  const calls = [], states = [], encoded = [];
  const api = createReceiptApi({
    credentialStore: overrides.store || memoryStore(),
    now: () => clock, sleep: async (ms, signal) => { if (signal?.aborted) throw new Error('CANCELLED'); clock += ms; },
    notifyAuthorization: state => states.push(state),
    encodePhoto: async source => { encoded.push(source); return source; },
    fetchImpl: async (url, options) => {
      calls.push({ url, ...options });
      const custom = await overrides.fetch?.(url, options); if (custom) return custom;
      if (url.endsWith('/pairings')) { starts++; return json({ deviceCode: 'd'.repeat(43), userCode: 'ABCD-EFGH', verificationUri: origin + '/receipt-devices', expiresAt: new Date(clock + 600_000).toISOString(), interval: 3 }, 201); }
      if (url.endsWith('/pairings/token')) return pending-- > 0 ? json({ status: 'authorization_pending' }, 202) : json({ accessToken: 's'.repeat(43), tokenType: 'Bearer', scope: 'receipt:recognize', expiresAt: null });
      assert.equal(url, prefix + '/receipt-recognition'); return json(candidate);
    }, ...overrides.api,
  });
  return { api, calls, states, encoded, advance: ms => { clock += ms; }, starts: () => starts };
}
test('entry binding saves authorization without a photo, encoding or recognition upload', async () => {
  const store = memoryStore(), f = fixture({ store });
  assert.equal(await f.api.authorize(), true); assert.ok(store.read()); assert.equal(f.encoded.length, 0);
  assert.deepEqual(f.calls.map(call => call.url), ['/pairings', '/pairings/token', '/pairings/token'].map(path => prefix + path));
  assert.deepEqual(f.states.map(state => state.state), ['pending', 'idle']);
  await f.api.recognize(photo); assert.equal(f.starts(), 1); assert.equal(f.calls.at(-1).url, prefix + '/receipt-recognition');
});

test('voice correction sends only the transcript and candidate through the authenticated JSON API', async () => {
  const values = { amount: '614' }, reply = { values, changedFields: [], warnings: [] };
  const f = fixture({ fetch: async url => url.endsWith('/review-correction') ? json(reply) : null });
  assert.deepEqual(await f.api.correct(values, '金额改为614'), reply);
  const call = f.calls.at(-1); assert.equal(call.headers.Authorization, 'Bearer ' + 's'.repeat(43));
  assert.deepEqual(JSON.parse(call.body), { values, transcript: '金额改为614' });
  assert.equal(call.credentials, 'omit'); assert.equal(f.encoded.length, 0);
});

test('confirmation uses the existing grant, checks capabilities and queries an operation by key', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const f = fixture({ fetch: async url => {
    if (url.endsWith('/capabilities')) return json({ deviceId: id, canCreateExpenses: true, authorizationUri: origin + '/receipt-devices?device=' + id });
    if (url.includes('/receipt-confirmations/')) return json({ status: 'not_found' });
    if (url.endsWith('/receipt-confirmations')) return json({ status: 'recorded' }, 201);
  } });
  assert.equal((await f.api.capabilities()).canCreateExpenses, true);
  assert.equal((await f.api.getConfirmation(id, id)).status, 'not_found');
  assert.equal((await f.api.confirmReceipt({ receiptId: id, requestKey: id, revision: 1, confirmed: true })).status, 201);
  assert.ok(f.calls.at(-2).url.endsWith('/' + id + '?receiptId=' + id));
  assert.equal(f.calls.at(-1).headers.Authorization, 'Bearer ' + 's'.repeat(43));
});
test('entry binding restores a saved grant without a pairing request or phone code', async () => {
  const f = fixture({ store: memoryStore(saved()) });
  assert.equal(await f.api.authorize(), true); assert.equal(f.calls.length, 0); assert.deepEqual(f.states, []); assert.equal(f.encoded.length, 0);
});
test('cancelling entry binding stops polling without saving a credential or uploading', async () => {
  const controller = new AbortController(), store = memoryStore();
  const f = fixture({ store, api: { sleep: async () => controller.abort() } });
  await assert.rejects(f.api.authorize({ signal: controller.signal }), /CANCELLED/);
  assert.equal(store.read(), null); assert.equal(f.encoded.length, 0); assert.equal(f.calls.length, 1); assert.equal(f.states.at(-1).state, 'idle');
});
test('real HTTPS flow waits for approval before encoding or uploading and keeps secrets out of UI', async () => {
  assert.equal(receiptApiConfig.baseUrl, origin);
  const f = fixture(); const result = await f.api.recognize(photo); assert.deepEqual(result, { status: 200, body: candidate });
  assert.deepEqual(f.calls.map(call => call.url), ['/pairings', '/pairings/token', '/pairings/token', '/receipt-recognition'].map(path => prefix + path));
  const upload = f.calls.at(-1); assert.equal(upload.body, photo.data); assert.equal(upload.headers.Authorization, 'Bearer ' + 's'.repeat(43)); assert.equal(upload.headers['Content-Type'], 'image/jpeg'); assert.equal(upload.headers['X-Receipt-Upload'], '1');
  for (const call of f.calls) { assert.equal(call.credentials, 'omit'); assert.equal(call.redirect, 'error'); assert.ok(call.signal); }
  assert.deepEqual(f.states.map(state => state.state), ['pending', 'idle']);
  assert.equal(JSON.stringify(f.states).includes('d'.repeat(43)), false); assert.equal(JSON.stringify(f.states).includes('s'.repeat(43)), false);
  assert.deepEqual(f.encoded, [photo]);
});
test('long-lived grant is reused without time-based reauthorization and cleared only explicitly or when unauthorized', async () => {
  const f = fixture(); await f.api.recognize(photo); await f.api.recognize(photo); assert.equal(f.starts(), 1);
  f.advance(10 * 365 * 86400_000); await f.api.recognize(photo); assert.equal(f.starts(), 1);
  f.api.clear(); await f.api.recognize(photo); assert.equal(f.starts(), 2);
  let rejected = true;
  const g = fixture({ fetch: url => url.endsWith('/receipt-recognition') && rejected ? json({ error: { code: 'DEVICE_UNAUTHORIZED' } }, 401) : null });
  assert.equal((await g.api.recognize(photo)).status, 401); rejected = false; await g.api.recognize(photo); assert.equal(g.starts(), 2);
});
test('denied, expired, missing endpoint and unconfigured provider never upload or fabricate results', async () => {
  for (const [status, code] of [[403, 'DEVICE_ACCESS_DENIED'], [410, 'DEVICE_CODE_EXPIRED'], [404, 'DEVICE_ENDPOINT_UNAVAILABLE']]) {
    const f = fixture({ fetch: url => url.endsWith('/pairings/token') ? json({ error: { code } }, status) : null });
    await assert.rejects(f.api.recognize(photo), new RegExp(code)); assert.equal(f.encoded.length, 0); assert.equal(f.calls.some(call => call.url.endsWith('/receipt-recognition')), false);
  }
  const f = fixture({ fetch: url => url.endsWith('/receipt-recognition') ? json({ error: { code: 'RECEIPT_NOT_CONFIGURED' } }, 503) : null });
  await assert.rejects(f.api.recognize(photo), /BACKEND_NOT_CONFIGURED/);
});
test('malformed or oversized responses and redirects are rejected', async () => {
  for (const response of [json({}, 201), json({}, 201, { 'Content-Length': '17000' }), json({ value: 'x'.repeat(17000) }, 201), new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }), { ...json({}), redirected: true }]) {
    const f = fixture({ api: { fetchImpl: async () => response } });
    await assert.rejects(f.api.recognize(photo), /INVALID_RESULT|BACKEND_REDIRECT/); assert.equal(f.encoded.length, 0);
  }
  assert.throws(() => createReceiptApi({ config: { baseUrl: 'http://ledger.zcorw.xyz', prefix: '/api' } }), /BACKEND_CONFIG/);
});
test('aborting pending polling or an in-flight request stops the operation before upload', async () => {
  const controller = new AbortController();
  const f = fixture({ api: { sleep: async () => controller.abort() } });
  await assert.rejects(f.api.recognize(photo, { signal: controller.signal }), /CANCELLED/); assert.equal(f.encoded.length, 0); assert.equal(f.states.at(-1).state, 'idle');
  const c = new AbortController(); let requestSignal;
  const g = fixture({ api: { fetchImpl: (url, options) => new Promise((resolve, reject) => { requestSignal = options.signal; options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); }) } });
  const run = g.api.recognize(photo, { signal: c.signal }); c.abort(); await assert.rejects(run, /CANCELLED/); assert.equal(requestSignal.aborted, true); assert.equal(g.encoded.length, 0);
});
test('transport timeout and network failures remain failures', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture({ api: { fetchImpl: (url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) } });
  const run = f.api.recognize(photo); t.mock.timers.tick(15_001); await assert.rejects(run, /TIMEOUT/);
  const g = fixture({ api: { fetchImpl: async () => { throw new Error('offline'); } } }); await assert.rejects(g.api.recognize(photo), /NETWORK_ERROR/);
});

test('authorization survives Agent restart and years of inactivity without another pairing', async () => {
  const store = memoryStore(), first = fixture({ store }); await first.api.recognize(photo);
  assert.equal(JSON.parse(store.read()).expiresAt, null); first.api.close(); assert.ok(store.read());
  const restarted = fixture({ store }); restarted.advance(20 * 365 * 86400_000);
  assert.equal((await restarted.api.recognize(photo)).status, 200); assert.equal(restarted.starts(), 0);
  assert.deepEqual(restarted.calls.map(call => call.url), [prefix + '/receipt-recognition']); assert.deepEqual(restarted.states, []);
});

test('revocation clears the saved grant while offline errors preserve it for the next launch', async () => {
  const store = memoryStore(saved());
  const revoked = fixture({ store, fetch: () => json({ error: { code: 'DEVICE_UNAUTHORIZED' } }, 401) });
  assert.equal((await revoked.api.recognize(photo)).status, 401); assert.equal(store.read(), null);
  const fresh = fixture({ store }); await fresh.api.recognize(photo); assert.equal(fresh.starts(), 1);
  const offline = fixture({ store, api: { fetchImpl: async () => { throw new Error('offline'); } } });
  await assert.rejects(offline.api.recognize(photo), /NETWORK_ERROR/); offline.api.close(); assert.ok(store.read());
  const returned = fixture({ store }); await returned.api.recognize(photo); assert.equal(returned.starts(), 0);
});

test('corrupt, wrong-origin or expired saved credentials are not sent and can authorize again', async () => {
  for (const raw of ['{bad json', 'x'.repeat(1025), saved({ resource: 'https://other.example/api' }), saved({ scope: 'expense:create' }), saved({ expiresAt: '2000-01-01T00:00:00Z' }), saved({ expiresAt: undefined })]) {
    const store = memoryStore(raw), f = fixture({ store }); await f.api.recognize(photo); assert.equal(f.starts(), 1);
    assert.equal(f.calls[0].headers.Authorization, undefined);
  }
  const store = memoryStore(saved({ expiresAt: '2026-11-16T00:15:00Z' })), f = fixture({ store });
  f.advance(14.5 * 60_000); await f.api.recognize(photo); assert.equal(f.starts(), 0);
  f.advance(60_000); await f.api.recognize(photo); assert.equal(f.starts(), 1);
});

test('storage read errors prevent pairing and a failed save retries without another phone approval', async () => {
  const broken = fixture({ store: { read() { throw new Error('AUTH_STORAGE_FAILED'); } } });
  await assert.rejects(broken.api.recognize(photo), /AUTH_STORAGE_FAILED/); assert.equal(broken.calls.length, 0);
  const store = memoryStore(), write = store.write; let fail = true;
  store.write = (...args) => { if (fail) throw new Error('AUTH_STORAGE_FAILED'); write(...args); };
  const f = fixture({ store }); await assert.rejects(f.api.recognize(photo), /AUTH_STORAGE_FAILED/); assert.equal(f.encoded.length, 0);
  fail = false; await f.api.recognize(photo); assert.equal(f.starts(), 1); assert.ok(store.read());
});

test('a closed or cancelled client cannot persist a late grant or upload after image encoding', async () => {
  const store = memoryStore(); let resolve, requested;
  const blocked = new Promise(yes => { resolve = yes; });
  const f = fixture({ store, fetch: url => { if (url.endsWith('/pairings/token')) { requested = true; return blocked; } } });
  const run = f.api.recognize(photo);
  while (!requested) await new Promise(yes => setImmediate(yes));
  f.api.close(); resolve(json({ accessToken: 's'.repeat(43), tokenType: 'Bearer', scope: 'receipt:recognize', expiresAt: null }));
  await assert.rejects(run, /CANCELLED/); assert.equal(store.read(), null); assert.equal(f.encoded.length, 0);
  let imageReady; const encoding = new Promise(yes => { imageReady = yes; });
  const g = fixture({ store: memoryStore(saved()), api: { encodePhoto: () => encoding } });
  const upload = g.api.recognize(photo); await new Promise(yes => setImmediate(yes)); g.api.close(); imageReady(photo);
  await assert.rejects(upload, /CANCELLED/); assert.equal(g.calls.length, 0);
});

test('closing during a late unauthorized response does not erase authorization saved for restart', async () => {
  const store = memoryStore(saved()); let body, requested = false;
  const f = fixture({ store, api: { fetchImpl: async () => {
    requested = true;
    return new Response(new ReadableStream({ start(controller) { body = controller; } }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  } } });
  const run = f.api.recognize(photo);
  while (!requested) await new Promise(resolve => setImmediate(resolve));
  f.api.close(); body.enqueue(new TextEncoder().encode('{"error":{"code":"DEVICE_UNAUTHORIZED"}}')); body.close();
  await assert.rejects(run, /CANCELLED/); assert.ok(store.read());
});
