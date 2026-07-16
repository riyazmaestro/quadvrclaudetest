import { Vector3 } from 'three';
import type { BoundaryPoint } from './XRSessionManager';

// A pilot walking the room's perimeter to calibrate it can go either clockwise or counterclockwise,
// so winding direction (CW/CCW) can't be assumed — inward-normal sign is resolved per-edge against
// the polygon centroid instead.
const PROXIMITY_WARN_MARGIN_M = 0.5;
const WALL_RESTITUTION = 0.35;

const _closest = new Vector3();
const _edge = new Vector3();
const _toPoint = new Vector3();
const _normal = new Vector3();
const _toCentroid = new Vector3();

export interface BoundaryResolution {
  /** 0 = safe interior, 1 = at or past the wall. */
  proximity: number;
  /** Outward speed (m/s) removed by this call's collision response; 0 if no wall was touched. */
  impactSpeedMs: number;
}

/**
 * Always the room the pilot actually walked and marked (see main.ts's 'calibrating' phase /
 * ControllerInput.pollCalibration) — there is no generic-circle fallback. `hasPolygon()` gates
 * every other method: flight only ever starts once a real polygon is set (main.ts guarantees
 * this), and the desktop keyboard preview has no calibration step at all, so callers there must
 * check `hasPolygon()` before calling resolve()/proximity().
 */
export class RoomBoundary {
  private polygon: BoundaryPoint[] = [];
  private centroid: BoundaryPoint = { x: 0, z: 0 };

  hasPolygon(): boolean {
    return this.polygon.length >= 3;
  }

  getPolygon(): BoundaryPoint[] {
    return this.polygon;
  }

  getCentroid(): BoundaryPoint {
    return this.centroid;
  }

  setPolygon(polygon: BoundaryPoint[]): void {
    this.polygon = polygon;
    let cx = 0;
    let cz = 0;
    for (const p of polygon) {
      cx += p.x;
      cz += p.z;
    }
    this.centroid = polygon.length > 0 ? { x: cx / polygon.length, z: cz / polygon.length } : { x: 0, z: 0 };
  }

  /**
   * Keeps (position.x, position.z) inside the boundary, reflecting velocity's outward component
   * on contact. `margin` is the drone's collision radius. Only call once hasPolygon() is true.
   */
  resolve(position: Vector3, velocity: Vector3, margin: number): BoundaryResolution {
    const signedDist = this.signedDistance(position.x, position.z);
    const impactSpeedMs = signedDist < margin ? this.pushOut(position, velocity, margin) : 0;
    return { proximity: proximityFromSignedDist(signedDist, margin), impactSpeedMs };
  }

  /** Read-only version of resolve()'s proximity value for HUD warnings — does not mutate position/velocity. */
  proximity(x: number, z: number, margin: number): number {
    return proximityFromSignedDist(this.signedDistance(x, z), margin);
  }

  private signedDistance(x: number, z: number): number {
    const { dist } = this.nearestEdge(x, z);
    return this.isInside(x, z) ? dist : -dist;
  }

  private nearestEdge(x: number, z: number): { closestX: number; closestZ: number; normalX: number; normalZ: number; dist: number } {
    const poly = this.polygon;
    const n = poly.length;
    let minDist = Infinity;
    let bestA = poly[0];
    let bestB = poly[1];
    let bestT = 0;

    for (let i = 0; i < n; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      _edge.set(b.x - a.x, 0, b.z - a.z);
      _toPoint.set(x - a.x, 0, z - a.z);
      const edgeLenSq = _edge.lengthSq();
      const t = edgeLenSq > 1e-9 ? clamp01(_toPoint.dot(_edge) / edgeLenSq) : 0;
      _closest.set(a.x + _edge.x * t, 0, a.z + _edge.z * t);
      const dist = Math.hypot(x - _closest.x, z - _closest.z);
      if (dist < minDist) {
        minDist = dist;
        bestA = a;
        bestB = b;
        bestT = t;
      }
    }

    _edge.set(bestB.x - bestA.x, 0, bestB.z - bestA.z);
    _closest.set(bestA.x + _edge.x * bestT, 0, bestA.z + _edge.z * bestT);
    _normal.set(-_edge.z, 0, _edge.x).normalize();
    _toCentroid.set(this.centroid.x - _closest.x, 0, this.centroid.z - _closest.z);
    if (_normal.dot(_toCentroid) < 0) _normal.multiplyScalar(-1); // ensure inward-facing

    return { closestX: _closest.x, closestZ: _closest.z, normalX: _normal.x, normalZ: _normal.z, dist: minDist };
  }

  private pushOut(position: Vector3, velocity: Vector3, margin: number): number {
    const { closestX, closestZ, normalX, normalZ } = this.nearestEdge(position.x, position.z);

    position.x = closestX + normalX * margin;
    position.z = closestZ + normalZ * margin;

    const outward = -(velocity.x * normalX + velocity.z * normalZ);
    if (outward > 0) {
      velocity.x += (1 + WALL_RESTITUTION) * outward * normalX;
      velocity.z += (1 + WALL_RESTITUTION) * outward * normalZ;
    }
    return Math.max(0, outward);
  }

  private isInside(x: number, z: number): boolean {
    const poly = this.polygon;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const pi = poly[i];
      const pj = poly[j];
      const intersects = pi.z > z !== pj.z > z && x < ((pj.x - pi.x) * (z - pi.z)) / (pj.z - pi.z) + pi.x;
      if (intersects) inside = !inside;
    }
    return inside;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function proximityFromSignedDist(signedDist: number, margin: number): number {
  return 1 - clamp01((signedDist - margin) / PROXIMITY_WARN_MARGIN_M);
}
