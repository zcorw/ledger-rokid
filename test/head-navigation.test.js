import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeadNavigation, createPageOrientationSensor } from '../aiui/lib/head-navigation.js';
const identity = [0, 0, 0, 1];
const rotation = (axis, degrees) => { const q = [0, 0, 0, Math.cos(degrees * Math.PI / 360)]; q[axis] = Math.sin(degrees * Math.PI / 360); return q; };
function multiply([a,b,c,d], [x,y,z,w]) { return [d*x+a*w+b*z-c*y, d*y-a*z+b*w+c*x, d*z+a*y-b*x+c*w, d*w-a*x-b*y-c*z]; }
function fixture() {
  let time = 0, timerId = 0; const directions = [], failures = [], statuses = [], listeners = new Map(), timers = new Map();
  const sensor = { starts: 0, stops: 0, quaternion: null, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); }, start() { this.starts++; }, stop() { this.stops++; } };
  const navigation = createHeadNavigation({ sensorFactory: () => sensor, onDirection: value => directions.push(value), onUnavailable: detail => failures.push(detail.reason), onStatus: state => statuses.push(state), now: () => time, schedule: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; }, unschedule: id => timers.delete(id) });
  const emit = (q, elapsed = 0) => { time += elapsed; sensor.quaternion = q; listeners.get('reading')?.(); };
  const calibrate = (origin = identity) => { emit(origin); emit(origin, 300); };
  const move = q => { emit(q, 10); emit(q, 130); };
  const neutral = (origin = identity) => { emit(origin, 10); emit(origin, 160); };
  const watch = elapsed => { time += elapsed; const [id, next] = timers.entries().next().value; timers.delete(id); next.fn(); };
  const event = (payload, elapsed = 0) => { time += elapsed; listeners.get('reading')?.(payload); };
  return { navigation, sensor, directions, failures, statuses, listeners, timers, watch, event, emit, calibrate, move, neutral };
}
test('relative head pitch/yaw maps all four directions independently of the starting world orientation', () => {
  const origin = multiply(rotation(2, 37), rotation(0, -65));
  for (const [q, direction] of [[rotation(0, 18), 'up'], [rotation(0, -18), 'down'], [rotation(1, 18), 'left'], [rotation(1, -18), 'right']]) {
    const f = fixture(); f.navigation.start(); f.calibrate(origin);
    f.move(multiply(origin, q)); assert.deepEqual(f.directions, [direction]); f.navigation.stop();
  }
});
test('holding a pose cannot repeat; returning to neutral must be sustained before another move', () => {
  const f = fixture(); f.navigation.start(); f.calibrate(); f.move(rotation(0, -18));
  for (let i = 0; i < 20; i++) f.emit(rotation(0, -25), 100);
  assert.deepEqual(f.directions, ['down']);
  f.emit(identity, 10); f.emit(identity, 70); f.move(rotation(0, 18)); assert.deepEqual(f.directions, ['down']);
  f.neutral(); f.move(rotation(0, 18)); assert.deepEqual(f.directions, ['down', 'up']); f.navigation.stop();
});
test('small movements, roll, diagonal uncertainty and brief excursions do not navigate', () => {
  const f = fixture(); f.navigation.start(); f.calibrate();
  for (const q of [rotation(0, 8), rotation(1, 8), rotation(2, 40), multiply(rotation(0, 18), rotation(1, 18))]) { f.move(q); f.neutral(); }
  f.emit(rotation(0, 20), 10); f.emit(rotation(0, 20), 80); f.emit(identity, 10);
  assert.deepEqual(f.directions, []); f.navigation.stop();
});
test('calibration waits for quiet readings and accepts normalized sign-equivalent quaternions', () => {
  const f = fixture(); f.navigation.start(); f.emit(identity);
  f.emit(rotation(0, 15), 100); f.emit(identity, 100); f.emit(identity, 100);
  assert.deepEqual(f.directions, []);
  f.emit(identity.map(n => -2*n), 160); f.move(rotation(1, -20).map(n => -2*n));
  assert.deepEqual(f.directions, ['right']); f.navigation.stop();
});
test('missing, zero and non-finite quaternion readings never become directions', () => {
  const f = fixture(); f.navigation.start(); f.calibrate();
  for (const q of [null, [], [0,0,0,0], [0,NaN,0,1], [0,0,Infinity,1]]) f.emit(q, 1000);
  assert.deepEqual(f.directions, []); f.move(rotation(0, 18)); assert.deepEqual(f.directions, ['up']); f.navigation.stop();
});
test('sensor start is idempotent and stopped or failed sessions ignore late events', () => {
  const f = fixture(); assert.equal(f.navigation.start(), true); f.navigation.start(); assert.equal(f.sensor.starts, 1);
  f.calibrate(); const lateReading = f.listeners.get('reading'), lateError = f.listeners.get('error');
  f.navigation.stop(); assert.equal(f.sensor.stops, 1); assert.equal(f.listeners.size, 0);
  lateError(); lateReading(); assert.deepEqual(f.failures, []); assert.deepEqual(f.directions, []);
  f.navigation.start(); f.calibrate(); lateError(); assert.deepEqual(f.failures, []);
  f.listeners.get('error')(); assert.equal(f.sensor.stops, 2); assert.deepEqual(f.failures, ['sensor']);
  assert.equal(f.navigation.start(), false); assert.equal(f.sensor.starts, 2);
  lateReading(); assert.deepEqual(f.directions, []); f.navigation.stop();
});
test('unsupported hosts fail explicitly without repeated construction or background retries', () => {
  let attempts = 0, failures = 0;
  const n = createHeadNavigation({ sensorFactory: () => { attempts++; throw new Error('unsupported'); }, onDirection: () => assert.fail('no navigation'), onUnavailable: () => failures++ });
  assert.equal(n.start(), false); assert.equal(n.start(), false); assert.equal(attempts, 1); assert.equal(failures, 1); n.stop();
});
test('event quaternion and x/y/z/w payloads work before the instance property is updated', () => {
  const f = fixture(); f.navigation.start(); assert.equal(f.sensor.quaternion, null);
  f.event({ quaternion: identity }); f.event({ quaternion: identity }, 300);
  const [x,y,z,w] = rotation(1, -20);
  f.event({ x,y,z,w }, 10); f.event({ x,y,z,w }, 130);
  assert.deepEqual(f.directions, ['right']); assert.equal(f.sensor.quaternion, null);
  assert.ok(f.statuses.some(s => s.state === 'ready')); f.navigation.stop();
});
test('silent and invalid first readings time out instead of looking active forever', () => {
  for (const [invalid, reason] of [[false, 'no_data'], [true, 'invalid']]) {
    const f = fixture(); f.navigation.start(); if (invalid) f.emit(null);
    assert.equal(f.statuses.at(-1).state, 'waiting'); f.watch(3000);
    assert.deepEqual(f.failures, [reason]); assert.equal(f.statuses.at(-1).reason, reason);
    assert.equal(f.timers.size, 0); assert.equal(f.listeners.size, 0); assert.equal(f.sensor.stops, 1); assert.equal(f.navigation.start(), false);
    f.navigation.stop();
  }
});
test('the watchdog tracks the last valid reading, detects a stall and is canceled on stop', () => {
  const f = fixture(); f.navigation.start(); f.emit(identity, 2500); f.watch(500);
  assert.deepEqual(f.failures, []); assert.equal([...f.timers.values()][0].delay, 2500);
  f.watch(2500); assert.deepEqual(f.failures, ['stalled']); f.navigation.stop();
  f.navigation.start(); const late = [...f.timers.values()][0].fn; f.navigation.stop(); late();
  assert.deepEqual(f.failures, ['stalled']); assert.equal(f.timers.size, 0);
});
test('cached readings are accepted only for an activated session, and status updates are bounded', () => {
  const f = fixture(); f.sensor.activated = true; f.sensor.hasReading = true; f.sensor.quaternion = identity; f.navigation.start();
  assert.equal(f.statuses.at(-1).state, 'calibrating'); f.emit(identity, 300); assert.equal(f.statuses.at(-1).state, 'ready');
  const before = f.statuses.length; for (let i=0;i<10;i++) f.emit(rotation(0, 2), 20);
  assert.equal(f.statuses.length, before); f.emit(rotation(0, 3), 400); assert.equal(f.statuses.at(-1).pitch, 3); f.navigation.stop();
  f.sensor.activated = false; f.navigation.start(); assert.equal(f.statuses.at(-1).state, 'waiting'); f.navigation.stop();
});
test('page world awareness owns startup/cleanup; missing or failed page APIs fall back cleanly', () => {
  const handlers = new Map(); let starts=0, stops=0, enables=0, disables=0, fallbacks=0;
  const native = { addEventListener: (type, fn) => handlers.set(type,fn), removeEventListener: type => handlers.delete(type), start() { starts++; }, stop() { stops++; }, quaternion: identity };
  const page = { enableWorldAwareness() { enables++; this.orientationSensor = native; native.start(); }, disableWorldAwareness() { disables++; native.stop(); } };
  const sensor = createPageOrientationSensor(page, () => { fallbacks++; return native; });
  sensor.addEventListener('reading', () => {}); sensor.start(); assert.equal(starts,1); assert.equal(enables,1); assert.equal(fallbacks,0);
  assert.deepEqual(sensor.quaternion, identity); sensor.removeEventListener('reading'); sensor.stop(); assert.equal(disables,1); assert.equal(stops,1); assert.equal(handlers.size,0);
  assert.equal(createPageOrientationSensor({}, () => { fallbacks++; return native; }), native);
  assert.equal(createPageOrientationSensor({ enableWorldAwareness() { throw Error('host'); }, disableWorldAwareness() { disables++; } }, () => { fallbacks++; return native; }), native);
  assert.equal(fallbacks,2); assert.equal(disables,2);
});
