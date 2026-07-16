/**
 * Headless flight-dynamics test harness. Runs the physics engine standalone (no browser/WebXR
 * needed) so behavior can be validated on a machine with no headset attached. Run with:
 *   npx tsx scripts/simTest.ts
 *
 * This is the ground-truth check for stick-direction sign conventions (derived by hand in
 * QuadcopterPhysics.ts, verified here empirically) plus general stability/sanity checks.
 */
import { Vector3 } from 'three';
import { QuadcopterPhysics, ControlInput } from '../src/physics/QuadcopterPhysics';
import { FIXED_DT, MASS, GRAVITY, MAX_THRUST_PER_MOTOR } from '../src/physics/constants';

let failures = 0;
let passed = 0;

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}  ${detail}`);
  }
}

// In ANGLE mode, throttle=0.5 is the centered "hold altitude" stick position (see
// ControlInput.throttle docs). In ACRO mode, throttle is direct/manual 0..1 thrust.
const ANGLE_CENTER = 0.5;
const ACRO_HOVER_THROTTLE = (MASS * GRAVITY) / (MAX_THRUST_PER_MOTOR * 4); // == 0.5 given T/W=2.0

function neutralInput(overrides: Partial<ControlInput> = {}): ControlInput {
  return { throttle: ANGLE_CENTER, pitch: 0, roll: 0, yaw: 0, armed: true, flightMode: 'ANGLE', ...overrides };
}

function runSteps(q: QuadcopterPhysics, input: ControlInput, seconds: number, floorY = -100): void {
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    q.step(FIXED_DT, input, floorY);
  }
}

function assertNoNaN(q: QuadcopterPhysics, label: string): void {
  const t = q.getTelemetry(0);
  const bad =
    !isFinite(t.position.x) || !isFinite(t.position.y) || !isFinite(t.position.z) ||
    !isFinite(t.velocity.x) || !isFinite(t.velocity.y) || !isFinite(t.velocity.z) ||
    !isFinite(t.quaternion.x) || !isFinite(t.quaternion.y) || !isFinite(t.quaternion.z) || !isFinite(t.quaternion.w);
  check(`${label}: no NaN/Infinity`, !bad, JSON.stringify(t.position));
}

console.log('\n=== Test 1: Hover equilibrium (ANGLE/alt-hold mode, centered throttle, no stick) ===');
{
  const q = new QuadcopterPhysics();
  q.reset();
  q.setArmed(true);
  runSteps(q, neutralInput(), 5, -100);
  assertNoNaN(q, 'hover');
  const t = q.getTelemetry(0);
  check('hover: altitude holds close to start (within 0.15m after 5s)', Math.abs(t.position.y - 1) < 0.15, `y=${t.position.y.toFixed(3)}`);
  check('hover: near-zero vertical velocity', Math.abs(t.velocity.y) < 0.1, `vy=${t.velocity.y.toFixed(3)}`);
  check('hover: horizontal drift small', Math.hypot(t.velocity.x, t.velocity.z) < 0.3, `vx=${t.velocity.x.toFixed(3)} vz=${t.velocity.z.toFixed(3)}`);
}

console.log('\n=== Test 2: ACRO mode, zero throttle + armed -> free-falls under gravity ===');
{
  const q = new QuadcopterPhysics();
  q.reset();
  q.setArmed(true);
  const startY = q.position.y;
  runSteps(q, neutralInput({ throttle: 0, flightMode: 'ACRO' }), 1, -100);
  assertNoNaN(q, 'freefall-armed-zero-throttle');
  check('falls when throttle=0 (ACRO/manual)', q.position.y < startY - 1, `y=${q.position.y.toFixed(3)}`);
}

console.log('\n=== Test 3: Disarmed -> free-falls regardless of stick ===');
{
  const q = new QuadcopterPhysics();
  q.reset();
  q.setArmed(false);
  const startY = q.position.y;
  runSteps(q, neutralInput({ throttle: 1, armed: false }), 1, -100);
  check('disarmed falls even with throttle=1 commanded', q.position.y < startY - 1, `y=${q.position.y.toFixed(3)}`);
}

console.log('\n=== Test 4: Forward pitch stick -> drone moves forward (-Z) ===');
{
  const q = new QuadcopterPhysics();
  q.reset();
  q.setArmed(true);
  runSteps(q, neutralInput({ pitch: 0.6 }), 1.5, -100);
  assertNoNaN(q, 'pitch-forward');
  const t = q.getTelemetry(0);
  check('forward-pitch stick moves drone toward -Z (forward)', t.position.z < -0.15, `z=${t.position.z.toFixed(3)} (start was -1)`);
}

console.log('\n=== Test 5: Backward pitch stick -> drone moves backward (+Z) ===');
{
  const q = new QuadcopterPhysics();
  q.reset();
  q.setArmed(true);
  const startZ = q.position.z;
  runSteps(q, neutralInput({ pitch: -0.6 }), 1.5, -100);
  assertNoNaN(q, 'pitch-backward');
  const t = q.getTelemetry(0);
  check('backward-pitch stick moves drone toward +Z (backward)', t.position.z > startZ + 0.15, `z=${t.position.z.toFixed(3)}`);
}

console.log('\n=== Test 6: Right roll stick -> drone moves right (+X) ===');
{
  const q = new QuadcopterPhysics();
  q.reset();
  q.setArmed(true);
  runSteps(q, neutralInput({ roll: 0.6 }), 1.5, -100);
  assertNoNaN(q, 'roll-right');
  const t = q.getTelemetry(0);
  check('right-roll stick moves drone toward +X (right)', t.position.x > 0.15, `x=${t.position.x.toFixed(3)}`);
}

console.log('\n=== Test 7: Left roll stick -> drone moves left (-X) ===');
{
  const q = new QuadcopterPhysics();
  q.reset();
  q.setArmed(true);
  runSteps(q, neutralInput({ roll: -0.6 }), 1.5, -100);
  assertNoNaN(q, 'roll-left');
  const t = q.getTelemetry(0);
  check('left-roll stick moves drone toward -X (left)', t.position.x < -0.15, `x=${t.position.x.toFixed(3)}`);
}

console.log('\n=== Test 8: Right yaw stick -> nose rotates toward +X (clockwise viewed from above) ===');
{
  const q = new QuadcopterPhysics();
  q.reset();
  q.setArmed(true);
  // Forward vector starts at (0,0,-1). After yaw-right, forward.x should become positive.
  runSteps(q, neutralInput({ yaw: 0.6 }), 0.8, -100);
  assertNoNaN(q, 'yaw-right');
  const t = q.getTelemetry(0);
  const forward = new Vector3(0, 0, -1).applyQuaternion(t.quaternion);
  check('right-yaw stick swings nose toward +X', forward.x > 0.1, `forward=(${forward.x.toFixed(3)},${forward.y.toFixed(3)},${forward.z.toFixed(3)})`);
}

console.log('\n=== Test 9: ACRO mode full-deflection stress test stays finite and bounded ===');
{
  const q = new QuadcopterPhysics();
  q.reset();
  q.setArmed(true);
  runSteps(q, neutralInput({ throttle: 0.9, pitch: 1, roll: 1, yaw: 1, flightMode: 'ACRO' }), 3, -100);
  assertNoNaN(q, 'acro-stress');
  const t = q.getTelemetry(0);
  check('acro stress: angular velocity bounded (< 50 rad/s)', t.angularVelocity.length() < 50, `|w|=${t.angularVelocity.length().toFixed(2)}`);
  check('acro stress: speed bounded (< 50 m/s)', t.speedMs < 50, `speed=${t.speedMs.toFixed(2)}`);
}

console.log('\n=== Test 10: Hard floor impact (ACRO, motors off, free fall from 3m) bounces but stays armed ===');
{
  const q = new QuadcopterPhysics();
  q.reset(new Vector3(0, 3, 0));
  q.setArmed(true);
  runSteps(q, neutralInput({ throttle: 0, flightMode: 'ACRO' }), 2, 0);
  assertNoNaN(q, 'hard-floor-impact');
  const t = q.getTelemetry(0);
  check('hard impact does not disarm', t.armed === true, `armed=${t.armed} y=${t.position.y.toFixed(3)}`);
  check('hard impact settles to rest near the floor', t.position.y < 0.3, `y=${t.position.y.toFixed(3)}`);
}

console.log('\n=== Test 11: Gentle landing (ACRO, slightly below hover throttle) stays armed ===');
{
  const q = new QuadcopterPhysics();
  q.reset(new Vector3(0, 0.5, 0));
  q.setArmed(true);
  runSteps(q, neutralInput({ throttle: ACRO_HOVER_THROTTLE * 0.85, flightMode: 'ACRO' }), 3, 0);
  const t = q.getTelemetry(0);
  check('gentle descent stays armed', t.armed === true, `armed=${t.armed}`);
}

console.log('\n=== Test 12: Alt-hold climb command (throttle > 0.5) increases altitude ===');
{
  const q = new QuadcopterPhysics();
  q.reset();
  q.setArmed(true);
  const startY = q.position.y;
  runSteps(q, neutralInput({ throttle: 0.8 }), 2, -100);
  assertNoNaN(q, 'alt-hold-climb');
  const t = q.getTelemetry(0);
  check('throttle > center climbs', t.position.y > startY + 0.3, `y=${t.position.y.toFixed(3)} (start ${startY})`);
}

console.log('\n=== Test 13: Alt-hold descend command (throttle < 0.5) decreases altitude ===');
{
  const q = new QuadcopterPhysics();
  q.reset();
  q.setArmed(true);
  const startY = q.position.y;
  runSteps(q, neutralInput({ throttle: 0.2 }), 2, -100);
  assertNoNaN(q, 'alt-hold-descend');
  const t = q.getTelemetry(0);
  check('throttle < center descends', t.position.y < startY - 0.3, `y=${t.position.y.toFixed(3)} (start ${startY})`);
}

console.log(`\n=== RESULTS: ${passed} passed, ${failures} failed ===\n`);
if (failures > 0) process.exit(1);
