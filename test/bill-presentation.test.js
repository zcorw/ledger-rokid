import test from 'node:test';
import assert from 'node:assert/strict';
import { presentBill } from '../aiui/lib/bill-presentation.js';

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
