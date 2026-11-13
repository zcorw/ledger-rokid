import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 640 } });
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('http://127.0.0.1:4386/preview/chain.html');
  await page.getByText('开始虚构拍摄与识别', { exact: true }).click();
  for (let i = 0; i < 4; i++) await page.getByText('下一字段', { exact: true }).click();
  await page.getByRole('textbox').fill('food'); await page.getByText('预览', { exact: true }).click();
  await page.getByText('确认内容', { exact: true }).click();
  await page.locator('#mode').selectOption('unknown'); await page.getByText('提交虚构记录', { exact: true }).click();
  await page.getByText('重试原请求', { exact: true }).waitFor();
  const before = await page.getByText('测试请求标识：', { exact: false }).innerText();
  await page.reload(); await page.getByText('重试原请求', { exact: true }).waitFor();
  assert.equal(await page.getByText('测试请求标识：', { exact: false }).innerText(), before);
  await page.getByText('重试原请求', { exact: true }).click();
  await page.getByText('虚构记录提交成功，未创建真实账务。', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.reload(); await page.getByText('虚构记录提交成功，未创建真实账务。', { exact: true }).waitFor();
  console.log('Synthetic receipt chain/restart browser checks passed; no native-device claims.');
} finally { await browser.close(); }
