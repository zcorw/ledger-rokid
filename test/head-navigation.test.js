import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeadNavigation } from '../aiui/lib/head-navigation.js';
const identity = [0, 0, 0, 1];
const rotation = (axis, degrees) => { const q = [0, 0, 0, Math.cos(degrees * Math.PI / 360)]; q[axis] = Math.sin(degrees * Math.PI / 360); return q; };
function multiply([a,b,c,d], [x,y,z,w]) { return [d*x+a*w+b*z-c*y, d*y-a*z+b*w+c*x, d*z+a*y-b*x+c*w, d*w-a*x-b*y-c*z]; }
function fixture() {
  let time = 0; const directions = [], failures = [], listeners = new Map();
  const sensor = { starts: 0, stops: 0, quaternion: null, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); }, start() { this.starts++; }, stop() { this.stops++; } };
  const navigation = createHeadNavigation({ sensorFactory: () => sensor, onDirection: value => directions.push(value), onUnavailable: () => failures.push(true), now: () => time });
  const emit = (q, elapsed = 0) => { time += elapsed; sensor.quaternion = q; listeners.get('reading')?.(); };
  const calibrate = (origin = identity) => { emit(origin); emit(origin, 300); };
  const move = q => { emit(q, 10); emit(q, 130); };
  const neutral = (origin = identity) => { emit(origin, 10); emit(origin, 160); };
  return { navigation, sensor, directions, failures, listeners, emit, calibrate, move, neutral };
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
  f.listeners.get('error')(); assert.equal(f.sensor.stops, 2); assert.deepEqual(f.failures, [true]);
  assert.equal(f.navigation.start(), false); assert.equal(f.sensor.starts, 2);
  lateReading(); assert.deepEqual(f.directions, []); f.navigation.stop();
});
test('unsupported hosts fail explicitly without repeated construction or background retries', () => {
  let attempts = 0, failures = 0;
  const n = createHeadNavigation({ sensorFactory: () => { attempts++; throw new Error('unsupported'); }, onDirection: () => assert.fail('no navigation'), onUnavailable: () => failures++ });
  assert.equal(n.start(), false); assert.equal(n.start(), false); assert.equal(attempts, 1); assert.equal(failures, 1); n.stop();
});
