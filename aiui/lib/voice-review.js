// Capture starts in the user's activation and has no silence/listening timer.
// Only an explicit stop followed by a complete final transcript can analyze.
export function createVoiceReview({ speechFactory = () => {
  if (typeof globalThis.SpeechRecognition !== 'function') throw new Error('SPEECH_UNSUPPORTED');
  return new globalThis.SpeechRecognition();
}, correct, notify = () => {}, timeout = 10_000 } = {}) {
  let generation = 0, pending = null, requestStop = null, busy = false, closed = false, lastTranscript = '';
  function cancel() {
    const wasBusy = busy;
    generation++;
    pending?.(); pending = null; requestStop = null; busy = false;
    if (wasBusy && !closed) notify({ state: 'cancelled', busy: false, transcript: lastTranscript });
  }
  return {
    stop() { return requestStop?.() ?? false; },
    async run(values, context = {}) {
      if (closed || busy) return false;
      busy = true; lastTranscript = '';
      const current = ++generation, controller = new AbortController();
      const active = () => !closed && current === generation;
      let speech;
      try {
        notify({ state: 'listening', busy: true, transcript: '' });
        const transcript = await new Promise((resolve, reject) => {
          let finished = false, stopRequested = false, timer, segments = [];
          const text = finalOnly => segments.filter(item => item && (!finalOnly || item.final)).map(item => item.text).filter(Boolean).join(' ').trim();
          const finish = (value, failure) => {
            if (finished) return;
            finished = true; clearTimeout(timer);
            if (speech) {
              speech.onresult = speech.onerror = speech.onend = null;
              try { speech.abort(); } catch {}
            }
            failure ? reject(new Error(failure)) : resolve(value);
          };
          pending = () => { controller.abort(); finish('', 'CANCELLED'); };
          speech = speechFactory();
          speech.lang = 'zh-CN'; speech.continuous = true; speech.interimResults = true;
          speech.onresult = event => {
            if (finished || !active()) return;
            // The API supplies cumulative indexed results. Replace the snapshot
            // so revised interim text and repeated events are never appended twice.
            const next = [];
            for (let i = 0; i < (event.results?.length || 0); i++) {
              const result = event.results[i];
              if (typeof result?.[0]?.transcript === 'string') next[i] = { text: result[0].transcript.trim(), final: result.isFinal === true };
            }
            segments = next;
            lastTranscript = text(false);
            if (lastTranscript.length > 1000) { finish('', 'SPEECH_TOO_LONG'); return; }
            notify({ state: stopRequested ? 'stopping' : 'listening', busy: true, transcript: lastTranscript });
          };
          speech.onerror = event => {
            const codes = { 'not-allowed': 'SPEECH_PERMISSION', 'service-not-allowed': 'SPEECH_PERMISSION', 'audio-capture': 'SPEECH_MICROPHONE', network: 'SPEECH_NETWORK', 'language-not-supported': 'SPEECH_LANGUAGE', 'no-speech': 'SPEECH_EMPTY' };
            finish('', codes[event.error] || 'SPEECH_FAILED');
          };
          speech.onend = () => {
            if (finished || !active()) return;
            if (!stopRequested) { finish('', 'SPEECH_ENDED'); return; }
            const finalText = text(true);
            if (segments.some(item => item?.text && !item.final)) { finish('', 'SPEECH_INCOMPLETE'); return; }
            if (!finalText) { finish('', 'SPEECH_EMPTY'); return; }
            lastTranscript = finalText;
            finish(finalText);
          };
          requestStop = () => {
            if (finished || stopRequested || !active()) return false;
            stopRequested = true;
            notify({ state: 'stopping', busy: true, transcript: lastTranscript });
            // The timeout only bounds flushing after the user stops; it never
            // ends an active recording or submits a partial utterance.
            timer = setTimeout(() => finish('', 'SPEECH_TIMEOUT'), timeout);
            try { speech.stop(); }
            catch { finish('', 'SPEECH_FAILED'); }
            return true;
          };
          try { speech.start(); }
          catch (failure) { finish('', failure?.name === 'NotAllowedError' ? 'SPEECH_PERMISSION' : 'SPEECH_FAILED'); }
        });
        if (!active()) return false;
        requestStop = null; pending = () => controller.abort();
        notify({ state: 'correcting', busy: true, transcript });
        const result = await correct({ ...values }, transcript, { ...context, signal: controller.signal });
        if (!active()) return false;
        if (!result || typeof result.values !== 'object' || !Array.isArray(result.changedFields) || !Array.isArray(result.warnings)) throw new Error('INVALID_RESULT');
        const keys = ['amount', 'expenseDate', 'currencyCode', 'merchant', 'category', 'accountId', 'accountName', 'note'];
        const limits = [32, 10, 3, 150, 40, 36, 150, 2000];
        if (Object.keys(result.values).length !== keys.length || keys.some((key, i) => typeof result.values[key] !== 'string' || result.values[key].length > limits[i]) || result.changedFields.some(key => !keys.includes(key)) || result.warnings.length > 10 || result.warnings.some(value => typeof value !== 'string' || value.length > 200)) throw new Error('INVALID_RESULT');
        notify({ state: 'corrected', busy: false, transcript, result });
        return result;
      } catch (failure) {
        if (active()) notify({ state: 'failed', busy: false, transcript: lastTranscript, error: failure?.message || 'SPEECH_FAILED' });
        return false;
      } finally {
        if (speech) { speech.onresult = speech.onerror = speech.onend = null; try { speech.abort(); } catch {} }
        if (active()) { pending = null; requestStop = null; busy = false; }
      }
    },
    cancel,
    close() { cancel(); closed = true; lastTranscript = ''; },
  };
}
