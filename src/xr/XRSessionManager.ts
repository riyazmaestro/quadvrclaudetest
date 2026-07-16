import type { WebGLRenderer } from 'three';

// three.js's internal render reference space (used for camera/controller poses) is kept at its
// default 'local-floor' and never pointed at 'bounded-floor': WebXRManager.setSession() awaits
// session.requestReferenceSpace(type) with NO fallback on rejection (verified by reading
// three.module.js), so requesting an unsupported type would hard-fail the entire session. The
// real room boundary is instead sourced from a manual walk-the-room calibration (the user places
// boundary points by standing at each corner and pressing a controller button — see
// ControllerInput.pollCalibration() and main.ts's 'calibrating' phase), which reads controller
// poses directly off the per-frame XRFrame, independent of whatever reference space three trusts
// for rendering. (Both Guardian's `bounded-floor` boundsGeometry and the WebXR 'plane-detection'
// feature were tried and abandoned here — both are documented, real-world-confirmed to return
// coarse/incorrect rectangular approximations rather than the true room shape on current Quest
// software, even with Room Setup completed.)
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
      optionalFeatures: ['hand-tracking', 'dom-overlay'],
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
