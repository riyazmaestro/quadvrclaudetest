import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  TorusGeometry,
} from 'three';
import { MOTOR_LAYOUT } from '../physics/Mixer';
import { ARM_LENGTH } from '../physics/constants';

const MAX_VISUAL_SPIN_RAD_S = 90; // purely cosmetic prop spin rate at full thrust, not real RPM
const IDLE_SPIN_RAD_S = 12; // gentle spin while armed but at low/zero thrust, reads as "alive"
const BASE_SCALE = 0.5;
const BUMP_DECAY_PER_S = 10; // exponential decay rate of the squash pulse below
const BUMP_MAX = 0.22; // cap how big the squash pulse can get, regardless of impact speed

// Duct outer radius must clear the prop blade tip (below) but stay inside ARM_LENGTH so
// neighboring ducts on the X-frame don't visually overlap.
const DUCT_OUTER_RADIUS = 0.062;
const DUCT_TUBE_RADIUS = 0.011;
const PROP_BLADE_LENGTH = 0.1; // shorter than the old open-frame prop so it sits inside the duct

export class DroneModel {
  readonly root = new Group();
  private props: Object3D[] = [];
  private propAngle = [0, 0, 0, 0];
  private bumpEnvelope = 0; // 0 = resting size; decays back down from a wall-impact pulse

  constructor() {
    // Tiny-whoop style: a small bright frame almost entirely hidden under full circular prop
    // ducts, an FPV camera pod up front (no canopy dome — plain frame + lens), and a whip antenna
    // out the back.
    const bodyMat = new MeshStandardMaterial({ color: 0xf2f5f7, roughness: 0.35, metalness: 0.15 });
    const body = new Mesh(new BoxGeometry(0.07, 0.03, 0.09), bodyMat);
    this.root.add(body);

    const lensMat = new MeshStandardMaterial({ color: 0x0a0e14, roughness: 0.15, metalness: 0.6 });
    const cameraPod = new Mesh(new CylinderGeometry(0.016, 0.016, 0.026, 12), lensMat);
    cameraPod.position.set(0, 0.012, -0.05);
    cameraPod.rotation.x = Math.PI / 2.4;
    this.root.add(cameraPod);

    const antennaMat = new MeshStandardMaterial({ color: 0xb7c2cc, roughness: 0.5 });
    const antenna = new Mesh(new CylinderGeometry(0.0015, 0.0015, 0.09, 6), antennaMat);
    antenna.position.set(0.015, 0.045, 0.05);
    antenna.rotation.x = -Math.PI / 7;
    antenna.rotation.z = Math.PI / 14;
    this.root.add(antenna);

    const rearLed = new Mesh(new BoxGeometry(0.018, 0.01, 0.01), new MeshStandardMaterial({ color: 0x2ee6a8, emissive: 0x0d5c43, roughness: 0.5 }));
    rearLed.position.set(0, 0, 0.047);
    this.root.add(rearLed);

    // Tail: a big, vivid rod + flag sticking straight out the back, nothing equivalent up front —
    // an unambiguous "this way is backward" cue that reads at a glance, unlike the subtler
    // antenna front-vs-rear asymmetry alone. Sized up and given a strong emissive glow so it stays
    // the single most eye-catching thing on the drone from any distance/angle.
    const tailMat = new MeshStandardMaterial({ color: 0xff9500, roughness: 0.3, emissive: 0x7a3d00, emissiveIntensity: 1.2 });
    const tailRod = new Mesh(new BoxGeometry(0.008, 0.008, 0.12), tailMat);
    tailRod.position.set(0, 0.014, 0.11);
    this.root.add(tailRod);

    const tailFlag = new Mesh(new BoxGeometry(0.003, 0.05, 0.06), tailMat);
    tailFlag.position.set(0, 0.03, 0.175);
    this.root.add(tailFlag);

    const armMat = new MeshStandardMaterial({ color: 0xdfe6ec, roughness: 0.5 });
    const hubMat = new MeshStandardMaterial({ color: 0xc7d0d9, roughness: 0.3, metalness: 0.4 });
    const propMat = new MeshStandardMaterial({ color: 0x0d1116, roughness: 0.25, metalness: 0.2 });
    const ductMat = new MeshStandardMaterial({ color: 0xe3e8ec, roughness: 0.45, metalness: 0.15 });

    for (const motor of MOTOR_LAYOUT) {
      // ARM_LENGTH (center-to-motor distance) applies to every motor identically only because
      // this is a symmetric X-frame (HALF_X === HALF_Z in constants.ts); recomputing it per-motor
      // via Math.hypot would give the same answer 4 times over for no reason.
      const arm = new Mesh(new BoxGeometry(0.01, 0.008, ARM_LENGTH), armMat);
      arm.position.set(motor.x / 2, 0, motor.z / 2);
      arm.rotation.y = Math.atan2(motor.x, motor.z);
      this.root.add(arm);

      const duct = new Mesh(new TorusGeometry(DUCT_OUTER_RADIUS, DUCT_TUBE_RADIUS, 8, 20), ductMat);
      duct.position.set(motor.x, 0.014, motor.z);
      duct.rotation.x = Math.PI / 2;
      this.root.add(duct);

      const hub = new Mesh(new CylinderGeometry(0.009, 0.009, 0.016, 10), hubMat);
      hub.position.set(motor.x, 0.012, motor.z);
      this.root.add(hub);

      const propGroup = new Group();
      propGroup.position.set(motor.x, 0.02, motor.z);
      const blade = new Mesh(new BoxGeometry(PROP_BLADE_LENGTH, 0.003, 0.013), propMat);
      const blade2 = new Mesh(new BoxGeometry(0.013, 0.003, PROP_BLADE_LENGTH), propMat);
      propGroup.add(blade, blade2);
      this.root.add(propGroup);
      this.props.push(propGroup);
    }

    // Cosmetic only — shrinks the visual model without touching ARM_LENGTH/BODY_RADIUS,
    // so flight physics and collision size are unaffected.
    this.root.scale.setScalar(BASE_SCALE);
  }

  /** Advances cosmetic propeller spin and the wall-bump squash pulse. `motorNormalized` is 0..1 per motor from physics telemetry. */
  update(dt: number, motorNormalized: number[], armed: boolean): void {
    for (let i = 0; i < 4; i++) {
      const target = armed ? IDLE_SPIN_RAD_S + motorNormalized[i] * (MAX_VISUAL_SPIN_RAD_S - IDLE_SPIN_RAD_S) : 0;
      const dir = MOTOR_LAYOUT[i].spinDir;
      this.propAngle[i] += dir * target * dt;
      this.props[i].rotation.y = this.propAngle[i];
    }

    if (this.bumpEnvelope > 0) {
      this.bumpEnvelope *= Math.exp(-BUMP_DECAY_PER_S * dt);
      if (this.bumpEnvelope < 0.001) this.bumpEnvelope = 0;
      this.root.scale.setScalar(BASE_SCALE * (1 + this.bumpEnvelope));
    }
  }

  /** Kicks off a brief squash-pulse "bonk" — call once per wall/boundary impact with its impact speed (m/s). */
  triggerBump(impactSpeedMs: number): void {
    this.bumpEnvelope = Math.min(BUMP_MAX, Math.max(this.bumpEnvelope, 0.05 + impactSpeedMs * 0.04));
  }
}
