import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptReceiptResponse } from '../aiui/lib/receipt-candidate.js';
import { createReview } from '../aiui/lib/review.js';
const candidate = () => ({ amount: '99999999999999.123456', expenseDate: '2024-02-29', currencyCode: 'JPY', merchant: 'Synthetic Store', warnings: ['Synthetic: verify all fields.'] });

test('preserves decimal strings and local dates without guessing category or account', () => {
  const input = candidate(); const result = adaptReceiptResponse(200, input);
  assert.equal(result.ok, true); assert.equal(result.values.amount, input.amount);
  assert.equal(result.values.expenseDate, '2024-02-29');
  assert.equal(result.values.category, ''); assert.equal(result.values.note, '');
  assert.deepEqual(result.missingFields, ['category']);
  assert.equal(result.requiresConfirmation, true); assert.equal('accountId' in result.values, false);
  result.warnings.push('changed'); assert.equal(input.warnings.length, 1);
  const review = createReview(); review.load(result.values);
  assert.equal(review.confirm(), false); assert.equal(review.preview(), false);
});
test('missing and unreliable fields stay blank, never today or a guessed currency', () => {
  for (const amount of ['', '0', '0.000000', '-1', '1e3', '1,000', '1.1234567', '100000000000000', ' 12', '１２']) {
    const r = adaptReceiptResponse(200, { ...candidate(), amount });
    assert.equal(r.values.amount, '', amount); assert.ok(r.missingFields.includes('amount'));
  }
  for (const expenseDate of ['', '2023-02-29', '2024-04-31', '2024-2-1', '0000-01-01', '2024-02-29T00:00Z']) {
    assert.equal(adaptReceiptResponse(200, { ...candidate(), expenseDate }).values.expenseDate, '', expenseDate);
  }
  for (const currencyCode of ['', 'jpy', '¥', 'JP', 'JPY ']) {
    assert.equal(adaptReceiptResponse(200, { ...candidate(), currencyCode }).values.currencyCode, '');
  }
});
test('empty candidate remains editable without fabricated merchant or category', () => {
  const r = adaptReceiptResponse(200, { amount: '', expenseDate: '', currencyCode: '', merchant: '', warnings: [] });
  assert.equal(r.ok, true); assert.ok(Object.values(r.values).every(value => value === ''));
  assert.deepEqual(r.missingFields, ['amount', 'expenseDate', 'currencyCode', 'category']);
});
test('rejects malformed, partial, provider, error and extra-field bodies', () => {
  const bodies = [null, [], 'json', {}, { ...candidate(), amount: 12 }, { ...candidate(), merchant: null },
    { ...candidate(), amount: undefined }, { ...candidate(), accountId: 'private' },
    { status: 'completed', output: [] }, { error: { message: 'private' } },
    { ...candidate(), warnings: 'bad' }, { ...candidate(), warnings: [null] },
    { ...candidate(), warnings: Array(11).fill('x') }, { ...candidate(), warnings: ['x'.repeat(201)] },
    { ...candidate(), merchant: 'x'.repeat(151) }, { ...candidate(), amount: 'x'.repeat(33) },
    Object.assign(Object.create({ inherited: true }), candidate())];
  for (const body of bodies) assert.deepEqual(adaptReceiptResponse(200, body), { ok: false, code: 'INVALID_RESULT' });
});
test('HTTP and provider errors cannot be treated as candidates or reflected into output', () => {
  for (const status of [201, 204, 400, 401, 403, 404, 413, 415, 422, 429, 500, 502, 503, 504, '200', undefined]) {
    const r = adaptReceiptResponse(status, candidate());
    assert.equal(r.ok, false); assert.equal('values' in r, false); assert.equal(JSON.stringify(r).includes('Synthetic'), false);
  }
  assert.equal(adaptReceiptResponse(401, null).code, 'AUTH_REQUIRED');
  assert.equal(adaptReceiptResponse(429, null).code, 'RATE_LIMITED');
  assert.equal(adaptReceiptResponse(504, null).code, 'TIMEOUT');
});
test('accepts backend warning ceiling and valid edge dates without floating point conversion', () => {
  const r = adaptReceiptResponse(200, { ...candidate(), amount: '0.000001', expenseDate: '0001-01-01', warnings: Array(10).fill('x'.repeat(200)) });
  assert.equal(r.ok, true); assert.equal(r.values.amount, '0.000001'); assert.equal(r.values.expenseDate, '0001-01-01');
  assert.equal(r.warnings.length, 10);
});
