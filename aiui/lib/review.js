// This module never uploads data or submits accounting records.
export const fields = [
  ['expenseDate', '日期 YYYY-MM-DD', 10], ['amount', '金额', 21],
  ['currencyCode', '币种（三位大写代码）', 3], ['merchant', '商户', 150],
  ['category', '类别代码（如 food）', 32], ['note', '备注', 2000],
];
const categories = ['uncategorized','food','groceries','transport','housing','utilities','shopping','health','entertainment','education','travel','other'];
export function validate(values) {
  const errors = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.expenseDate) || !Number.isFinite(Date.parse(values.expenseDate + 'T00:00:00Z')) || new Date(values.expenseDate + 'T00:00:00Z').toISOString().slice(0,10) !== values.expenseDate) errors.push('请填写有效日期');
  if (!/^\d{1,14}(\.\d{1,6})?$/.test(values.amount) || Number(values.amount) <= 0) errors.push('金额须为正数，最多六位小数');
  if (!/^[A-Z]{3}$/.test(values.currencyCode)) errors.push('币种须为三位大写代码');
  if (!categories.includes(values.category)) errors.push('请填写有效类别代码');
  for (const [key,,max] of fields) if (values[key].length > max) errors.push('字段超过长度限制');
  return errors;
}
export function createReview() {
  let values = {}, state = 'empty', index = 0, confirmed = null;
  const clear = () => { values = Object.fromEntries(fields.map(([key]) => [key, ''])); confirmed = null; index = 0; };
  clear();
  return {
    load(candidate = {}) { clear(); for (const [key] of fields) if (typeof candidate[key] === 'string') values[key] = candidate[key]; state = 'editing'; },
    snapshot() { return { values: { ...values }, state, index, confirmed: confirmed ? { ...confirmed } : null, errors: state === 'empty' || state === 'cancelled' ? [] : validate(values) }; },
    move(delta) { if (state === 'editing') index = Math.max(0, Math.min(fields.length - 1, index + delta)); },
    edit(value) { if (state !== 'editing' || typeof value !== 'string') return false; values[fields[index][0]] = value; confirmed = null; return true; },
    preview() { if (state !== 'editing' || validate(values).length) return false; state = 'review'; return true; },
    back() { if (state === 'review') state = 'editing'; },
    confirm() { if (state !== 'review' || validate(values).length) return false; confirmed = { ...values, merchant: values.merchant || null, note: values.note || null, accountId: null }; state = 'confirmed'; return true; },
    cancel() { clear(); state = 'cancelled'; },
  };
}
export const syntheticReceipt = { expenseDate: '2026-11-13', amount: '1234', currencyCode: 'JPY', merchant: '虚构测试商店', category: 'food', note: '仅演示，未识别照片' };
