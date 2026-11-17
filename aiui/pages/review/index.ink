<script def>
{"navigationBarTitleText":"账单"}
</script>
<script setup>
import { createReview, fields, syntheticReceipt } from '../../lib/review.js';
import { presentBill, billFieldLabels } from '../../lib/bill-presentation.js';
export default {
  data: { state: 'empty', value: '', label: '', errors: '', bill: {}, maxLength: 500, selectedAction: 'next' },
  onLoad() { this.review = createReview(); this.start(); },
  start() { this.review.load(syntheticReceipt); this.render(); },
  actions() {
    if (this.review.snapshot().state === 'editing') return [['next', '下一项'], ['previous', '上一项'], ['preview', '核对'], ['cancel', '取消']];
    if (this.review.snapshot().state === 'review') return [['back', '修改'], ['confirm', '确认'], ['cancel', '取消']];
    if (this.review.snapshot().state === 'confirmed') return [];
    return [['start', '重新开始']];
  },
  onKeyUp(event) {
    // Preserve native text input focus and leave host navigation keys alone.
    if (event.repeat || this.inputFocused) return;
    const actions = this.actions();
    if (!actions.length) return;
    if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
      event.preventDefault();
      const index = actions.findIndex(([name]) => name === this.data.selectedAction);
      const next = actions[(index + (event.code === 'ArrowUp' ? -1 : 1) + actions.length) % actions.length];
      this.setData({ selectedAction: next[0] });
    } else if (event.code === 'Enter') {
      event.preventDefault();
      if (actions.some(([name]) => name === this.data.selectedAction)) this[this.data.selectedAction]();
    }
  },
  focusInput() { this.inputFocused = true; },
  blurInput() { this.inputFocused = false; },
  render() {
    const s = this.review.snapshot();
    const actions = this.actions();
    const selected = actions.find(([name]) => name === this.data.selectedAction) || actions[0];
    const [key,,maxLength] = fields[s.index];
    this.setData({ selectedAction: selected?.[0] || '', state:s.state, value:s.values[key] || '', label:billFieldLabels[key], maxLength, errors:s.errors.join('；'), bill:presentBill(s.confirmed || s.values) });
  },
  input(e) { this.review.edit(e.detail.value); this.render(); },
  previous() { this.review.move(-1); this.render(); },
  next() { this.review.move(1); this.render(); },
  preview() { this.review.preview(); this.render(); },
  back() { this.review.back(); this.render(); },
  confirm() { this.review.confirm(); this.render(); },
  cancel() { this.review.cancel(); this.render(); },
  onHide() { this.inputFocused = false; this.cancel(); },
  onUnload() { this.review?.cancel(); },
};
</script>
<page><scroll-view class="screen" scroll-y="true">
<view class="bill" ink:if="{{state === 'editing' || state === 'review' || state === 'confirmed'}}">
  <view class="total"><text class="currency">{{bill.currencySymbol}}</text><text class="amount" style="font-size:{{bill.amountFontSize}}px">{{bill.amountText}}</text></view>
  <text class="merchant" ink:if="{{bill.merchant}}">{{bill.merchant}}</text>
  <view class="details"><text>{{bill.expenseDate}}</text><text>{{bill.category}}</text></view>
  <text class="note" ink:if="{{bill.note}}">{{bill.note}}</text>
</view>
<view class="editor" ink:if="{{state === 'editing'}}">
  <view class="field"><text class="field-label">{{label}}</text><input value="{{value}}" maxLength="{{maxLength}}" bindinput="input" bindfocus="focusInput" bindblur="blurInput"/></view>
  <text class="errors" ink:if="{{errors}}">{{errors}}</text>
  <view class="actions"><button class="{{selectedAction === 'previous' ? 'selected' : ''}}" bindtap="previous">上一项</button><button class="{{selectedAction === 'next' ? 'selected' : ''}}" bindtap="next">下一项</button><button class="{{selectedAction === 'preview' ? 'selected' : ''}}" bindtap="preview">核对</button><button class="{{selectedAction === 'cancel' ? 'selected' : ''}}" bindtap="cancel">取消</button></view>
</view>
<view class="actions" ink:if="{{state === 'review'}}"><button class="{{selectedAction === 'back' ? 'selected' : ''}}" bindtap="back">修改</button><button class="{{selectedAction === 'confirm' ? 'selected' : ''}}" bindtap="confirm">确认</button><button class="{{selectedAction === 'cancel' ? 'selected' : ''}}" bindtap="cancel">取消</button></view>
<button ink:if="{{state === 'cancelled'}}" bindtap="start">重新开始</button>
</scroll-view></page>
<style>
.screen { width:100%; height:100%; padding:16px; box-sizing:border-box; background-color:#000; color:#40ff5e; font-size:18px; }
.bill { display:flex; flex-direction:column; gap:8px; margin-bottom:16px; }
.total { display:flex; flex-direction:row; flex-wrap:wrap; align-items:baseline; gap:4px; }
.currency { font-size:28px; font-weight:600; }
.amount { font-weight:700; line-height:1.08; max-width:100%; overflow-wrap:anywhere; }
.merchant { font-size:22px; font-weight:600; overflow-wrap:anywhere; }
.details { display:flex; flex-direction:row; justify-content:space-between; gap:12px; font-size:18px; }
.note { font-size:18px; white-space:pre-wrap; overflow-wrap:anywhere; }
.editor { border-top:1px solid #155c24; padding-top:10px; }
.field { display:flex; flex-direction:row; align-items:center; gap:12px; margin-bottom:8px; }
.field-label { font-size:16px; }
input { flex:1; min-width:0; font-size:18px; }
.errors { font-size:16px; margin-bottom:8px; }
.actions { display:flex; flex-direction:row; gap:6px; }
.actions button { flex:1; min-width:0; font-size:16px; padding:6px; border:1px solid #155c24; }
.actions .selected { border-color:#40ff5e; }
</style>
