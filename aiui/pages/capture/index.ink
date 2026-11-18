<script def>
{"navigationBarTitleText":"账单拍摄"}
</script>
<script setup>
import wx from 'wx';
import { createViewfinderController } from '../../lib/viewfinder.js';
import { createPhotoDisplayController } from '../../lib/photo-display.js';
import { createReceiptRecognitionController } from '../../lib/receipt-recognition.js';
import { createReceiptApi, receiptApiConfig } from '../../lib/receipt-api.js';
import { createReceiptCredentialStore } from '../../lib/receipt-credential-store.js';
import { presentBill, presentVoiceFeedback } from '../../lib/bill-presentation.js';
import { createVoiceReview } from '../../lib/voice-review.js';
import { createDraftSaver } from '../../lib/receipt-draft.js';
import { createNativeConfirmation } from '../../lib/native-confirmation.js';
export default {
  data: { busy: false, bindingState: 'checking', captureState: 'idle', recognitionState: 'idle', previewItems: [], photoVisible: false, photoMessage: '', billVisible: false, bill: {}, receiptId: '', selectedAction: 'voice', reviewBusy: false, reviewMessage: '', voiceState: 'idle', voiceActive: false, voiceTranscript: '', voiceScrollTop: 0, authorizationVisible: false, authorizationCode: '', authorizationUrl: '', message: '正在检查绑定…', canRetry: false, entryHint: '单击拍照，自动识别账单' },
  onLoad() {
    this.setData({ submissionState: 'idle', submissionPending: false, writeAuthorizationUrl: '' });
    this.recoveryChecked = false; this.recoveryPending = false;
    this.pageHidden = false; this.pageClosed = false; this.pageReady = false;
    this.wantsPreview = false; this.previewStarting = false; this.captureActionBusy = false; this.captureRun = 0;
    this.bindingReady = false; this.bindingRun = 0; this.bindingAbort = null;
    this.reviewValues = null;
    this.drafts = createDraftSaver({
      save: (payload, options) => this.receiptApi.saveDraft(payload, options),
      load: (id, options) => this.receiptApi.getDraft(id, options),
      notify: ({ state, busy, error }) => {
        if (this.pageHidden || this.pageClosed) return;
        const messages = { RECEIPT_ID_REQUIRED: '未取得原图标识，请更新服务后重新拍摄', DRAFT_VERSION_CONFLICT: '草稿已有更新，请在知产网站核对后继续', AUTH_REQUIRED: '设备授权已失效，请返回重新绑定' };
        this.setData({ reviewBusy: busy, reviewMessage: state === 'saving' ? '正在保存草稿…' : state === 'saved' ? '草稿已保存，可在知产继续编辑；尚未入账' : messages[error] || '草稿保存未确认，内容已保留，请重试' });
      },
    });
    this.voice = createVoiceReview({
      correct: (values, transcript, options) => this.receiptApi.correct(values, transcript, options),
      notify: ({ state, busy, transcript, result, error }) => {
        if (this.pageHidden || this.pageClosed) return;
        const messages = { SPEECH_UNSUPPORTED: '当前眼镜不支持语音输入，请在知产网站继续编辑', SPEECH_PERMISSION: '未获得麦克风权限，账单已保留', SPEECH_EMPTY: '没有听清，请重新收音', SPEECH_TIMEOUT: '等待最终转写超时，文字已保留，尚未修改账单', SPEECH_ENDED: '收音意外结束，文字已保留，尚未提交分析，请重新收音', SPEECH_INCOMPLETE: '未取得完整最终转写，文字已保留，请重新收音', SPEECH_TOO_LONG: '语音文字超过1000字，尚未提交分析，请分次修改', SPEECH_MICROPHONE: '无法打开麦克风，账单已保留', SPEECH_NETWORK: '语音识别网络异常，文字已保留', SPEECH_LANGUAGE: '当前语音服务不支持中文识别', AUTH_REQUIRED: '设备授权已失效，请返回重新绑定' };
        let message = state === 'listening' ? '说完后点击结束收音' : state === 'stopping' ? '正在结束收音并等待最终文字…' : state === 'correcting' ? '正在分析识别文字…' : state === 'cancelled' ? '语音修改已取消，账单未改变' : messages[error] || '修改失败，原账单已保留，请重试';
        if (result) {
          this.reviewValues = { ...result.values };
          message = presentVoiceFeedback(result, transcript);
        }
        this.setData({ reviewBusy: busy, reviewMessage: message, voiceState: state, voiceActive: busy, voiceTranscript: transcript || '', voiceScrollTop: (transcript?.length || 0) * 30, ...(!busy ? { selectedAction: 'voice' } : state === 'stopping' || state === 'correcting' ? { selectedAction: 'draft' } : {}), ...(result ? { bill: presentBill(this.reviewValues) } : {}) });
      },
    });
    this.lastCaptureInput = null; this.keySequence = 0; this.pendingKeyAction = null;
    this.photoDisplay = createPhotoDisplayController({
      decode: photo => {
        if (typeof globalThis.Blob !== 'function' || typeof globalThis.createImageBitmap !== 'function') throw new Error('当前运行时不支持照片解码');
        return globalThis.createImageBitmap(new globalThis.Blob([photo.data], { type: photo.mimeType }));
      },
      contextFactory: () => wx.createCanvasContext?.('captured-photo'),
      notify: ({ state, error }) => {
        if (!this.pageClosed) this.setData({ photoVisible: state === 'loading' || state === 'visible', photoMessage: state === 'failed' ? '照片显示失败：' + error : '' });
      },
    });
    this.receiptApi = createReceiptApi({
      credentialStore: createReceiptCredentialStore({ wx }),
      notifyAuthorization: ({ state, userCode, verificationUri }) => {
        if (!this.pageClosed && !this.pageHidden) this.setData({ ...(state === 'pending' && !this.bindingReady ? { bindingState: 'binding' } : {}), authorizationVisible: state === 'pending', authorizationCode: userCode || '', authorizationUrl: verificationUri ? verificationUri.replace('https://', '') : '' });
      },
    });
    this.recognition = createReceiptRecognitionController({
      recognize: (photo, options) => this.receiptApi.recognize(photo, options),
      notify: ({ state, busy, result, error }) => {
        if (this.pageClosed) return;
        if (result) {
          this.reviewValues = { ...result.values, accountId: '', accountName: '' };
          if (!this.submission?.hasPending()) this.submission?.reset();
          this.setData({ submissionState: 'idle', submissionPending: false, selectedAction: 'voice', reviewMessage: '', voiceState: 'idle', voiceActive: false, voiceTranscript: '', voiceScrollTop: 0, writeAuthorizationUrl: '' });
        }
        const messages = { AUTH_STORAGE_UNAVAILABLE: '当前运行时不支持保存设备授权，请升级运行时', AUTH_STORAGE_FAILED: '设备授权存储失败，请重试', RECEIPT_ARCHIVE_FAILED: '原图保存失败，请重试', AUTH_REQUIRED: '设备授权已失效，请重试并在手机授权', DEVICE_ACCESS_DENIED: '已拒绝授权，可重试重新申请', DEVICE_CODE_EXPIRED: '授权码已过期，请重试', DEVICE_CODE_USED: '授权码已使用，请重试', DEVICE_RATE_LIMIT: '授权请求过于频繁，请稍后重试', DEVICE_ENDPOINT_UNAVAILABLE: '后端尚未部署设备授权接口', RATE_LIMITED: '识别请求过于频繁，请稍后重试', TIMEOUT: '识别超时，请重试', INVALID_RESULT: '识别结果无效，请重试', NETWORK_ERROR: '连接失败，请检查网络后重试', BACKEND_UNAVAILABLE: '识别服务暂不可用，请稍后重试', BACKEND_NOT_CONFIGURED: '后端尚未配置识别服务', BACKEND_REDIRECT: '后端地址发生跳转，请检查 HTTPS 配置', BACKEND_CONFIG: '后端 HTTPS 地址配置无效', RUNTIME_UNSUPPORTED: '当前运行时不支持识别网络接口', IMAGE_TOO_LARGE: '照片过大，请重新拍摄', IMAGE_ENCODING_UNSUPPORTED: '当前运行时不支持照片格式转换', IMAGE_ENCODING_FAILED: '照片转换失败，请重新拍摄', RECEIPT_NOT_FOUND: '未识别到账单，请重新拍摄', RECOGNITION_FAILED: '识别失败，请重试' };
        this.setData({ recognitionState: state, ...(!busy ? { authorizationVisible: false, authorizationCode: '', authorizationUrl: '' } : {}), billVisible: state === 'recognized', receiptId: result?.receiptId || '', bill: result ? presentBill(result.values) : {}, busy: busy || !!this.controller?.snapshot().busy || this.captureActionBusy, canRetry: state === 'failed', ...(state === 'recognizing' ? { message: '正在识别账单…' } : state === 'failed' ? { message: messages[error] || messages.RECOGNITION_FAILED } : state === 'recognized' ? { message: '' } : {}) });
      },
    });
    this.controller = createViewfinderController({
      requestStream: constraints => {
        if (typeof globalThis.navigator?.mediaDevices?.getUserMedia !== 'function') throw Object.assign(new Error('运行时未提供 getUserMedia'), { code: 'PREVIEW_UNSUPPORTED' });
        return globalThis.navigator.mediaDevices.getUserMedia(constraints);
      },
      createPreviewURL: stream => {
        if (typeof globalThis.URL?.createObjectURL !== 'function' || typeof globalThis.URL?.revokeObjectURL !== 'function') throw Object.assign(new Error('运行时未提供 MediaStream 预览地址接口'), { code: 'PREVIEW_UNSUPPORTED' });
        return globalThis.URL.createObjectURL(stream);
      },
      revokePreviewURL: url => globalThis.URL.revokeObjectURL(url),
      cameraFactory: () => wx.media?.createCameraContext?.(),
      runtimeInfo: () => globalThis.navigator?.userAgent || '未知运行时',
      notify: ({ state, busy, photo, failure, preview }) => {
        const recognition = this.recognition.snapshot();
        const labels = { idle: '', opening: '正在打开相机…', previewing: '', capturing: '正在拍照…', captured: '正在识别账单…', unsupported: '当前运行时不支持相机', failed: '相机操作未成功' };
        let message = labels[state] || '';
        if (failure) {
          const stages = { preview: '实时取景', camera: '创建相机', takePhoto: '拍摄接口', validate: '照片返回值校验' };
          const detail = failure.stage === 'validate'
            ? `data=${failure.dataType}，字节=${failure.byteLength ?? '未知'}，MIME=${failure.mimeType}`
            : [failure.step, failure.code, failure.message, failure.runtime].filter(Boolean).join(' / ');
          message += `。阶段：${stages[failure.stage] || failure.stage} / ${detail}`;
          this.logDiagnostic('[capture]', failure);
        }
        if (recognition.state === 'recognized') message = '';
        this.setData({ captureState: state, previewItems: preview ? [preview] : [], busy: busy || recognition.busy || this.captureActionBusy || !!this.bindingAbort, ...(this.bindingReady ? { canRetry: !!failure || recognition.state === 'failed', message } : {}) });
        if (photo && !this.data.billVisible) this.photoDisplay.show(photo);
        else if (!photo) this.photoDisplay.clear();
        this.maybeOpenPreview();
      },
    });
  },
  setupSubmission() {
    if (this.submission) return;
    const store = createReceiptCredentialStore({ wx });
    const resource = receiptApiConfig.baseUrl + receiptApiConfig.prefix;
    this.submission = createNativeConfirmation({ api: this.receiptApi, resource,
      saveDraft: (id, values) => this.drafts.run(id, values),
      restoreDraft: draft => this.drafts.adopt(draft),
      store: { get: () => store.read(resource + ':confirmation'), set: value => store.write(resource + ':confirmation', value), remove: () => store.remove(resource + ':confirmation') },
      notify: ({ state, busy, pending, values, receiptId, error, authorizationUri }) => {
        if (this.pageHidden || this.pageClosed) return;
        const messages = { REVIEW_INCOMPLETE: '请先用语音补全金额、时间、币种、账户和分类', EXPENSE_PERMISSION_REQUIRED: '请在手机允许本设备确认入账，再按确认', POSSIBLE_DUPLICATE: '可能已有相同开销；请核对，仍需入账请再次按确认', EXPENSE_ALREADY_DELETED: '此单据的开销已删除，不会重新入账', IDEMPOTENCY_CONFLICT: '请求与已有记录冲突，请在知产核对', DRAFT_VERSION_CONFLICT: '草稿已有更新，请在知产网站核对', AUTH_REQUIRED: '设备授权已失效，请返回重新绑定', AUTH_STORAGE_FAILED: '恢复状态保存失败，请先保存草稿', AUTH_STORAGE_UNAVAILABLE: '当前环境不支持保存恢复状态，请在网站入账', CURRENCY_NOT_ENABLED: '请先在知产启用该币种', DRAFT_FAILED: '草稿未保存成功，尚未入账，请重试' };
        const message = state === 'succeeded' ? '已入账，可在知产查看原图及开销' : state === 'checking' ? '正在查询上次入账结果…' : state === 'checking_permission' ? '正在核对入账权限…' : state === 'preparing' ? '正在保存待确认单据…' : state === 'submitting' ? '正在确认入账…' : messages[error] || '入账结果尚未确认，请按确认查询；不会重复创建';
        if (values) this.reviewValues = { ...values };
        if (pending || values || state === 'succeeded') this.wantsPreview = false;
        this.setData({ submissionState: state, submissionPending: pending, reviewBusy: busy, reviewMessage: message,
          writeAuthorizationUrl: authorizationUri || '', ...(receiptId ? { receiptId } : {}),
          ...((pending || values || state === 'succeeded') ? { billVisible: true, bill: presentBill(this.reviewValues || {}), selectedAction: 'confirm' } : {}) });
      },
    });
  },
  async openAfterRecovery() {
    this.setupSubmission();
    if (!this.recoveryChecked) {
      this.recoveryChecked = true; this.recoveryPending = true;
      let restored;
      try { restored = await this.submission.recover(); } finally { this.recoveryPending = false; }
      if (restored || !this.allowCameraAction()) return false;
    }
    return this.maybeOpenPreview();
  },
  onShow() {
    this.pageHidden = false; this.wantsPreview = true;
    if (this.pageReady) return this.openAfterRecovery();
  },
  onReady() { this.pageReady = true; this.wantsPreview = true; return this.openAfterRecovery(); },
  bindingError(code) {
    const messages = { AUTH_STORAGE_UNAVAILABLE: '当前运行时不支持保存设备绑定，请升级运行时', AUTH_STORAGE_FAILED: '设备绑定存储失败，请重试', DEVICE_ACCESS_DENIED: '已拒绝绑定，请重新绑定', DEVICE_CODE_EXPIRED: '绑定码已过期，请重新绑定', DEVICE_CODE_USED: '绑定码已使用，请重新绑定', DEVICE_RATE_LIMIT: '绑定请求过于频繁，请稍后重试', DEVICE_ENDPOINT_UNAVAILABLE: '后端尚未部署设备绑定接口', TIMEOUT: '绑定请求超时，请重试', NETWORK_ERROR: '连接失败，请检查网络后重试', BACKEND_UNAVAILABLE: '绑定服务暂不可用，请稍后重试', INVALID_RESULT: '绑定返回结果无效，请重试' };
    return messages[code] || '设备绑定未完成，请重试';
  },
  async ensureBinding() {
    if (!this.pageReady || !this.allowCameraAction() || this.bindingAbort || this.bindingReady) return false;
    const current = ++this.bindingRun, request = new AbortController(); this.bindingAbort = request;
    this.setData({ bindingState: 'checking', busy: true, canRetry: false, message: '正在检查绑定…' });
    try {
      await this.receiptApi.authorize({ signal: request.signal });
      if (!this.allowCameraAction() || current !== this.bindingRun) return false;
      this.bindingReady = true; this.bindingAbort = null;
      this.setData({ bindingState: 'bound', busy: false, canRetry: false, message: '', authorizationVisible: false, authorizationCode: '', authorizationUrl: '' });
      return await this.maybeOpenPreview();
    } catch (failure) {
      if (this.allowCameraAction() && current === this.bindingRun) {
        this.wantsPreview = false;
        this.setData({ bindingState: 'failed', busy: false, canRetry: true, authorizationVisible: false, authorizationCode: '', authorizationUrl: '', message: this.bindingError(failure?.message) });
      }
      return false;
    } finally { if (this.bindingAbort === request) this.bindingAbort = null; }
  },
  cancelBinding() {
    this.bindingRun++; this.bindingReady = false;
    this.bindingAbort?.abort(); this.bindingAbort = null;
  },
  maybeOpenPreview() {
    if (this.recoveryPending || !this.recoveryChecked || this.submission?.hasPending()) return false;
    if (!this.pageReady || this.pageHidden || this.pageClosed || !this.wantsPreview || this.previewStarting || this.captureActionBusy) return false;
    if (!this.bindingReady) return this.ensureBinding();
    const current = this.controller?.snapshot();
    if (!current || current.busy || current.state !== 'idle' || this.recognition.snapshot().busy) return false;
    return this.startPreview();
  },
  async startPreview() {
    if (!this.allowCameraAction() || !this.bindingReady || this.previewStarting) return false;
    this.previewStarting = true;
    try {
      this.recognition.cancel();
      return await this.controller.start();
    } catch (error) { this.reportActionFailure('打开预览', error); return false; }
    finally { this.previewStarting = false; this.maybeOpenPreview(); }
  },
  previewEventSession(event) { return Number(event?.currentTarget?.dataset?.session ?? event?.target?.dataset?.session); },
  previewPlaying(event) {
    if (this.pageHidden || this.pageClosed) return false;
    return this.controller?.markPlaying(this.previewEventSession(event));
  },
  previewError(event) {
    if (this.pageClosed) return false;
    return this.controller?.videoError(this.previewEventSession(event), new Error(event?.detail?.message || '原生视频组件无法播放摄像头流'));
  },
  logDiagnostic(tag, value) { try { console.log(tag, JSON.stringify(value)); } catch {} },
  reportActionFailure(action, error) {
    if (this.pageClosed) return;
    this.wantsPreview = false;
    try { this.controller?.discard('action-error'); } catch {}
    this.setData({ busy: false, captureState: 'failed', canRetry: true, message: action + '失败：' + String(error?.errMsg || error?.message || error).slice(0, 160) });
  },
  allowCameraAction() { return !this.pageClosed && !this.pageHidden; },
  onHide() {
    this.submission?.cancel(); this.recoveryChecked = false;
    this.drafts?.cancel();
    this.voice?.cancel(); this.setData({ reviewBusy: false, voiceActive: false, voiceState: 'idle', voiceTranscript: '', voiceScrollTop: 0 });
    this.pageHidden = true; this.wantsPreview = false; this.pendingKeyAction = null; this.lastCaptureInput = null; this.captureRun++; this.captureActionBusy = false;
    this.cancelBinding(); this.recognition?.cancel(); this.controller?.discard('hidden'); this.photoDisplay?.clear();
  },
  onUnload() {
    this.submission?.cancel();
    this.drafts?.cancel();
    this.voice?.close();
    this.setData({ voiceActive: false, voiceState: 'idle', voiceTranscript: '', voiceScrollTop: 0 });
    this.pageHidden = true; this.pageClosed = true; this.wantsPreview = false; this.pendingKeyAction = null; this.lastCaptureInput = null; this.captureRun++; this.captureActionBusy = false;
    this.cancelBinding(); this.recognition?.close(); this.receiptApi?.close(); this.controller?.close('unload'); this.photoDisplay?.close();
  },
  keyboardAction() {
    if (this.data.billVisible && this.data.voiceActive) return this.data.selectedAction === 'draft' ? 'review-voice-cancel' : this.data.voiceState === 'listening' ? 'review-voice-stop' : null;
    if (this.data.billVisible) return this.data.reviewBusy ? null : 'review-' + this.data.selectedAction;
    if (this.data.billVisible || this.captureActionBusy || this.recognition?.snapshot().busy) return null;
    if (this.data.canRetry) return 'retry';
    return this.controller?.snapshot().state === 'previewing' ? 'confirm-photo' : null;
  },
  onKeyDown(event) {
    if (!this.allowCameraAction() || event.repeat || event.code !== 'Enter') return;
    this.keySequence++;
    // A press begun before preview is ready must not become a shutter on release.
    this.pendingKeyAction = this.keyboardAction() || (this.data.billVisible ? null : 'ignore');
  },
  onKeyUp(event) {
    if (!this.allowCameraAction() || event.repeat) return;
    if (event.code === 'Backspace' || event.code === 'Escape') { this.discard('return'); return; }
    if (this.data.billVisible && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.code)) {
      event.preventDefault();
      if (!this.data.reviewBusy || this.data.voiceActive) {
        const actions = this.data.voiceActive ? this.data.voiceState === 'listening' ? ['voice', 'draft'] : ['draft'] : this.data.submissionPending || ['succeeded', 'conflict'].includes(this.data.submissionState) ? ['confirm'] : ['voice', 'draft', 'confirm'];
        const index = Math.max(0, actions.indexOf(this.data.selectedAction));
        this.setData({ selectedAction: actions[(index + (['ArrowLeft', 'ArrowUp'].includes(event.code) ? actions.length - 1 : 1)) % actions.length] });
      }
      return;
    }
    if (event.code !== 'Enter') return;
    let action = this.pendingKeyAction || this.keyboardAction();
    const previous = this.lastCaptureInput, elapsed = previous ? Date.now() - previous.time : -1;
    if (!this.pendingKeyAction && previous?.source === 'tap' && previous.keySequence === this.keySequence && elapsed >= 0 && elapsed < 750) action = previous.action;
    this.pendingKeyAction = null;
    if (!action) return;
    event.preventDefault();
    if (action === 'ignore') return false;
    if (action.startsWith('review-')) return this.activateReview(action.slice(7), event);
    return action === 'retry' ? this.retry(event) : action === 'open-preview' ? this.openPreview(event) : this.confirmCapture(event);
  },
  acceptCaptureInput(event, action) {
    const source = event?.code === 'Enter' ? 'key' : 'tap', time = Date.now(), previous = this.lastCaptureInput;
    const freshKey = source === 'key' && this.keySequence > (previous?.keySequence ?? -1);
    const sameVoiceControl = ['review-voice', 'review-voice-stop'].includes(previous?.action) && ['review-voice', 'review-voice-stop'].includes(action);
    const sameDraftControl = ['review-draft', 'review-voice-cancel'].includes(previous?.action) && ['review-draft', 'review-voice-cancel'].includes(action);
    if (previous && (previous.action === action || sameVoiceControl || sameDraftControl) && previous.source !== source && !freshKey && time >= previous.time && time - previous.time < 750) return false;
    this.lastCaptureInput = { source, time, action, keySequence: this.keySequence }; return true;
  },
  activateReview(action, event) {
    event?.preventDefault?.(); event?.stopPropagation?.();
    if (action === 'voice-stop' || action === 'voice-cancel') {
      if (!this.allowCameraAction() || !this.data.billVisible || !this.data.voiceActive || (action === 'voice-stop' && this.data.voiceState !== 'listening')) return false;
      if (!this.acceptCaptureInput(event, 'review-' + action)) return false;
      if (action === 'voice-stop') return this.voice.stop();
      this.voice.cancel(); return true;
    }
    if (!this.allowCameraAction() || !this.data.billVisible || this.data.reviewBusy || this.submission?.isBusy() || !['voice', 'draft', 'confirm'].includes(action)) return false;
    if (!this.acceptCaptureInput(event, 'review-' + action)) return false;
    if (action === 'confirm') {
      this.setData({ selectedAction: action, writeAuthorizationUrl: '' });
      if (['succeeded', 'conflict'].includes(this.data.submissionState)) {
        if (!this.submission.reset()) return false;
        this.setData({ submissionState: 'idle', submissionPending: false, reviewMessage: '' });
        return this.retake();
      }
      return this.submission.confirm(this.data.receiptId, this.reviewValues || {});
    }
    if (this.submission?.hasPending() || this.data.submissionState === 'succeeded') return false;
    if (action === 'voice') {
      this.setData({ selectedAction: action });
      return this.voice.run(this.reviewValues || {});
    }
    if (action === 'draft') {
      this.setData({ selectedAction: action });
      return this.drafts.run(this.data.receiptId, this.reviewValues || {});
    }
    return false;
  },
  voiceEdit(event) { return this.activateReview(this.data.voiceActive ? 'voice-stop' : 'voice', event); },
  saveDraft(event) { return this.activateReview(this.data.voiceActive ? 'voice-cancel' : 'draft', event); },
  submitBill(event) { return this.activateReview('confirm', event); },
  openPreview(event) {
    if (!this.allowCameraAction() || this.captureActionBusy || this.recognition.snapshot().busy || this.controller.snapshot().busy) return Promise.resolve(false);
    if (!this.acceptCaptureInput(event, 'open-preview')) return Promise.resolve(false);
    this.wantsPreview = true; return this.bindingReady ? this.startPreview() : this.ensureBinding();
  },
  async confirmCapture(event) {
    event?.preventDefault?.(); event?.stopPropagation?.();
    if (!this.allowCameraAction() || !this.bindingReady || this.data.billVisible || this.captureActionBusy || this.recognition.snapshot().busy || this.controller.snapshot().busy || this.controller.snapshot().state !== 'previewing') return false;
    if (!this.acceptCaptureInput(event, 'confirm-photo')) return false;
    this.wantsPreview = false; this.captureActionBusy = true; const current = ++this.captureRun;
    try {
      if (!await this.controller.confirm() || !this.allowCameraAction() || current !== this.captureRun) return false;
      this.captureActionBusy = false;
      return await this.runRecognition(this.controller.snapshot().photo);
    } catch (error) { this.reportActionFailure('拍摄', error); return false; }
    finally {
      if (current === this.captureRun) {
        this.captureActionBusy = false;
        if (!this.pageClosed) this.setData({ busy: this.controller.snapshot().busy || this.recognition.snapshot().busy });
        this.maybeOpenPreview();
      }
    }
  },
  async runRecognition(photo) {
    const current = this.captureRun;
    const ok = await this.recognition.run(photo);
    if (ok && this.allowCameraAction() && current === this.captureRun && this.recognition.snapshot().state === 'recognized') {
      this.wantsPreview = false; this.photoDisplay.clear(); this.controller.discard('recognized');
      return true;
    }
    if (this.allowCameraAction() && current === this.captureRun && this.recognition.snapshot().error === 'AUTH_REQUIRED') {
      this.discard('authorization-expired');
      this.setData({ bindingState: 'failed', busy: false, canRetry: true, message: '设备绑定已失效，请重新绑定' });
    }
    return false;
  },
  retry(event) {
    if (!this.allowCameraAction() || this.data.billVisible || this.captureActionBusy || this.recognition.snapshot().busy) return Promise.resolve(false);
    if (!this.acceptCaptureInput(event, 'retry')) return Promise.resolve(false);
    if (!this.bindingReady) { this.wantsPreview = true; return this.ensureBinding(); }
    const photo = this.controller.snapshot().photo;
    return photo ? this.runRecognition(photo) : this.openPreview(event);
  },
  retake() {
    if (this.submission?.hasPending() || this.submission?.isBusy() || this.data.reviewBusy) return false;
    if (!this.allowCameraAction() || this.captureActionBusy || this.recognition.snapshot().busy) return false;
    this.discard('retake'); this.wantsPreview = true; return this.maybeOpenPreview();
  },
  capture(event) { return this.data.canRetry ? this.retry(event) : this.confirmCapture(event); },
  discard(reason = 'cancel') {
    this.voice?.cancel(); this.drafts?.cancel(); this.submission?.cancel();
    this.setData({ reviewBusy: false, voiceActive: false, voiceState: 'idle', voiceTranscript: '', voiceScrollTop: 0 });
    this.wantsPreview = false; this.pendingKeyAction = null; this.lastCaptureInput = null; this.captureRun++; this.captureActionBusy = false;
    this.cancelBinding(); this.recognition?.cancel(); this.controller?.discard(reason); this.photoDisplay?.clear();
  },
};
</script>
<page>
<view class="bill-screen" ink:if="{{billVisible}}">
<view class="bill-fields" ink:if="{{!voiceActive}}">
  <view class="bill-row merchant-row"><text class="field-label">商户：</text><scroll-view class="field-value merchant-value" scroll-y="true"><text class="field-text merchant-text">{{bill.merchant}}</text></scroll-view></view>
  <view class="bill-row amount-row">
    <view class="amount-field"><text class="field-label">金额：</text><scroll-view class="field-value" scroll-x="true"><view class="total"><text class="currency">{{bill.currencySymbol}}</text><text class="amount">{{bill.amountText}}</text><text class="currency-code" ink:if="{{bill.currencyCode}}">({{bill.currencyCode}})</text><text class="currency-notice" ink:if="{{bill.currencyNotice}}">{{bill.currencyNotice}}</text></view></scroll-view></view>
    <view class="category-field"><text class="field-label">分类：</text><scroll-view class="field-value" scroll-x="true"><text class="field-text">{{bill.category}}</text></scroll-view></view>
  </view>
  <view class="bill-row date-row"><text class="field-label">时间：</text><scroll-view class="field-value" scroll-x="true"><text class="field-text">{{bill.expenseDate}}</text></scroll-view></view>
  <view class="bill-row account-row"><text class="field-label">账户：</text><scroll-view class="field-value" scroll-x="true"><text class="field-text">{{bill.account}}</text></scroll-view></view>
</view>
<view class="voice-panel" ink:if="{{voiceActive}}"><text class="voice-title">{{voiceState === 'listening' ? '正在收音' : voiceState === 'stopping' ? '正在结束收音' : '正在分析语音'}}</text><text class="voice-hint">{{voiceState === 'listening' ? '说完后单击「结束收音」' : '已停止收音，正在处理完整文字'}}</text><scroll-view class="voice-transcript" scroll-y="true" scroll-top="{{voiceScrollTop}}"><text class="voice-text">{{voiceTranscript || '等待说话…'}}</text></scroll-view></view>
<scroll-view class="review-feedback" scroll-y="true" ink:if="{{!voiceActive && (reviewMessage || writeAuthorizationUrl || voiceTranscript)}}"><text class="review-message">{{reviewMessage}}</text><text class="review-transcript" ink:if="{{voiceTranscript}}">识别：{{voiceTranscript}}</text><text class="authorization-url" ink:if="{{writeAuthorizationUrl}}">{{writeAuthorizationUrl}}</text></scroll-view>
<view class="review-actions"><button class="{{selectedAction === 'voice' ? 'selected' : ''}}" bindtap="voiceEdit" disabled="{{(reviewBusy && voiceState !== 'listening') || submissionPending || submissionState === 'succeeded'}}">{{voiceState === 'listening' ? '结束收音' : voiceState === 'stopping' ? '结束中…' : voiceState === 'correcting' ? '正在分析' : '语音修改'}}</button><button class="{{selectedAction === 'draft' ? 'selected' : ''}}" bindtap="saveDraft" disabled="{{(reviewBusy && !voiceActive) || submissionPending || submissionState === 'succeeded'}}">{{voiceActive ? '取消' : '草稿'}}</button><button class="{{selectedAction === 'confirm' ? 'selected' : ''}}" bindtap="submitBill" disabled="{{reviewBusy}}">{{submissionState === 'succeeded' || submissionState === 'conflict' ? '继续拍摄' : '确认'}}</button></view>
</view>
<view class="{{billVisible ? 'screen screen-hidden' : 'screen'}}">
<view class="authorization" ink:if="{{authorizationVisible}}"><text class="hint">请先绑定知产</text><text class="authorization-url">{{authorizationUrl}}</text><text class="authorization-code">{{authorizationCode}}</text><text class="hint">手机核对绑定码，允许识别并保存原图</text></view>
<view class="preview-frame" ink:if="{{bindingState === 'bound' && !billVisible && !photoVisible && !authorizationVisible}}" bindtap="capture"><video ink:for="{{previewItems}}" ink:key="id" data-session="{{item.id}}" src="{{item.src}}" class="viewfinder" autoplay="true" muted="true" object-fit="contain" bindplaying="previewPlaying" binderror="previewError"></video></view>
<canvas id="captured-photo" width="400" height="180" class="{{photoVisible && !billVisible && !authorizationVisible ? 'photo-canvas' : 'photo-canvas photo-hidden'}}"></canvas>
<text class="hint" ink:if="{{!billVisible && !authorizationVisible}}">{{message || entryHint}}</text>
<text class="hint" ink:if="{{!billVisible && !authorizationVisible && photoMessage}}">{{photoMessage}}</text>
<button class="retry" ink:if="{{!billVisible && canRetry}}" bindtap="retry" disabled="{{busy}}">{{bindingState === 'failed' ? '重新绑定' : '重试'}}</button>
<button class="retry" ink:if="{{!billVisible && canRetry && photoVisible}}" bindtap="retake" disabled="{{busy}}">重拍</button>
</view></page>
<style>
.screen { width:100%; height:100%; box-sizing:border-box; padding:12px; background-color:#000; color:#40ff5e; display:flex; flex-direction:column; justify-content:center; }
.screen-hidden { height:0; padding:0; overflow:hidden; visibility:hidden; }
.preview-frame { width:400px; max-width:100%; height:180px; flex-shrink:0; align-self:center; }
.viewfinder { width:100%; height:100%; }
.photo-canvas { width:400px; max-width:100%; height:180px; flex-shrink:0; align-self:center; }
.photo-hidden { height:0; visibility:hidden; }
.hint { font-size:16px; text-align:center; margin-top:8px; }
.retry { font-size:16px; margin-top:8px; }
.authorization { display:flex; flex-direction:column; align-items:center; }
.authorization-url { font-size:16px; text-align:center; margin-top:4px; overflow-wrap:anywhere; }
.authorization-code { font-size:40px; font-weight:700; margin-top:8px; }
.bill-screen { width:100%; height:100%; box-sizing:border-box; padding:12px 16px; background-color:#000; color:#40ff5e; font-size:18px; display:flex; flex-direction:column; }
.bill-fields { flex:1; min-height:112px; width:100%; display:flex; flex-direction:column; }
.bill-row { flex:1; min-height:28px; width:100%; display:flex; flex-direction:row; align-items:center; }
.field-label { flex-shrink:0; width:54px; font-size:18px; line-height:28px; }
.field-value { flex:1; min-width:0; height:28px; overflow-x:auto; overflow-y:hidden; }
.field-text { display:block; font-size:18px; line-height:28px; white-space:nowrap; }
/* Bound both the viewport and text leaf; do not depend on intrinsic glyph width. */
.merchant-value { width:0; overflow-x:hidden; overflow-y:auto; }
.merchant-text { width:100%; box-sizing:border-box; padding-right:8px; white-space:pre-wrap; overflow-wrap:anywhere; word-break:break-all; }
.amount-field { width:62%; min-width:0; display:flex; flex-direction:row; align-items:center; }
.category-field { flex:1; min-width:0; margin-left:12px; display:flex; flex-direction:row; align-items:center; }
.total { display:flex; flex-direction:row; align-items:baseline; height:28px; white-space:nowrap; }
.currency { flex-shrink:0; font-size:22px; line-height:28px; font-weight:600; }
.amount { flex-shrink:0; font-size:24px; line-height:28px; font-weight:700; }
.currency-code, .currency-notice { flex-shrink:0; margin-left:4px; font-size:14px; line-height:28px; }
.review-feedback { height:40px; width:100%; flex-shrink:0; overflow-y:auto; }
.review-message { display:block; font-size:14px; line-height:20px; overflow-wrap:anywhere; }
.review-transcript { display:block; font-size:14px; line-height:20px; overflow-wrap:anywhere; white-space:pre-wrap; }
.voice-panel { flex:1; min-height:0; display:flex; flex-direction:column; }
.voice-title { flex-shrink:0; font-size:18px; line-height:24px; }
.voice-hint { flex-shrink:0; font-size:14px; line-height:20px; }
.voice-transcript { flex:1; min-height:24px; width:100%; overflow-y:auto; }
.voice-text { display:block; font-size:18px; line-height:26px; white-space:pre-wrap; overflow-wrap:anywhere; }
.bill-screen .authorization-url { display:block; font-size:14px; line-height:20px; margin-top:0; text-align:left; overflow-wrap:anywhere; }
.review-actions { display:flex; flex-direction:row; flex-shrink:0; padding-top:8px; }
.review-actions button { flex:1; min-width:0; height:36px; font-size:16px; padding:4px 0; border:2px solid #155c24; background-color:#000; color:#40ff5e; }
.review-actions button + button { margin-left:12px; }
.review-actions .selected { border-color:#40ff5e; }
.review-actions button:disabled { opacity:0.4; }
@media (max-height:200px) {
  .bill-screen { padding:4px 12px; }
  .bill-fields { min-height:80px; }
  .bill-row { min-height:20px; }
  .field-label { width:42px; font-size:14px; line-height:20px; }
  .field-value { height:20px; }
  .field-text { font-size:14px; line-height:20px; }
  .total { height:20px; }
  .currency { font-size:18px; line-height:20px; }
  .amount { font-size:20px; line-height:20px; }
  .currency-code, .currency-notice { font-size:12px; line-height:20px; }
  .review-feedback { height:24px; }
  .review-message, .review-transcript, .bill-screen .authorization-url { font-size:12px; line-height:18px; }
  .voice-title { font-size:16px; line-height:20px; }
  .voice-hint { font-size:12px; line-height:18px; }
  .voice-transcript { min-height:20px; }
  .voice-text { font-size:14px; line-height:20px; }
  .review-actions { padding-top:4px; }
  .review-actions button { height:28px; font-size:14px; padding:2px 0; }
}
@media (min-height:160px) and (max-height:200px) {
  .review-feedback { height:36px; }
}
</style>
