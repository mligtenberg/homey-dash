import { HomeyCapability, HomeyDevice, HomeyInsightLog, homeyImageUrl } from '@homey-dash/api-client';
import { capabilityText, CONTROLS, deviceDetail, deviceMode, formatReading } from './device-look';

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** The insight logs of a device's readings that can be charted: numbers, not on/off or text. */
export function deviceLogs(insights: ReadonlyMap<string, HomeyInsightLog> | undefined, deviceId: string): HomeyInsightLog[] {
  const prefix = `homey:device:${deviceId}:`;
  return [...(insights?.values() ?? [])].filter((l) => l.type === 'number' && l.id.startsWith(prefix));
}

/** Whether two lists of logs hold the same ones; a device's values change all the time, its logs do not. */
export const sameLogs = (a: readonly HomeyInsightLog[], b: readonly HomeyInsightLog[]) =>
  a.length === b.length && a.every((l, i) => l.id === b[i].id);

/**
 * Everything the detail view of a device shows: every control it has, whatever the tile size, laid out for its mode.
 * `failed` says its last command was not answered.
 */
export function describeDevice(device: HomeyDevice, accountId: number | undefined, failed: boolean) {
  const caps = device.capabilities;
  const control = (id: string) => (caps[id]?.setable ? caps[id] : undefined);
  const reading = (c: HomeyCapability | undefined) =>
    typeof c?.value === 'number' ? formatReading(c.value, c.units) : undefined;
  const fraction = (c: HomeyCapability | undefined, fallback: [number, number]) => {
    if (typeof c?.value !== 'number') return 0;
    const [min, max] = [c.min ?? fallback[0], c.max ?? fallback[1]];
    return clamp((c.value - min) / ((max - min) || 1), 0, 1);
  };
  const mode = deviceMode(device);
  const thermostat = control('target_temperature');
  const on = caps['onoff']?.value === true || caps['speaker_playing']?.value === true || (mode === 'lock' && caps['locked']?.value === true);
  // A thermostat's dial says it all, so its state line only shows when something is wrong.
  const shown = new Set([
    ...CONTROLS,
    ...(thermostat ? ['measure_temperature'] : []),
    'locked',
    'windowcoverings_set',
    'volume_set',
  ]);
  const text = (id: string) => (typeof caps[id]?.value === 'string' ? (caps[id].value as string) : '');
  const closed = coverClosed(device);
  const dimValue = caps['dim']?.value;
  return {
    mode,
    on,
    room: device.zoneName ?? '',
    state: failed ? 'Did not respond' : device.available ? (thermostat ? '' : deviceDetail(device).detail) : device.unavailableMessage || 'Unavailable',
    // The hero of a light, lock, cover or speaker already says what the state is; only a problem or a plain device needs the line.
    showState: failed || !device.available || mode === 'switch' || mode === 'sensor',
    onoff: control('onoff'),
    dim: control('dim'),
    level: typeof dimValue === 'number' ? (on ? dimValue : 0) : on ? 1 : 0,
    thermostat,
    target: reading(caps['target_temperature']),
    measured: reading(caps['measure_temperature']),
    fraction: fraction(caps['target_temperature'], [5, 35]),
    cover: control('windowcoverings_state'),
    position: control('windowcoverings_set'),
    closed,
    coverText: coverText(device, closed),
    lock: control('locked'),
    locked: caps['locked']?.value === true,
    playback: control('speaker_playing'),
    playing: caps['speaker_playing']?.value === true,
    previous: control('speaker_prev'),
    next: control('speaker_next'),
    volume: control('volume_set'),
    track: text('speaker_track'),
    artist: text('speaker_artist'),
    art: device.albumArt && accountId !== undefined ? homeyImageUrl(accountId, device.albumArt) : null,
    alarms: Object.values(caps)
      .filter((c) => !c.setable && typeof c.value === 'boolean' && c.id.startsWith('alarm_'))
      .map((c) => ({ id: c.id, title: c.title, text: capabilityText(c)?.value ?? '', active: c.value === true })),
    readings: Object.values(caps)
      .filter((c) => !shown.has(c.id) && !c.setable && typeof c.value === 'number')
      .map((c) => ({ id: c.id, title: c.title, ...formatReading(c.value as number, c.units) })),
  };
}

export type DeviceView = ReturnType<typeof describeDevice>;

/** How far a cover is shut, 0 to 1: by its position when it has one, else by its state. */
function coverClosed(device: HomeyDevice): number {
  const caps = device.capabilities;
  const position = caps['windowcoverings_set']?.value;
  if (typeof position === 'number') return clamp(1 - position, 0, 1);
  switch (caps['windowcoverings_state']?.value) {
    case 'up':
      return 0;
    case 'down':
      return 1;
    default:
      return 0.5;
  }
}

function coverText(device: HomeyDevice, closed: number): string {
  const caps = device.capabilities;
  if (typeof caps['windowcoverings_set']?.value === 'number') return closed >= 1 ? 'Closed' : `${Math.round((1 - closed) * 100)}% open`;
  switch (caps['windowcoverings_state']?.value) {
    case 'up':
      return 'Open';
    case 'down':
      return 'Closed';
    default:
      return 'Stopped';
  }
}

