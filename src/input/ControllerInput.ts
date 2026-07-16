import type { FlightMode } from '../physics/QuadcopterPhysics';
import type { FrameInput, InputSource } from './types';
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

const EMPTY_HAND_STATE: HandButtonState = { trigger: false, grip: false, faceLower: false, faceUpper: false };

export class ControllerInput implements InputSource {
  private session: XRSession | null = null;
  private prevLeft: HandButtonState = { ...EMPTY_HAND_STATE };
  private prevRight: HandButtonState = { ...EMPTY_HAND_STATE };
  private armed = false;
  private flightMode: FlightMode = 'ANGLE';

  setSession(session: XRSession | null): void {
    this.session = session;
    this.prevLeft = { ...EMPTY_HAND_STATE };
    this.prevRight = { ...EMPTY_HAND_STATE };
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

        const state = this.readButtons(gamepad);
        const prev = source.handedness === 'left' ? this.prevLeft : this.prevRight;

        // Accumulated across both hands and applied once after the loop (see below) rather than
        // toggling `armed` inline here: if both grips happen to edge-trigger in the same frame,
        // toggling per-hand would flip `armed` twice and cancel out to a no-op.
        if (state.grip && !prev.grip) gripJustPressed = true;

        if (source.handedness === 'left') {
          const rawX = gamepad.axes[AXIS_X] ?? 0;
          const rawY = gamepad.axes[AXIS_Y] ?? 0;
          yaw = shapeAxis(rawX);
          throttle = throttleFromAxis(rawY);
          if (state.faceUpper && !prev.faceUpper) {
            resetRequested = true; // Y button
            this.armed = false; // always require an explicit re-arm after a reset, e.g. post-crash
          }
          leftTriggerHeld = state.trigger;
          this.prevLeft = state;
        } else {
          const rawX = gamepad.axes[AXIS_X] ?? 0;
          const rawY = gamepad.axes[AXIS_Y] ?? 0;
          roll = shapeAxis(rawX);
          pitch = -shapeAxis(rawY);
          if (state.faceLower && !prev.faceLower) this.flightMode = this.flightMode === 'ANGLE' ? 'ACRO' : 'ANGLE';
          rightTriggerHeld = state.trigger;
          this.prevRight = state;
        }
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

  private readButtons(gamepad: Gamepad): HandButtonState {
    return {
      trigger: gamepad.buttons[BTN_TRIGGER]?.pressed ?? false,
      grip: gamepad.buttons[BTN_GRIP]?.pressed ?? false,
      faceLower: gamepad.buttons[BTN_FACE_LOWER]?.pressed ?? false,
      faceUpper: gamepad.buttons[BTN_FACE_UPPER]?.pressed ?? false,
    };
  }
}
