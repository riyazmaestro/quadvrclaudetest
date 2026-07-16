import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from 'three';
import type { FlightModel } from './FlightModel';

const MAX_VISUAL_SPIN_RAD_S = 140; // main rotor spins faster-looking than the quad's props, toy-heli style
const IDLE_SPIN_RAD_S = 20;
const TAIL_ROTOR_SPIN_MUL = 1.6; // tail rotors visually spin faster than the main rotor on real helis
const BASE_SCALE = 1;
const BUMP_DECAY_PER_S = 10;
const BUMP_MAX = 0.22;

/**
 * Classic toy-helicopter silhouette (bulbous fuselage + tinted canopy, skid landing gear, a
 * tapering tail boom ending in a fin + tail rotor, and a single two-blade main rotor on a mast) —
 * an alternate selectable visual for the same underlying quadcopter physics/telemetry (see
 * main.ts's model switcher). Green/black colorway, red main-rotor blade tips, matching common
 * toy-heli styling (green & black body, bright rotor tips for visibility).
 */
export class HelicopterModel implements FlightModel {
  readonly root = new Group();
  private mainRotor: Group;
  private tailRotor: Group;
  private mainRotorAngle = 0;
  private tailRotorAngle = 0;
  private bumpEnvelope = 0; // 0 = resting size; decays back down from a wall-impact pulse

  constructor() {
    const fuselageMat = new MeshStandardMaterial({ color: 0x2f8f3e, roughness: 0.4, metalness: 0.1 });
    const fuselage = new Mesh(new SphereGeometry(0.05, 16, 12), fuselageMat);
    fuselage.scale.set(0.9, 0.85, 1.6);
    this.root.add(fuselage);

    const canopyMat = new MeshStandardMaterial({ color: 0x0a0e14, roughness: 0.15, metalness: 0.5 });
    const canopy = new Mesh(new SphereGeometry(0.032, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), canopyMat);
    canopy.position.set(0, 0.02, -0.045);
    this.root.add(canopy);

    const skidMat = new MeshStandardMaterial({ color: 0x15181d, roughness: 0.5, metalness: 0.2 });
    for (const side of [-1, 1]) {
      const skid = new Mesh(new CylinderGeometry(0.004, 0.004, 0.13, 8), skidMat);
      skid.rotation.x = Math.PI / 2;
      skid.position.set(side * 0.038, -0.048, 0);
      this.root.add(skid);

      for (const zOffset of [-0.03, 0.03]) {
        const strut = new Mesh(new CylinderGeometry(0.003, 0.003, 0.03, 6), skidMat);
        strut.position.set(side * 0.038, -0.03, zOffset);
        this.root.add(strut);
      }
    }

    // Tail boom tapers back and slightly up from the fuselage, ending in a fin + tail rotor —
    // nothing equivalent up front, so which way is forward reads at a glance just like the quad's tail.
    const boomMat = new MeshStandardMaterial({ color: 0x2f8f3e, roughness: 0.4, metalness: 0.1 });
    const boom = new Mesh(new CylinderGeometry(0.016, 0.026, 0.16, 10), boomMat);
    boom.rotation.x = Math.PI / 2.15;
    boom.position.set(0, 0.015, 0.13);
    this.root.add(boom);

    const finMat = new MeshStandardMaterial({ color: 0x15181d, roughness: 0.45 });
    const tailFin = new Mesh(new BoxGeometry(0.003, 0.045, 0.03), finMat);
    tailFin.position.set(0, 0.05, 0.205);
    this.root.add(tailFin);

    const stabilizer = new Mesh(new BoxGeometry(0.09, 0.003, 0.02), finMat);
    stabilizer.position.set(0, 0.03, 0.195);
    this.root.add(stabilizer);

    const tailHubMat = new MeshStandardMaterial({ color: 0x0e1114, roughness: 0.3, metalness: 0.4 });
    const tailHub = new Mesh(new CylinderGeometry(0.006, 0.006, 0.012, 8), tailHubMat);
    tailHub.rotation.z = Math.PI / 2;
    tailHub.position.set(0.017, 0.05, 0.2);
    this.root.add(tailHub);

    this.tailRotor = new Group();
    this.tailRotor.position.set(0.017, 0.05, 0.2);
    const tailBladeMat = new MeshStandardMaterial({ color: 0x15181d, roughness: 0.3 });
    const tailBlade1 = new Mesh(new BoxGeometry(0.004, 0.045, 0.008), tailBladeMat);
    const tailBlade2 = new Mesh(new BoxGeometry(0.004, 0.008, 0.045), tailBladeMat);
    this.tailRotor.add(tailBlade1, tailBlade2);
    this.root.add(this.tailRotor);

    // Main rotor: mast + hub on top of the fuselage, two long crossed blades with a small red tip
    // accent on each — matching common toy-helicopter styling (bright rotor tips for visibility).
    const mastMat = new MeshStandardMaterial({ color: 0x0e1114, roughness: 0.3, metalness: 0.4 });
    const mast = new Mesh(new CylinderGeometry(0.006, 0.006, 0.05, 8), mastMat);
    mast.position.set(0, 0.075, 0);
    this.root.add(mast);

    const hub = new Mesh(new CylinderGeometry(0.012, 0.012, 0.014, 10), mastMat);
    hub.position.set(0, 0.1, 0);
    this.root.add(hub);

    this.mainRotor = new Group();
    this.mainRotor.position.set(0, 0.106, 0);
    const bladeMat = new MeshStandardMaterial({ color: 0x15181d, roughness: 0.3 });
    const tipMat = new MeshStandardMaterial({ color: 0xd9342b, roughness: 0.35, emissive: 0x3a0906 });
    const bladeLength = 0.16;
    for (const angle of [0, Math.PI / 2]) {
      const blade = new Mesh(new BoxGeometry(bladeLength, 0.004, 0.014), bladeMat);
      blade.rotation.y = angle;
      this.mainRotor.add(blade);
      const tip = new Mesh(new BoxGeometry(0.018, 0.005, 0.016), tipMat);
      tip.position.set((bladeLength / 2) * Math.cos(angle), 0, (bladeLength / 2) * Math.sin(angle));
      tip.rotation.y = angle;
      this.mainRotor.add(tip);

      const blade2 = new Mesh(new BoxGeometry(bladeLength, 0.004, 0.014), bladeMat);
      blade2.rotation.y = angle + Math.PI;
      this.mainRotor.add(blade2);
      const tip2 = new Mesh(new BoxGeometry(0.018, 0.005, 0.016), tipMat);
      tip2.position.set((-bladeLength / 2) * Math.cos(angle), 0, (-bladeLength / 2) * Math.sin(angle));
      tip2.rotation.y = angle;
      this.mainRotor.add(tip2);
    }
    this.root.add(this.mainRotor);

    this.root.scale.setScalar(BASE_SCALE);
  }

  /** Advances main/tail rotor spin and the wall-bump squash pulse. `motorNormalized` is 0..1 per motor from physics telemetry. */
  update(dt: number, motorNormalized: number[], armed: boolean): void {
    let meanThrust = 0;
    for (const m of motorNormalized) meanThrust += m;
    meanThrust /= motorNormalized.length || 1;

    const mainTarget = armed ? IDLE_SPIN_RAD_S + meanThrust * (MAX_VISUAL_SPIN_RAD_S - IDLE_SPIN_RAD_S) : 0;
    this.mainRotorAngle += mainTarget * dt;
    this.mainRotor.rotation.y = this.mainRotorAngle;

    this.tailRotorAngle += mainTarget * TAIL_ROTOR_SPIN_MUL * dt;
    this.tailRotor.rotation.x = this.tailRotorAngle;

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
