import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftSaver } from '../aiui/lib/receipt-draft.js';
const id = 'a91b75cc-2654-49ca-8d1a-6e27df2a5c03';
const key = 'a91b75cc-2654-49ca-8d1a-6e27df2a5c04';
const reply = payload => ({ receiptId: id, requestKey: payload.requestKey, revision: 1, values: payload.values, saved: true });
test('retries preserve the same key, values and one draft; lost responses are queried', async () => {
  let stored, calls = 0; const events = [];
  const saver = createDraftSaver({ makeKey: () => key, notify: value => events.push(value),
    save: async payload => { calls++; stored = reply(payload); throw new Error('NETWORK_ERROR'); },
    load: async receiptId => { assert.equal(receiptId, id); return stored; },
  });
  const values = { amount: '614' };
  assert.equal((await saver.run(id, values)).requestKey, key);
  assert.equal((await saver.run(id, values)).requestKey, key);
  assert.equal(calls, 2); assert.equal(events.at(-1).state, 'saved');
});
test('draft cancellation and missing receipt identifiers cannot report success', async () => {
  let resolve; const events = [];
  const saver = createDraftSaver({ notify: value => events.push(value), save: payload => new Promise(yes => { resolve = () => yes(reply(payload)); }) });
  assert.equal(await saver.run('', {}), false);
  assert.equal(events.at(-1).error, 'RECEIPT_ID_REQUIRED');
  const pending = saver.run(id, { amount: '614' }); assert.equal(await saver.run(id, {}), false);
  saver.cancel(); resolve(); assert.equal(await pending, false);
  assert.equal(events.some(x => x.state === 'saved'), false);
});
