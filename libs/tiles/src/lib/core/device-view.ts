import { HomeyCapability, HomeyDevice, HomeyInsightLog } from '@homey-dash/api-client';
import { albumArtUrl, capabilityText, capText, CONTROLS, deviceDetail, deviceMode, formatReading, isPlaying } from './device-look';

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Readings of what plays that are not worth a chart: the playbar already shows them. */
const UNCHARTED = new Set(['speaker_duration', 'speaker_position']);

/** The insight logs of a device's readings that can be charted: numbers, not on/off or text. */
export function deviceLogs(insights: ReadonlyMap<string, HomeyInsightLog> | undefined, deviceId: string): HomeyInsightLog[] {
  const prefix = `homey:device:${deviceId}:`;
  return [...(insights?.values() ?? [])].filter((l) => l.type === 'number' && l.id.startsWith(prefix) && !UNCHARTED.has(l.id.slice(prefix.length)));
}

/** Whether two lists of logs hold the same ones; a device's values change all the time, its logs do not. */
export const sameLogs = (a: readonly HomeyInsightLog[], b: readonly HomeyInsightLog[]) =>
  a.length === b.length && a.every((l, i) => l.id === b[i].id);

/** The capabilities that press a remote's buttons, by what each does; a device has the ones it has. */
export type RemoteKeys = Partial<
  Record<'up' | 'down' | 'left' | 'right' | 'select' | 'back' | 'home' | 'playpause' | 'x' | 'y' | 'menu' | 'view', HomeyCapability>
>;

/** The channel buttons of a television. */
export type ChannelKeys = Partial<Record<'up' | 'down', HomeyCapability>>;

/** The volume buttons of a device with no volume slider. */
export type VolumeKeys = Partial<Record<'down' | 'mute' | 'up', HomeyCapability>>;

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
  // Each key is pressed by the first of the capabilities named for it that the device has.
  const keys = <K extends string>(ids: Record<K, string | string[]>): Partial<Record<K, HomeyCapability>> | null => {
    const found = Object.entries<string | string[]>(ids).flatMap(([key, id]) => {
      const button = [id].flat().map(control).find(Boolean);
      return button ? [[key, button]] : [];
    });
    return found.length ? (Object.fromEntries(found) as Partial<Record<K, HomeyCapability>>) : null;
  };
  const mode = deviceMode(device);
  const thermostat = control('target_temperature');
  const on = caps['onoff']?.value === true || isPlaying(device) || (mode === 'lock' && caps['locked']?.value === true);
  // A thermostat's dial says it all, so its state line only shows when something is wrong.
  const shown = new Set([
    ...CONTROLS,
    ...(thermostat ? ['measure_temperature'] : []),
    'locked',
    'windowcoverings_set',
    'volume_set',
    'speaker_duration',
    'speaker_position',
  ]);
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
    // An Apple TV has no volume to slide, only buttons to press.
    volumeKeys: control('volume_set') ? null : keys({ down: 'volume_down', mute: 'volume_mute', up: 'volume_up' }),
    // An Apple TV's remote, or an Xbox's controller: A selects and B goes back.
    remote: keys({
      up: ['remote_up', 'controller_Up'],
      down: ['remote_down', 'controller_Down'],
      left: ['remote_left', 'controller_Left'],
      right: ['remote_right', 'controller_Right'],
      select: ['remote_select', 'controller_A'],
      back: ['remote_back', 'controller_B'],
      home: ['remote_home', 'controller_nexus'],
      playpause: 'remote_playpause',
      x: 'controller_X',
      y: 'controller_Y',
      menu: 'controller_Menu',
      view: 'controller_View',
    }),
    channel: keys({ up: 'channel_up', down: 'channel_down' }),
    // Beside a volume slider, mute is a button of its own.
    mute: control('volume_set') ? control('volume_mute') : undefined,
    app: capText(device, 'now_playing_app'),
    progress: playbackProgress(caps['speaker_position'], caps['speaker_duration'], on),
    track: capText(device, 'speaker_track'),
    artist: capText(device, 'speaker_artist'),
    art: albumArtUrl(device, accountId),
    alarms: Object.values(caps)
      .filter((c) => !c.setable && typeof c.value === 'boolean' && c.id.startsWith('alarm_'))
      .map((c) => ({ id: c.id, title: c.title, text: capabilityText(c)?.value ?? '', active: c.value === true })),
    readings: Object.values(caps)
      .filter((c) => !shown.has(c.id) && !c.setable && typeof c.value === 'number')
      .map((c) => ({ id: c.id, title: c.title, ...formatReading(c.value as number, c.units) })),
  };
}

export type DeviceView = ReturnType<typeof describeDevice>;

/** How far what plays has come, in seconds, when the device says both where it is and how long it lasts. */
function playbackProgress(position: HomeyCapability | undefined, duration: HomeyCapability | undefined, playing: boolean) {
  if (typeof position?.value !== 'number' || typeof duration?.value !== 'number' || duration.value <= 0 || position.value < 0) return null;
  const updated = position.lastUpdated ? Date.parse(position.lastUpdated) : NaN;
  return { position: position.value, duration: duration.value, playing, updated: Number.isNaN(updated) ? null : updated };
}

/** A time in seconds as `4:07` or `1:31:57`. */
export function clockTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const [h, m, s] = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  return `${h ? `${h}:${`${m}`.padStart(2, '0')}` : m}:${`${s}`.padStart(2, '0')}`;
}

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

