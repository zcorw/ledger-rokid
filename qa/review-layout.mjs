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
const normal = { amount: '972', currencyCode: 'JPY', merchant: '示例商户', expenseDate: '2026-11-17', accountName: '', category: '' };
const cases = [
  { name: 'normal', values: normal },
  { name: 'empty', values: {} },
  { name: 'amount-only', values: { amount: '972' } },
  { name: 'long', values: { amount: '99999999999999.123456', currencyCode: 'CAD', merchant: '很长的测试商户'.repeat(15), expenseDate: '2026-11-17', accountName: '很长的测试账户'.repeat(15), category: 'food' } },
  { name: 'feedback', values: normal, reviewMessage: '请在手机核对设备并单独允许确认入账。'.repeat(4), writeAuthorizationUrl: 'ledger.zcorw.xyz/receipt-devices?device=11111111-1111-4111-8111-111111111111' },
];
const inside = async locator => {
  const box = await locator.boundingBox(), viewport = page.viewportSize();
  assert.ok(box && box.width > 0 && box.height > 0);
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 0.5 && box.y + box.height <= viewport.height + 0.5, await locator.getAttribute('class'));
  return box;
};
async function render({ values, reviewMessage = '', writeAuthorizationUrl = '' }) {
  const bill = presentBill(values);
  const evaluate = expression => new Function('bill', 'billVisible', 'selectedAction', 'reviewBusy', 'submissionPending', 'submissionState', 'reviewMessage', 'writeAuthorizationUrl', 'return (' + expression + ');')(bill, true, 'voice', false, false, 'idle', reviewMessage, writeAuthorizationUrl);
  const html = template.replace(/{{([^}]+)}}/g, (_, expression) => escape(evaluate(expression)))
    .replace(/<(\/?)(?:view|scroll-view)\b/g, '<$1div').replace(/<(\/?)(?:text)\b/g, '<$1span');
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
      assert.deepEqual(await page.locator('.field-label').allTextContents(), ['商户：', '金额：', '分类：', '时间：', '账户：']);
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
      for (const field of ['.merchant-row', '.amount-field', '.category-field', '.date-row', '.account-row']) {
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
      assert.equal(await page.locator('.selected').innerText(), '语音修改');
      assert.equal(await page.locator('.currency-code').count(), bill.currencyCode ? 1 : 0);
      assert.equal(await page.locator('.currency-notice').count(), bill.currencyCode ? 0 : 1);
      if (bill.currencyCode) assert.equal(await page.locator('.currency-code').innerText(), '(' + bill.currencyCode + ')');
      for (const [selector, value] of [['.merchant-row .field-text', bill.merchant], ['.amount', bill.amountText], ['.date-row .field-text', bill.expenseDate], ['.account-row .field-text', bill.account], ['.category-field .field-text', bill.category]]) assert.equal(await page.locator(selector).textContent(), value);
      if (fixture.name === 'long') {
        for (const selector of ['.merchant-row', '.amount-field', '.account-row']) {
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
    }
  }
  console.log('Native review sketch: 25 geometry cases passed (compact cards, inline fields, category beside amount, fixed bottom actions, empty/long values, feedback).');
} finally { await browser.close(); }
