import {
  LucideAirVent,
  LucideBell,
  LucideBlinds,
  LucideBox,
  LucideCamera,
  LucideCar,
  LucideCoffee,
  LucideDoorOpen,
  LucideFan,
  LucideFlame,
  LucideIconInput,
  LucideLightbulb,
  LucideLock,
  LucidePlug,
  LucideRadar,
  LucideShield,
  LucideSpeaker,
  LucideSun,
  LucideThermometer,
  LucideTv,
  LucideWashingMachine,
  LucideZap,
} from '@lucide/angular';
import { HomeyCapability, HomeyDevice } from '@homey-dash/api-client';
import { KindHue } from '../tile-kind';

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
    return { value: value ? yes : no, units: '' };
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

/** A short state phrase for a device, such as `On · 80%`, `Closed` or `20.5°C`. */
export function deviceDetail(device: HomeyDevice): { detail: string; active: boolean } {
  const caps = device.capabilities;
  const value = (id: string) => caps[id]?.value;

  // What plays says more than that the device is on.
  if (value('speaker_playing') === true) {
    const playing = [value('speaker_track'), value('speaker_artist')].filter((v) => typeof v === 'string' && v).join(' · ');
    return { detail: playing || 'Playing', active: true };
  }
  if (typeof value('onoff') === 'boolean') {
    const on = value('onoff') as boolean;
    const dim = value('dim');
    return { detail: on && typeof dim === 'number' ? `On · ${Math.round(dim * 100)}%` : on ? 'On' : 'Off', active: on };
  }
  if (typeof value('target_temperature') === 'number' && caps['measure_temperature']?.value != null) {
    return { detail: `${formatNumber(caps['measure_temperature'])} · set to ${formatNumber(caps['target_temperature'])}`, active: false };
  }
  if (typeof value('alarm_contact') === 'boolean') {
    return { detail: value('alarm_contact') ? 'Open' : 'Closed', active: value('alarm_contact') as boolean };
  }
  if (typeof value('locked') === 'boolean') return { detail: value('locked') ? 'Locked' : 'Unlocked', active: false };
  if (typeof value('alarm_motion') === 'boolean') {
    return { detail: value('alarm_motion') ? 'Motion' : 'No motion', active: value('alarm_motion') as boolean };
  }
  if (typeof value('windowcoverings_set') === 'number') {
    const open = Math.round((value('windowcoverings_set') as number) * 100);
    return { detail: open === 0 ? 'Closed' : `${open}% open`, active: open > 0 };
  }

  if (value('speaker_playing') === false) return { detail: 'Not playing', active: false };

  const measured = Object.values(caps).filter((c) => typeof c.value === 'number' && c.id.startsWith('measure_'));
  if (measured.length > 0) return { detail: measured.slice(0, 2).map(formatNumber).join(' · '), active: false };
  return { detail: device.zoneName ?? '', active: false };
}
