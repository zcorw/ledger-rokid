import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceiptCredentialStore } from '../aiui/lib/receipt-credential-store.js';

test('native wx persistence is scoped by backend and removes only the receipt credential', () => {
  const data = new Map([['unrelated', 'keep']]);
  const wx = { getStorageSync: key => data.get(key), setStorageSync: (key, value) => data.set(key, value), removeStorageSync: key => data.delete(key) };
  const store = createReceiptCredentialStore({ wx }), resource = 'https://ledger.zcorw.xyz/api/v1/receipt-devices';
  store.write(resource, 'credential'); assert.equal(createReceiptCredentialStore({ wx }).read(resource), 'credential');
  assert.equal(store.read('https://other.example/api'), undefined);
  store.remove(resource); assert.equal(store.read(resource), undefined); assert.equal(data.get('unrelated'), 'keep');
});

test('documented storage fallback supports restart and sanitizes native exceptions', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  createReceiptCredentialStore({ storage }).write('backend', 'saved'); assert.equal(createReceiptCredentialStore({ storage }).read('backend'), 'saved');
  const broken = createReceiptCredentialStore({ storage: { ...storage, setItem() { throw new Error('private token detail'); } } });
  assert.throws(() => broken.write('backend', 'secret'), /^Error: AUTH_STORAGE_FAILED$/);
  assert.throws(() => createReceiptCredentialStore({ storage: {} }).read('backend'), /AUTH_STORAGE_UNAVAILABLE/);
});
