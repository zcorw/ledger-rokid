// Decode only a completed photo. Keep binary data outside page bindings and
// invalidate pending decodes when the user clears, retakes, or leaves the page.
export function createPhotoDisplayController({ decode, contextFactory, notify = () => {}, width = 400, height = 180 }) {
  let generation = 0, closed = false, photo = null, context = null;
  let state = 'idle', error = '';
  const snapshot = () => ({ state, error });
  function emit(next, detail = '') {
    state = next; error = detail;
    if (!closed) notify(snapshot());
  }
  function clearCanvas() {
    const previous = context; context = null;
    if (!previous) return;
    try { previous.clearRect(0, 0, width, height); previous.flush(); } catch {}
  }
  return {
    snapshot,
    async show(nextPhoto) {
      if (closed || !nextPhoto) return false;
      if (photo === nextPhoto) return state === 'visible';
      photo = nextPhoto;
      const current = ++generation;
      clearCanvas();
      let bitmap;
      try {
        emit('loading');
        bitmap = await decode(nextPhoto);
        if (closed || current !== generation) return false;
        if (!Number.isFinite(bitmap?.width) || bitmap.width <= 0 || !Number.isFinite(bitmap?.height) || bitmap.height <= 0) throw new Error('照片解码未返回有效尺寸');
        const ctx = contextFactory();
        if (!ctx || typeof ctx.drawImage !== 'function' || typeof ctx.clearRect !== 'function' || typeof ctx.flush !== 'function') throw new Error('运行时未提供照片画布接口');
        context = ctx;
        const scale = Math.min(width / bitmap.width, height / bitmap.height);
        const drawnWidth = bitmap.width * scale, drawnHeight = bitmap.height * scale;
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(bitmap, (width - drawnWidth) / 2, (height - drawnHeight) / 2, drawnWidth, drawnHeight);
        ctx.flush();
        emit('visible');
        return true;
      } catch (failure) {
        if (!closed && current === generation) {
          clearCanvas();
          emit('failed', String(failure?.errMsg || failure?.message || failure || '未提供错误详情').replace(/[\r\n\t]+/g, ' ').slice(0, 160));
        }
        return false;
      } finally {
        try { bitmap?.close?.(); } catch {}
      }
    },
    clear() {
      if (closed) return;
      generation++; photo = null;
      clearCanvas();
      if (state !== 'idle') emit('idle');
    },
    close() {
      closed = true; generation++; photo = null;
      clearCanvas(); state = 'closed'; error = '';
    },
  };
}
