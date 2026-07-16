import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { MOTOR_LAYOUT } from '../physics/Mixer';
import { ARM_LENGTH } from '../physics/constants';

const MAX_VISUAL_SPIN_RAD_S = 90; // purely cosmetic prop spin rate at full thrust, not real RPM
const IDLE_SPIN_RAD_S = 12; // gentle spin while armed but at low/zero thrust, reads as "alive"

// Duct outer radius must clear the prop blade tip (below) but stay inside ARM_LENGTH so
// neighboring ducts on the X-frame don't visually overlap.
const DUCT_OUTER_RADIUS = 0.062;
const DUCT_TUBE_RADIUS = 0.011;
const PROP_BLADE_LENGTH = 0.1; // shorter than the old open-frame prop so it sits inside the duct

export class DroneModel {
  readonly root = new Group();
  private props: Object3D[] = [];
  private propAngle = [0, 0, 0, 0];

  constructor() {
    // Tiny-whoop style: a small brushed frame almost entirely hidden under full circular prop
    // ducts, a bulbous FPV camera pod up front, and a whip antenna out the back.
    const bodyMat = new MeshStandardMaterial({ color: 0x1c2733, roughness: 0.45, metalness: 0.35 });
    const body = new Mesh(new BoxGeometry(0.07, 0.03, 0.09), bodyMat);
    this.root.add(body);

    const canopyMat = new MeshStandardMaterial({ color: 0xff3b30, roughness: 0.4, metalness: 0.15 });
    const canopy = new Mesh(new SphereGeometry(0.038, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), canopyMat);
    canopy.position.set(0, 0.014, -0.005);
    this.root.add(canopy);

    const lensMat = new MeshStandardMaterial({ color: 0x0a0e14, roughness: 0.15, metalness: 0.6 });
    const cameraPod = new Mesh(new CylinderGeometry(0.016, 0.016, 0.026, 12), lensMat);
    cameraPod.position.set(0, 0.012, -0.05);
    cameraPod.rotation.x = Math.PI / 2.4;
    this.root.add(cameraPod);

    const antennaMat = new MeshStandardMaterial({ color: 0x2b3947, roughness: 0.5 });
    const antenna = new Mesh(new CylinderGeometry(0.0015, 0.0015, 0.09, 6), antennaMat);
    antenna.position.set(0.015, 0.045, 0.05);
    antenna.rotation.x = -Math.PI / 7;
    antenna.rotation.z = Math.PI / 14;
    this.root.add(antenna);

    const rearLed = new Mesh(new BoxGeometry(0.018, 0.01, 0.01), new MeshStandardMaterial({ color: 0x2ee6a8, emissive: 0x0d5c43, roughness: 0.5 }));
    rearLed.position.set(0, 0, 0.047);
    this.root.add(rearLed);

    const armMat = new MeshStandardMaterial({ color: 0x2b3947, roughness: 0.55 });
    const hubMat = new MeshStandardMaterial({ color: 0x111417, roughness: 0.3, metalness: 0.5 });
    const propMat = new MeshStandardMaterial({ color: 0x0d1116, roughness: 0.25, metalness: 0.2 });
    const ductMat = new MeshStandardMaterial({ color: 0x161d24, roughness: 0.5, metalness: 0.2 });

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
    this.root.scale.setScalar(0.75);
  }

  /** Advances cosmetic propeller spin. `motorNormalized` is 0..1 per motor from physics telemetry. */
  update(dt: number, motorNormalized: number[], armed: boolean): void {
    for (let i = 0; i < 4; i++) {
      const target = armed ? IDLE_SPIN_RAD_S + motorNormalized[i] * (MAX_VISUAL_SPIN_RAD_S - IDLE_SPIN_RAD_S) : 0;
      const dir = MOTOR_LAYOUT[i].spinDir;
      this.propAngle[i] += dir * target * dt;
      this.props[i].rotation.y = this.propAngle[i];
    }
  }
}
