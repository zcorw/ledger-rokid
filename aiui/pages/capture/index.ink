<script def>
{"navigationBarTitleText":"知产拍摄测试"}
</script>
<script setup>
import wx from 'wx';
import { createCaptureController } from '../../lib/capture.js';
export default {
  data: { message: '仅使用虚构测试收据。照片仅保留在内存中，不上传。', busy: false, selectedAction: 'capture', entryHint: '上下选择拍摄、清除或虚构审核，确认键执行。' },
  onLoad() {
    this.controller = createCaptureController({
      cameraFactory: () => wx.media?.createCameraContext?.(),
      notify: ({ state, busy, photo, failure }) => {
        const labels = { idle: '照片已清除，可以重新拍摄。', capturing: '等待相机拍摄；取消后需等待相机结束。', captured: `已收到照片 ${photo?.data.byteLength ?? 0} 字节。尚未验证清晰度，无识别和上传功能。`, unsupported: '当前运行环境不支持相机，请检查设备、运行时和相机权限。', failed: '拍摄未成功。' };
        let message = labels[state] || '';
        if (failure) {
          const stages = { camera: '创建相机', takePhoto: '拍摄接口', validate: '照片返回值校验' };
          const detail = failure.stage === 'validate'
            ? `结果=${failure.resultType}，data=${failure.dataType}，ArrayBuffer=${failure.isArrayBuffer}，字节=${failure.byteLength ?? '未知'}，MIME=${failure.mimeType}`
            : [failure.name, failure.code, failure.message].filter(Boolean).join(' / ');
          message += `\n阶段：${stages[failure.stage] || failure.stage}\n${detail}`;
          console.warn('[capture]', JSON.stringify(failure));
        }
        this.setData({ busy, message });
      },
    });
  },
  onHide() { this.controller?.discard(); },
  onUnload() { this.controller?.close(); },
  onKeyUp(event) {
    console.log('keyup')
    // Leave Backspace and voice wakeup to the host.
    if (event.repeat) return;
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
