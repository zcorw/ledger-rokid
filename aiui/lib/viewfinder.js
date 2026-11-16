import { createCaptureController } from './capture.js';

function logTrace(value) { try { console.log('[viewfinder]', value); } catch {} }
function errorMessage(error) { return String(error?.errMsg || error?.message || error || '未提供错误详情').replace(/[\r\n\t]+/g, ' ').slice(0, 160); }

// Preview uses the native video renderer; the shutter uses the verified wx camera.
export function createViewfinderController({ requestStream, createPreviewURL, revokePreviewURL, cameraFactory, runtimeInfo = () => '', notify = () => {} }) {
  let session = null, acquiring = false, closed = false, nextSession = 0;
  let state = 'idle', stage = 'idle', stopReason = '', lastTrace = '';
  let previewFailure = null;
  const capture = createCaptureController({
    cameraFactory: () => {
      const camera = cameraFactory?.();
      if (!camera || typeof camera.takePhoto !== 'function') return undefined;
      return { takePhoto: options => camera.takePhoto({ ...options, enableSystemPreview: false }) };
    },
    notify: ({ state: next }) => {
      state = next;
      if (next === 'capturing') stage = 'take-photo';
      if (next === 'captured') { stage = 'photo-result'; stopReason = 'photo-complete'; }
      emit();
    },
  });
  function snapshot() {
    const result = capture.snapshot();
    return { state, stage, stopReason, busy: acquiring || state === 'opening' || result.busy, photo: result.photo, failure: previewFailure ? { ...previewFailure } : result.failure, preview: session?.url ? { id: session.id, src: session.url } : null };
  }
  function emit() {
    if (closed) return;
    const value = snapshot();
    const trace = JSON.stringify({ state, stage, stopReason, busy: value.busy });
    if (trace !== lastTrace) { logTrace(trace); lastTrace = trace; }
    notify(value);
  }
  function stopTracks(stream) {
    for (const track of stream?.getTracks?.() || []) {
      try { track.stop(); }
      catch (error) { logTrace(JSON.stringify({ stage: 'release-track', message: errorMessage(error) })); }
    }
  }
  function release(current, reason) {
    if (!current || current.closed) return;
    current.closed = true;
    current.track?.removeEventListener?.('ended', current.onEnded);
    stopTracks(current.stream);
    current.stream = null;
    if (current.url) {
      try { revokePreviewURL(current.url); }
      catch (error) { logTrace(JSON.stringify({ stage: 'revoke-preview', message: errorMessage(error) })); }
      current.url = '';
    }
    if (session === current) { session = null; if (reason) stopReason = reason; }
  }
  function fail(current, error) {
    if (closed || current.closed || session !== current) return false;
    const failedStep = stage;
    release(current, 'preview-error');
    stage = 'stopped';
    state = error?.code === 'PREVIEW_UNSUPPORTED' ? 'unsupported' : 'failed';
    let runtime = '';
    try { runtime = errorMessage(runtimeInfo() || '未知运行时').slice(0, 160); } catch {}
    previewFailure = { stage: 'preview', step: failedStep, message: errorMessage(error), runtime };
    emit(); return true;
  }
  async function start() {
    if (closed || acquiring || capture.snapshot().busy || state === 'opening') return false;
    if (session && state === 'previewing') return true;
    stopReason = ''; stage = 'idle'; previewFailure = null;
    capture.discard();
    const current = { id: ++nextSession, closed: false, stream: null, url: '', playing: false, track: null };
    session = current; acquiring = true; state = 'opening'; stage = 'request-stream'; emit();
    try {
      const stream = await requestStream({ audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 10 } } });
      if (closed || current.closed || session !== current) { stopTracks(stream); return false; }
      current.stream = stream;
      current.track = stream.getVideoTracks()[0];
      if (!current.track || current.track.readyState === 'ended') throw new Error('没有可用的视频轨道');
      current.onEnded = () => fail(current, new Error('摄像头连接已结束，请重新打开预览'));
      current.track.addEventListener?.('ended', current.onEnded);
      stage = 'create-preview-url'; emit();
      current.url = createPreviewURL(stream);
      if (typeof current.url !== 'string' || !current.url) throw new Error('运行时未返回有效的摄像头预览地址');
      // MediaStream video can render without delivering a playing event on the
      // glasses. Publish its URL and let the user confirm after viewing it,
      // following the native scanner sample; playing is diagnostic only.
      state = 'previewing'; stage = 'preview-attached';
      emit(); return true;
    } catch (error) {
      fail(current, error); return false;
    } finally { acquiring = false; emit(); }
  }
  function markPlaying(id) {
    const current = session;
    if (closed || !current?.url || current.closed || current.id !== Number(id) || state !== 'previewing' || current.playing) return false;
    current.playing = true; stage = 'preview-playing'; emit(); return true;
  }
  function confirm() {
    if (closed || snapshot().busy || state !== 'previewing' || !session) return Promise.resolve(false);
    // Release the preview before acquiring the still-photo camera context.
    release(session, 'confirmed'); previewFailure = null;
    return capture.capture();
  }
  return {
    snapshot, start, markPlaying, confirm,
    videoError(id, error) { return session?.id === Number(id) ? fail(session, error) : false; },
    capture() { return state === 'previewing' ? confirm() : start(); },
    discard(reason = 'cancel') { release(session, reason); stopReason = reason; stage = 'stopped'; previewFailure = null; capture.discard(); },
    close(reason = 'unload') {
      closed = true; release(session, reason); stopReason = reason; stage = 'stopped'; previewFailure = null; capture.close(); state = 'closed';
      logTrace(JSON.stringify({ state, stage, stopReason }));
    },
  };
}
