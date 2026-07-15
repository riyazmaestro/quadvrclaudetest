import { Vector3, Quaternion, Euler } from 'three';
import { MOTOR_LAYOUT, mixMotors } from './Mixer';
import { PIDController } from './PID';
import {
  MASS,
  GRAVITY,
  INERTIA,
  MAX_THRUST_PER_MOTOR,
  MOTOR_TAU,
  LINEAR_DRAG,
  QUADRATIC_DRAG,
  ANGULAR_LINEAR_DRAG,
  ANGULAR_QUADRATIC_DRAG,
  YAW_TORQUE_PER_THRUST,
  GROUND_EFFECT_HEIGHT,
  GROUND_EFFECT_MAX_BOOST,
  MAX_ANGLE_DEG,
  MAX_RATE_DEG_S,
  MAX_YAW_RATE_DEG_S,
  RATE_PID,
  ANGLE_P_GAIN,
  MAX_CLIMB_RATE,
  ALT_HOLD_PID,
  FLOOR_RESTITUTION,
  FLOOR_FRICTION,
  CRASH_SPEED_THRESHOLD,
  BODY_RADIUS,
} from './constants';

export type FlightMode = 'ACRO' | 'ANGLE';

export interface ControlInput {
  /**
   * Meaning depends on flightMode:
   *  - ACRO: 0..1 direct/manual thrust command (0=motors idle, 1=full thrust), matching a real
   *    transmitter's non-centering throttle stick.
   *  - ANGLE: 0..1 but treated as a centered climb-rate command (0.5=hold altitude, 0=max
   *    descend, 1=max climb), suited to Quest's spring-centered thumbsticks.
   */
  throttle: number;
  /** -1..1, forward tilt / pitch stick (positive = pitch forward, nose down, moves forward) */
  pitch: number;
  /** -1..1, roll stick (positive = roll right, moves right) */
  roll: number;
  /** -1..1, yaw stick (positive = yaw right / nose right, clockwise viewed from above) */
  yaw: number;
  armed: boolean;
  flightMode: FlightMode;
}

export interface QuadcopterTelemetry {
  position: Vector3;
  velocity: Vector3;
  quaternion: Quaternion;
  angularVelocity: Vector3; // body frame, rad/s
  motorThrust: number[]; // actual (lagged) per-motor thrust, N
  motorNormalized: number[]; // 0..1 for visualizing prop spin
  armed: boolean;
  crashed: boolean;
  altitudeM: number;
  speedMs: number;
}

const UP = new Vector3(0, 1, 0);
const _tmpVec = new Vector3();
const _tmpVec2 = new Vector3();
const _iOmega = new Vector3();
const _gyroTerm = new Vector3();
const _angAccel = new Vector3();
const _bodyUpWorld = new Vector3();
const _dragForce = new Vector3();
const _thrustWorld = new Vector3();
const _spinDelta = new Quaternion();
const _desiredRate = new Vector3();
const _euler = new Euler();
const ZERO_THRUST = [0, 0, 0, 0];

export class QuadcopterPhysics {
  position = new Vector3(0, 1, -1); // start ~1m up, 1m in front of origin
  velocity = new Vector3();
  quaternion = new Quaternion();
  angularVelocity = new Vector3(); // body frame rad/s

  motorThrustActual = [0, 0, 0, 0]; // N, after spin-up lag
  motorThrustCommand = [0, 0, 0, 0]; // N, target from mixer

  armed = false;
  crashed = false;

  private ratePID = {
    roll: new PIDController(RATE_PID.roll),
    pitch: new PIDController(RATE_PID.pitch),
    yaw: new PIDController(RATE_PID.yaw),
  };
  private altHoldPID = new PIDController(ALT_HOLD_PID);

  private inertiaInv = new Vector3(1 / INERTIA.xx, 1 / INERTIA.yy, 1 / INERTIA.zz);
  private inertiaDiag = new Vector3(INERTIA.xx, INERTIA.yy, INERTIA.zz);

  reset(position?: Vector3): void {
    this.position.copy(position ?? new Vector3(0, 1, -1));
    this.velocity.set(0, 0, 0);
    this.quaternion.identity();
    this.angularVelocity.set(0, 0, 0);
    this.motorThrustActual = [0, 0, 0, 0];
    this.motorThrustCommand = [0, 0, 0, 0];
    this.crashed = false;
    this.ratePID.roll.reset();
    this.ratePID.pitch.reset();
    this.ratePID.yaw.reset();
    this.altHoldPID.reset();
  }

  setArmed(armed: boolean): void {
    if (armed && this.crashed) return; // must reset before re-arming from a crash
    this.armed = armed;
    if (!armed) {
      this.motorThrustCommand = [0, 0, 0, 0];
    }
  }

  /** Advance the simulation by a fixed timestep dt (seconds). Call in a fixed-step loop. */
  step(dt: number, input: ControlInput, floorY: number): void {
    if (this.crashed || !this.armed) {
      // Motors spin down even when disarmed/crashed; disarmed also free-falls under gravity.
      this.integrateMotorLag(dt, ZERO_THRUST);
      if (!this.armed) {
        this.applyFreeFall(dt, floorY);
      }
      return;
    }

    const desiredRateRadS = this.computeDesiredRates(input, dt);

    // Rate-loop PID: error in rad/s -> torque command (Nm), body frame.
    const pitchTorqueCmd = this.ratePID.pitch.update(desiredRateRadS.x - this.angularVelocity.x, dt);
    const yawTorqueCmd = this.ratePID.yaw.update(desiredRateRadS.y - this.angularVelocity.y, dt);
    const rollTorqueCmd = this.ratePID.roll.update(desiredRateRadS.z - this.angularVelocity.z, dt);

    const totalThrustCmd = this.computeTotalThrustCommand(input, dt);

    this.motorThrustCommand = mixMotors(totalThrustCmd, pitchTorqueCmd, rollTorqueCmd, yawTorqueCmd);
    for (let i = 0; i < 4; i++) {
      if (this.motorThrustCommand[i] < 0) this.motorThrustCommand[i] = 0;
      else if (this.motorThrustCommand[i] > MAX_THRUST_PER_MOTOR) this.motorThrustCommand[i] = MAX_THRUST_PER_MOTOR;
    }

    this.integrateMotorLag(dt, this.motorThrustCommand);

    // Ground effect boost applied to actual thrust before computing net force/torque.
    const heightAboveFloor = Math.max(0, this.position.y - floorY);
    const groundEffectMul =
      1 + GROUND_EFFECT_MAX_BOOST * Math.max(0, 1 - heightAboveFloor / GROUND_EFFECT_HEIGHT);

    let totalThrust = 0;
    let pitchTorque = 0;
    let rollTorque = 0;
    let yawTorque = 0;
    for (let i = 0; i < 4; i++) {
      const t = this.motorThrustActual[i] * groundEffectMul;
      const m = MOTOR_LAYOUT[i];
      totalThrust += t;
      pitchTorque += -m.z * t;
      rollTorque += m.x * t;
      yawTorque += -m.spinDir * t * YAW_TORQUE_PER_THRUST;
    }

    // Forces: thrust (body +Y rotated to world) + gravity + drag.
    _bodyUpWorld.copy(UP).applyQuaternion(this.quaternion);
    _thrustWorld.copy(_bodyUpWorld).multiplyScalar(totalThrust);

    const speed = this.velocity.length();
    _dragForce.copy(this.velocity).multiplyScalar(-(LINEAR_DRAG + QUADRATIC_DRAG * speed));

    _tmpVec.set(0, -MASS * GRAVITY, 0).add(_thrustWorld).add(_dragForce);
    const accel = _tmpVec.multiplyScalar(1 / MASS);

    // Semi-implicit Euler.
    this.velocity.addScaledVector(accel, dt);
    this.position.addScaledVector(this.velocity, dt);

    // Angular dynamics (body frame). Euler's rigid body equation:
    // I*dw/dt = torque - w x (I*w) - angularDrag(w)
    _iOmega.set(
      this.inertiaDiag.x * this.angularVelocity.x,
      this.inertiaDiag.y * this.angularVelocity.y,
      this.inertiaDiag.z * this.angularVelocity.z
    );
    _gyroTerm.copy(this.angularVelocity).cross(_iOmega);

    const wMag = this.angularVelocity.length();
    _tmpVec2.copy(this.angularVelocity).multiplyScalar(-(ANGULAR_LINEAR_DRAG + ANGULAR_QUADRATIC_DRAG * wMag));

    _angAccel.set(
      (pitchTorque - _gyroTerm.x + _tmpVec2.x) * this.inertiaInv.x,
      (yawTorque - _gyroTerm.y + _tmpVec2.y) * this.inertiaInv.y,
      (rollTorque - _gyroTerm.z + _tmpVec2.z) * this.inertiaInv.z
    );

    this.angularVelocity.addScaledVector(_angAccel, dt);

    // Integrate orientation: dq/dt = 0.5 * q * (0, wx, wy, wz) (body-frame angular velocity)
    const w = this.angularVelocity;
    _spinDelta.set(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 1);
    this.quaternion.multiply(_spinDelta);
    this.quaternion.normalize();

    this.handleFloorCollision(floorY);
  }

  private applyFreeFall(dt: number, floorY: number): void {
    this.velocity.y -= GRAVITY * dt;
    this.position.addScaledVector(this.velocity, dt);
    _tmpVec2.copy(this.angularVelocity).multiplyScalar(-(ANGULAR_LINEAR_DRAG * 3));
    this.angularVelocity.addScaledVector(_tmpVec2, dt / Math.max(this.inertiaDiag.x, 1e-6));
    const w = this.angularVelocity;
    _spinDelta.set(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 1);
    this.quaternion.multiply(_spinDelta);
    this.quaternion.normalize();
    this.handleFloorCollision(floorY);
  }

  private integrateMotorLag(dt: number, targets: number[]): void {
    const alpha = 1 - Math.exp(-dt / MOTOR_TAU);
    for (let i = 0; i < 4; i++) {
      this.motorThrustActual[i] += (targets[i] - this.motorThrustActual[i]) * alpha;
      if (this.motorThrustActual[i] < 1e-6) this.motorThrustActual[i] = 0;
    }
  }

  private handleFloorCollision(floorY: number): void {
    const floorContactY = floorY + BODY_RADIUS * 0.3; // visual body sits slightly above pure point
    if (this.position.y < floorContactY) {
      const impactSpeed = Math.max(0, -this.velocity.y);
      this.position.y = floorContactY;
      if (this.velocity.y < 0) this.velocity.y = -this.velocity.y * FLOOR_RESTITUTION;
      this.velocity.x *= FLOOR_FRICTION;
      this.velocity.z *= FLOOR_FRICTION;
      this.angularVelocity.multiplyScalar(0.5);

      if (impactSpeed > CRASH_SPEED_THRESHOLD || this.isExcessivelyTilted()) {
        this.crashed = true;
        this.armed = false;
      }
    }
  }

  private isExcessivelyTilted(): boolean {
    _bodyUpWorld.copy(UP).applyQuaternion(this.quaternion);
    return _bodyUpWorld.y < 0.35; // more than ~70 deg from vertical while touching ground
  }

  /**
   * Converts stick input into target body-frame angular rates (rad/s), handling ACRO vs ANGLE.
   * Writes into and returns the shared scratch vector _desiredRate.
   *
   * Sign note: in this right-handed, Y-up, forward=-Z body frame, positive rotation about an
   * axis (right-hand rule) is the OPPOSITE of the intuitive stick direction on all three axes
   * (verified by hand: +X rotation tilts bodyUp toward +Z, i.e. thrust gains a +Z/backward
   * component, which is a nose-UP/backward response, not the nose-down/forward response a
   * positive forward-pitch stick should produce; the same flip applies to roll and yaw). Hence
   * SIGN below negates every axis to match real transmitter conventions.
   */
  private computeDesiredRates(input: ControlInput, _dt: number): Vector3 {
    const SIGN = -1;
    const yawRateTarget = SIGN * degToRad(input.yaw * MAX_YAW_RATE_DEG_S);

    if (input.flightMode === 'ACRO') {
      return _desiredRate.set(
        SIGN * degToRad(input.pitch * MAX_RATE_DEG_S),
        yawRateTarget,
        SIGN * degToRad(input.roll * MAX_RATE_DEG_S)
      );
    }

    // ANGLE mode: stick commands a target tilt angle; outer P loop converts angle error to a
    // target rate, which is then fed to the same inner rate-PID loop (mirrors real flight
    // controller cascaded-loop architecture).
    const targetPitchDeg = SIGN * input.pitch * MAX_ANGLE_DEG;
    const targetRollDeg = SIGN * input.roll * MAX_ANGLE_DEG;
    _euler.setFromQuaternion(this.quaternion, 'YXZ');
    const currentPitchDeg = radToDeg(_euler.x);
    const currentRollDeg = radToDeg(_euler.z);

    const pitchRateTarget = degToRad(ANGLE_P_GAIN * (targetPitchDeg - currentPitchDeg));
    const rollRateTarget = degToRad(ANGLE_P_GAIN * (targetRollDeg - currentRollDeg));

    return _desiredRate.set(pitchRateTarget, yawRateTarget, rollRateTarget);
  }

  /**
   * ACRO: direct manual throttle -> total thrust. ANGLE: throttle is a centered climb-rate
   * command tracked by a velocity PID on top of a hover-thrust feedforward term, so the drone
   * holds altitude when the (spring-centered) stick is released. See ControlInput.throttle docs.
   */
  private computeTotalThrustCommand(input: ControlInput, dt: number): number {
    if (input.flightMode === 'ACRO') {
      return input.throttle * MAX_THRUST_PER_MOTOR * 4;
    }
    const targetClimbRate = (input.throttle - 0.5) * 2 * MAX_CLIMB_RATE;
    const hoverThrustFeedforward = MASS * GRAVITY;
    const correction = this.altHoldPID.update(targetClimbRate - this.velocity.y, dt);
    const total = hoverThrustFeedforward + correction;
    const maxTotal = MAX_THRUST_PER_MOTOR * 4;
    return total < 0 ? 0 : total > maxTotal ? maxTotal : total;
  }

  getTelemetry(floorY: number): QuadcopterTelemetry {
    return {
      position: this.position.clone(),
      velocity: this.velocity.clone(),
      quaternion: this.quaternion.clone(),
      angularVelocity: this.angularVelocity.clone(),
      motorThrust: [...this.motorThrustActual],
      motorNormalized: this.motorThrustActual.map((t) => t / MAX_THRUST_PER_MOTOR),
      armed: this.armed,
      crashed: this.crashed,
      altitudeM: this.position.y - floorY,
      speedMs: this.velocity.length(),
    };
  }
}

function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}
function radToDeg(r: number): number {
  return (r * 180) / Math.PI;
}
