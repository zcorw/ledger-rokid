const currencySymbols = {
  CNY: '¥', JPY: '¥', USD: '$', EUR: '€', GBP: '£', KRW: '₩',
  HKD: 'HK$', TWD: 'NT$', SGD: 'S$', AUD: 'A$', CAD: 'C$', NZD: 'NZ$',
  CHF: 'Fr', INR: '₹', THB: '฿', VND: '₫', MYR: 'RM', IDR: 'Rp',
  PHP: '₱', RUB: '₽', BRL: 'R$', ZAR: 'R', TRY: '₺',
};
const categoryLabels = {
  uncategorized: '未分类', food: '餐饮', groceries: '日用', transport: '交通',
  housing: '住房', utilities: '水电', shopping: '购物', health: '医疗',
  entertainment: '娱乐', education: '教育', travel: '旅行', other: '其他',
};
export const billFieldLabels = { expenseDate: '日期', amount: '金额', currencyCode: '币种', merchant: '商户', category: '类别', note: '备注' };

// Format the decimal string directly so neither precision nor trailing decimals
// change. Unsupported currency codes stay explicit instead of inventing a symbol.
export function presentBill(values = {}) {
  const text = key => typeof values[key] === 'string' ? values[key] : '';
  const amount = text('amount');
  let amountText = amount;
  if (/^\d+(\.\d+)?$/.test(amount)) {
    const [integer, decimals] = amount.split('.');
    amountText = integer.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',')
      + (decimals === undefined ? '' : '.' + decimals);
  }
  const code = text('currencyCode'), category = text('category');
  const currencySymbol = Object.prototype.hasOwnProperty.call(currencySymbols, code) ? currencySymbols[code] : code;
  const length = amountText.length + currencySymbol.length;
  return {
    amountText, currencySymbol, currencyCode: code, currencyNotice: code ? '' : '币种待确认',
    amountFontSize: length > 22 ? 18 : length > 17 ? 24 : length > 12 ? 34 : 42,
    merchant: text('merchant'), expenseDate: text('expenseDate'),
    category: Object.prototype.hasOwnProperty.call(categoryLabels, category) ? categoryLabels[category] : category,
    account: text('accountName'), note: text('note'),
  };
}
