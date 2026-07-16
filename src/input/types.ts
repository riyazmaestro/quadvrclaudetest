import type { ControlInput } from '../physics/QuadcopterPhysics';

export interface FrameInput extends ControlInput {
  /** Edge-triggered: true for exactly one poll() after the reset button/key is pressed. */
  resetRequested: boolean;
  /** Edge-triggered: true for exactly one poll() after the model-switch button/key is pressed. */
  modelSwitchRequested: boolean;
  /** Edge-triggered: true for exactly one poll() after the ceiling-toggle button/key is pressed. */
  ceilingToggleRequested: boolean;
  /** Level-triggered safety override: both grips held -> caller must force-disarm immediately. */
  killSwitch: boolean;
}

export interface InputSource {
  poll(): FrameInput;
}

/** Input for the pre-flight room-boundary calibration walk (see ControllerInput.pollCalibration). */
export interface CalibrationInput {
  /** Right controller's current floor position (x/z), or null if it can't be resolved this frame. */
  pointer: { x: number; z: number } | null;
  /** Edge-triggered: right trigger just pressed — drops a point, or closes the loop near the start. */
  placeRequested: boolean;
  /** Edge-triggered: left face-lower (X) just pressed — clears points placed so far, starts over. */
  redoBoundaryRequested: boolean;
}
