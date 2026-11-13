<script def>
{"navigationBarTitleText":"知产拍摄测试"}
</script>
<script setup>
import wx from 'wx';
import { createCaptureController } from '../../lib/capture.js';
export default {
  data: { message: '仅使用虚构测试收据。照片仅保留在内存中，不上传。', busy: false },
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
  capture() { return this.controller?.capture(); },
  discard() { this.controller?.discard(); },
};
</script>
<page><view class="screen"><text class="heading">知产 · 收据拍摄原型</text><text class="message">{{message}}</text><button bindtap="capture" disabled="{{busy}}">拍摄测试收据</button><button bindtap="discard">清除 / 取消</button></view></page>
<style>
.screen { width:100%; height:100%; box-sizing:border-box; padding:24px; background-color:#000000; color:#40ff5e; display:flex; flex-direction:column; }
.heading { font-size:28px; margin-bottom:20px; }
.message { font-size:22px; flex:1; }
</style>
