import { createReview, fields, syntheticReceipt } from '../aiui/lib/review.js';
import { presentBill, billFieldLabels } from '../aiui/lib/bill-presentation.js';
const review = createReview();
const app = document.querySelector('#app');
let billNode;
function element(tag, className, text) {
  const node = document.createElement(tag); node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function paintBill(values) {
  const bill = presentBill(values); billNode.replaceChildren();
  const total = element('div', 'total');
  const amount = element('span', 'amount', bill.amountText); amount.style.fontSize = bill.amountFontSize + 'px';
  total.append(element('span', 'currency', bill.currencySymbol), amount); billNode.append(total);
  if (bill.merchant) billNode.append(element('h1', 'merchant', bill.merchant));
  const details = element('div', 'details');
  details.append(element('span', 'date', bill.expenseDate), element('span', 'category', bill.category)); billNode.append(details);
  if (bill.note) billNode.append(element('p', 'note', bill.note));
}
function actions(items) {
  const row = element('div', 'actions');
  for (const [text, run] of items) {
    const button = element('button', '', text);
    button.onclick = () => { run(); render(); }; row.append(button);
  }
  return row;
}
function render() {
  const snapshot = review.snapshot(); app.replaceChildren();
  if (['editing', 'review', 'confirmed'].includes(snapshot.state)) {
    billNode = element('article', 'bill'); app.append(billNode); paintBill(snapshot.confirmed || snapshot.values);
  }
  if (snapshot.state === 'editing') {
    const editor = element('section', 'editor'), label = element('label', 'field');
    const [key,,maxLength] = fields[snapshot.index]; label.append(element('span', 'field-label', billFieldLabels[key]));
    const input = element('input', ''); input.value = snapshot.values[key]; input.maxLength = maxLength;
    const errors = element('p', 'errors', snapshot.errors.join('；'));
    input.oninput = () => {
      review.edit(input.value); const current = review.snapshot();
      paintBill(current.values); errors.textContent = current.errors.join('；');
    };
    label.append(input); editor.append(label, errors, actions([
      ['上一项', () => review.move(-1)], ['下一项', () => review.move(1)],
      ['核对', () => review.preview()], ['取消', () => review.cancel()],
    ])); app.append(editor);
  } else if (snapshot.state === 'review') {
    app.append(actions([['修改', () => review.back()], ['确认', () => review.confirm()], ['取消', () => review.cancel()]]));
  } else if (snapshot.state === 'cancelled') {
    app.append(actions([['重新开始', () => review.load(syntheticReceipt)]]));
  }
}
document.addEventListener('visibilitychange', () => { if (document.hidden) { review.cancel(); render(); } });
review.load(syntheticReceipt); render();
