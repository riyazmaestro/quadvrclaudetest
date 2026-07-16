import type { WebGLRenderer } from 'three';

// three.js's internal render reference space (used for camera/controller poses) is kept at its
// default 'local-floor' and never pointed at 'bounded-floor': WebXRManager.setSession() awaits
// session.requestReferenceSpace(type) with NO fallback on rejection (verified by reading
// three.module.js), so requesting an unsupported type would hard-fail the entire session. The
// real room boundary is instead sourced from the WebXR 'plane-detection' feature (see
// getFloorPolygon() below), read directly off the per-frame XRFrame passed into the render loop,
// independent of whatever reference space three trusts for rendering.
const RENDER_REFERENCE_SPACE = 'local-floor';

export interface BoundaryPoint {
  x: number;
  z: number;
}

export interface XRSessionCallbacks {
  onSessionStart?: (session: XRSession) => void;
  onSessionEnd?: () => void;
  /** Fires when the headset hides the app (user lifted/removed the headset, or the system UI took over). */
  onVisibilityChange?: (visibilityState: XRVisibilityState) => void;
}

export class XRSessionManager {
  isPresenting = false;

  private renderer: WebGLRenderer;
  private hudRoot: HTMLElement;
  private callbacks: XRSessionCallbacks;
  private session: XRSession | null = null;

  constructor(renderer: WebGLRenderer, hudRoot: HTMLElement, callbacks: XRSessionCallbacks = {}) {
    this.renderer = renderer;
    this.hudRoot = hudRoot;
    this.callbacks = callbacks;
    this.renderer.xr.setReferenceSpaceType(RENDER_REFERENCE_SPACE);
  }

  static async isArSupported(): Promise<boolean> {
    if (!('xr' in navigator) || !navigator.xr) return false;
    try {
      return await navigator.xr.isSessionSupported('immersive-ar');
    } catch {
      return false;
    }
  }

  async start(): Promise<void> {
    if (!navigator.xr) throw new Error('WebXR not available on this device/browser.');

    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['plane-detection', 'hand-tracking', 'dom-overlay'],
      domOverlay: { root: this.hudRoot },
    });

    session.addEventListener('end', this.handleSessionEnd);
    session.addEventListener('visibilitychange', () => this.callbacks.onVisibilityChange?.(session.visibilityState));

    try {
      await this.renderer.xr.setSession(session);
      await this.tryRequestHighFrameRate(session);
    } catch (err) {
      // Anything failing after requestSession() succeeded must not leave a half-registered
      // session lying around: a stray open XRSession blocks a retry (most runtimes reject a
      // second requestSession while one is still active), permanently bricking "Enter AR" until
      // the page is reloaded.
      session.removeEventListener('end', this.handleSessionEnd);
      await session.end().catch(() => {});
      throw err;
    }

    this.session = session;
    this.isPresenting = true;
    this.hudRoot.classList.add('visible');
    this.callbacks.onSessionStart?.(session);
  }

  async end(): Promise<void> {
    await this.session?.end();
  }

  private handleSessionEnd = (): void => {
    this.isPresenting = false;
    this.session = null;
    this.hudRoot.classList.remove('visible');
    this.callbacks.onSessionEnd?.();
  };

  /**
   * Reads the real room's floor extent from the WebXR 'plane-detection' feature for this frame,
   * or null if unsupported/nothing plausible has been found yet (caller falls back to the
   * circle). Prefers a plane semantically labeled 'floor' (a Meta extension to the spec); when no
   * runtime exposes labels, falls back to the largest horizontal plane, since a room's floor is
   * reliably the biggest horizontal surface a headset detects.
   */
  getFloorPolygon(frame: XRFrame, referenceSpace: XRReferenceSpace): BoundaryPoint[] | null {
    const planes = frame.detectedPlanes;
    if (!planes || planes.size === 0) return null;

    let best: XRPlane | null = null;
    let bestArea = -Infinity;
    let bestIsLabeledFloor = false;
    for (const plane of planes) {
      if (plane.orientation !== 'horizontal' || plane.polygon.length < 3) continue;
      const isLabeledFloor = plane.semanticLabel === 'floor';
      const area = polygonArea(plane.polygon);
      // A labeled floor always wins over an unlabeled plane regardless of area; among planes with
      // the same label status, the largest one wins (the room's floor is its biggest horizontal
      // surface, e.g. bigger than a tabletop or shelf).
      if (best === null || (isLabeledFloor && !bestIsLabeledFloor) || (isLabeledFloor === bestIsLabeledFloor && area > bestArea)) {
        best = plane;
        bestArea = area;
        bestIsLabeledFloor = isLabeledFloor;
      }
    }
    if (!best) return null;

    const pose = frame.getPose(best.planeSpace, referenceSpace);
    if (!pose) return null;

    const m = pose.transform.matrix;
    return best.polygon.map((p) => ({
      x: m[0] * p.x + m[8] * p.z + m[12],
      z: m[2] * p.x + m[10] * p.z + m[14],
    }));
  }

  // Purely a comfort/smoothness nice-to-have for a physics-heavy sim — never allowed to fail the
  // session start, since `updateTargetFrameRate`/`supportedFrameRates` are newer, inconsistently
  // supported APIs (own try/catch here, on top of the caller's, so a rejection here can never be
  // mistaken for a real session-start failure that should tear the session down).
  private async tryRequestHighFrameRate(session: XRSession): Promise<void> {
    try {
      const rates = session.supportedFrameRates;
      if (!rates || rates.length === 0) return;
      const best = Math.max(...rates);
      if (best > (session.frameRate ?? 0)) await session.updateTargetFrameRate(best);
    } catch {
      // Not supported on this runtime; three.js/the headset's default frame rate is used.
    }
  }
}

function polygonArea(polygon: readonly DOMPointReadOnly[]): number {
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    area += a.x * b.z - b.x * a.z;
  }
  return Math.abs(area) / 2;
}
