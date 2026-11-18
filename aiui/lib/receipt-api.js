import { createReceiptCredentialStore } from './receipt-credential-store.js';

export const receiptApiConfig = Object.freeze({ baseUrl: 'https://ledger.zcorw.xyz', prefix: '/api/v1/receipt-devices' });
const MAX_RESPONSE_BYTES = 16_384;
const error = code => new Error(code);
const check = signal => { if (signal?.aborted) throw error('CANCELLED'); };
const originalImage = async photo => {
  if (!(photo?.data instanceof ArrayBuffer) || !photo.data.byteLength) throw error('IMAGE_ENCODING_FAILED');
  if (photo.data.byteLength > 8 * 1024 * 1024) throw error('IMAGE_TOO_LARGE');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(photo.mimeType)) throw error('IMAGE_ENCODING_UNSUPPORTED');
  return photo;
};

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    check(signal);
    const stop = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); reject(error('CANCELLED')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms);
    signal?.addEventListener('abort', stop, { once: true });
  });
}

async function boundedJson(response, signal) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (declared > MAX_RESPONSE_BYTES || !String(response.headers?.get?.('content-type') || '').toLowerCase().includes('application/json')) {
    try { await response.body?.cancel?.(); } catch {}
    throw error(declared > MAX_RESPONSE_BYTES || response.status < 400 ? 'INVALID_RESULT' : 'BACKEND_UNAVAILABLE');
  }
  if (typeof response.body?.getReader !== 'function' || typeof TextDecoder !== 'function') throw error('RUNTIME_UNSUPPORTED');
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let length = 0, text = '';
  try {
    while (true) {
      check(signal); const { done, value } = await reader.read(); check(signal);
      if (done) break;
      if (!(value instanceof Uint8Array) || (length += value.byteLength) > MAX_RESPONSE_BYTES) throw error('INVALID_RESULT');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw error('INVALID_RESULT');
    return value;
  } catch (failure) {
    try { await reader.cancel(); } catch {}
    if (failure?.message === 'CANCELLED') throw failure;
    throw error('INVALID_RESULT');
  } finally { reader.releaseLock?.(); }
}

export function createReceiptApi({ fetchImpl = (...args) => globalThis.fetch(...args), encodePhoto = originalImage, notifyAuthorization = () => {}, now = Date.now, sleep = wait, config = receiptApiConfig, credentialStore = createReceiptCredentialStore() } = {}) {
  const origin = new URL(config.baseUrl);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || !['', '/'].includes(origin.pathname)) throw error('BACKEND_CONFIG');
  const base = origin.origin + config.prefix;
  let credential = null, loaded = false, authorizationRun = 0, closed = false;
  const active = signal => { check(signal); if (closed) throw error('CANCELLED'); };
  const valid = value => value && value.version === 1 && value.resource === base && value.scope === 'receipt:recognize' && /^[A-Za-z0-9_-]{43}$/.test(value.accessToken) && (value.expiresAt === null || (typeof value.expiresAt === 'string' && Number.isFinite(Date.parse(value.expiresAt)) && Date.parse(value.expiresAt) > now()));
  let needsSave = false;
  function persist() {
    if (needsSave) { credentialStore.write(base, JSON.stringify(credential)); needsSave = false; }
  }
  function forget() {
    credential = null; needsSave = false; loaded = false;
    credentialStore.remove(base); loaded = true;
  }
  function restore() {
    if (loaded) return;
    const raw = credentialStore.read(base);
    if (raw === null || raw === undefined || raw === '') { loaded = true; return; }
    let saved;
    try { if (typeof raw === 'string' && raw.length <= 1024) saved = JSON.parse(raw); } catch {}
    if (valid(saved)) { credential = saved; loaded = true; }
    else forget();
  }

  async function request(path, { signal, timeout = 15_000, ...options } = {}) {
    active(signal);
    if (typeof globalThis.AbortController !== 'function') throw error('RUNTIME_UNSUPPORTED');
    const controller = new AbortController(); let timedOut = false;
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
    try {
      const response = await fetchImpl(base + path, { ...options, credentials: 'omit', redirect: 'error', cache: 'no-store', timeout, signal: controller.signal });
      active(signal);
      if (response.redirected || (response.url && new URL(response.url).href !== base + path)) throw error('BACKEND_REDIRECT');
      const body = await boundedJson(response, controller.signal);
      active(signal);
      const receiptId = response.headers?.get?.('X-Receipt-Id');
      return { status: response.status, body, ...(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(receiptId || '') ? { receiptId } : {}) };
    } catch (failure) {
      if (closed || signal?.aborted) throw error('CANCELLED');
      if (timedOut) throw error('TIMEOUT');
      if (['INVALID_RESULT', 'RUNTIME_UNSUPPORTED', 'BACKEND_REDIRECT', 'BACKEND_UNAVAILABLE'].includes(failure?.message)) throw failure;
      throw error('NETWORK_ERROR');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }

  const json = (value, signal) => ({ method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  function authorizationError(response) {
    const code = response.body?.error?.code;
    if (['DEVICE_ACCESS_DENIED', 'DEVICE_CODE_EXPIRED', 'DEVICE_RATE_LIMIT', 'DEVICE_CODE_USED'].includes(code)) return error(code);
    return error(response.status === 404 ? 'DEVICE_ENDPOINT_UNAVAILABLE' : response.status === 429 ? 'RATE_LIMITED' : 'AUTH_REQUIRED');
  }

  async function authorized(signal) {
    active(signal); restore();
    if (valid(credential)) { persist(); return credential.accessToken; }
    if (credential) forget();
    const current = ++authorizationRun;
    try {
      const started = await request('/pairings', json({ deviceName: 'Rokid' }, signal));
      if (started.status !== 201) throw authorizationError(started);
      const pairing = started.body, expiresAt = Date.parse(pairing.expiresAt);
      let verification;
      try { verification = new URL(pairing.verificationUri); } catch { throw error('INVALID_RESULT'); }
      if (!/^[A-Za-z0-9_-]{43}$/.test(pairing.deviceCode) || !/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(pairing.userCode) || verification.origin !== origin.origin || verification.username || verification.password || verification.pathname !== '/receipt-devices' || verification.search || verification.hash || !Number.isFinite(expiresAt) || expiresAt <= now() || expiresAt > now() + 11 * 60_000) throw error('INVALID_RESULT');
      let interval = Number(pairing.interval);
      if (!Number.isFinite(interval) || interval < 3 || interval > 30) throw error('INVALID_RESULT');
      if (current === authorizationRun) notifyAuthorization({ state: 'pending', userCode: pairing.userCode, verificationUri: verification.href, expiresAt: pairing.expiresAt });
      while (now() < expiresAt) {
        await sleep(interval * 1000, signal); check(signal);
        if (current !== authorizationRun) throw error('CANCELLED');
        const response = await request('/pairings/token', json({ deviceCode: pairing.deviceCode }, signal));
        if (response.status === 202 && response.body.status === 'authorization_pending') continue;
        if (response.status === 429) { interval = Math.min(30, interval + 2); continue; }
        if (response.status !== 200) throw authorizationError(response);
        const grant = response.body;
        const saved = { version: 1, resource: base, accessToken: grant.accessToken, scope: grant.scope, expiresAt: grant.expiresAt };
        if (grant.tokenType !== 'Bearer' || !valid(saved)) throw error('INVALID_RESULT');
        active(signal); if (current !== authorizationRun) throw error('CANCELLED');
        credential = saved; needsSave = true; persist();
        return credential.accessToken;
      }
      throw error('DEVICE_CODE_EXPIRED');
    } finally { if (current === authorizationRun) notifyAuthorization({ state: 'idle' }); }
  }

  return {
    async capabilities({ signal } = {}) {
      const token = await authorized(signal); active(signal);
      const response = await request('/capabilities', { signal, headers: { Authorization: 'Bearer ' + token } });
      if (response.status === 401) { forget(); throw error('AUTH_REQUIRED'); }
      if (response.status !== 200 || typeof response.body.canCreateExpenses !== 'boolean') throw error('INVALID_RESULT');
      const uri = new URL(response.body.authorizationUri);
      if (uri.origin !== origin.origin || uri.username || uri.password || uri.hash || uri.pathname !== '/receipt-devices' || uri.search !== '?device=' + response.body.deviceId || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(response.body.deviceId || '')) throw error('INVALID_RESULT');
      return response.body;
    },
    async confirmReceipt(payload, { signal } = {}) {
      const token = await authorized(signal); active(signal);
      const response = await request('/receipt-confirmations', { ...json(payload, signal), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token } });
      if (response.status === 401) { forget(); throw error('AUTH_REQUIRED'); }
      return response;
    },
    async getConfirmation(requestKey, receiptId, { signal } = {}) {
      const token = await authorized(signal); active(signal);
      const response = await request('/receipt-confirmations/' + encodeURIComponent(requestKey) + '?receiptId=' + encodeURIComponent(receiptId), { signal, headers: { Authorization: 'Bearer ' + token } });
      if (response.status === 401) { forget(); throw error('AUTH_REQUIRED'); }
      if (response.status !== 200) throw error(response.body?.error?.code || 'CONFIRMATION_UNKNOWN');
      return response.body;
    },
    async saveDraft(payload, { signal } = {}) {
      const token = await authorized(signal); active(signal);
      const response = await request('/receipt-drafts', { ...json(payload, signal), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token } });
      if (response.status === 401) { forget(); throw error('AUTH_REQUIRED'); }
      if (response.status !== 200) throw error(response.body?.error?.code || 'DRAFT_FAILED');
      return response.body;
    },
    async getDraft(receiptId, { signal } = {}) {
      const token = await authorized(signal); active(signal);
      const response = await request('/receipt-drafts/' + encodeURIComponent(receiptId), { signal, headers: { Authorization: 'Bearer ' + token } });
      if (response.status === 401) { forget(); throw error('AUTH_REQUIRED'); }
      if (response.status !== 200) throw error(response.body?.error?.code || 'DRAFT_FAILED');
      return response.body;
    },
    async correct(values, transcript, { signal } = {}) {
      const token = await authorized(signal); active(signal);
      const response = await request('/review-correction', { ...json({ values, transcript }, signal), timeout: 55_000, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token } });
      if (response.status === 401) { forget(); throw error('AUTH_REQUIRED'); }
      if (response.status !== 200) throw error(response.body?.error?.code || 'CORRECTION_FAILED');
      return response.body;
    },
    async authorize({ signal } = {}) {
      await authorized(signal); active(signal);
      return true;
    },
    async recognize(photo, { signal } = {}) {
      const token = await authorized(signal); active(signal);
      const image = await encodePhoto(photo, { signal }); active(signal);
      const response = await request('/receipt-recognition', { method: 'POST', signal, timeout: 55_000, headers: { Authorization: 'Bearer ' + token, 'Content-Type': image.mimeType, 'X-Receipt-Upload': '1' }, body: image.data });
      if (response.status === 401 || response.status === 403) forget();
      if (response.body?.error?.code === 'RECEIPT_ARCHIVE_FAILED') throw error('RECEIPT_ARCHIVE_FAILED');
      if (response.status === 503 && response.body?.error?.code === 'RECEIPT_NOT_CONFIGURED') throw error('BACKEND_NOT_CONFIGURED');
      if (response.status === 413) throw error('IMAGE_TOO_LARGE');
      if (response.status === 415 || response.body?.error?.code === 'RECEIPT_IMAGE_INVALID') throw error('IMAGE_ENCODING_FAILED');
      if (response.body?.error?.code === 'RECEIPT_NOT_FOUND') throw error('RECEIPT_NOT_FOUND');
      return response;
    },
    clear() { authorizationRun++; forget(); notifyAuthorization({ state: 'idle' }); },
    close() { closed = true; credential = null; needsSave = false; authorizationRun++; notifyAuthorization({ state: 'idle' }); },
  };
}
