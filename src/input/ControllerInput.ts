import type { FlightMode } from '../physics/QuadcopterPhysics';
import type { CalibrationInput, FrameInput, InputSource } from './types';
import { shapeAxis, throttleFromAxis } from './stickShaping';

// xr-standard gamepad mapping for Meta Touch/Touch Plus controllers (confirmed against the
// immersive-web WebXR Gamepads Module sample mapping + Meta's own WebXR input docs): axes[0]/[1]
// are a legacy touchpad placeholder (always 0 on Touch controllers, which have no touchpad),
// the primary thumbstick is axes[2]/axes[3]. Buttons: [0] trigger, [1] squeeze/grip,
// [3] thumbstick click, [4] A/X (lower face button), [5] B/Y (upper face button).
const AXIS_X = 2;
const AXIS_Y = 3;
const BTN_TRIGGER = 0;
const BTN_GRIP = 1;
const BTN_FACE_LOWER = 4; // A (right hand) / X (left hand)
const BTN_FACE_UPPER = 5; // B (right hand) / Y (left hand)

interface HandButtonState {
  trigger: boolean;
  grip: boolean;
  faceLower: boolean;
  faceUpper: boolean;
}

function freshHandState(): HandButtonState {
  return { trigger: false, grip: false, faceLower: false, faceUpper: false };
}

export class ControllerInput implements InputSource {
  private session: XRSession | null = null;
  private armed = false;
  private flightMode: FlightMode = 'ANGLE';

  // Persistent scratch objects (per-hand "this frame" / "last frame" button state), reused every
  // poll() rather than allocated fresh, since this runs every XR animation frame.
  private curLeft: HandButtonState = freshHandState();
  private curRight: HandButtonState = freshHandState();
  private prevLeft: HandButtonState = freshHandState();
  private prevRight: HandButtonState = freshHandState();

  setSession(session: XRSession | null): void {
    this.session = session;
    resetHandState(this.prevLeft);
    resetHandState(this.prevRight);
  }

  forceDisarm(): void {
    this.armed = false;
  }

  poll(): FrameInput {
    let throttle = 0.5;
    let yaw = 0;
    let pitch = 0;
    let roll = 0;
    let resetRequested = false;
    let leftTriggerHeld = false;
    let rightTriggerHeld = false;
    let gripJustPressed = false;

    if (this.session) {
      for (const source of this.session.inputSources) {
        const gamepad = source.gamepad;
        if (!gamepad || (source.handedness !== 'left' && source.handedness !== 'right')) continue;

        const isLeft = source.handedness === 'left';
        const state = isLeft ? this.curLeft : this.curRight;
        const prev = isLeft ? this.prevLeft : this.prevRight;
        readButtonsInto(gamepad, state);

        // Accumulated across both hands and applied once after the loop (see below) rather than
        // toggling `armed` inline here: if both grips happen to edge-trigger in the same frame,
        // toggling per-hand would flip `armed` twice and cancel out to a no-op.
        if (state.grip && !prev.grip) gripJustPressed = true;

        if (isLeft) {
          const rawX = gamepad.axes[AXIS_X] ?? 0;
          const rawY = gamepad.axes[AXIS_Y] ?? 0;
          yaw = shapeAxis(rawX);
          throttle = throttleFromAxis(rawY);
          if (state.faceUpper && !prev.faceUpper) {
            resetRequested = true; // Y button
            this.armed = false; // always require an explicit re-arm after a reset
          }
          leftTriggerHeld = state.trigger;
        } else {
          const rawX = gamepad.axes[AXIS_X] ?? 0;
          const rawY = gamepad.axes[AXIS_Y] ?? 0;
          roll = shapeAxis(rawX);
          pitch = -shapeAxis(rawY);
          if (state.faceLower && !prev.faceLower) this.flightMode = this.flightMode === 'ANGLE' ? 'ACRO' : 'ANGLE';
          rightTriggerHeld = state.trigger;
        }

        copyHandState(state, prev);
      }
    }

    if (gripJustPressed) this.armed = !this.armed;

    const killSwitch = leftTriggerHeld && rightTriggerHeld;
    if (killSwitch) this.armed = false;

    return {
      throttle,
      pitch,
      roll,
      yaw,
      armed: this.armed,
      flightMode: this.flightMode,
      resetRequested,
      killSwitch,
    };
  }

  /**
   * Input for the pre-flight boundary-calibration walk (see RoomBoundary/main.ts): right hand
   * points (its own floor position is the candidate boundary point, no raycasting), left hand
   * controls the flow. Safe to share `poll()`'s per-hand edge-detection scratch state since the
   * two methods are never called on the same frame (main.ts phase-gates between them).
   */
  pollCalibration(frame: XRFrame | undefined, referenceSpace: XRReferenceSpace | null): CalibrationInput {
    let pointer: { x: number; z: number } | null = null;
    let placeRequested = false;
    let undoRequested = false;
    let finishRequested = false;
    let skipRequested = false;

    if (this.session) {
      for (const source of this.session.inputSources) {
        const gamepad = source.gamepad;
        if (!gamepad || (source.handedness !== 'left' && source.handedness !== 'right')) continue;

        const isLeft = source.handedness === 'left';
        const state = isLeft ? this.curLeft : this.curRight;
        const prev = isLeft ? this.prevLeft : this.prevRight;
        readButtonsInto(gamepad, state);

        if (isLeft) {
          if (state.faceLower && !prev.faceLower) finishRequested = true;
          if (state.faceUpper && !prev.faceUpper) skipRequested = true;
        } else {
          if (state.trigger && !prev.trigger) placeRequested = true;
          if (state.grip && !prev.grip) undoRequested = true;

          if (frame && referenceSpace) {
            const space = source.gripSpace ?? source.targetRaySpace;
            const pose = frame.getPose(space, referenceSpace);
            if (pose) {
              const m = pose.transform.matrix;
              pointer = { x: m[12], z: m[14] };
            }
          }
        }

        copyHandState(state, prev);
      }
    }

    return { pointer, placeRequested, undoRequested, finishRequested, skipRequested };
  }
}

function readButtonsInto(gamepad: Gamepad, out: HandButtonState): void {
  out.trigger = gamepad.buttons[BTN_TRIGGER]?.pressed ?? false;
  out.grip = gamepad.buttons[BTN_GRIP]?.pressed ?? false;
  out.faceLower = gamepad.buttons[BTN_FACE_LOWER]?.pressed ?? false;
  out.faceUpper = gamepad.buttons[BTN_FACE_UPPER]?.pressed ?? false;
}

function copyHandState(src: HandButtonState, dst: HandButtonState): void {
  dst.trigger = src.trigger;
  dst.grip = src.grip;
  dst.faceLower = src.faceLower;
  dst.faceUpper = src.faceUpper;
}

function resetHandState(state: HandButtonState): void {
  state.trigger = false;
  state.grip = false;
  state.faceLower = false;
  state.faceUpper = false;
}
