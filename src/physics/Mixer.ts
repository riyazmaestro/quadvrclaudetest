// Motor mixer: converts a desired [totalThrust, rollTorque, pitchTorque, yawTorque] command
// into 4 individual motor thrust outputs, derived from first-principles geometry rather than
// a copied mixer table, so the sign conventions are provably self-consistent.
//
// Body frame convention (matches three.js / WebXR): +X = right, +Y = up, +Z = backward
// (i.e. forward is -Z). Physically: PITCH (nose up/down) is rotation about the lateral axis
// (X), ROLL (bank left/right) is rotation about the longitudinal/forward axis (Z), YAW (nose
// left/right) is rotation about the vertical axis (Y).
//
// For a motor at body-frame position r = (x, 0, z) producing thrust force F along body +Y,
// the torque it contributes about the center of mass is r x (0, F, 0). Using
// (a x b) = (ay*bz-az*by, az*bx-ax*bz, ax*by-ay*bx) with a = (x, 0, z), b = (0, F, 0):
//   torque.x = 0*0 - z*F = -z*F   -> drives rotation about X -> PITCH
//   torque.y = z*0 - x*0 = 0
//   torque.z = x*F - 0*0 = x*F    -> drives rotation about Z -> ROLL
// So a motor's thrust contributes torque (-z*F, 0, x*F) about (pitch-axis, yaw-axis, roll-axis)
// respectively. Yaw torque instead comes purely from the reactive drag torque of the spinning
// prop (handled separately, proportional to thrust and spin direction). The sign convention
// for "positive roll = right stick" vs. actual world drift direction is calibrated and
// verified empirically in scripts/simTest.ts rather than hand-derived, to avoid a
// right-hand-rule sign error silently inverting controls.

import { HALF_X, HALF_Z, YAW_TORQUE_PER_THRUST } from './constants';

export interface MotorLayoutEntry {
  name: string;
  x: number; // body-frame X position (m)
  z: number; // body-frame Z position (m)
  spinDir: 1 | -1; // +1 = CCW viewed from above, -1 = CW
}

// Standard X-frame quad: diagonal pairs spin the same direction so reaction torques cancel at
// equal thrust (hover, no yaw command). FR/BL spin CW (-1), FL/BR spin CCW (+1).
export const MOTOR_LAYOUT: MotorLayoutEntry[] = [
  { name: 'frontRight', x: +HALF_X, z: -HALF_Z, spinDir: -1 },
  { name: 'frontLeft', x: -HALF_X, z: -HALF_Z, spinDir: +1 },
  { name: 'backRight', x: +HALF_X, z: +HALF_Z, spinDir: +1 },
  { name: 'backLeft', x: -HALF_X, z: +HALF_Z, spinDir: -1 },
];

// Build the 4x4 "allocation" matrix A such that:
//   [totalThrust, pitchTorque, rollTorque, yawTorque]^T = A * [t0, t1, t2, t3]^T
// where t_i is each motor's thrust. Row order matches the command vector above.
function buildAllocationMatrix(): number[][] {
  return MOTOR_LAYOUT.map(() => [0, 0, 0, 0]).map((_, row) =>
    MOTOR_LAYOUT.map((m) => {
      if (row === 0) return 1; // sum of thrusts
      if (row === 1) return -m.z; // pitch torque (about X) contribution per unit thrust
      if (row === 2) return m.x; // roll torque (about Z) contribution per unit thrust
      return -m.spinDir * YAW_TORQUE_PER_THRUST; // yaw reaction torque per unit thrust
    })
  );
}

function invert4x4(src: number[][]): number[][] {
  const n = 4;
  const a: number[][] = src.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) throw new Error('Mixer allocation matrix is singular');
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const pivotVal = a[col][col];
    for (let c = 0; c < 2 * n; c++) a[col][c] /= pivotVal;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = a[r][col];
      for (let c = 0; c < 2 * n; c++) a[r][c] -= factor * a[col][c];
    }
  }
  return a.map((row) => row.slice(n));
}

const ALLOCATION_MATRIX = buildAllocationMatrix();
const INVERSE_ALLOCATION_MATRIX = invert4x4(ALLOCATION_MATRIX);

// This runs every physics substep (240Hz) while armed, so the input command vector is a
// module-level scratch array rather than a fresh allocation per call (not re-entrant/recursive,
// so reuse is safe) — matches the `_tmpVec`-style scratch convention used in QuadcopterPhysics.ts.
const _cmdScratch = [0, 0, 0, 0];

/** Solve for the 4 motor thrusts that produce the desired [thrust, pitch, roll, yaw] command, writing into `out` (must be length 4). */
export function mixMotors(totalThrust: number, pitchTorque: number, rollTorque: number, yawTorque: number, out: number[]): number[] {
  _cmdScratch[0] = totalThrust;
  _cmdScratch[1] = pitchTorque;
  _cmdScratch[2] = rollTorque;
  _cmdScratch[3] = yawTorque;
  for (let i = 0; i < 4; i++) {
    let sum = 0;
    for (let j = 0; j < 4; j++) sum += INVERSE_ALLOCATION_MATRIX[i][j] * _cmdScratch[j];
    out[i] = sum;
  }
  return out;
}
