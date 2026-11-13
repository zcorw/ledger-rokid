<script def>
{"navigationBarTitleText":"知产 · 确认演示"}
</script>
<script setup>
import { createReview, fields, syntheticReceipt } from '../../lib/review.js';
export default {
  data: { state: 'empty', value: '', label: '', position: '', errors: '', summary: '', maxLength: 500 },
  onLoad() { this.review = createReview(); this.start(); },
  start() { this.review.load(syntheticReceipt); this.render(); },
  render() {
    const s = this.review.snapshot(); const [key,label,maxLength] = fields[s.index];
    this.setData({ state:s.state, value:s.values[key] || '', label, maxLength, position:`${s.index + 1}/${fields.length}`, errors:s.errors.join('；'), summary:fields.map(([k,l]) => `${l}: ${s.values[k] || '未填写'}`).join('\n') });
  },
  input(e) { this.review.edit(e.detail.value); this.render(); },
  previous() { this.review.move(-1); this.render(); },
  next() { this.review.move(1); this.render(); },
  preview() { this.review.preview(); this.render(); },
  back() { this.review.back(); this.render(); },
  confirm() { this.review.confirm(); this.render(); },
  cancel() { this.review.cancel(); this.render(); },
  onHide() { this.cancel(); },
  onUnload() { this.review?.cancel(); },
};
</script>
<page><scroll-view class="screen" scroll-y="true">
<text class="title">虚构数据演示 · 不提交</text>
<view ink:if="{{state === 'editing'}}"><text>{{position}} {{label}}</text><input value="{{value}}" maxLength="{{maxLength}}" bindinput="input"/><button bindtap="previous">上一字段</button><button bindtap="next">下一字段</button><text>{{errors}}</text><button bindtap="preview">预览全部字段</button></view>
<view ink:if="{{state === 'review'}}"><text>{{summary}}</text><button bindtap="back">返回修改</button><button bindtap="confirm">确认本地内容（不提交）</button></view>
<text ink:if="{{state === 'confirmed'}}">已确认本地内容。尚未提交，也未接入账务服务。</text>
<button bindtap="cancel">取消并清除</button><button bindtap="start">重新加载虚构数据</button>
</scroll-view></page>
<style>.screen { width:100%; height:100%; padding:20px; box-sizing:border-box; background-color:#000; color:#40ff5e; font-size:22px; } .title { font-size:26px; margin-bottom:12px; }</style>
