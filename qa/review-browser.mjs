import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:320,height:640}});
await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
try {
 await page.goto('http://127.0.0.1:4386/preview/');
 await page.getByText('下一字段',{exact:true}).click();await page.getByRole('textbox').fill('0');await page.getByText('预览全部字段',{exact:true}).click();assert.equal(await page.getByText('确认本地内容（不提交）',{exact:true}).count(),0);
 await page.getByRole('textbox').fill('999.25');await page.getByText('预览全部字段',{exact:true}).click();assert.match(await page.locator('pre').innerText(),/999.25/);
 await page.getByText('返回修改',{exact:true}).click();assert.equal(await page.getByRole('textbox').inputValue(),'999.25');await page.getByText('预览全部字段',{exact:true}).click();await page.getByText('确认本地内容（不提交）',{exact:true}).click();await page.getByText('已确认本地内容。尚未提交，也未接入账务服务。',{exact:true}).waitFor();
 await page.getByText('取消并清除',{exact:true}).click();assert.equal(await page.getByText('已确认本地内容。尚未提交，也未接入账务服务。',{exact:true}).count(),0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.reload();await page.getByText('下一字段',{exact:true}).click();assert.equal(await page.getByRole('textbox').inputValue(),'1234');
 console.log('Synthetic browser review checks passed; no native-device claims.');
}finally{await browser.close();}
