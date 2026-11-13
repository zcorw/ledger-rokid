<script def>
{"navigationBarTitleText":"知产拍摄测试"}
</script>
<script setup>
import wx from 'wx';
import { createCaptureController } from '../../lib/capture.js';
export default {
  data: { message: '仅使用虚构测试收据。照片仅保留在内存中，不上传。', busy: false, selectedAction: 'capture', hostTarget: 'unknown', entryHint: '聊天卡片请双击进入全屏，再确认拍摄。全屏内上下选择，确认键执行。' },
  onLoad() {
    this.controller = createCaptureController({
      cameraFactory: () => wx.media?.createCameraContext?.(),
      notify: ({ state, busy, photo }) => {
        const labels = { idle: '照片已清除，可以重新拍摄。', capturing: '等待相机拍摄；取消后需等待相机结束。', captured: `已收到照片 ${photo?.data.byteLength ?? 0} 字节。尚未验证清晰度，无识别和上传功能。`, unsupported: '当前运行环境不支持相机，请在目标设备以 _blank 启动。', failed: '拍摄失败或权限未获准，请检查相机授权后重试。' };
        this.setData({ busy, message: labels[state] || '' });
      },
    });
  },
  onHide() { this.controller?.discard(); },
  onUnload() { this.controller?.close(); },
  onTargetChanged(target) {
    this.setData({
      hostTarget: target,
      entryHint: target === '_blank'
        ? '全屏：上下选择拍摄、清除或虚构审核，确认键执行；返回键退出。'
        : '聊天卡片请双击进入全屏后拍摄；卡片中不能使用相机。',
    });
    if (target !== '_blank') this.controller?.discard();
  },
  onKeyUp(event) {
    // Leave card activation, Backspace and voice wakeup to the host.
    if (this.data.hostTarget !== '_blank' || event.repeat) return;
    if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
      event.preventDefault();
      const actions = ['capture', 'discard', 'reviewDemo'];
      const offset = event.code === 'ArrowUp' ? -1 : 1;
      this.setData({ selectedAction: actions[(actions.indexOf(this.data.selectedAction) + offset + actions.length) % actions.length] });
    } else if (event.code === 'Enter') {
      event.preventDefault();
      if (this.data.selectedAction === 'discard') this.discard();
      else if (this.data.selectedAction === 'reviewDemo') return this.reviewDemo();
      else return this.capture();
    }
  },
  capture() {
    if (this.data.hostTarget === '_current') {
      this.setData({ message: '请先双击进入全屏，再选择拍摄测试收据。' });
      return false;
    }
    return this.controller?.capture();
  },
  reviewDemo() {
    this.controller?.discard();
    wx.navigateTo({ url: '/pages/review/index' });
  },
  discard() { this.controller?.discard(); },
};
</script>
<page><view class="screen"><text class="heading">知产 · 收据拍摄原型</text><text class="hint">{{entryHint}}</text><text class="selection">当前选择：{{selectedAction === 'capture' ? '拍摄测试收据' : selectedAction === 'discard' ? '清除 / 取消' : '虚构字段审核（非照片识别）'}}</text><text class="message">{{message}}</text><button bindtap="capture" disabled="{{busy}}">拍摄测试收据</button><button bindtap="discard">清除 / 取消</button><button bindtap="reviewDemo">虚构字段审核（非照片识别）</button></view></page>
<style>
.screen { width:100%; height:100%; box-sizing:border-box; padding:24px; background-color:#000000; color:#40ff5e; display:flex; flex-direction:column; }
.heading { font-size:28px; margin-bottom:20px; }
.hint, .selection { font-size:20px; margin-bottom:12px; }
.message { font-size:22px; flex:1; }
</style>
