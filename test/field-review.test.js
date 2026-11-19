import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReviewOptions, choicesFor, scopeFieldResult, fieldFeedback } from '../aiui/lib/field-review.js';
const original = { amount: '972', merchant: 'SEIYU', currencyCode: 'JPY', category: '', expenseDate: '2026-11-17', accountId: '', accountName: '', note: '' };
test('scoped corrections ignore off-target values and untrusted changedFields', () => {
  const result = scopeFieldResult(original, 'amount', { values: { ...original, amount: '700', merchant: 'wrong', currencyCode: 'USD' }, changedFields: ['merchant'], warnings: [], fieldOutcome: 'matched' });
  assert.deepEqual(result.values, { ...original, amount: '700' }); assert.deepEqual(result.changedFields, ['amount']);
  assert.equal(fieldFeedback(result, 'amount'), '已修改金额：700'); assert.equal(original.amount, '972');
});
test('account ID/name change together; ambiguous and invalid outcomes cannot apply values', () => {
  const response = { values: { ...original, accountId: '11111111-1111-4111-8111-111111111111', accountName: '微信支付', note: 'wrong' }, warnings: [], fieldOutcome: 'matched' };
  const result = scopeFieldResult(original, 'account', response);
  assert.equal(result.values.note, ''); assert.deepEqual(result.changedFields, ['accountId', 'accountName']);
  assert.equal(scopeFieldResult(original, 'account', { ...response, fieldOutcome: 'ambiguous' }).values.accountId, '');
  assert.throws(() => scopeFieldResult(original, 'note', { ...response, fieldOutcome: undefined }), /INVALID_RESULT/);
});
test('all legal options remain available and duplicate/malformed values are rejected', () => {
  const accounts = Array.from({ length: 125 }, (_, i) => ({ value: '11111111-1111-4111-8111-' + i.toString().padStart(12, '0'), label: '账户' + i }));
  const options = parseReviewOptions({ version: 1, categories: [{ value: 'food', label: '餐饮' }], currencies: [{ value: 'JPY', label: 'JPY 日元' }], accounts });
  assert.equal(choicesFor(options, 'account').length, 125); assert.equal(choicesFor(options, 'account').at(-1).label, '账户124'); assert.deepEqual(choicesFor(options, 'merchant'), []);
  assert.throws(() => parseReviewOptions({ version: 1, categories: [], currencies: [], accounts: [accounts[0], accounts[0]] }), /REVIEW_OPTIONS_INVALID/);
  assert.throws(() => parseReviewOptions({ version: 1, categories: [], currencies: [], accounts: [{ value: 'bad-id', label: '坏账户' }] }), /REVIEW_OPTIONS_INVALID/);
});
