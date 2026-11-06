import { Injectable } from '@angular/core';

/** The slice of the Fully Kiosk Browser JavaScript interface used here (it needs "JavaScript Interface" on in Fully). */
interface Fully {
  turnScreenOff(keepAlive?: boolean): void;
  turnScreenOn(): void;
  bind?(event: string, code: string): void;
}

// Where Fully calls back into the page.
const MOTION_CALLBACK = '__homeyDashMotion';

/**
 * Turns the screen off and on when the dashboard runs in Fully Kiosk Browser, which a regular browser can't do:
 * `available` is false everywhere else, and nothing happens. The page keeps running while the screen is off, so the
 * display stays connected and its idle rules go on.
 */
@Injectable({ providedIn: 'root' })
export class KioskScreen {
  private readonly fully = (globalThis as { fully?: Fully }).fully;
  /** Whether this screen is hosted by Fully Kiosk Browser. */
  readonly available = typeof this.fully?.turnScreenOff === 'function';
  private off = false;

  /** Turns the screen off, or on again; does nothing when it already is. */
  setOff(off: boolean) {
    if (!this.available || off === this.off) return;
    this.off = off;
    if (off) this.fully?.turnScreenOff(true);
    else this.fully?.turnScreenOn();
  }

  /** Calls back when Fully sees motion (turn Motion Detection on in Fully); a screen that is off can't be touched. */
  onMotion(callback: () => void) {
    if (!this.available) return;
    (globalThis as Record<string, unknown>)[MOTION_CALLBACK] = () => {
      this.off = false;
      this.fully?.turnScreenOn();
      callback();
    };
    this.fully?.bind?.('onMotion', `${MOTION_CALLBACK}();`);
  }
}
