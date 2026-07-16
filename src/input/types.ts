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
