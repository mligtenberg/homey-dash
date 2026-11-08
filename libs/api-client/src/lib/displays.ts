import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { DashboardLayout } from './dashboards';
import { Rule } from './rules';

// Mirrors apps/api/Displays/Display.cs.

/**
 * A rule and what a display left alone does while it holds: show one of its dashboards, or play a photo set full
 * screen or fill the screen with a colour until it is touched, which goes back to `returnDashboardId`, or to the
 * dashboard it showed last without it.
 */
export interface IdleRule {
  rule: Rule;
  /** The dashboard it shows; null when it plays a photo set or fills with a colour. */
  dashboardId: string | null;
  photoSetId?: string | null;
  /** The colour it fills the screen with, as `#rrggbb`. */
  color?: string | null;
  /** Whether it turns the screen off (black where the browser can't) instead. */
  screenOff?: boolean;
  returnDashboardId?: string | null;
}

/** Where on its lock screen a display shows a widget. */
export type LockSpot = 'top-left' | 'top-right' | 'center' | 'bottom-left' | 'bottom-right';

export const LOCK_SPOTS: readonly LockSpot[] = ['top-left', 'top-right', 'center', 'bottom-left', 'bottom-right'];

/**
 * Something a display shows on its lock screen, over the photo set or colour an idle rule plays: the time and date,
 * the weather where a Homey is (of `account`, or the oldest), or the value of a device's capability, named by its
 * Homey signal (`homey:<account>:capability:<device>:<capability>`). Widgets in the same spot stack in order. A hidden
 * widget stays configured but the screen leaves it out; one with a rule is shown only while it holds (ADR-0010).
 */
export type LockWidget = (
  | { kind: 'clock'; spot: LockSpot }
  | { kind: 'weather'; spot: LockSpot; account?: number | null }
  | { kind: 'value'; spot: LockSpot; signal: string }
) & { hidden?: boolean; rule?: Rule | null };

/** The device and capability a Homey capability signal names, `homey:<account>:capability:<device>:<capability>`. */
export function capabilitySignal(signal: string): { account: number; device: string; capability: string } | null {
  const [source, account, kind, device, capability] = signal.split(':');
  return source === 'homey' && kind === 'capability' && device && capability ? { account: Number(account), device, capability } : null;
}

/**
 * The functions of Fully Kiosk Browser's JavaScript interface worth telling Management about, when they exist, and
 * what each allows. Which of them exist depends on the Fully version and on its settings.
 */
export const FULLY_FUNCTIONS: Readonly<Record<string, string>> = {
  turnScreenOff: 'Turn the screen off',
  turnScreenOn: 'Turn the screen on',
  bind: 'Wake on motion',
  getBatteryLevel: 'Read the battery',
  getScreenBrightness: 'Read the screen brightness',
  setScreenBrightness: 'Set the screen brightness',
  isScreenOn: 'Know whether the screen is on',
  startScreensaver: 'Start the screensaver',
  stopScreensaver: 'Stop the screensaver',
  getFullyVersion: 'Read its version',
  getIp4Address: 'Read the IP address',
  getWifiSignalLevel: 'Read the Wi-Fi signal',
  getDeviceId: 'Read the device id',
};

/**
 * A display, the dashboards it offers in that order, the rules that choose which it shows when left alone, and what
 * its lock screen shows.
 */
export interface DisplaySummary {
  id: string;
  name: string;
  /** It starts on the first; none while it waits for one. */
  dashboardIds: string[];
  /** In order: left alone, it does what the first of these whose rule holds says, else stays where it is. */
  idleRules: IdleRule[];
  /** In order; at most 8. */
  lockWidgets: LockWidget[];
}

/**
 * Which published version of one of its dashboards a display shows. It is on the latest version when
 * `shownVersion` equals `latestVersion`.
 */
export interface DashboardVersion {
  dashboardId: string;
  shownVersion: number | null;
  latestVersion: number;
}

/** What a screen says about itself and its browser; every part is optional because browsers differ in what they tell. */
export interface ScreenDetails {
  /** The screen's size in CSS pixels, and the part of it the page fills. */
  screenWidth: number | null;
  screenHeight: number | null;
  viewportWidth: number | null;
  viewportHeight: number | null;
  pixelRatio: number | null;
  orientation: string | null;
  userAgent: string | null;
  language: string | null;
  timeZone: string | null;
  touchPoints: number | null;
  /** Whether the page runs in a secure context, which the camera and light sensor need. */
  secureContext: boolean;
  /** The kind of connection, such as `4g` (only where the browser says). */
  connection: string | null;
  /** When the display page was loaded on the screen, which a restart of the page or browser resets. */
  loadedAt: string | null;
  /** Fully Kiosk Browser's JavaScript interface; null where the page doesn't run in Fully or can't reach it. */
  fully: { version: string | null; api: string[] } | null;
  light: { available: boolean; source: 'sensor' | 'camera' | null } | null;
  battery: { level: number | null; charging: boolean | null } | null;
}

/** What Management knows about a display beyond its configuration. */
export interface DisplayStatus {
  connected: boolean;
  /** False once its screen was given to another display; a screen in setup can take it over. */
  held: boolean;
  lastSeenAt: string | null;
  /** One per dashboard it offers, in order. */
  versions: DashboardVersion[];
  /** Whether its screen runs in Fully Kiosk Browser. */
  kiosk: boolean;
  /** The light falling on its screen in lux, as it last measured; null until it has. */
  lux: number | null;
  /** What it last said about itself; null until it has. */
  details: ScreenDetails | null;
}

/** A display as Management lists it. */
export interface DisplayInfo extends DisplaySummary {
  status: DisplayStatus;
}

/** The published version a display shows. */
export interface ShownDashboard {
  id: string;
  name: string;
  version: number;
  layout: DashboardLayout;
}

/** Which display a screen is, and the dashboards it offers, in order (none while waiting for one). */
export interface ScreenView {
  display: DisplaySummary;
  dashboards: ShownDashboard[];
}

/**
 * Displays, for setup on a screen and for assignment in Management. A screen is known by the id it keeps in
 * localStorage; asking for a screen that holds no display answers 404, which sends it to setup.
 */
@Injectable({ providedIn: 'root' })
export class DisplaysApi {
  private readonly http = inject(HttpClient);

  list() {
    return this.http.get<DisplayInfo[]>('/api/displays');
  }

  setUp(name: string, screenId: string) {
    return this.http.post<DisplaySummary>('/api/displays', { name, screenId });
  }

  takeOver(id: string, screenId: string) {
    return this.http.post<DisplayInfo>(`/api/displays/${id}/takeover`, { screenId });
  }

  /** Asks its screen for a picture of what it shows now; fails with 409 while nothing is connected. */
  screenshot(id: string) {
    return this.http.post(`/api/displays/${id}/screenshot`, null, { responseType: 'blob' });
  }

  /** A screen's answer to the request it was sent: its screenshot, as JPEG. */
  sendScreenshot(requestId: string, picture: Blob) {
    return this.http.post<void>(`/api/screenshots/${requestId}`, picture);
  }

  rename(id: string, name: string) {
    return this.http.patch<DisplayInfo>(`/api/displays/${id}`, { name });
  }

  /** Assigns the dashboards the display offers, in order; none makes it wait. */
  assign(id: string, dashboardIds: string[]) {
    return this.http.put<DisplayInfo>(`/api/displays/${id}/dashboards`, { dashboardIds });
  }

  /** Replaces the rules that choose what it shows when left alone; each names a dashboard it offers or a photo set. */
  setIdleRules(id: string, rules: IdleRule[]) {
    return this.http.put<DisplayInfo>(`/api/displays/${id}/idle-rules`, { rules });
  }

  /** Replaces what its lock screen shows. */
  setLockScreen(id: string, widgets: LockWidget[]) {
    return this.http.put<DisplayInfo>(`/api/displays/${id}/lock-screen`, { widgets });
  }

  delete(id: string) {
    return this.http.delete<void>(`/api/displays/${id}`);
  }

  screen(screenId: string) {
    return this.http.get<ScreenView>(`/api/screens/${screenId}`);
  }
}
