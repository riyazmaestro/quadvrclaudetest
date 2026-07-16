import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Object3D } from 'three';
import { MOTOR_LAYOUT } from '../physics/Mixer';
import { ARM_LENGTH } from '../physics/constants';

const MAX_VISUAL_SPIN_RAD_S = 90; // purely cosmetic prop spin rate at full thrust, not real RPM
const IDLE_SPIN_RAD_S = 12; // gentle spin while armed but at low/zero thrust, reads as "alive"

export class DroneModel {
  readonly root = new Group();
  private props: Object3D[] = [];
  private propAngle = [0, 0, 0, 0];

  constructor() {
    const bodyMat = new MeshStandardMaterial({ color: 0x1c2733, roughness: 0.45, metalness: 0.35 });
    const body = new Mesh(new BoxGeometry(0.09, 0.035, 0.12), bodyMat);
    this.root.add(body);

    const frontLed = new Mesh(new BoxGeometry(0.02, 0.012, 0.012), new MeshStandardMaterial({ color: 0x2ee6a8, emissive: 0x0d5c43, roughness: 0.5 }));
    frontLed.position.set(0, 0, -0.062);
    this.root.add(frontLed);
    const rearLed = new Mesh(new BoxGeometry(0.02, 0.012, 0.012), new MeshStandardMaterial({ color: 0xff3b30, emissive: 0x6b1410, roughness: 0.5 }));
    rearLed.position.set(0, 0, 0.062);
    this.root.add(rearLed);

    const armMat = new MeshStandardMaterial({ color: 0x2b3947, roughness: 0.55 });
    const hubMat = new MeshStandardMaterial({ color: 0x111417, roughness: 0.3, metalness: 0.5 });
    const propMat = new MeshStandardMaterial({ color: 0x0d1116, roughness: 0.25, metalness: 0.2 });

    for (const motor of MOTOR_LAYOUT) {
      // ARM_LENGTH (center-to-motor distance) applies to every motor identically only because
      // this is a symmetric X-frame (HALF_X === HALF_Z in constants.ts); recomputing it per-motor
      // via Math.hypot would give the same answer 4 times over for no reason.
      const arm = new Mesh(new BoxGeometry(0.012, 0.01, ARM_LENGTH), armMat);
      arm.position.set(motor.x / 2, 0, motor.z / 2);
      arm.rotation.y = Math.atan2(motor.x, motor.z);
      this.root.add(arm);

      const hub = new Mesh(new CylinderGeometry(0.012, 0.012, 0.02, 10), hubMat);
      hub.position.set(motor.x, 0.012, motor.z);
      this.root.add(hub);

      const propGroup = new Group();
      propGroup.position.set(motor.x, 0.022, motor.z);
      const blade = new Mesh(new BoxGeometry(0.15, 0.004, 0.018), propMat);
      const blade2 = new Mesh(new BoxGeometry(0.018, 0.004, 0.15), propMat);
      propGroup.add(blade, blade2);
      this.root.add(propGroup);
      this.props.push(propGroup);
    }
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
