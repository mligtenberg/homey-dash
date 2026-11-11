import { LucideAirVent, LucideBell, LucideBlinds, LucideBox, LucideCamera, LucideCar, LucideCoffee, LucideDoorOpen, LucideFan, LucideFlame, LucideGamepad2, LucideLightbulb, LucideLock, LucidePlug, LucideRadar, LucideShield, LucideSpeaker, LucideSun, LucideThermometer, LucideTv, LucideWashingMachine, LucideZap } from '@homey-dash/design-system';
import { LucideIconInput } from '@lucide/angular';
import { HomeyCapability, HomeyDevice, homeyImageUrl } from '@homey-dash/api-client';
import { KindHue } from '../tile-kind';
import { t } from '@homey-dash/i18n';

const HUES: Record<string, KindHue> = {
  light: 'light',
  thermostat: 'heat',
  heater: 'heat',
  boiler: 'heat',
  airconditioning: 'climate',
  lock: 'security',
  homealarm: 'security',
  doorbell: 'security',
  camera: 'security',
  windowcoverings: 'cover',
  curtain: 'cover',
  blinds: 'cover',
  sunshade: 'cover',
  awning: 'cover',
  garagedoor: 'cover',
  tv: 'appliance',
  speaker: 'appliance',
  amplifier: 'appliance',
  mediaplayer: 'appliance',
  settopbox: 'appliance',
  gameconsole: 'appliance',
  washer: 'appliance',
  washingmachine: 'appliance',
  dryer: 'appliance',
  dishwasher: 'appliance',
  coffeemachine: 'appliance',
  kettle: 'appliance',
  vacuumcleaner: 'appliance',
  fan: 'climate',
  airpurifier: 'climate',
  socket: 'energy',
  solarpanel: 'energy',
  battery: 'energy',
  evcharger: 'energy',
};

const ICONS: Record<string, LucideIconInput> = {
  light: LucideLightbulb,
  thermostat: LucideThermometer,
  heater: LucideFlame,
  boiler: LucideFlame,
  airconditioning: LucideAirVent,
  lock: LucideLock,
  homealarm: LucideShield,
  doorbell: LucideBell,
  camera: LucideCamera,
  windowcoverings: LucideBlinds,
  curtain: LucideBlinds,
  blinds: LucideBlinds,
  sunshade: LucideBlinds,
  awning: LucideBlinds,
  garagedoor: LucideDoorOpen,
  tv: LucideTv,
  speaker: LucideSpeaker,
  amplifier: LucideSpeaker,
  mediaplayer: LucideSpeaker,
  settopbox: LucideTv,
  gameconsole: LucideGamepad2,
  washer: LucideWashingMachine,
  washingmachine: LucideWashingMachine,
  dryer: LucideWashingMachine,
  dishwasher: LucideWashingMachine,
  coffeemachine: LucideCoffee,
  kettle: LucideCoffee,
  fan: LucideFan,
  airpurifier: LucideFan,
  socket: LucidePlug,
  solarpanel: LucideSun,
  battery: LucideZap,
  evcharger: LucideCar,
};

// Homey device classes whose name is not one capitalized word.
const TYPES: Record<string, string> = {
  airconditioning: 'Air conditioning',
  homealarm: 'Home alarm',
  windowcoverings: 'Window coverings',
  garagedoor: 'Garage door',
  mediaplayer: 'Media player',
  settopbox: 'Set-top box',
  gameconsole: 'Game console',
  washingmachine: 'Washing machine',
  coffeemachine: 'Coffee machine',
  vacuumcleaner: 'Vacuum cleaner',
  airpurifier: 'Air purifier',
  solarpanel: 'Solar panel',
  evcharger: 'EV charger',
  tv: 'TV',
};

/** What kind of device it is, from its Homey device class: `Light`, `Window coverings`. */
export function deviceType(device: HomeyDevice): string {
  return TYPES[device.class] ?? device.class.charAt(0).toUpperCase() + device.class.slice(1);
}

/** The hue and icon for a device, from its Homey device class; sensors go by what they measure. */
export function deviceLook(device: HomeyDevice | undefined): { hue: KindHue; icon: LucideIconInput } {
  if (!device) return { hue: 'neutral', icon: LucideBox };
  if (device.class === 'sensor') {
    const caps = device.capabilities;
    if (caps['measure_temperature'] || caps['measure_humidity']) return { hue: 'climate', icon: LucideThermometer };
    if (caps['measure_power'] || caps['meter_power']) return { hue: 'energy', icon: LucideZap };
    if (caps['alarm_contact']) return { hue: 'security', icon: LucideDoorOpen };
    return { hue: 'security', icon: LucideRadar };
  }
  return { hue: HUES[device.class] ?? 'neutral', icon: ICONS[device.class] ?? LucideBox };
}

/** Capabilities a tile can operate, in the order `auto` prefers them. */
export const CONTROLS = ['onoff', 'dim', 'target_temperature', 'windowcoverings_state', 'speaker_playing'];

/** The layout of a device's full-screen detail view; each has its own design. */
export type DeviceMode = 'light' | 'climate' | 'cover' | 'speaker' | 'lock' | 'sensor' | 'switch';

/** Which detail design fits a device: by what it can do first, then by its class. */
export function deviceMode(device: HomeyDevice): DeviceMode {
  const caps = device.capabilities;
  if (caps['speaker_playing']) return 'speaker';
  if (caps['target_temperature']) return 'climate';
  if (caps['windowcoverings_state'] || caps['windowcoverings_set']) return 'cover';
  if (caps['locked']) return 'lock';
  if (caps['dim'] || device.class === 'light') return 'light';
  if (device.class === 'sensor' || !caps['onoff']) return 'sensor';
  return 'switch';
}

/** A reading split for display: `20.5` and `°C`, rounded to what a tile has room for. */
export function formatReading(value: number, units: string | null): { value: string; units: string } {
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return { value: `${rounded}`, units: units ?? '' };
}

// What a yes-or-no capability's two values say, where On and Off would not.
const BOOLEANS: Record<string, [string, string]> = {
  alarm_contact: ['Open', 'Closed'],
  alarm_motion: ['Motion', 'No motion'],
  locked: ['Locked', 'Unlocked'],
  speaker_playing: ['Playing', 'Not playing'],
};

/**
 * A capability's value for reading at a glance: `20.5` and `°C`, `80` and `%` for a fraction such as brightness,
 * `Closed`, or an enum value's title. Null while it has no value.
 */
export function capabilityText(capability: HomeyCapability): { value: string; units: string } | null {
  const { value, id } = capability;
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') {
    const [yes, no] = BOOLEANS[id] ?? (id.startsWith('alarm_') ? ['Yes', 'No'] : ['On', 'Off']);
    return { value: t(value ? yes : no), units: '' };
  }
  if (typeof value === 'number') {
    // Fractions Homey keeps 0–1 without units.
    if (!capability.units && capability.min === 0 && capability.max === 1) return { value: `${Math.round(value * 100)}`, units: '%' };
    return formatReading(value, capability.units);
  }
  return { value: capability.values?.find((v) => v.id === value)?.title ?? value, units: '' };
}

function formatNumber(capability: HomeyCapability): string {
  const { value, units } = formatReading(capability.value as number, capability.units);
  return units ? `${value}${units.startsWith('°') ? '' : ' '}${units}` : value;
}

/** A device's text capability, such as the track it plays; empty when it has none. */
export function capText(device: HomeyDevice | undefined, id: string): string {
  const value = device?.capabilities[id]?.value;
  return typeof value === 'string' ? value : '';
}

/** Whether a speaker or player plays now. */
export function isPlaying(device: HomeyDevice | undefined): boolean {
  return device?.capabilities['speaker_playing']?.value === true;
}

/** What a speaker plays, such as `Song · Artist`; empty when it doesn't say. */
export function nowPlaying(device: HomeyDevice | undefined): string {
  return [capText(device, 'speaker_track'), capText(device, 'speaker_artist')].filter(Boolean).join(' · ');
}

/** The address of a device's album art, when it has any and its account is known. */
export function albumArtUrl(device: HomeyDevice | undefined, accountId: number | undefined): string | null {
  return device?.albumArt && accountId !== undefined ? homeyImageUrl(accountId, device.albumArt) : null;
}

/** A short state phrase for a device, such as `On · 80%`, `Closed` or `20.5°C`. */
export function deviceDetail(device: HomeyDevice): { detail: string; active: boolean } {
  const caps = device.capabilities;
  const value = (id: string) => caps[id]?.value;

  // What plays says more than that the device is on.
  if (isPlaying(device)) return { detail: nowPlaying(device) || t('Playing'), active: true };
  if (typeof value('onoff') === 'boolean') {
    const on = value('onoff') as boolean;
    const dim = value('dim');
    return { detail: on && typeof dim === 'number' ? `${t('On')} · ${Math.round(dim * 100)}%` : on ? t('On') : t('Off'), active: on };
  }
  if (typeof value('target_temperature') === 'number' && caps['measure_temperature']?.value != null) {
    return { detail: `${formatNumber(caps['measure_temperature'])} · ${t('set to {value}', { value: formatNumber(caps['target_temperature']) })}`, active: false };
  }
  if (typeof value('alarm_contact') === 'boolean') {
    return { detail: value('alarm_contact') ? t('Open') : t('Closed'), active: value('alarm_contact') as boolean };
  }
  if (typeof value('locked') === 'boolean') return { detail: value('locked') ? t('Locked') : t('Unlocked'), active: value('locked') === false };
  if (typeof value('alarm_motion') === 'boolean') {
    return { detail: value('alarm_motion') ? t('Motion') : t('No motion'), active: value('alarm_motion') as boolean };
  }
  if (typeof value('windowcoverings_set') === 'number') {
    const open = Math.round((value('windowcoverings_set') as number) * 100);
    return { detail: open === 0 ? t('Closed') : t('{open}% open', { open }), active: open > 0 };
  }

  if (value('speaker_playing') === false) return { detail: t('Not playing'), active: false };

  const measured = Object.values(caps).filter((c) => typeof c.value === 'number' && c.id.startsWith('measure_'));
  if (measured.length > 0) return { detail: measured.slice(0, 2).map(formatNumber).join(' · '), active: false };
  return { detail: device.zoneName ?? '', active: false };
}
