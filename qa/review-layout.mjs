import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { presentBill } from '../aiui/lib/bill-presentation.js';

const source = await readFile(new URL('../aiui/pages/capture/index.ink', import.meta.url), 'utf8');
const template = source.slice(source.indexOf('<view class="bill-screen"'), source.indexOf('<view class="{{billVisible'));
const styles = source.match(/<style>([\s\S]*?)<\/style>/)[1];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const browser = await chromium.launch({ executablePath: process.env.REVIEW_CHROMIUM_PATH || undefined });
const page = await browser.newPage();
try {
  for (const viewport of [{ width: 320, height: 240 }, { width: 480, height: 320 }, { width: 640, height: 360 }]) {
    await page.setViewportSize(viewport);
    for (const values of [{ amount: '614' }, { amount: '99999999999999.123456', currencyCode: 'JPY', merchant: '很长的测试商户'.repeat(15), expenseDate: '2026-11-17', accountName: '合成账户', category: 'food' }]) {
      const bill = presentBill(values);
      const html = template.replace(/\s(?:ink:if|disabled)="[^"]*"/g, '')
        .replace(/{{selectedAction === '[^']+' \? 'selected' : ''}}/g, '')
        .replace(/{{bill\.([A-Za-z]+)}}/g, (_, key) => escape(bill[key]))
        .replace(/{{reviewMessage}}/g, '')
        .replace(/<(\/?)(?:view|scroll-view)\b/g, '<$1div').replace(/<(\/?)(?:text)\b/g, '<$1span');
      await page.setContent(`<style>html,body{margin:0;width:100%;height:100%}*{box-sizing:border-box}button{color:inherit;background:#000}${styles}</style>${html}`);
      for (const label of ['商户', '金额', '时间', '账户', '分类']) assert.equal(await page.locator('.field-label').filter({ hasText: label }).count(), 1);
      assert.deepEqual(await page.getByRole('button').allTextContents(), ['语音修改', '草稿', '确认']);
      for (const button of await page.getByRole('button').all()) {
        const box = await button.boundingBox();
        assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.locator('.currency-code').innerText(), values.currencyCode ? '(JPY)' : '()');
    }
  }
  if (process.env.REVIEW_SCREENSHOT_DIR) {
    await mkdir(process.env.REVIEW_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: process.env.REVIEW_SCREENSHOT_DIR + '/review-layout.png' });
  }
  console.log('Native bill template: fixed fields, currency codes, long content and visible actions passed.');
} finally { await browser.close(); }
