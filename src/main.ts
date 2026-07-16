import './style.css';
import { Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SceneSetup } from './render/SceneSetup';
import { DroneModel } from './render/DroneModel';
import { XRSessionManager, type BoundaryPoint } from './xr/XRSessionManager';
import { RoomBoundary } from './xr/RoomBoundary';
import { ControllerInput } from './input/ControllerInput';
import { KeyboardInput } from './input/KeyboardInput';
import type { InputSource } from './input/types';
import { QuadcopterPhysics } from './physics/QuadcopterPhysics';
import { FIXED_DT, BODY_RADIUS } from './physics/constants';
import { Hud, type HudData } from './ui/Hud';
import { MotorAudio } from './audio/MotorAudio';

const FALLBACK_ARENA_RADIUS_M = 4;
const MAX_SUBSTEPS_PER_FRAME = 8;
const SPAWN_POSITION = new Vector3(0, 1, -1);
// Consecutive frames a plane-detection floor reading must keep showing up before the scan locks
// in — not a shape/stability comparison (too fussy given plane-detection keeps refining the same
// physical plane frame to frame), just "did we see a real floor at all," repeated for ~1-1.5s of
// typical Quest frame rates so a single noisy/missing-plane frame can't finalize (or reset) early.
const SCAN_STABLE_FRAMES_REQUIRED = 90;
const SCAN_TIMEOUT_MS = 8000;

const sceneSetup = new SceneSetup();
const drone = new DroneModel();
sceneSetup.scene.add(drone.root);
const physics = new QuadcopterPhysics();
const roomBoundary = new RoomBoundary();
roomBoundary.setFallbackRadius(FALLBACK_ARENA_RADIUS_M);
sceneSetup.setBoundaryVisual(roomBoundary.getVisualBoundary());

const controllerInput = new ControllerInput();
const keyboardInput = new KeyboardInput();

const hud = new Hud();
sceneSetup.scene.add(hud.object); // Hud repositions this to track the camera in world space every frame, not parented

const motorAudio = new MotorAudio();

const statusLine = document.getElementById('status-line') as HTMLParagraphElement;
const enterArBtn = document.getElementById('enter-ar-btn') as HTMLButtonElement;
const landing = document.getElementById('landing') as HTMLDivElement;
const hudRoot = document.getElementById('hud-root') as HTMLDivElement;
const scanOverlay = document.getElementById('scan-overlay') as HTMLDivElement;
const scanOverlayText = document.getElementById('scan-overlay-text') as HTMLParagraphElement;

// Desktop preview: lets the app be developed/tested without a headset (see scripts/smokeTest.ts).
sceneSetup.camera.position.set(0, 1.4, 1.4);
const orbitControls = new OrbitControls(sceneSetup.camera, sceneSetup.renderer.domElement);
orbitControls.target.copy(SPAWN_POSITION);
orbitControls.update();

let flightStartTime = performance.now();
let wasArmed = false;

// The app's only phase state: 'landing' (pre-session) -> 'scanning' (session just started, room
// being mapped) -> 'flying' (boundary locked in, physics/input live). Flight stays gated off
// during 'scanning' so the drone can't be armed before its boundary actually means anything.
type Phase = 'landing' | 'scanning' | 'flying';
let phase: Phase = 'landing';
let scanStableFrames = 0;
let scanStartTime = 0;
let lastPlausiblePolygon: BoundaryPoint[] | null = null;

/** Locks in the boundary (scanned polygon, or null to fall back to the circle) and starts flight. */
function finishScan(polygon: BoundaryPoint[] | null): void {
  roomBoundary.setPolygon(polygon);
  sceneSetup.setBoundaryVisual(roomBoundary.getVisualBoundary());
  physics.reset(SPAWN_POSITION.clone());
  flightStartTime = performance.now();
  motorAudio.start();
  scanOverlay.classList.remove('visible');
  phase = 'flying';
}

const xrSessionManager = new XRSessionManager(sceneSetup.renderer, hudRoot, {
  onSessionStart: (session) => {
    controllerInput.setSession(session);
    landing.style.display = 'none';
    orbitControls.enabled = false;
    phase = 'scanning';
    scanStableFrames = 0;
    scanStartTime = performance.now();
    lastPlausiblePolygon = null;
    scanOverlayText.textContent = 'Look around the room to map your flying space…';
    scanOverlay.classList.add('visible');
  },
  onSessionEnd: () => {
    controllerInput.setSession(null);
    landing.style.display = '';
    orbitControls.enabled = true;
    motorAudio.stop();
    scanOverlay.classList.remove('visible');
    phase = 'landing';
  },
  onVisibilityChange: (visibilityState) => {
    // If the user lifts/removes the headset mid-flight they can no longer see the drone (or the
    // boundary warning), so treat "app hidden" like a safety pause: force a disarm rather than
    // let it keep flying unattended. They'll need to grip-arm again once visible.
    if (visibilityState !== 'visible') controllerInput.forceDisarm();
  },
});

async function initEnterArButton(): Promise<void> {
  const supported = await XRSessionManager.isArSupported();
  if (!supported) {
    enterArBtn.textContent = 'AR not supported here — desktop preview below';
    statusLine.textContent = 'Open this page in the Meta Quest Browser to fly for real.';
    return;
  }
  enterArBtn.disabled = false;
  enterArBtn.textContent = 'Enter AR';
  enterArBtn.addEventListener('click', async () => {
    enterArBtn.disabled = true;
    try {
      await xrSessionManager.start();
    } catch (err) {
      statusLine.textContent = `Couldn't start AR: ${(err as Error).message}`;
      statusLine.classList.add('error');
      enterArBtn.disabled = false;
    }
  });
}
void initEnterArButton();

let lastFrameTime = performance.now();
let accumulator = 0;

// Reused every frame instead of building a fresh object literal each time (this is a flat,
// primitives-only shape read synchronously by Hud.update(), so reuse is trivially safe).
const hudDataScratch: HudData = {
  armed: false,
  flightMode: 'ANGLE',
  altitudeM: 0,
  speedMs: 0,
  boundaryProximity: 0,
  flightTimeS: 0,
};

sceneSetup.renderer.setAnimationLoop((_time, frame) => {
  const now = performance.now();
  const frameDt = Math.min(0.25, (now - lastFrameTime) / 1000);
  lastFrameTime = now;

  if (phase === 'scanning') {
    const referenceSpace = sceneSetup.renderer.xr.getReferenceSpace();
    const candidate = frame && referenceSpace ? xrSessionManager.getFloorPolygon(frame, referenceSpace) : null;
    scanStableFrames = candidate ? scanStableFrames + 1 : 0;
    if (candidate) lastPlausiblePolygon = candidate;
    scanOverlayText.textContent = candidate
      ? `Mapping room… ${Math.min(scanStableFrames, SCAN_STABLE_FRAMES_REQUIRED)}/${SCAN_STABLE_FRAMES_REQUIRED}`
      : 'Look around the room to map your flying space…';

    if (scanStableFrames >= SCAN_STABLE_FRAMES_REQUIRED) {
      finishScan(lastPlausiblePolygon);
    } else if (now - scanStartTime > SCAN_TIMEOUT_MS) {
      finishScan(null); // No plausible floor found in time — RoomBoundary falls back to the circle.
    }
  }

  // Gated off during 'scanning' so the drone can't be armed/stepped before its boundary is locked
  // in; always runs on desktop (no XR session ever enters 'scanning' there, see onSessionStart).
  if (phase === 'flying' || !xrSessionManager.isPresenting) {
    const activeInput: InputSource = xrSessionManager.isPresenting ? controllerInput : keyboardInput;
    const frameInput = activeInput.poll();

    physics.setArmed(frameInput.armed);
    if (frameInput.resetRequested) {
      physics.reset(SPAWN_POSITION.clone());
    }
    if (physics.armed && !wasArmed) flightStartTime = now; // rising edge only, so a mid-flight disarm+rearm restarts the timer
    wasArmed = physics.armed;

    accumulator = Math.min(accumulator + frameDt, FIXED_DT * MAX_SUBSTEPS_PER_FRAME);
    let substeps = 0;
    while (accumulator >= FIXED_DT && substeps < MAX_SUBSTEPS_PER_FRAME) {
      physics.step(FIXED_DT, frameInput, 0);
      roomBoundary.resolve(physics.position, physics.velocity, BODY_RADIUS);
      accumulator -= FIXED_DT;
      substeps++;
    }

    const telemetry = physics.getTelemetry(0);
    drone.root.position.copy(telemetry.position);
    drone.root.quaternion.copy(telemetry.quaternion);
    drone.update(frameDt, telemetry.motorNormalized, telemetry.armed);

    const boundaryProximity = roomBoundary.proximity(telemetry.position.x, telemetry.position.z, BODY_RADIUS);
    motorAudio.update(telemetry.motorNormalized, telemetry.armed);

    hudDataScratch.armed = telemetry.armed;
    hudDataScratch.flightMode = frameInput.flightMode;
    hudDataScratch.altitudeM = telemetry.altitudeM;
    hudDataScratch.speedMs = telemetry.speedMs;
    hudDataScratch.boundaryProximity = boundaryProximity;
    hudDataScratch.flightTimeS = telemetry.armed ? (now - flightStartTime) / 1000 : 0;
    hud.update(hudDataScratch, sceneSetup.camera, frameDt);

    if (import.meta.env.DEV) {
      // Dev-only hook: lets a headless smoke test (see scripts/smokeTest.ts) assert on real
      // simulation state without a headset. Dead-code-eliminated from production builds.
      (window as unknown as { __quadDebug: unknown }).__quadDebug = {
        telemetry,
        frameInput,
        isPresenting: xrSessionManager.isPresenting,
      };
    }
  }

  if (!xrSessionManager.isPresenting) orbitControls.update();
  sceneSetup.renderer.render(sceneSetup.scene, sceneSetup.camera);
});
