import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { presentBill } from '../aiui/lib/bill-presentation.js';

// Render the registered native page, including its real conditional nodes and
// selected action. Browser geometry is a local check, not native acceptance.
const source = await readFile(new URL('../aiui/pages/capture/index.ink', import.meta.url), 'utf8');
const template = source.slice(source.indexOf('<view class="bill-screen"'), source.indexOf('<view class="{{billVisible'));
assert.ok(template.length > 0, 'the registered capture page must contain the review');
const styles = source.match(/<style>([\s\S]*?)<\/style>/)[1];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const browser = await chromium.launch({ executablePath: process.env.REVIEW_CHROMIUM_PATH || undefined });
const page = await browser.newPage();
const output = process.env.REVIEW_SCREENSHOT_DIR;
let renderedCases = 0;
const normal = { amount: '972', currencyCode: 'JPY', merchant: 'SEIYU', expenseDate: '2026-11-17', accountName: '', category: '' };
const cases = [
  { name: 'normal', values: normal },
  { name: 'empty', values: {} },
  { name: 'amount-only', values: { amount: '972' } },
  { name: 'long', values: { amount: '99999999999999.123456', currencyCode: 'CAD', merchant: '很长的测试商户'.repeat(15), expenseDate: '2026-11-17', accountName: '很长的测试账户'.repeat(15), category: 'food' } },
  { name: 'feedback', values: normal, reviewMessage: '请在手机核对设备并单独允许确认入账。'.repeat(4), writeAuthorizationUrl: 'ledger.zcorw.xyz/receipt-devices?device=11111111-1111-4111-8111-111111111111' },
  { name: 'merchant-cjk', values: { ...normal, merchant: '西友東京店' } },
  { name: 'merchant-mixed', values: { ...normal, merchant: 'SEIYU 西友・東京店' } },
  { name: 'merchant-latin-long', values: { ...normal, merchant: 'W'.repeat(149) + 'U' } },
  { name: 'merchant-unchanged', values: normal, reviewMessage: '商户已是 SEIYU，无需修改', voiceTranscript: '商户名SEIYU。' },
  { name: 'head-unavailable', values: normal, headNavigationMessage: '当前眼镜无法启用头部选择，可在知产网站编辑字段' },
];
const inside = async locator => {
  const box = await locator.boundingBox(), viewport = page.viewportSize();
  assert.ok(box && box.width > 0 && box.height > 0);
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 0.5 && box.y + box.height <= viewport.height + 0.5, await locator.getAttribute('class'));
  return box;
};
async function render({ values, reviewMessage = '', headNavigationMessage = '', writeAuthorizationUrl = '', voiceState = 'idle', voiceTranscript = '', focusedField = 'merchant', fieldEditorVisible = false, fieldOptions = [], fieldTitle = '分类', fieldCurrent = '' }) {
  renderedCases++;
  const bill = presentBill(values);
  const voiceActive = ['listening', 'stopping', 'correcting'].includes(voiceState);
  const context = { bill, billVisible: true, selectedAction: voiceActive && voiceState !== 'listening' ? 'draft' : 'voice', reviewBusy: voiceActive, submissionPending: false, submissionState: 'idle', reviewMessage, headNavigationMessage, writeAuthorizationUrl, voiceState, voiceActive, voiceTranscript, voiceScrollTop: voiceTranscript.length * 30, focusedField, fieldEditorVisible, fieldOptions, fieldTitle, fieldCurrent, fieldOptionsMessage: '', fieldOptionsScrollTop: 0 };
  const evaluate = expression => new Function(...Object.keys(context), 'return (' + expression + ');')(...Object.values(context));
  const html = template.replace(/<text class="voice-option" ink:for="{{fieldOptions}}" ink:key="value">{{item.label}}<\/text>/, '__FIELD_OPTIONS__')
    .replace(/{{([^}]+)}}/g, (_, expression) => escape(evaluate(expression)))
    .replace(/<(\/?)(?:view|scroll-view)\b/g, '<$1div').replace(/<(\/?)(?:text)\b/g, '<$1span')
    .replace('__FIELD_OPTIONS__', () => fieldOptions.map(item => '<span class="voice-option">' + escape(item.label) + '</span>').join(''));
  await page.setContent('<html lang="zh-CN"><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;font-family:sans-serif}*{box-sizing:border-box}button{font-family:inherit}div[scroll-x]{scrollbar-width:none}' + styles + '</style>' + html + '</html>');
  await page.evaluate(() => {
    for (const element of document.querySelectorAll('*')) {
      if (element.hasAttribute('ink:if') && ['false', ''].includes(element.getAttribute('ink:if'))) element.remove();
      if (element.getAttribute('disabled') === 'false') element.removeAttribute('disabled');
    }
  });
  return bill;
}
try {
  if (output) await mkdir(output, { recursive: true });
  for (const viewport of [{ width: 448, height: 150 }, { width: 480, height: 168 }, { width: 320, height: 240 }, { width: 480, height: 320 }, { width: 640, height: 360 }]) {
    await page.setViewportSize(viewport);
    for (const fixture of cases) {
      const bill = await render(fixture);
      assert.deepEqual(await page.locator('.field-label').allTextContents(), ['商户：', '金额：', '分类：', '时间：', '币种：', '账户：', '备注：']);
      for (const label of await page.locator('.field-label').all()) await inside(label);
      const rows = ['.merchant-row', '.amount-row', '.date-row', '.account-row'];
      let previousBottom = 0;
      for (const row of rows) {
        const box = await inside(page.locator(row));
        assert.ok(box.y >= previousBottom - 0.5, 'four non-overlapping rows must remain visible');
        previousBottom = box.y + box.height;
      }
      // Category belongs beside amount, not beside merchant. Values share the
      // label's line instead of making another row for every value.
      for (const field of ['.merchant-row', '.amount-field', '.category-field', '.date-field', '.code-field', '.account-field', '.note-field']) {
        const label = await inside(page.locator(field + ' > .field-label'));
        const value = await inside(page.locator(field + ' > .field-value'));
        assert.ok(Math.abs(label.y - value.y) < 1, 'labels and values must be inline');
        assert.ok(value.x >= label.x + label.width - 0.5);
      }
      const amount = await inside(page.locator('.amount-field')), category = await inside(page.locator('.category-field'));
      assert.ok(Math.abs(amount.y - category.y) < 1 && category.x > amount.x + amount.width);
      assert.deepEqual(await page.getByRole('button').allTextContents(), ['语音修改', '草稿', '确认']);
      const buttons = [];
      for (const button of await page.getByRole('button').all()) buttons.push(await inside(button));
      assert.ok(buttons.every(box => Math.abs(box.y - buttons[0].y) < 1 && box.y >= previousBottom));
      assert.ok(buttons[1].x > buttons[0].x + buttons[0].width && buttons[2].x > buttons[1].x + buttons[1].width);
      assert.ok(Math.abs(buttons[0].y + buttons[0].height - (viewport.height - (viewport.height <= 200 ? 4 : 12))) < 1, 'actions must stay at the bottom');
      assert.equal(await page.locator('.selected').count(), 0);
      assert.equal(await page.locator('.field-selected').getAttribute('data-field'), 'merchant');
      assert.equal(await page.locator('.currency-code').count(), bill.currencyCode ? 1 : 0);
      assert.equal(await page.locator('.currency-notice').count(), bill.currencyCode ? 0 : 1);
      if (bill.currencyCode) assert.equal(await page.locator('.currency-code').innerText(), '(' + bill.currencyCode + ')');
      for (const [selector, value] of [['.merchant-row .field-text', bill.merchant], ['.amount', bill.amountText], ['.date-field .field-text', bill.expenseDate], ['.account-field .field-text', bill.account], ['.category-field .field-text', bill.category], ['.code-field .field-text', bill.currencyCode], ['.note-field .field-text', bill.note]]) assert.equal(await page.locator(selector).textContent(), value);
      if (bill.merchant) {
        // Check rendered character bounds, not just textContent: a complete
        // string can still paint outside its clipped native-style viewport.
        const geometry = await page.locator('.merchant-text').evaluate(element => {
          const viewport = element.parentElement, text = element.firstChild;
          const glyph = index => {
            const range = document.createRange(); range.setStart(text, index); range.setEnd(text, index + 1);
            return range.getBoundingClientRect();
          };
          const fits = rect => {
            const box = viewport.getBoundingClientRect();
            return rect.left >= box.left - 0.5 && rect.right <= box.left + viewport.clientWidth - 7.5
              && rect.top >= box.top - 0.5 && rect.bottom <= box.top + viewport.clientHeight + 0.5;
          };
          const firstVisible = fits(glyph(0));
          const wraps = viewport.scrollHeight > viewport.clientHeight;
          if (wraps) viewport.scrollTop = viewport.scrollHeight;
          const lastVisible = fits(glyph(text.length - 1));
          return { firstVisible, lastVisible, wraps, horizontalOverflow: viewport.scrollWidth > viewport.clientWidth };
        });
        assert.equal(geometry.firstVisible, true, fixture.name + ': first merchant character must be visible');
        assert.equal(geometry.lastVisible, true, fixture.name + ': final merchant character must fit, including after scrolling');
        assert.equal(geometry.horizontalOverflow, false, 'merchant wraps inside its definite width with a trailing gutter');
        if (fixture.name === 'long' || fixture.name === 'merchant-latin-long') assert.equal(geometry.wraps, true);
        else assert.equal(geometry.wraps, false, 'short merchant names must be visible in full without scrolling');
        await page.locator('.merchant-value').evaluate(element => { element.scrollTop = 0; });
      }
      if (fixture.name === 'long') {
        for (const selector of ['.amount-field', '.account-field']) {
          assert.equal(await page.locator(selector + ' .field-value').evaluate(element => {
            const overflows = element.scrollWidth > element.clientWidth;
            element.scrollLeft = element.scrollWidth;
            return overflows && element.scrollLeft > 0;
          }), true, 'long values must remain accessible without displacing other fields');
        }
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), true);
      if (output && fixture.name === 'normal') {
        const name = 'review-sketch-' + viewport.width + 'x' + viewport.height;
        await page.screenshot({ path: join(output, name + '.png') });
        await writeFile(join(output, name + '.html'), await page.content());
      }
      if (output && fixture.name === 'merchant-unchanged') {
        const name = 'merchant-feedback-' + viewport.width + 'x' + viewport.height;
        await page.screenshot({ path: join(output, name + '.png') });
        await writeFile(join(output, name + '.html'), await page.content());
      }
    }
    for (const focusedField of ['merchant', 'amount', 'category', 'expenseDate', 'currencyCode', 'account', 'note']) {
      await render({ values: normal, focusedField });
      const selected = page.locator('.field-selected'); await inside(selected);
      assert.equal(await selected.getAttribute('data-field'), focusedField);
      assert.equal(await page.locator('.field-selected').count(), 1);
      assert.equal(await page.locator('[bindtap="fieldTap"]').count(), 7);
      for (const button of await page.getByRole('button').all()) await inside(button);
    }
    const categories = ['未分类', '餐饮', '日用', '交通', '住房', '水电', '购物', '医疗', '娱乐', '教育', '旅行', '其他'].map((label, index) => ({ value: String(index), label }));
    const longAccounts = Array.from({ length: 125 }, (_, i) => ({ value: String(i), label: '完整账户名'.repeat(8) + i }));
    for (const fixture of [
      { name: 'categories', title: '分类', choices: categories, state: 'listening' },
      { name: 'accounts', title: '账户', choices: longAccounts, state: 'listening' },
      { name: 'ambiguous', title: '分类', choices: categories, state: 'corrected' },
      { name: 'free-text', title: '商户', choices: [], state: 'listening' },
    ]) {
      await render({ values: normal, fieldEditorVisible: true, fieldTitle: fixture.title, fieldCurrent: fixture.title === '商户' ? 'SEIYU' : '', fieldOptions: fixture.choices, voiceState: fixture.state, voiceTranscript: '识别出的字段新内容', reviewMessage: fixture.state === 'corrected' ? '匹配到多个接近选项，请说出完整名称' : '' });
      assert.equal(await page.locator('.bill-fields').count(), 0);
      await inside(page.locator('.voice-panel')); await inside(page.locator('.voice-transcript'));
      assert.equal(await page.locator('.voice-title').textContent(), '修改' + fixture.title);
      assert.deepEqual(await page.locator('.voice-option').allTextContents(), fixture.choices.map(x => x.label));
      const buttons = await page.getByRole('button').all();
      assert.deepEqual(await page.getByRole('button').allTextContents(), [fixture.state === 'corrected' ? '重新收音' : '结束收音', '取消', '确认']);
      assert.equal(await buttons[0].isEnabled(), true); assert.equal(await buttons[1].isEnabled(), true); assert.equal(await buttons[2].isEnabled(), false);
      for (const button of buttons) await inside(button);
      if (fixture.choices.length) {
        await inside(page.locator('.voice-options'));
        const layout = await page.locator('.voice-options').evaluate(element => {
          const overflows = element.scrollHeight > element.clientHeight;
          element.scrollTop = element.scrollHeight;
          const last = element.querySelector('.voice-option:last-child').getBoundingClientRect(), box = element.getBoundingClientRect();
          return { overflows, lastVisible: last.bottom <= box.bottom + 1 && last.bottom > box.top, horizontalOverflow: element.scrollWidth > element.clientWidth };
        });
        assert.equal(layout.lastVisible, true); assert.equal(layout.horizontalOverflow, false);
        if (fixture.name === 'categories' || fixture.name === 'ambiguous') assert.equal(layout.overflows, false, 'all 12 categories should fit on one page');
        if (fixture.name === 'accounts') assert.equal(layout.overflows, true, 'all long account names must be reachable in the same scroll area');
        await page.locator('.voice-options').evaluate(element => { element.scrollTop = 0; });
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), true);
      if (output && fixture.name === 'categories') await page.screenshot({ path: join(output, 'field-options-' + viewport.width + 'x' + viewport.height + '.png') });
    }
    const spoken = '我在示例商户消费了700日元，属于日用食品分类，支付账户是合成现金。';
    for (const fixture of [
      { name: 'listening-empty', state: 'listening', text: '' },
      { name: 'listening', state: 'listening', text: spoken },
      { name: 'stopping', state: 'stopping', text: spoken.repeat(10) },
      { name: 'correcting', state: 'correcting', text: spoken },
      { name: 'corrected', state: 'corrected', text: spoken },
    ]) {
      const active = fixture.state !== 'corrected';
      await render({ values: normal, voiceState: fixture.state, voiceTranscript: fixture.text, reviewMessage: active ? '' : '已修改：分类、账户' });
      const buttons = await page.getByRole('button').all();
      assert.equal(buttons.length, 3);
      for (const button of buttons) await inside(button);
      assert.ok(Math.abs((await buttons[0].boundingBox()).y + (await buttons[0].boundingBox()).height - (viewport.height - (viewport.height <= 200 ? 4 : 12))) < 1);
      if (active) {
        await inside(page.locator('.voice-panel')); await inside(page.locator('.voice-transcript'));
        assert.equal(await page.locator('.voice-text').textContent(), fixture.text || '等待说话…');
        assert.equal(await page.locator('.bill-fields').count(), 0);
        assert.deepEqual(await page.getByRole('button').allTextContents(), [fixture.state === 'listening' ? '结束收音' : fixture.state === 'stopping' ? '结束中…' : '正在分析', '取消', '确认']);
        assert.equal(await buttons[0].isEnabled(), fixture.state === 'listening');
        assert.equal(await buttons[1].isEnabled(), true); assert.equal(await buttons[2].isEnabled(), false);
        if (fixture.state === 'stopping') assert.equal(await page.locator('.voice-transcript').evaluate(element => {
          element.scrollTop = element.scrollHeight; return element.scrollHeight > element.clientHeight && element.scrollTop > 0;
        }), true);
      } else {
        assert.equal(await page.locator('.voice-panel').count(), 0);
        assert.equal(await page.locator('.field-label').count(), 7);
        assert.equal(await page.locator('.review-transcript').textContent(), '识别：' + spoken);
        assert.deepEqual(await page.getByRole('button').allTextContents(), ['语音修改', '草稿', '确认']);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), true);
      if (output && fixture.name === 'listening') {
        const name = 'voice-listening-' + viewport.width + 'x' + viewport.height;
        await page.screenshot({ path: join(output, name + '.png') });
        await writeFile(join(output, name + '.html'), await page.content());
      }
    }
  }
  console.log(`Native review: ${renderedCases} geometry cases passed, including field focus, scoped choices, sensor feedback and manual voice on compact cards.`);
} finally { await browser.close(); }
