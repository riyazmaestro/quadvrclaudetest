import type { FlightMode } from '../physics/QuadcopterPhysics';
import type { FrameInput, InputSource } from './types';

// Desktop fallback control scheme: lets the app (and automated smoke tests) run and be exercised
// without a headset. Not meant to feel good, only to drive every ControlInput axis/toggle so bugs
// surface on a dev machine before ever touching a Quest.
export class KeyboardInput implements InputSource {
  private keys = new Set<string>();
  private armed = false;
  private flightMode: FlightMode = 'ANGLE';

  // Only these three keys ever need edge (just-pressed) detection, so tracking their previous
  // state as plain booleans avoids cloning the whole `keys` Set every poll() (this class backs
  // the headless smoke test's render loop too, so it's not purely a throwaway dev path).
  private prevSpace = false;
  private prevM = false;
  private prevR = false;

  constructor(target: EventTarget = window) {
    target.addEventListener('keydown', this.handleKeyDown as EventListener);
    target.addEventListener('keyup', this.handleKeyUp as EventListener);
  }

  dispose(target: EventTarget = window): void {
    target.removeEventListener('keydown', this.handleKeyDown as EventListener);
    target.removeEventListener('keyup', this.handleKeyUp as EventListener);
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  poll(): FrameInput {
    const up = this.keys.has('ArrowUp');
    const down = this.keys.has('ArrowDown');
    const throttle = up && !down ? 1 : down && !up ? 0 : 0.5;

    const yaw = (this.keys.has('KeyE') ? 1 : 0) - (this.keys.has('KeyQ') ? 1 : 0);
    const pitch = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const roll = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);

    const space = this.keys.has('Space');
    const m = this.keys.has('KeyM');
    const r = this.keys.has('KeyR');

    if (space && !this.prevSpace) this.armed = !this.armed;
    if (m && !this.prevM) this.flightMode = this.flightMode === 'ANGLE' ? 'ACRO' : 'ANGLE';
    const resetRequested = r && !this.prevR;
    if (resetRequested) this.armed = false; // always require an explicit re-arm after a reset, e.g. post-crash
    const killSwitch = this.keys.has('KeyX');
    if (killSwitch) this.armed = false;

    this.prevSpace = space;
    this.prevM = m;
    this.prevR = r;

    return { throttle, pitch, roll, yaw, armed: this.armed, flightMode: this.flightMode, resetRequested, killSwitch };
  }
}
