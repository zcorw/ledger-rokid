// Speech starts synchronously in the user's activation. No audio is stored here.
export function createVoiceReview({ speechFactory = () => {
  if (typeof globalThis.SpeechRecognition !== 'function') throw new Error('SPEECH_UNSUPPORTED');
  return new globalThis.SpeechRecognition();
}, correct, notify = () => {}, timeout = 30_000 } = {}) {
  let generation = 0, pending = null, busy = false, closed = false;
  function cancel() {
    generation++;
    pending?.(); pending = null; busy = false;
  }
  return {
    async run(values) {
      if (closed || busy) return false;
      busy = true; const current = ++generation;
      const active = () => !closed && current === generation;
      const controller = new AbortController();
      let speech;
      try {
        notify({ state: 'listening', busy: true });
        const transcript = await new Promise((resolve, reject) => {
          let finished = false, timer;
          const finish = (text, failure) => {
            if (finished) return;
            finished = true; clearTimeout(timer);
            if (speech) {
              speech.onresult = speech.onerror = speech.onend = null;
              try { speech.abort(); } catch {}
            }
            failure ? reject(new Error(failure)) : resolve(text);
          };
          pending = () => { controller.abort(); finish('', 'CANCELLED'); };
          speech = speechFactory();
          speech.lang = 'zh-CN'; speech.continuous = false; speech.interimResults = false;
          speech.onresult = event => {
            const final = [];
            for (let i = 0; i < (event.results?.length || 0); i++) {
              const result = event.results[i];
              if (result.isFinal && typeof result[0]?.transcript === 'string') final.push(result[0].transcript);
            }
            const text = final.join(' ').trim();
            if (text) finish(text.length <= 1000 ? text : '', text.length > 1000 ? 'SPEECH_TOO_LONG' : null);
          };
          speech.onerror = event => finish('', ['not-allowed', 'service-not-allowed'].includes(event.error) ? 'SPEECH_PERMISSION' : 'SPEECH_FAILED');
          speech.onend = () => finish('', 'SPEECH_EMPTY');
          timer = setTimeout(() => finish('', 'SPEECH_TIMEOUT'), timeout);
          try { speech.start(); }
          catch (failure) { finish('', failure?.name === 'NotAllowedError' ? 'SPEECH_PERMISSION' : 'SPEECH_FAILED'); }
        });
        if (!active()) return false;
        pending = () => controller.abort();
        notify({ state: 'correcting', busy: true });
        const result = await correct({ ...values }, transcript, { signal: controller.signal });
        if (!active()) return false;
        if (!result || typeof result.values !== 'object' || !Array.isArray(result.changedFields) || !Array.isArray(result.warnings)) throw new Error('INVALID_RESULT');
        const keys = ['amount', 'expenseDate', 'currencyCode', 'merchant', 'category', 'accountId', 'accountName', 'note'];
        const limits = [32, 10, 3, 150, 40, 36, 150, 2000];
        if (Object.keys(result.values).length !== keys.length || keys.some((key, i) => typeof result.values[key] !== 'string' || result.values[key].length > limits[i]) || result.changedFields.some(key => !keys.includes(key)) || result.warnings.length > 10 || result.warnings.some(text => typeof text !== 'string' || text.length > 200)) throw new Error('INVALID_RESULT');
        notify({ state: 'corrected', busy: false, result });
        return result;
      } catch (failure) {
        if (active()) notify({ state: 'failed', busy: false, error: failure?.message || 'SPEECH_FAILED' });
        return false;
      } finally {
        if (speech) { speech.onresult = speech.onerror = speech.onend = null; try { speech.abort(); } catch {} }
        if (active()) { pending = null; busy = false; }
      }
    },
    cancel,
    close() { cancel(); closed = true; },
  };
}
