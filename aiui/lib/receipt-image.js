export const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
function fail(code) { throw new Error(code); }
function check(signal) { if (signal?.aborted) fail('CANCELLED'); }

// Encode from the original photo, never from the 400x180 display canvas.
export async function prepareReceiptImage(photo, { signal, runtime = globalThis } = {}) {
  check(signal);
  if (!(photo?.data instanceof ArrayBuffer) || !photo.data.byteLength) fail('INVALID_PHOTO');
  if (['image/jpeg', 'image/png'].includes(photo.mimeType) && photo.data.byteLength <= MAX_RECEIPT_BYTES) return photo;
  if (!['image/webp', 'image/jpeg', 'image/png'].includes(photo.mimeType)) fail('INVALID_PHOTO');
  if (typeof runtime.Blob !== 'function' || typeof runtime.createImageBitmap !== 'function' || typeof runtime.Canvas !== 'function') fail('IMAGE_ENCODING_UNSUPPORTED');
  let bitmap;
  try {
    bitmap = await runtime.createImageBitmap(new runtime.Blob([photo.data], { type: photo.mimeType }));
    check(signal);
    if (!Number.isFinite(bitmap?.width) || !Number.isFinite(bitmap?.height) || bitmap.width < 1 || bitmap.height < 1 || bitmap.width * bitmap.height > 20_000_000) fail('IMAGE_TOO_LARGE');
    const scale = Math.min(1, 4096 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new runtime.Canvas(width, height), context = canvas.getContext('2d');
    if (!context || typeof context.drawImage !== 'function' || typeof canvas.convertToBlob !== 'function') fail('IMAGE_ENCODING_UNSUPPORTED');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    check(signal);
    if (!blob || !['image/jpeg', 'image/png'].includes(blob.type)) fail('IMAGE_ENCODING_FAILED');
    if (!blob.size || blob.size > MAX_RECEIPT_BYTES) fail('IMAGE_TOO_LARGE');
    const data = await blob.arrayBuffer(); check(signal);
    if (!data.byteLength || data.byteLength > MAX_RECEIPT_BYTES) fail('IMAGE_TOO_LARGE');
    return { data, mimeType: blob.type };
  } catch (error) {
    if (['CANCELLED', 'IMAGE_TOO_LARGE', 'IMAGE_ENCODING_UNSUPPORTED', 'IMAGE_ENCODING_FAILED'].includes(error?.message)) throw error;
    fail('IMAGE_ENCODING_FAILED');
  } finally { try { bitmap?.close?.(); } catch {} }
}
