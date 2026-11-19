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

export function createHeadNavigation({ onDirection, onUnavailable = () => {}, now = () => Date.now(), sensorFactory = () => new globalThis.AbsoluteOrientationSensor({ frequency: 30 }) }) {
  let sensor = null, reading = null, error = null, active = false, failed = false;
  let generation = 0, origin = null, quiet = null, quietSince = 0, armed = true;
  let candidate = null, candidateSince = 0, neutralSince = null;
  function resetPose() { origin = null; quiet = null; armed = true; candidate = null; neutralSince = null; }
  function stop() {
    active = false; generation++; resetPose();
    const previous = sensor; sensor = null;
    if (previous) {
      try { previous.removeEventListener('reading', reading); previous.removeEventListener('error', error); } catch {}
      try { previous.stop(); } catch {}
    }
    failed = false;
  }
  function consume(value) {
    const pose = normalize(value), time = now();
    if (!pose || !Number.isFinite(time)) { candidate = null; neutralSince = null; quiet = null; return; }
    if (!origin) {
      if (!quiet || separation(quiet, pose) > radians(3)) { quiet = pose; quietSince = time; }
      else if (time - quietSince >= 250) origin = pose;
      return;
    }
    const { pitch, yaw } = relativePose(origin, pose);
    if (Math.abs(pitch) <= radians(5) && Math.abs(yaw) <= radians(5)) {
      candidate = null;
      if (neutralSince === null) neutralSince = time;
      if (time - neutralSince >= 150) armed = true;
      return;
    }
    neutralSince = null;
    if (!armed) return;
    const vertical = Math.abs(pitch), horizontal = Math.abs(yaw);
    const direction = Math.max(vertical, horizontal) < radians(12) || Math.min(vertical, horizontal) * 1.25 > Math.max(vertical, horizontal)
      ? null : vertical > horizontal ? pitch > 0 ? 'up' : 'down' : yaw > 0 ? 'left' : 'right';
    if (!direction || direction !== candidate) { candidate = direction; candidateSince = time; return; }
    if (time - candidateSince < 120) return;
    armed = false; candidate = null; onDirection(direction);
  }
  return {
    start() {
      if (active || failed) return active;
      resetPose(); const current = ++generation; active = true;
      const unavailable = () => {
        if (!active || current !== generation) return;
        stop(); failed = true; onUnavailable();
      };
      try {
        sensor = sensorFactory();
        reading = () => { if (active && current === generation) consume(sensor.quaternion); };
        error = unavailable;
        sensor.addEventListener('reading', reading); sensor.addEventListener('error', error); sensor.start();
        return active;
      } catch { unavailable(); return false; }
    },
    stop,
  };
}
