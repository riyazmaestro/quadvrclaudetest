import './style.css';
import { Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SceneSetup } from './render/SceneSetup';
import { DroneModel } from './render/DroneModel';
import { HelicopterModel } from './render/HelicopterModel';
import { disposeFlightModel, type FlightModel } from './render/FlightModel';
import { XRSessionManager, type BoundaryPoint } from './xr/XRSessionManager';
import { RoomBoundary } from './xr/RoomBoundary';
import { ControllerInput } from './input/ControllerInput';
import { KeyboardInput } from './input/KeyboardInput';
import type { InputSource } from './input/types';
import { QuadcopterPhysics } from './physics/QuadcopterPhysics';
import { FIXED_DT, BODY_RADIUS, CEILING_HEIGHT_M } from './physics/constants';
import { Hud, type HudData } from './ui/Hud';
import { MotorAudio } from './audio/MotorAudio';

const MAX_SUBSTEPS_PER_FRAME = 8;
const SPAWN_POSITION = new Vector3(0, 1, -1);
const MIN_CALIBRATION_POINTS = 3;
// How close (in meters) a newly-placed point must be to the very first one before it's treated
// as "closing the loop" instead of adding another corner — roughly "you're standing back where
// you started," not a precise click target.
const CLOSE_LOOP_DISTANCE_M = 0.4;

const sceneSetup = new SceneSetup();

// Selectable visual models for the same underlying quadcopter physics — press X in flight to
// cycle. Factories (not instances) so switching always builds a fresh model rather than juggling
// pre-built, possibly-stale instances.
const FLIGHT_MODEL_FACTORIES: Array<() => FlightModel> = [() => new DroneModel(), () => new HelicopterModel()];
let modelIndex = 0;
let drone: FlightModel = FLIGHT_MODEL_FACTORIES[modelIndex]();
sceneSetup.scene.add(drone.root);

function switchDroneModel(): void {
  sceneSetup.scene.remove(drone.root);
  disposeFlightModel(drone.root);
  modelIndex = (modelIndex + 1) % FLIGHT_MODEL_FACTORIES.length;
  drone = FLIGHT_MODEL_FACTORIES[modelIndex]();
  sceneSetup.scene.add(drone.root);
}

const physics = new QuadcopterPhysics();
const roomBoundary = new RoomBoundary();
sceneSetup.setBoundaryVisual(roomBoundary.getPolygon());

const controllerInput = new ControllerInput();
const keyboardInput = new KeyboardInput();

const hud = new Hud();
sceneSetup.scene.add(hud.object); // Hud repositions this to track the camera in world space every frame, not parented

const motorAudio = new MotorAudio();

const statusLine = document.getElementById('status-line') as HTMLParagraphElement;
const enterArBtn = document.getElementById('enter-ar-btn') as HTMLButtonElement;
const enterArMiniatureBtn = document.getElementById('enter-ar-miniature-btn') as HTMLButtonElement;
const landingMain = document.getElementById('landing-main') as HTMLDivElement;
const comingSoon = document.getElementById('coming-soon') as HTMLDivElement;
const comingSoonBackBtn = document.getElementById('coming-soon-back-btn') as HTMLButtonElement;
const landing = document.getElementById('landing') as HTMLDivElement;
const hudRoot = document.getElementById('hud-root') as HTMLDivElement;
const calibrationOverlay = document.getElementById('calibration-overlay') as HTMLDivElement;
const calibrationOverlayText = document.getElementById('calibration-overlay-text') as HTMLParagraphElement;

// "Enter AR miniature" has no behavior yet — just a placeholder screen with a way back.
enterArMiniatureBtn.addEventListener('click', () => {
  landingMain.style.display = 'none';
  comingSoon.classList.add('visible');
});
comingSoonBackBtn.addEventListener('click', () => {
  comingSoon.classList.remove('visible');
  landingMain.style.display = '';
});

// Desktop preview: lets the app be developed/tested without a headset (see scripts/smokeTest.ts).
sceneSetup.camera.position.set(0, 1.4, 1.4);
const orbitControls = new OrbitControls(sceneSetup.camera, sceneSetup.renderer.domElement);
orbitControls.target.copy(SPAWN_POSITION);
orbitControls.update();

let flightStartTime = performance.now();
let wasArmed = false;

// The app's only phase state: 'landing' (pre-session) -> 'calibrating' (the pilot is walking the
// room's corners) -> 'flying' (boundary locked in, physics/input live). Flight stays gated off
// during 'calibrating' so the drone can't be armed before its boundary actually means anything.
// There is no circle fallback anywhere: flight simply can't start until a real polygon exists.
type Phase = 'landing' | 'calibrating' | 'flying';
let phase: Phase = 'landing';
let calibrationPoints: BoundaryPoint[] = [];

/** Enters the calibration walk on session start. Once a boundary is created it can't be redone mid-session. */
function enterCalibrating(): void {
  controllerInput.forceDisarm();
  phase = 'calibrating';
  calibrationPoints = [];
  sceneSetup.setCalibrationPoints([]);
  sceneSetup.setCalibrationPointer(null);
  calibrationOverlayText.textContent = 'Walk to a corner of your flying space and pull the right trigger to drop a point.';
  calibrationOverlay.classList.add('visible');
}

/** Locks in the walked polygon and starts flight. Only called once >= MIN_CALIBRATION_POINTS points exist. */
function finishCalibration(polygon: BoundaryPoint[]): void {
  roomBoundary.setPolygon(polygon);
  sceneSetup.setBoundaryVisual(roomBoundary.getPolygon());
  if (physics.ceilingEnabled) sceneSetup.setCeilingVisual(roomBoundary.getPolygon(), CEILING_HEIGHT_M);
  physics.reset(new Vector3(roomBoundary.getCentroid().x, 1, roomBoundary.getCentroid().z));
  flightStartTime = performance.now();
  motorAudio.start();
  calibrationOverlay.classList.remove('visible');
  sceneSetup.clearCalibrationVisuals();
  calibrationPoints = [];
  phase = 'flying';
}

const xrSessionManager = new XRSessionManager(sceneSetup.renderer, hudRoot, {
  onSessionStart: (session) => {
    controllerInput.setSession(session);
    landing.style.display = 'none';
    orbitControls.enabled = false;
    enterCalibrating();
  },
  onSessionEnd: () => {
    controllerInput.setSession(null);
    landing.style.display = '';
    orbitControls.enabled = true;
    motorAudio.stop();
    calibrationOverlay.classList.remove('visible');
    sceneSetup.clearCalibrationVisuals();
    phase = 'landing';
  },
  onVisibilityChange: (visibilityState) => {
    // If the user lifts/removes the headset mid-flight they can no longer see the drone (or the
    // boundary warning), so treat "app hidden" like a safety pause: force a disarm rather than
    // let it keep flying unattended. They'll need to trigger-arm again once visible.
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

function distance(a: BoundaryPoint, b: BoundaryPoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Picks the right overlay message for the current calibration state — no new UI subsystem, just text. */
function calibrationStatusText(pointer: BoundaryPoint | null, pointCount: number, nearStart: boolean): string {
  if (pointer === null) return 'Controller not detected — hold up your right controller.';
  if (nearStart) return 'Back at the start — pull the trigger again to close the boundary.';
  if (pointCount === 0) return 'Walk to a corner of your flying space and pull the right trigger to drop a point.';
  return `${pointCount} corners placed — keep walking the edge (around furniture too). Return to your first point and mark it again to close the boundary.`;
}

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
  ceilingEnabled: true,
};

sceneSetup.renderer.setAnimationLoop((_time, frame) => {
  const now = performance.now();
  const frameDt = Math.min(0.25, (now - lastFrameTime) / 1000);
  lastFrameTime = now;

  if (phase === 'calibrating') {
    const referenceSpace = sceneSetup.renderer.xr.getReferenceSpace();
    const calInput = controllerInput.pollCalibration(frame, referenceSpace);
    sceneSetup.setCalibrationPointer(calInput.pointer);

    const nearStart =
      calInput.pointer !== null && calibrationPoints.length >= MIN_CALIBRATION_POINTS && distance(calInput.pointer, calibrationPoints[0]) <= CLOSE_LOOP_DISTANCE_M;

    if (calInput.redoBoundaryRequested) {
      calibrationPoints = [];
      sceneSetup.setCalibrationPoints(calibrationPoints);
    } else if (calInput.placeRequested && calInput.pointer) {
      if (nearStart) {
        finishCalibration([...calibrationPoints]);
      } else {
        calibrationPoints.push(calInput.pointer);
        sceneSetup.setCalibrationPoints(calibrationPoints);
      }
    }

    if (phase === 'calibrating') {
      // finishCalibration() above may have just flipped phase to 'flying' this same frame.
      calibrationOverlayText.textContent = calibrationStatusText(calInput.pointer, calibrationPoints.length, nearStart);
    }
  }

  // Gated off during 'calibrating' so the drone can't be armed/stepped before its boundary is
  // locked in; always runs on desktop (no XR session ever enters 'calibrating' there, see onSessionStart).
  if (phase === 'flying' || !xrSessionManager.isPresenting) {
    const activeInput: InputSource = xrSessionManager.isPresenting ? controllerInput : keyboardInput;
    const frameInput = activeInput.poll();

    if (frameInput.modelSwitchRequested) switchDroneModel();

    physics.setArmed(frameInput.armed);
    if (frameInput.resetRequested) {
      const resetPos = roomBoundary.hasPolygon()
        ? new Vector3(roomBoundary.getCentroid().x, 1, roomBoundary.getCentroid().z)
        : SPAWN_POSITION.clone();
      physics.reset(resetPos);
    }
    if (frameInput.ceilingToggleRequested) {
      physics.ceilingEnabled = !physics.ceilingEnabled;
      if (physics.ceilingEnabled && roomBoundary.hasPolygon()) {
        sceneSetup.setCeilingVisual(roomBoundary.getPolygon(), CEILING_HEIGHT_M);
      } else {
        sceneSetup.hideCeilingVisual();
      }
    }
    if (physics.armed && !wasArmed) flightStartTime = now; // rising edge only, so a mid-flight disarm+rearm restarts the timer
    wasArmed = physics.armed;

    accumulator = Math.min(accumulator + frameDt, FIXED_DT * MAX_SUBSTEPS_PER_FRAME);
    let substeps = 0;
    let wallImpactSpeedMs = 0;
    while (accumulator >= FIXED_DT && substeps < MAX_SUBSTEPS_PER_FRAME) {
      physics.step(FIXED_DT, frameInput, 0);
      if (roomBoundary.hasPolygon()) {
        const { impactSpeedMs } = roomBoundary.resolve(physics.position, physics.velocity, BODY_RADIUS);
        if (impactSpeedMs > wallImpactSpeedMs) wallImpactSpeedMs = impactSpeedMs;
      }
      accumulator -= FIXED_DT;
      substeps++;
    }
    if (wallImpactSpeedMs > 0) drone.triggerBump(wallImpactSpeedMs);

    const telemetry = physics.getTelemetry(0);
    drone.root.position.copy(telemetry.position);
    drone.root.quaternion.copy(telemetry.quaternion);
    drone.update(frameDt, telemetry.motorNormalized, telemetry.armed);

    const boundaryProximity = roomBoundary.hasPolygon() ? roomBoundary.proximity(telemetry.position.x, telemetry.position.z, BODY_RADIUS) : 0;
    motorAudio.update(telemetry.motorNormalized, telemetry.armed);

    hudDataScratch.armed = telemetry.armed;
    hudDataScratch.flightMode = frameInput.flightMode;
    hudDataScratch.altitudeM = telemetry.altitudeM;
    hudDataScratch.speedMs = telemetry.speedMs;
    hudDataScratch.boundaryProximity = boundaryProximity;
    hudDataScratch.flightTimeS = telemetry.armed ? (now - flightStartTime) / 1000 : 0;
    hudDataScratch.ceilingEnabled = physics.ceilingEnabled;
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
