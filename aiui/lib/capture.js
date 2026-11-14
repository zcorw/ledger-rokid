// AIUI native capture is not abortable. Cancellation invalidates the result.
function errorText(value) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/[\r\n\t]+/g, ' ').slice(0, 160)
    : '';
}
export function createCaptureController({ cameraFactory, notify = () => {} }) {
  let active = false;
  let generation = 0;
  let closed = false;
  let photo = null;
  let state = 'idle';
  let failure = null;
  const snapshot = () => ({ state, busy: active, photo, failure: failure ? { ...failure } : null });
  function emit(next) { state = next; notify(snapshot()); }
  return {
    snapshot,
    async capture() {
      if (closed || active) return false;
      photo = null;
      failure = null;
      active = true;
      const current = ++generation;
      emit('capturing');
      let stage = 'camera';
      let result;
      try {
        const camera = cameraFactory();
        if (!camera || typeof camera.takePhoto !== 'function') throw new Error('unsupported');
        stage = 'takePhoto';
        result = await camera.takePhoto({ quality: 'high', mode: 'telephoto', enableSystemPreview: true });
        if (closed || current !== generation) return false;
        stage = 'validate';
        if (!(result?.data instanceof ArrayBuffer) || result.data.byteLength === 0 || !['image/jpeg', 'image/png', 'image/webp'].includes(result.mimeType)) {
          throw new Error('invalid-image');
        }
        photo = { data: result.data, mimeType: result.mimeType };
        state = 'captured';
        return true;
      } catch (error) {
        if (!closed && current === generation) {
          state = error?.message === 'unsupported' ? 'unsupported' : 'failed';
          failure = {
            stage,
            name: errorText(error?.name),
            code: errorText(error?.code ?? error?.errCode),
            message: errorText(error?.errMsg) || errorText(error?.message) || errorText(error) || '未提供错误详情',
          };
          if (stage === 'validate') Object.assign(failure, {
            resultType: Object.prototype.toString.call(result).slice(8, -1),
            dataType: Object.prototype.toString.call(result?.data).slice(8, -1),
            isArrayBuffer: result?.data instanceof ArrayBuffer,
            byteLength: typeof result?.data?.byteLength === 'number' ? result.data.byteLength : null,
            mimeType: errorText(result?.mimeType) || '未返回',
          });
        }
        return false;
      } finally {
        active = false;
        if (!closed) emit(state);
      }
    },
    discard() {
      generation++;
      photo = null;
      failure = null;
      if (!closed) emit('idle');
    },
    close() { generation++; closed = true; photo = null; failure = null; state = 'closed'; },
  };
}
