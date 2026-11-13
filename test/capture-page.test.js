import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Exercise the actual page callbacks without pretending to compile AIUI or use hardware.
const source = await readFile(new URL('../aiui/pages/capture/index.ink', import.meta.url), 'utf8');
const script = source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm, '');
const definition = (await import('data:text/javascript,' + encodeURIComponent(script))).default;
function page() {
  let captures = 0, discards = 0;
  const p = { ...definition, data: { ...definition.data },
    setData(value) { Object.assign(this.data, value); },
    controller: { capture() { captures++; return true; }, discard() { discards++; } },
  };
  return { p, counts: () => ({ captures, discards }) };
}
function key(code, repeat = false) {
  return { code, repeat, prevented: false, preventDefault() { this.prevented = true; } };
}
test('inline card preserves host activation and never invokes capture', () => {
  const { p, counts } = page();
  p.onTargetChanged('_current');
  const event = key('Enter'); p.onKeyUp(event);
  assert.equal(event.prevented, false);
  assert.equal(p.capture(), false);
  assert.equal(counts().captures, 0);
  assert.match(p.data.message, /全屏/);
});
test('full-screen confirm captures once; repeat and unrelated keys do not capture', () => {
  const { p, counts } = page();
  p.onTargetChanged('_blank');
  const event = key('Enter'); p.onKeyUp(event);
  assert.equal(event.prevented, true);
  p.onKeyUp(key('Enter', true));
  for (const code of ['Backspace', 'GlobalHook', 'Escape']) {
    const e = key(code); p.onKeyUp(e); assert.equal(e.prevented, false);
  }
  assert.equal(counts().captures, 1);
});
test('direction changes selection, confirm clears, return to card discards image', () => {
  const { p, counts } = page();
  p.onTargetChanged('_blank');
  const down = key('ArrowDown'); p.onKeyUp(down);
  assert.equal(down.prevented, true);
  assert.equal(p.data.selectedAction, 'discard');
  p.onKeyUp(key('Enter'));
  assert.deepEqual(counts(), { captures: 0, discards: 1 });
  p.onKeyUp(key('ArrowUp'));
  assert.equal(p.data.selectedAction, 'capture');
  p.onTargetChanged('_current');
  assert.equal(counts().discards, 2);
});
test('unknown target does not intercept host navigation and tap still uses native guard', () => {
  const { p, counts } = page();
  const e = key('Enter'); p.onKeyUp(e);
  assert.equal(e.prevented, false);
  assert.equal(counts().captures, 0);
  assert.equal(p.capture(), true);
});
