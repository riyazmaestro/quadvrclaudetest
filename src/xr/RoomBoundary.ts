import { Vector3 } from 'three';
import type { BoundaryPoint } from './XRSessionManager';

// A pilot walking the room's perimeter to calibrate it can go either clockwise or counterclockwise,
// so winding direction (CW/CCW) can't be assumed — inward-normal sign is resolved per-edge against
// the polygon centroid instead.
const DEFAULT_RADIUS_M = 2.5;
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

export class RoomBoundary {
  private polygon: BoundaryPoint[] | null = null;
  private centroid: BoundaryPoint = { x: 0, z: 0 };
  private configuredFallbackRadius = DEFAULT_RADIUS_M;
  private effectiveFallbackRadius = DEFAULT_RADIUS_M;

  // A manually-calibrated polygon (see main.ts's 'calibrating' phase / ControllerInput.pollCalibration)
  // can end up implausibly small if the pilot rushes it — too few corners placed, or corners placed
  // too close together/misjudged. A polygon this small is more likely a rushed calibration than a
  // genuinely tiny room, so its exact SHAPE is rejected in favor of the circular fallback — but
  // its size is still taken as a conservative hint (see setPolygon): if the real room genuinely
  // is that small, using the larger default circle instead would fail unsafe (letting the drone
  // fly past a real nearby wall the polygon was trying to warn about).
  private static readonly MIN_PLAUSIBLE_RADIUS_M = 0.9;

  setPolygon(polygon: BoundaryPoint[] | null): void {
    const candidate = polygon && polygon.length >= 3 ? polygon : null;
    const halfSpan = candidate ? this.halfSpanOf(candidate) : null;

    if (candidate && halfSpan !== null && halfSpan >= RoomBoundary.MIN_PLAUSIBLE_RADIUS_M) {
      this.polygon = candidate;
      let cx = 0;
      let cz = 0;
      for (const p of candidate) {
        cx += p.x;
        cz += p.z;
      }
      this.centroid = { x: cx / candidate.length, z: cz / candidate.length };
      this.effectiveFallbackRadius = this.configuredFallbackRadius;
      return;
    }

    this.polygon = null;
    this.effectiveFallbackRadius = halfSpan !== null ? Math.min(this.configuredFallbackRadius, halfSpan) : this.configuredFallbackRadius;
  }

  private halfSpanOf(polygon: BoundaryPoint[]): number {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of polygon) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    return Math.min(maxX - minX, maxZ - minZ) / 2;
  }

  setFallbackRadius(radiusM: number): void {
    this.configuredFallbackRadius = radiusM;
    this.effectiveFallbackRadius = radiusM;
  }

  /**
   * What's actually in effect right now, for drawing the boundary line — deliberately NOT the
   * same as the raw scan polygon passed into setPolygon(), since that's pre-sanity-check: if this
   * class rejected it as an implausible scan reading, the visual must show the real (circle)
   * fallback it's actually colliding against, not a shape nothing is enforcing anymore.
   */
  getVisualBoundary(): { polygon: BoundaryPoint[] | null; radius: number; isScannedPolygon: boolean } {
    return { polygon: this.polygon, radius: this.effectiveFallbackRadius, isScannedPolygon: this.polygon !== null };
  }

  /**
   * Keeps (position.x, position.z) inside the boundary, reflecting velocity's outward component
   * on contact. `margin` is the drone's collision radius.
   */
  resolve(position: Vector3, velocity: Vector3, margin: number): BoundaryResolution {
    const signedDist = this.signedDistance(position.x, position.z);
    const impactSpeedMs =
      signedDist < margin ? (this.polygon ? this.pushOutPolygon(position, velocity, margin) : this.pushOutCircle(position, velocity, margin)) : 0;
    return { proximity: proximityFromSignedDist(signedDist, margin), impactSpeedMs };
  }

  /** Read-only version of resolve()'s proximity value for HUD warnings — does not mutate position/velocity. */
  proximity(x: number, z: number, margin: number): number {
    return proximityFromSignedDist(this.signedDistance(x, z), margin);
  }

  private signedDistance(x: number, z: number): number {
    return this.polygon ? this.signedDistancePolygon(x, z) : this.signedDistanceCircle(x, z);
  }

  private signedDistanceCircle(x: number, z: number): number {
    return this.effectiveFallbackRadius - Math.hypot(x, z);
  }

  private pushOutCircle(position: Vector3, velocity: Vector3, margin: number): number {
    const dist = Math.hypot(position.x, position.z);
    const limit = this.effectiveFallbackRadius - margin;
    if (dist <= 1e-6) return 0;
    const nx = position.x / dist;
    const nz = position.z / dist;
    position.x = nx * limit;
    position.z = nz * limit;
    const outward = velocity.x * nx + velocity.z * nz;
    if (outward > 0) {
      velocity.x -= (1 + WALL_RESTITUTION) * outward * nx;
      velocity.z -= (1 + WALL_RESTITUTION) * outward * nz;
    }
    return Math.max(0, outward);
  }

  private nearestEdge(x: number, z: number): { closestX: number; closestZ: number; normalX: number; normalZ: number; dist: number } {
    const poly = this.polygon!;
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

  private signedDistancePolygon(x: number, z: number): number {
    const { dist } = this.nearestEdge(x, z);
    return this.isInside(x, z) ? dist : -dist;
  }

  private pushOutPolygon(position: Vector3, velocity: Vector3, margin: number): number {
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
    const poly = this.polygon!;
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
