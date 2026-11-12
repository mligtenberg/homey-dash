import { Injectable, signal } from '@angular/core';
import { safeStorage } from './screen-id';

/** How often a display measures how much light falls on it. */
export const BRIGHTNESS_MS = 60_000;

// How long the camera runs before the frame is read, past the dark first frames and the exposure settling; and how long
// after the exposure is changed again.
const SETTLE_MS = 1_500;
const RESETTLE_MS = 700;

// How long a measurement may take before it is given up, such as when a camera never sends a picture; the next one
// is tried as usual.
const GIVE_UP_MS = 10_000;

// Where a screen remembers the camera picked for it in its screen settings.
const CAMERA_KEY = 'homeydash.camera';

// Where a screen remembers how much to scale the camera's estimate down, as a share of it (1 = as worked out).
const SCALE_KEY = 'homeydash.lux-scale';

// The camera's error names that mean this screen can't measure at all, rather than not this time.
const CANNOT = ['NotAllowedError', 'NotFoundError', 'SecurityError', 'OverconstrainedError'];

/** An exposure: how long, in seconds, and how sensitive. */
export interface Exposure {
  time: number;
  iso: number;
}

// The f-number of a typical tablet's front camera, which browsers don't tell.
const F_NUMBER = 2.2;

// Fixed exposures to measure at where the camera allows it (Chrome on Android), brightest room first: 1/60 s at ISO
// 100 reads about 80 to 4000 lx, and a room too dark for it is measured again at 1/8 s at ISO 800, down to about 1 lx.
const EXPOSURES: Exposure[] = [
  { time: 1 / 60, iso: 100 },
  { time: 1 / 8, iso: 800 },
];
// The share of full light below which a frame is too dark to tell more than "dark".
const TOO_DARK = 0.02;

// What automatic exposure is taken to have chosen where the browser doesn't tell (Safari, Firefox): one that makes an
// indoor room of about 300 lx middle grey. Automatic exposure brightens a dim room and darkens a bright one, so such
// an estimate only tells dark from light.
const AUTO: Exposure = { time: (F_NUMBER * F_NUMBER) / 128, iso: 100 };

/** A camera the screen has, by what the browser calls it. */
export interface Camera {
  deviceId: string;
  label: string;
}

/** How much light falls on the screen, in lux, and whether a light sensor measured it or the camera estimated it. */
export interface Reading {
  lux: number;
  source: 'sensor' | 'camera';
}

/**
 * Measures how much light falls on the screen, in lux. Where the browser has a light sensor (Chrome with its Generic
 * Sensor Extra Classes flag on) it reads it; elsewhere it estimates the lux with the front camera, running it for a
 * moment and working it out from the frame's brightness and the exposure it was taken at. Where the camera allows it
 * (Chrome on Android) the exposure is fixed, so the estimate follows the light; elsewhere automatic exposure evens out
 * dim and bright rooms, and the estimate mostly tells dark from light. Both need a secure context, so a display opened
 * over plain http can't measure.
 */
@Injectable({ providedIn: 'root' })
export class LightMeter {
  /** Whether this screen has a camera it may ask for. */
  readonly hasCamera = !!globalThis.navigator?.mediaDevices?.getUserMedia;
  /** Whether this screen may have a light sensor; whether it really has one shows when it is read. */
  private hasSensor = 'AmbientLightSensor' in globalThis;
  /** Whether this screen can measure at all. */
  readonly available = this.hasSensor || this.hasCamera;

  private readonly storage = safeStorage();
  /** The camera picked for this screen; null to leave the choice to the screen. */
  readonly camera = signal(this.storage?.getItem(CAMERA_KEY) ?? null);
  /**
   * The share of the camera's estimate to report, for a camera whose automatic exposure or tone mapping brightens the
   * frame and so reads high; 1 reports it as worked out. A light sensor's reading is never scaled.
   */
  readonly scale = signal(Number(this.storage?.getItem(SCALE_KEY)) || 1);
  /** What it measured last, since the screen loaded. */
  readonly reading = signal<Reading | null>(null);

  /** Picks the camera this screen measures with, kept on this screen; null leaves the choice to the screen. */
  choose(deviceId: string | null) {
    this.camera.set(deviceId);
    if (deviceId) this.storage?.setItem(CAMERA_KEY, deviceId);
    else this.storage?.removeItem(CAMERA_KEY);
  }

  /** Sets the share of the camera's estimate to report, kept on this screen. */
  calibrate(scale: number) {
    this.scale.set(scale);
    if (scale === 1) this.storage?.removeItem(SCALE_KEY);
    else this.storage?.setItem(SCALE_KEY, String(scale));
  }

  /**
   * The cameras this screen has. The browser only names them once a camera was allowed, so while it doesn't, the
   * camera is asked for once, briefly.
   */
  async cameras(): Promise<Camera[]> {
    if (!this.hasCamera) return [];
    let cameras = await videoInputs();
    if (cameras.length && cameras.every((c) => !c.label)) {
      await navigator.mediaDevices.getUserMedia({ video: true }).then(stop, () => undefined);
      cameras = await videoInputs();
    }
    return cameras.map((c, i) => ({ deviceId: c.deviceId, label: c.label || `Camera ${i + 1}` }));
  }

  /** A live picture from the camera this screen measures with, for the screen settings; the caller stops it. */
  async preview(): Promise<MediaStream> {
    const video = cameraOf(await navigator.mediaDevices.enumerateDevices().catch(() => []), this.camera());
    return navigator.mediaDevices.getUserMedia({ audio: false, video: { ...video, width: { ideal: 640 }, height: { ideal: 480 } } });
  }

  /**
   * The lux falling on the screen now; null when this screen can't measure, such as without a light sensor or camera,
   * or when refused. A light sensor that fails once, such as one the browser offers but the tablet lacks, is passed
   * over for the camera from then on.
   */
  async measure(): Promise<number | null> {
    if (this.hasSensor) {
      const lux = await sensorLux().catch(() => null);
      if (lux !== null) return this.read({ lux, source: 'sensor' });
      this.hasSensor = false;
    }
    if (!this.hasCamera) return null;
    const lux = await this.cameraLux();
    return lux === null ? null : this.read({ lux: lux * this.scale(), source: 'camera' });
  }

  private read(reading: Reading) {
    this.reading.set(reading);
    return reading.lux;
  }

  private async cameraLux(): Promise<number | null> {
    let stream: MediaStream;
    const video = cameraOf(await navigator.mediaDevices.enumerateDevices().catch(() => []), this.camera());
    const asked = navigator.mediaDevices.getUserMedia({ audio: false, video });
    try {
      stream = await within(asked, 'The camera did not answer');
    } catch (e) {
      // A camera that answers after all, such as once someone allows it, is let go again.
      void asked.then(stop, () => undefined);
      if (e instanceof DOMException && CANNOT.includes(e.name)) return null;
      throw e;
    }
    try {
      const track = stream.getVideoTracks()[0];
      const player = document.createElement('video');
      player.muted = true;
      player.playsInline = true;
      player.srcObject = stream;
      await within(player.play(), 'The camera sent no picture');
      const fixable = canFix(track);
      if (!fixable) {
        await settle(SETTLE_MS);
        return luxOf(lightOf(frame(player)), exposureOf(track) ?? AUTO);
      }
      let lux = 0;
      for (const [i, wanted] of EXPOSURES.entries()) {
        const exposure = await fix(track, wanted);
        await settle(i === 0 ? SETTLE_MS : RESETTLE_MS);
        const light = lightOf(frame(player));
        lux = luxOf(light, exposure);
        if (light >= TOO_DARK) break;
      }
      return lux;
    } finally {
      stop(stream);
    }
  }
}

/**
 * Which camera to ask for, of the cameras the browser names (it only names them once one was allowed): the one picked
 * in the screen settings while the screen still has it, else the front one, as a tablet has. A computer's cameras face
 * no way, so the browser takes the first, which may be a virtual camera that sends nothing (OBS, Insta360); then the
 * first real one is asked for instead.
 */
export function cameraOf(
  cameras: Pick<MediaDeviceInfo, 'kind' | 'label' | 'deviceId'>[],
  picked: string | null = null,
): MediaTrackConstraints {
  const size = { width: { ideal: 160 }, height: { ideal: 120 } };
  const all = cameras.filter((c) => c.kind === 'videoinput');
  if (picked && all.some((c) => c.deviceId === picked)) return { ...size, deviceId: { exact: picked } };
  const video: MediaTrackConstraints = { facingMode: 'user', ...size };
  const real = all.filter((c) => c.label && !/virtual/i.test(c.label));
  return real.length && real.length < all.length ? { ...video, deviceId: { ideal: real[0].deviceId } } : video;
}

/**
 * The share of full light in RGBA pixels, 0 to 1: their average luminance, undoing the gamma that makes a picture
 * look right, as a light meter sees it.
 */
export function lightOf(pixels: Uint8ClampedArray): number {
  const linear = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  let sum = 0;
  for (let i = 0; i < pixels.length; i += 4)
    sum += 0.2126 * linear(pixels[i]) + 0.7152 * linear(pixels[i + 1]) + 0.0722 * linear(pixels[i + 2]);
  return pixels.length ? sum / (pixels.length / 4) : 0;
}

/**
 * The lux that makes a frame this light at this exposure, as an incident light meter works it out: an exposure meters
 * 2.5·N²/t·100/ISO lux as middle grey (18% of full light), and a lighter or darker frame had that much more or less.
 */
export function luxOf(light: number, { time, iso }: Exposure): number {
  return 2.5 * ((F_NUMBER * F_NUMBER) / time) * (100 / iso) * (light / 0.18);
}

// The light sensor's lux, from a single reading.
function sensorLux(): Promise<number> {
  return new Promise((resolve, fail) => {
    const sensor = new (globalThis as unknown as { AmbientLightSensor: AmbientLightSensorClass }).AmbientLightSensor();
    const done = (then: () => void) => {
      clearTimeout(timer);
      sensor.stop();
      then();
    };
    const timer = setTimeout(() => done(() => fail(new Error('The light sensor gave no reading'))), GIVE_UP_MS);
    sensor.addEventListener('reading', () => done(() => resolve(sensor.illuminance ?? 0)));
    sensor.addEventListener('error', (e) => done(() => fail((e as Event & { error?: unknown }).error)));
    sensor.start();
  });
}

// The Ambient Light Sensor API, which TypeScript's DOM types don't know.
type AmbientLightSensorClass = new () => EventTarget & { illuminance?: number; start(): void; stop(): void };

async function videoInputs() {
  return (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((d) => d.kind === 'videoinput');
}

function within<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, fail) => (timer = setTimeout(() => fail(new Error(message)), GIVE_UP_MS)));
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

const settle = (ms: number) => new Promise((settled) => setTimeout(settled, ms));

function stop(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop());
}

function frame(video: HTMLVideoElement): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 24;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('No canvas to read the frame on');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

// Image capture's exposure settings, which TypeScript's DOM types don't know yet. Chrome counts exposure time in 100 µs.
type Range = { min: number; max: number };
type ExposureCapabilities = MediaTrackCapabilities & { exposureMode?: string[]; exposureTime?: Range; iso?: Range };
type ExposureSettings = MediaTrackSettings & { exposureTime?: number; iso?: number };
const UNITS_PER_SECOND = 10_000;

function canFix(track: MediaStreamTrack | undefined): track is MediaStreamTrack {
  const can = track?.getCapabilities?.() as ExposureCapabilities | undefined;
  return !!can?.exposureMode?.includes('manual') && !!can.exposureTime && !!can.iso;
}

// Fixes the exposure as near as the camera allows, and answers the exposure it took.
async function fix(track: MediaStreamTrack, { time, iso }: Exposure): Promise<Exposure> {
  const can = track.getCapabilities() as ExposureCapabilities;
  const within = (value: number, range?: Range) => (range ? Math.min(range.max, Math.max(range.min, value)) : value);
  const fixed = { exposureMode: 'manual', exposureTime: within(time * UNITS_PER_SECOND, can.exposureTime), iso: within(iso, can.iso) };
  await track.applyConstraints({ advanced: [fixed as MediaTrackConstraintSet] }).catch(() => undefined);
  return exposureOf(track) ?? { time: fixed.exposureTime / UNITS_PER_SECOND, iso: fixed.iso };
}

// The exposure the camera says it takes pictures at, where it says.
function exposureOf(track: MediaStreamTrack | undefined): Exposure | null {
  const now = track?.getSettings?.() as ExposureSettings | undefined;
  return now?.exposureTime && now.iso ? { time: now.exposureTime / UNITS_PER_SECOND, iso: now.iso } : null;
}
