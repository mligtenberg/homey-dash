import { Injectable } from '@angular/core';

/** The slice of the Fully Kiosk Browser JavaScript interface used here (it needs "JavaScript Interface" on in Fully). */
interface Fully {
  turnScreenOff(keepAlive?: boolean): void;
  turnScreenOn(): void;
  bind?(event: string, code: string): void;
  getBatteryLevel?(): number;
  getFullyVersion?(): string;
}

// The functions of Fully's interface worth telling Management about, when they exist: what HomeyDash uses, then what
// it could use. Which of them exist depends on the Fully version and on its settings.
const KNOWN_API = [
  'turnScreenOff',
  'turnScreenOn',
  'bind',
  'isScreenOn',
  'getScreenBrightness',
  'setScreenBrightness',
  'startScreensaver',
  'stopScreensaver',
  'getBatteryLevel',
  'getFullyVersion',
  'getIp4Address',
  'getWifiSignalLevel',
  'getDeviceId',
];

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

  /** Fully's version and which of the functions of its interface exist; null when the page can't reach Fully. */
  details(): { version: string | null; api: string[] } | null {
    const fully = this.fully as unknown as Record<string, unknown> | undefined;
    if (!fully) return null;
    const api = KNOWN_API.filter((name) => typeof fully[name] === 'function');
    return { version: this.read(() => this.fully?.getFullyVersion?.()) ?? null, api };
  }

  /** Fully's battery level, 0 to 1, where it tells. */
  battery(): number | null {
    const level = this.read(() => this.fully?.getBatteryLevel?.());
    return typeof level === 'number' && level >= 0 ? level / 100 : null;
  }

  private read<T>(call: () => T): T | undefined {
    try {
      return call();
    } catch {
      return undefined;
    }
  }

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
