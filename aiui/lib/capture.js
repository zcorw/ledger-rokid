// AIUI native capture is not abortable. Cancellation invalidates the result.
export function createCaptureController({ cameraFactory, notify = () => {} }) {
  let active = false;
  let generation = 0;
  let closed = false;
  let photo = null;
  let state = 'idle';
  function emit(next) { state = next; notify({ state, busy: active, photo }); }
  return {
    snapshot() { return { state, busy: active, photo }; },
    async capture() {
      if (closed || active) return false;
      photo = null;
      active = true;
      const current = ++generation;
      emit('capturing');
      try {
        const camera = cameraFactory();
        if (!camera || typeof camera.takePhoto !== 'function') throw new Error('unsupported');
        const result = await camera.takePhoto({ quality: 'high', mode: 'telephoto', enableSystemPreview: true });
        if (closed || current !== generation) return false;
        if (!(result?.data instanceof ArrayBuffer) || result.data.byteLength === 0 || !['image/jpeg', 'image/png'].includes(result.mimeType)) {
          throw new Error('invalid-image');
        }
        photo = { data: result.data, mimeType: result.mimeType };
        state = 'captured';
        return true;
      } catch (error) {
        if (!closed && current === generation) state = error?.message === 'unsupported' ? 'unsupported' : 'failed';
        return false;
      } finally {
        active = false;
        if (!closed) emit(state);
      }
    },
    discard() {
      generation++;
      photo = null;
      if (!closed) emit('idle');
    },
    close() { generation++; closed = true; photo = null; state = 'closed'; },
  };
}
