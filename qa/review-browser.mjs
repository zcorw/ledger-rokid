import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const browser = await chromium.launch({ executablePath: process.env.REVIEW_CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 320, height: 640 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
const button = name => page.getByRole('button', { name, exact: true });
const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
try {
  await page.goto(process.env.REVIEW_BASE_URL || 'http://127.0.0.1:4386/preview/');
  assert.equal(await page.locator('.amount').innerText(), '1,234');
  assert.equal(await page.locator('.currency').innerText(), '¥');
  assert.equal(await page.locator('.merchant').innerText(), '虚构测试商店');
  assert.equal(await page.locator('.date').innerText(), '2026-11-13');
  assert.equal(await page.locator('.category').innerText(), '餐饮');
  await button('下一项').click(); await page.getByRole('textbox').fill('0'); await button('核对').click();
  assert.equal(await button('确认').count(), 0);
  await page.getByRole('textbox').fill('99999999999999.123456');
  assert.equal(await page.locator('.amount').innerText(), '99,999,999,999,999.123456'); await noOverflow();
  await page.getByRole('textbox').fill('999.25'); await button('核对').click();
  await button('修改').click(); assert.equal(await page.getByRole('textbox').inputValue(), '999.25');
  await page.getByRole('textbox').fill('1234'); await button('下一项').click();
  await page.getByRole('textbox').fill('USD'); assert.equal(await page.locator('.currency').innerText(), '$');
  await page.getByRole('textbox').fill('JPY'); await button('核对').click();
  await button('取消').click(); assert.equal(await page.locator('.bill').count(), 0);
  await button('重新开始').click(); await button('核对').click(); await button('确认').click();
  assert.equal(await page.locator('.amount').innerText(), '1,234'); assert.equal(await page.getByRole('button').count(), 0);
  assert.equal(await page.getByRole('textbox').count(), 0);
  assert.equal((await page.locator('body').innerText()).replace(/\s+/g, ' ').trim(), '¥ 1,234 虚构测试商店 2026-11-13 餐饮');
  for (const viewport of [{ width: 320, height: 640 }, { width: 480, height: 320 }]) {
    await page.setViewportSize(viewport); await noOverflow();
    const bounds = await page.locator('.bill').boundingBox(); assert.ok(bounds.y + bounds.height <= viewport.height);
    if (process.env.REVIEW_SCREENSHOT_DIR) {
      await mkdir(process.env.REVIEW_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: join(process.env.REVIEW_SCREENSHOT_DIR, `bill-${viewport.width}x${viewport.height}.png`) });
    }
  }
  assert.deepEqual(errors, []);
  console.log('Bill layout checks passed: content-only result, symbols, exact amounts, confirmation and small-screen layout.');
} finally { await browser.close(); }
