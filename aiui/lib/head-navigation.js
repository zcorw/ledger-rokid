// Consume the documented AbsoluteOrientationSensor [x, y, z, w] readings.
// Work relative to a quiet starting pose; no compass heading is needed.
const radians = degrees => degrees * Math.PI / 180;
function normalize(value) {
  if (!value || value.length !== 4 || !Array.from(value).every(Number.isFinite)) return null;
  const length = Math.hypot(...value);
  return length > 1e-6 ? Array.from(value, n => n / length) : null;
}
function relativePose(origin, current) {
  const [ax, ay, az, aw] = origin, [bx, by, bz, bw] = current;
  const x = aw * bx - ax * bw - ay * bz + az * by;
  const y = aw * by + ax * bz - ay * bw - az * bx;
  const z = aw * bz - ax * by + ay * bx - az * bw;
  const w = aw * bw + ax * bx + ay * by + az * bz;
  const forwardX = -2 * (x * z + w * y), forwardY = 2 * (w * x - y * z);
  const forwardZ = 2 * (x * x + y * y) - 1;
  return { pitch: Math.atan2(forwardY, Math.hypot(forwardX, forwardZ)), yaw: Math.atan2(-forwardX, -forwardZ) };
}
const separation = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.reduce((sum, n, i) => sum + n * b[i], 0))));

export function createPageOrientationSensor(page, fallback = () => new globalThis.AbsoluteOrientationSensor({ frequency: 30 })) {
  if (typeof page.enableWorldAwareness !== 'function' || typeof page.disableWorldAwareness !== 'function') return fallback();
  try {
    page.enableWorldAwareness();
    const sensor = page.orientationSensor;
    if (!sensor || typeof sensor.addEventListener !== 'function' || typeof sensor.removeEventListener !== 'function') throw new Error('SENSOR_UNAVAILABLE');
    return {
      get quaternion() { return sensor.quaternion; },
      get hasReading() { return sensor.hasReading; },
      get activated() { return sensor.activated; },
      addEventListener: (type, listener) => sensor.addEventListener(type, listener),
      removeEventListener: (type, listener) => sensor.removeEventListener(type, listener),
      // enableWorldAwareness starts this sensor; do not start it a second time.
      start() {},
      stop: () => page.disableWorldAwareness(),
    };
  } catch {
    try { page.disableWorldAwareness(); } catch {}
    return fallback();
  }
}

export function createHeadNavigation({ onDirection, onUnavailable = () => {}, onStatus = () => {}, now = () => Date.now(), schedule = setTimeout, unschedule = clearTimeout, sensorFactory = () => new globalThis.AbsoluteOrientationSensor({ frequency: 30 }) }) {
  let sensor = null, reading = null, error = null, active = false, failed = false;
  let generation = 0, origin = null, quiet = null, quietSince = 0, armed = true;
  let candidate = null, candidateSince = 0, neutralSince = null;
  let watchdog = null, validAt = null, rawReadings = 0, status = '', statusAt = -Infinity;
  function report(state, detail = {}) {
    const time = now();
    if (state === status && time - statusAt < 500) return;
    status = state; statusAt = time; onStatus({ state, ...detail });
  }
  function resetPose() { origin = null; quiet = null; armed = true; candidate = null; neutralSince = null; }
  function release() {
    active = false; generation++; resetPose();
    if (watchdog !== null) unschedule(watchdog);
    watchdog = null;
    const previous = sensor; sensor = null;
    if (previous) {
      try { previous.removeEventListener('reading', reading); previous.removeEventListener('error', error); } catch {}
      try { previous.stop(); } catch {}
    }
    failed = false;
  }
  function stop() { const hadSession = active || failed; release(); if (hadSession) report('idle'); }
  function consume(value) {
    const pose = normalize(value), time = now();
    if (!pose || !Number.isFinite(time)) { candidate = null; neutralSince = null; quiet = null; return; }
    validAt = time;
    if (!origin) {
      if (!quiet || separation(quiet, pose) > radians(3)) { quiet = pose; quietSince = time; }
      else if (time - quietSince >= 250) origin = pose;
      report(origin ? 'ready' : 'calibrating', { pitch: 0, yaw: 0 });
      return;
    }
    const { pitch, yaw } = relativePose(origin, pose);
    const angles = { pitch: Math.round(pitch * 180 / Math.PI), yaw: Math.round(yaw * 180 / Math.PI) };
    if (Math.abs(pitch) <= radians(5) && Math.abs(yaw) <= radians(5)) {
      candidate = null;
      if (neutralSince === null) neutralSince = time;
      if (time - neutralSince >= 150) armed = true;
      report(armed ? 'ready' : 'neutral', angles);
      return;
    }
    neutralSince = null;
    report(armed ? 'ready' : 'neutral', angles);
    if (!armed) return;
    const vertical = Math.abs(pitch), horizontal = Math.abs(yaw);
    const direction = Math.max(vertical, horizontal) < radians(12) || Math.min(vertical, horizontal) * 1.25 > Math.max(vertical, horizontal)
      ? null : vertical > horizontal ? pitch > 0 ? 'up' : 'down' : yaw > 0 ? 'left' : 'right';
    if (!direction || direction !== candidate) { candidate = direction; candidateSince = time; return; }
    if (time - candidateSince < 120) return;
    armed = false; candidate = null; report('neutral', angles); onDirection(direction);
  }
  return {
    start() {
      if (active || failed) return active;
      resetPose(); validAt = null; rawReadings = 0; const current = ++generation; active = true;
      report('waiting');
      const unavailable = (reason = 'startup') => {
        if (!active || current !== generation) return;
        release(); failed = true; report('unavailable', { reason }); onUnavailable({ reason });
      };
      try {
        sensor = sensorFactory();
        reading = event => {
          if (!active || current !== generation) return;
          rawReadings++;
          // Hosts can deliver the new pose in the event before updating the instance.
          const pose = normalize(event?.quaternion) || normalize([event?.x, event?.y, event?.z, event?.w]) || normalize(sensor.quaternion);
          consume(pose);
        };
        error = () => unavailable('sensor');
        sensor.addEventListener('reading', reading); sensor.addEventListener('error', error); sensor.start();
        if (active && sensor.activated && sensor.hasReading) consume(sensor.quaternion);
        const watch = () => {
          if (!active || current !== generation) return;
          const elapsed = validAt === null ? 3000 : now() - validAt;
          if (elapsed >= 3000) return unavailable(validAt !== null ? 'stalled' : rawReadings ? 'invalid' : 'no_data');
          watchdog = schedule(watch, Math.max(1, 3000 - elapsed));
        };
        if (active) watchdog = schedule(watch, 3000);
        return active;
      } catch { unavailable(); return false; }
    },
    stop,
  };
}
