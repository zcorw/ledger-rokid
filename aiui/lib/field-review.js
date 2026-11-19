import { presentBill } from './bill-presentation.js';

export const reviewFields = ['merchant', 'amount', 'category', 'expenseDate', 'currencyCode', 'account', 'note'];
export const fieldLabels = { merchant: '商户', amount: '金额', category: '分类', expenseDate: '时间', currencyCode: '币种', account: '账户', note: '备注' };
const groups = { category: 'categories', currencyCode: 'currencies', account: 'accounts' };
export const needsChoices = field => Object.prototype.hasOwnProperty.call(groups, field);
export function fieldValue(values, field) {
  const bill = presentBill(values);
  return field === 'amount' ? bill.amountText : field === 'currencyCode' ? bill.currencyCode : field === 'account' ? bill.account : bill[field] || '';
}
export function parseReviewOptions(value) {
  if (value?.version !== 1) throw new Error('REVIEW_OPTIONS_INVALID');
  const result = {};
  for (const group of Object.values(groups)) {
    const list = value[group];
    if (!Array.isArray(list)) throw new Error('REVIEW_OPTIONS_INVALID');
    const ids = new Set();
    result[group] = list.map(item => {
      if (!item || typeof item.value !== 'string' || !item.value || typeof item.label !== 'string' || !item.label.trim() || item.label.length > 180 || ids.has(item.value)) throw new Error('REVIEW_OPTIONS_INVALID');
      if (group === 'accounts' ? !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(item.value) : group === 'currencies' ? !/^[A-Z]{3}$/.test(item.value) : !/^[a-z_]{1,40}$/.test(item.value)) throw new Error('REVIEW_OPTIONS_INVALID');
      ids.add(item.value); return { value: item.value, label: item.label };
    });
  }
  return result;
}
export const choicesFor = (options, field) => options?.[groups[field]] || [];

// The server enforces the same boundary. Do not trust changedFields to decide
// what to apply, and treat account ID/name as a single logical field.
export function scopeFieldResult(before, field, result) {
  if (!reviewFields.includes(field) || !result?.values || !['matched', 'unchanged', 'ambiguous', 'unmatched'].includes(result.fieldOutcome)) throw new Error('INVALID_RESULT');
  const keys = field === 'account' ? ['accountId', 'accountName'] : [field];
  const values = { ...before };
  if (['matched', 'unchanged'].includes(result.fieldOutcome)) {
    for (const key of keys) {
      if (typeof result.values[key] !== 'string') throw new Error('INVALID_RESULT');
      values[key] = result.values[key];
    }
  }
  return { ...result, values, changedFields: keys.filter(key => values[key] !== before[key]) };
}
export function fieldFeedback(result, field) {
  const label = fieldLabels[field], value = fieldValue(result.values, field);
  if (result.changedFields.length) return '已修改' + label + '：' + (value || '已清空');
  if (result.fieldOutcome === 'unchanged') return label + '已是 ' + (value || '空值') + '，无需修改';
  return result.warnings.join('；') || '未应用修改，请说出明确的新内容';
}
