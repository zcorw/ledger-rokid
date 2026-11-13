<script def>
{"navigationBarTitleText":"知产 · 确认演示"}
</script>
<script setup>
import { createReview, fields, syntheticReceipt } from '../../lib/review.js';
export default {
  data: { state: 'empty', value: '', label: '', position: '', errors: '', summary: '', maxLength: 500, hostTarget: 'unknown', selectedAction: 'next', actionLabel: '下一字段' },
  onLoad() { this.review = createReview(); this.start(); },
  start() { this.review.load(syntheticReceipt); this.render(); },
  actions() {
    if (this.review.snapshot().state === 'editing') return [['next', '下一字段'], ['previous', '上一字段'], ['preview', '预览全部字段'], ['cancel', '取消并清除']];
    if (this.review.snapshot().state === 'review') return [['back', '返回修改'], ['confirm', '确认本地内容（不提交）'], ['cancel', '取消并清除']];
    return [['start', '重新加载虚构数据'], ['cancel', '取消并清除']];
  },
  onTargetChanged(target) { this.setData({ hostTarget: target }); },
  onKeyUp(event) {
    // Preserve native text input focus and all host navigation outside full-screen.
    if (this.data.hostTarget !== '_blank' || event.repeat || this.inputFocused) return;
    const actions = this.actions();
    if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
      event.preventDefault();
      const index = actions.findIndex(([name]) => name === this.data.selectedAction);
      const next = actions[(index + (event.code === 'ArrowUp' ? -1 : 1) + actions.length) % actions.length];
      this.setData({ selectedAction: next[0], actionLabel: next[1] });
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
    this.setData({ selectedAction: selected[0], actionLabel: selected[1] }); const [key,label,maxLength] = fields[s.index];
    this.setData({ state:s.state, value:s.values[key] || '', label, maxLength, position:`${s.index + 1}/${fields.length}`, errors:s.errors.join('；'), summary:fields.map(([k,l]) => `${l}: ${s.values[k] || '未填写'}`).join('\n') });
  },
  input(e) { this.review.edit(e.detail.value); this.render(); },
  previous() { this.review.move(-1); this.render(); },
  next() { this.review.move(1); this.render(); },
  preview() { this.review.preview(); this.render(); },
  back() { this.review.back(); this.render(); },
  confirm() { this.review.confirm(); this.render(); },
  cancel() { this.review.cancel(); this.render(); },
  onHide() { this.inputFocused = false; this.setData({ hostTarget: 'unknown' }); this.cancel(); },
  onUnload() { this.review?.cancel(); },
};
</script>
<page><scroll-view class="screen" scroll-y="true">
<text>全屏：上下选择操作，确认键执行；输入框获得焦点时使用原生输入。</text><text>当前操作：{{actionLabel}}</text>
<text class="title">虚构数据演示 · 不提交</text>
<view ink:if="{{state === 'editing'}}"><text>{{position}} {{label}}</text><input value="{{value}}" maxLength="{{maxLength}}" bindinput="input" bindfocus="focusInput" bindblur="blurInput"/><button bindtap="previous">上一字段</button><button bindtap="next">下一字段</button><text>{{errors}}</text><button bindtap="preview">预览全部字段</button></view>
<view ink:if="{{state === 'review'}}"><text>{{summary}}</text><button bindtap="back">返回修改</button><button bindtap="confirm">确认本地内容（不提交）</button></view>
<text ink:if="{{state === 'confirmed'}}">已确认本地内容。尚未提交，也未接入账务服务。</text>
<button bindtap="cancel">取消并清除</button><button bindtap="start">重新加载虚构数据</button>
</scroll-view></page>
<style>.screen { width:100%; height:100%; padding:20px; box-sizing:border-box; background-color:#000; color:#40ff5e; font-size:22px; } .title { font-size:26px; margin-bottom:12px; }</style>
