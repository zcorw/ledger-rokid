import { createReceiptFlow } from '../aiui/lib/receipt-flow.js';
import { fields } from '../aiui/lib/review.js';
const app = document.querySelector('#app');
const storageKey = 'ledger-rokid.synthetic-chain.v1';
const flow = createReceiptFlow({
  cameraFactory: () => ({ takePhoto: async () => ({ data: new Uint8Array([1,2,3]).buffer, mimeType: 'image/jpeg' }) }),
  recognize: async () => ({ status: 200, body: { amount: '1234', expenseDate: '2026-11-13', currencyCode: 'JPY', merchant: '虚构商店', warnings: [] } }),
  newRequestKey: () => crypto.randomUUID(),
  storage: { get: () => localStorage.getItem(storageKey), set: value => localStorage.setItem(storageKey, value) },
  transport: async p => {
    const mode = document.querySelector('#mode').value;
    if (mode === 'unknown') throw new Error('synthetic timeout');
    if (mode === 'duplicate' && !p.allowDuplicate) return { status: 409, body: { error: { code: 'POSSIBLE_DUPLICATE' } } };
    return { status: 200, body: { id: '55555555-5555-4555-8555-555555555555', expense_date: p.expenseDate, amount: p.amount, currency_code: p.currencyCode, merchant: p.merchant, category: p.category, note: p.note, account_id: p.accountId, source: p.source } };
  }, notify: render,
});
function button(text, fn, disabled = false) { const b = document.createElement('button'); b.textContent = text; b.disabled = disabled; b.onclick = fn; app.append(b); }
function paragraph(text) { const p = document.createElement('p'); p.textContent = text; app.append(p); }
function render(s) {
  app.replaceChildren(); paragraph(`状态：${s.state} / ${s.submission.state}`);
  if (s.error) paragraph(s.error);
  if (['idle', 'failed', 'cancelled'].includes(s.state)) button('开始虚构拍摄与识别', () => flow.start(), s.busy);
  if (s.state === 'editing') {
    const [key,label,max] = fields[s.review.index]; const l = document.createElement('label'); l.textContent = label;
    const i = document.createElement('input'); i.value = s.review.values[key]; i.maxLength = max;
    // Keep typing focus: editing updates state without replacing the input.
    i.oninput = () => flow.edit(i.value); l.append(i); app.append(l);
    paragraph(s.review.errors.join('；'));
    button('上一字段', () => flow.move(-1)); button('下一字段', () => flow.move(1)); button('预览', () => flow.preview());
  }
  if (s.state === 'review') { const pre = document.createElement('pre'); pre.textContent = JSON.stringify(s.review.values, null, 2); app.append(pre); button('返回修改', () => flow.back()); button('确认内容', () => flow.confirm()); }
  if (s.state === 'submission') {
    const t = s.submission; paragraph(`测试请求标识：${t.payload?.requestKey ?? '无'}`);
    if (t.state === 'ready') button('提交虚构记录', () => flow.submit(), s.busy);
    if (t.state === 'unknown') { paragraph('结果未知，取消不代表服务端撤销。重试沿用原请求标识与内容。'); button('重试原请求', () => flow.retry(), s.busy); }
    if (t.state === 'duplicate_confirmation') button('确认仍提交重复记录', () => flow.confirmDuplicate(), s.busy);
    if (t.state === 'succeeded') { paragraph('虚构记录提交成功，未创建真实账务。'); button('开始下一张虚构收据', () => flow.next()); }
    if (t.state === 'conflict') paragraph('请求冲突，需要人工核对，不会自动创建新请求。');
  }
  if (s.state !== 'recovery_error') button('取消当前操作', () => flow.cancel());
}
render(flow.snapshot());
window.addEventListener('pagehide', () => flow.cancel());
