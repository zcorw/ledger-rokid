import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createReview, fields, syntheticReceipt } from '../aiui/lib/review.js';
import { presentBill, billFieldLabels } from '../aiui/lib/bill-presentation.js';
function load(name, wx = {}) {
  const source = readFileSync(new URL('../aiui/pages/' + name + '/index.ink', import.meta.url), 'utf8');
  const body = source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm, '').replace('export default', 'return');
  const p = new Function('wx', 'createReview', 'fields', 'syntheticReceipt', 'presentBill', 'billFieldLabels', body)(wx, createReview, fields, syntheticReceipt, presentBill, billFieldLabels);
  p.setData = function(value) { Object.assign(this.data, value); };
  return p;
}
function press(p, code, repeat = false) {
  const e = { code, repeat, prevented: false, preventDefault() { this.prevented = true; } };
  p.onKeyUp(e); return e;
}
test('review hardware selector requires preview and separate confirmation, then clears on hide', () => {
  const p = load('review'); p.onLoad();
  press(p, 'ArrowDown'); press(p, 'ArrowDown'); assert.equal(p.data.selectedAction, 'preview');
  press(p, 'Enter'); assert.equal(p.review.snapshot().state, 'review');
  assert.equal(p.data.selectedAction, 'back');
  press(p, 'ArrowDown'); assert.equal(p.data.selectedAction, 'confirm');
  press(p, 'Enter', true); assert.equal(p.review.snapshot().confirmed, null);
  press(p, 'Enter'); assert.equal(p.review.snapshot().state, 'confirmed');
  p.onHide(); assert.equal(p.review.snapshot().confirmed, null);
});
test('review preserves native text-input focus and host keys; cancellation is reachable', () => {
  const p = load('review'); p.onLoad();
  p.focusInput();
  assert.equal(press(p, 'ArrowDown').prevented, false);
  assert.equal(press(p, 'Enter').prevented, false);
  p.blurInput();
  for (const code of ['Backspace','GlobalHook','Escape']) assert.equal(press(p, code).prevented, false);
  press(p, 'ArrowUp'); assert.equal(p.data.selectedAction, 'cancel');
  press(p, 'Enter'); assert.equal(p.review.snapshot().state, 'cancelled');
});
