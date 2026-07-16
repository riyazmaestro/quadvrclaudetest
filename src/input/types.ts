import type { ControlInput } from '../physics/QuadcopterPhysics';

export interface FrameInput extends ControlInput {
  /** Edge-triggered: true for exactly one poll() after the reset button/key is pressed. */
  resetRequested: boolean;
  /** Level-triggered safety override: both triggers held -> caller must force-disarm immediately. */
  killSwitch: boolean;
}

export interface InputSource {
  poll(): FrameInput;
}

/** Input for the pre-flight room-boundary calibration walk (see ControllerInput.pollCalibration). */
export interface CalibrationInput {
  /** Right controller's current floor position (x/z), or null if it can't be resolved this frame. */
  pointer: { x: number; z: number } | null;
  /** Edge-triggered: right trigger just pressed. */
  placeRequested: boolean;
  /** Edge-triggered: right grip just pressed. */
  undoRequested: boolean;
  /** Edge-triggered: left face-lower (X) just pressed. */
  finishRequested: boolean;
  /** Edge-triggered: left face-upper (Y) just pressed. */
  skipRequested: boolean;
}
