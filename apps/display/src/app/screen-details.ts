import { ScreenDetails } from '@homey-dash/api-client';
import { KioskScreen } from './kiosk-screen';
import { LightMeter } from './light-meter';

// The parts of the browser's Network Information and Battery APIs that TypeScript's DOM types don't know.
type Navigator2 = Navigator & {
  connection?: { effectiveType?: string };
  getBattery?: () => Promise<{ level: number; charging: boolean }>;
};

/** What this screen and its browser are, for Management: its size, browser, Fully Kiosk interface, light and battery. */
export async function screenDetails(kiosk: KioskScreen, light: LightMeter, loadedAt: Date): Promise<ScreenDetails> {
  const nav = globalThis.navigator as Navigator2;
  const fully = kiosk.details();
  const battery = await nav.getBattery?.().catch(() => null);
  const fullyBattery = kiosk.battery();
  return {
    screenWidth: screen.width || null,
    screenHeight: screen.height || null,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    pixelRatio: window.devicePixelRatio || null,
    orientation: screen.orientation?.type ?? null,
    userAgent: nav.userAgent ?? null,
    language: nav.language ?? null,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
    touchPoints: nav.maxTouchPoints ?? null,
    secureContext: window.isSecureContext,
    connection: nav.connection?.effectiveType ?? null,
    loadedAt: loadedAt.toISOString(),
    fully,
    light: { available: light.available, source: light.reading()?.source ?? null },
    battery: battery
      ? { level: battery.level, charging: battery.charging }
      : fullyBattery !== null
        ? { level: fullyBattery, charging: null }
        : null,
  };
}
