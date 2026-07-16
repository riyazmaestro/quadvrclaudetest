import { Group, Mesh } from 'three';

/** Common contract every selectable drone/aircraft visual model implements — see main.ts's model switcher. */
export interface FlightModel {
  readonly root: Group;
  /** Advances cosmetic animation (rotor/prop spin, wall-bump squash). `motorNormalized` is 0..1 per motor from physics telemetry. */
  update(dt: number, motorNormalized: number[], armed: boolean): void;
  /** Kicks off a brief squash-pulse "bonk" — call once per wall/boundary impact with its impact speed (m/s). */
  triggerBump(impactSpeedMs: number): void;
}

/** Frees GPU geometry/material resources for a model no longer in use (e.g. switched away from). */
export function disposeFlightModel(root: Group): void {
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    obj.geometry.dispose();
    for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) mat.dispose();
  });
}
