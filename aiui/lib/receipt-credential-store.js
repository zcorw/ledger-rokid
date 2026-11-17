// Native AIUI storage is isolated by Agent. Never store photos or bills here.
const KEY = 'ledger.receipt.authorization.v1:';

export function createReceiptCredentialStore({ wx, storage } = {}) {
  function backend() {
    if (wx && ['getStorageSync', 'setStorageSync', 'removeStorageSync'].every(name => typeof wx[name] === 'function')) {
      return { get: key => wx.getStorageSync(key), set: (key, value) => wx.setStorageSync(key, value), remove: key => wx.removeStorageSync(key) };
    }
    const local = storage ?? globalThis.localStorage;
    if (!local || !['getItem', 'setItem', 'removeItem'].every(name => typeof local[name] === 'function')) throw new Error('AUTH_STORAGE_UNAVAILABLE');
    return { get: key => local.getItem(key), set: (key, value) => local.setItem(key, value), remove: key => local.removeItem(key) };
  }
  function invoke(method, resource, value) {
    try { return backend()[method](KEY + resource, value); }
    catch (failure) { throw new Error(failure?.message === 'AUTH_STORAGE_UNAVAILABLE' ? failure.message : 'AUTH_STORAGE_FAILED'); }
  }
  return {
    read: resource => invoke('get', resource),
    write: (resource, value) => invoke('set', resource, value),
    remove: resource => invoke('remove', resource),
  };
}
