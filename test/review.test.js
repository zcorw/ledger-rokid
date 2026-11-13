import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReview, syntheticReceipt } from '../aiui/lib/review.js';
test('cannot confirm before explicit preview; repeats do not confirm again', () => { const r=createReview(); r.load(syntheticReceipt); assert.equal(r.confirm(),false); assert.equal(r.preview(),true); assert.equal(r.confirm(),true); assert.equal(r.confirm(),false); assert.equal(r.snapshot().confirmed.amount,'1234'); });
test('invalid dates, amount and currency block confirmation',()=> { for(const patch of [{expenseDate:'2026-02-30'},{amount:'0'},{amount:'1e3'},{amount:'2.1234567'},{currencyCode:'jp'},{merchant:'a'.repeat(151)}]) { const r=createReview();r.load({...syntheticReceipt,...patch});assert.equal(r.preview(),false);assert.equal(r.snapshot().confirmed,null); }});
test('missing fields are never invented',()=> { const r=createReview();r.load({});assert.equal(r.preview(),false);assert.equal(r.snapshot().values.amount,''); });
test('edits are reviewed before confirmation and cannot change confirmed snapshot',()=> { const r=createReview();r.load(syntheticReceipt);r.move(1);r.edit('99');r.preview();r.back();r.edit('100');r.preview();r.confirm();assert.equal(r.snapshot().confirmed.amount,'100');assert.equal(r.edit('200'),false);const copy=r.snapshot();copy.confirmed.amount='300';assert.equal(r.snapshot().confirmed.amount,'100'); });
test('cancel and reload remove previous confirmation and fields',()=> { const r=createReview();r.load(syntheticReceipt);r.preview();r.confirm();r.cancel();assert.equal(r.snapshot().confirmed,null);assert.equal(r.snapshot().values.merchant,'');assert.equal(r.confirm(),false);r.load();assert.equal(r.snapshot().state,'editing'); });
import { readFileSync } from 'node:fs';
import { fields } from '../aiui/lib/review.js';
test('actual AIUI handlers clear on hide and unload, preserve full input replacements',()=> {
 const source=readFileSync(new URL('../aiui/pages/review/index.ink',import.meta.url),'utf8');
 assert.ok(!source.includes('wx:if'));
 const body=source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm,'').replace('export default','return');
 const page=new Function('createReview','fields','syntheticReceipt',body)(createReview,fields,syntheticReceipt);
 page.setData=function(value){this.data={...this.data,...value};};page.onLoad();page.next();page.input({detail:{value:'99'}});page.preview();page.confirm();assert.equal(page.review.snapshot().confirmed.amount,'99');page.onHide();assert.equal(page.review.snapshot().confirmed,null);page.start();page.onUnload();assert.equal(page.review.snapshot().values.amount,'');
});
