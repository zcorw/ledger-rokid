import test from 'node:test';
import assert from 'node:assert/strict';
import { presentBill, presentVoiceFeedback } from '../aiui/lib/bill-presentation.js';

test('bill amounts gain grouping without rounding or changing decimal places', () => {
  for (const [amount, expected] of [
    ['1234', '1,234'], ['1234.25', '1,234.25'], ['000001234.567890', '1,234.567890'],
    ['99999999999999.123456', '99,999,999,999,999.123456'], ['0.000001', '0.000001'],
  ]) assert.equal(presentBill({ amount }).amountText, expected);
});

test('bill currency uses symbols while unknown and missing currencies stay explicit', () => {
  for (const [currencyCode, symbol] of [['JPY', '¥'], ['CNY', '¥'], ['USD', '$'], ['EUR', '€'], ['GBP', '£'], ['HKD', 'HK$'], ['KRW', '₩'], ['ZZZ', 'ZZZ'], ['', '']]) {
    assert.equal(presentBill({ currencyCode }).currencySymbol, symbol);
  }
});

test('presentation keeps all bill content and does not change the underlying values', () => {
  const values = { amount: '1234.000001', currencyCode: 'JPY', merchant: '商店', expenseDate: '2026-11-13', category: 'food', note: '午餐\n两人' };
  const original = { ...values }, bill = presentBill(values);
  assert.deepEqual(values, original); assert.equal(bill.category, '餐饮');
  for (const key of ['merchant', 'expenseDate', 'note']) assert.equal(bill[key], values[key]);
  assert.equal(presentBill({}).amountText, ''); assert.equal(presentBill({}).category, '');
  assert.equal(presentBill({ category: 'constructor' }).category, 'constructor');
});

test('unconfirmed receipt fields stay empty without placeholder amounts or invented content', () => {
  const bill = presentBill({ amount: '42.00' });
  assert.equal(bill.amountText, '42.00');
  for (const field of ['currencySymbol', 'merchant', 'expenseDate', 'category', 'note']) assert.equal(bill[field], '');
  assert.equal(presentBill({}).amountText, '');
});

test('review separates currencies sharing a symbol and preserves an unknown account', () => {
  for (const currencyCode of ['JPY', 'CNY', 'USD', 'CAD']) {
    const bill = presentBill({ amount: '614', currencyCode });
    assert.equal(bill.currencyCode, currencyCode); assert.equal(bill.currencyNotice, '');
    assert.equal(bill.account, '');
  }
  assert.equal(presentBill({ amount: '614' }).currencyNotice, '币种待确认');
  assert.equal(presentBill({ accountName: '现金钱包' }).account, '现金钱包');
});

test('merchant presentation preserves the final character of Latin, CJK and mixed names', () => {
  for (const merchant of ['SEIYU', '西友東京店', 'SEIYU 西友・東京店', 'W'.repeat(149) + 'U', '商'.repeat(149) + '店']) {
    assert.equal(presentBill({ merchant }).merchant, merchant);
  }
});

test('unchanged feedback acknowledges only a complete matching merchant instruction', () => {
  const result = { values: { merchant: 'SEIYU' }, changedFields: [], warnings: [] };
  for (const text of ['商户名SEIYU。', '商户名称改为 SEIYU', '请把商户改成SEIYU.', '商户：SEIYU']) {
    assert.equal(presentVoiceFeedback(result, text), '商户已是 SEIYU，无需修改');
  }
  for (const text of ['商户名SEIYU东京店。', '商户改成SEIY', '商户不是SEIYU', '商户名SEIYU。金额改成700', '金额改成700', '']) {
    assert.equal(presentVoiceFeedback(result, text), '未应用修改，请核对识别文字或换种说法；当前商户：SEIYU');
  }
  assert.equal(presentVoiceFeedback({ ...result, values: { merchant: '' } }, '商户名SEIYU。'), '未应用修改，请核对识别文字或换种说法；当前商户为空');
});

test('unapplied feedback retains warnings instead of claiming the request already matches', () => {
  const result = { values: { merchant: 'SEIYU' }, changedFields: [], warnings: ['账户名称未匹配，请在网站核对'] };
  assert.equal(presentVoiceFeedback(result, '商户名SEIYU。'), '未应用修改；账户名称未匹配，请在网站核对；当前商户：SEIYU');
});

test('changed feedback includes the resulting full merchant and deduplicates account labels', () => {
  const result = { values: { merchant: 'SEIYU 西友・東京店' }, changedFields: ['merchant', 'accountId', 'accountName'], warnings: ['请核对账户'] };
  assert.equal(presentVoiceFeedback(result, '商户名称改为SEIYU 西友・東京店'), '已修改：商户、账户；当前商户：SEIYU 西友・東京店；请核对账户');
});
