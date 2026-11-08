import { HomeyZone, SignalInfo } from '@homey-dash/api-client';
import { deviceLook, deviceType, HomeyData, KindHue } from '@homey-dash/tiles';
import {
  LucideBox,
  LucideClock,
  LucideIconInput,
  LucideMonitor,
  LucideTv,
  LucideVariable,
} from '@lucide/angular';
import { SignalGroup } from './signal-catalogue';
import { byName, findNode, matchesWords, searchWords } from './tree-utils';

/** A group of signals as the signal picker shows it: a device, "Variables", "Clock". */
export interface PickerGroup extends SignalGroup {
  /** What kind of group it is: `Light`, `Variables`. */
  type: string;
  icon: LucideIconInput;
  hue: KindHue;
}

/**
 * A place in the signal picker's sidebar: HomeyDash's own signals, an account, or a zone in a Homey account. Its own
 * groups, then its places, each nesting.
 */
export interface SignalPlace {
  id: string;
  name: string;
  places: SignalPlace[];
  groups: PickerGroup[];
}

/** Where the signals that come from no account sit, such as the clock and the display. */
export const GENERAL = 'homeydash';

/** The device of a Homey capability signal: `homey:{account}:capability:{device}:{capability}`. */
function deviceId(signal: SignalInfo) {
  const [, , kind, device] = signal.id.split(':');
  return kind === 'capability' || kind === 'changed' ? device : undefined;
}

function look(
  group: SignalGroup,
  homey: HomeyData | undefined,
): Pick<PickerGroup, 'type' | 'icon' | 'hue'> & { zoneId?: string | null } {
  const signal = group.signals[0];
  const id = deviceId(signal);
  if (signal.source === 'homey' && id) {
    const device = homey?.devices.get(id);
    return {
      type: device ? deviceType(device) : 'Device',
      ...deviceLook(device),
      zoneId: device?.zoneId,
    };
  }
  const icon =
    {
      homey: LucideVariable,
      clock: LucideClock,
      display: LucideMonitor,
      plex: LucideTv,
    }[signal.source] ?? LucideBox;
  return {
    type: `${group.signals.length} ${group.signals.length === 1 ? 'signal' : 'signals'}`,
    icon,
    hue: 'neutral',
  };
}

/**
 * The sidebar of the signal picker: each Homey or Plex account, Homey's with its zones as Homey nests them, then
 * HomeyDash's own signals. A Homey's single top zone (its home) is the account itself; zones without device signals
 * anywhere below are left out.
 */
export function buildPlaces(
  groups: readonly SignalGroup[],
  homeys: readonly HomeyData[],
): SignalPlace[] {
  const accounts = new Map<
    string,
    { place: SignalPlace; zones: Map<string, SignalPlace>; homey?: HomeyData }
  >();
  const general: SignalPlace = {
    id: GENERAL,
    name: 'HomeyDash',
    places: [],
    groups: [],
  };

  for (const group of groups) {
    const signal = group.signals[0];
    if (signal.account == null) {
      general.groups.push({ ...group, ...look(group, undefined) });
      continue;
    }
    const id = `${signal.source}|${signal.account}`;
    let account = accounts.get(id);
    if (!account) {
      const homey =
        signal.source === 'homey'
          ? homeys.find((h) => h.accountId === signal.account)
          : undefined;
      account = {
        place: { id, name: group.source, places: [], groups: [] },
        zones: zonePlaces(id, homey),
        homey,
      };
      accounts.set(id, account);
    }
    const { zoneId, ...picked } = look(group, account.homey);
    ((zoneId && account.zones.get(zoneId)) || account.place).groups.push({
      ...group,
      ...picked,
    });
  }

  const places = [...accounts.values()].map(({ place, zones, homey }) =>
    nest(place, zones, homey?.zones.values() ?? []),
  );
  return general.groups.length ? [...places, general] : places;
}

function zonePlaces(accountId: string, homey: HomeyData | undefined) {
  return new Map(
    [...(homey?.zones.values() ?? [])].map((z): [string, SignalPlace] => [
      z.id,
      { id: `${accountId}|${z.id}`, name: z.name, places: [], groups: [] },
    ]),
  );
}

function nest(
  account: SignalPlace,
  zones: Map<string, SignalPlace>,
  zoneList: Iterable<HomeyZone>,
): SignalPlace {
  const top: SignalPlace[] = [];
  for (const zone of zoneList) {
    const place = zones.get(zone.id);
    if (!place) continue;
    const parent = zone.parentId ? zones.get(zone.parentId) : undefined;
    (parent ? parent.places : top).push(place);
  }
  const kept = top.map(prune).filter((p) => p !== null);
  if (kept.length === 1) {
    const [home] = kept;
    return {
      ...account,
      places: home.places,
      groups: [...account.groups, ...home.groups],
    };
  }
  return { ...account, places: kept.sort(byName) };
}

function prune(place: SignalPlace): SignalPlace | null {
  const places = place.places
    .map(prune)
    .filter((p) => p !== null)
    .sort(byName);
  return places.length || place.groups.length ? { ...place, places } : null;
}

/** Every group in a place and below it, with the place it sits in. */
export function placeGroups(
  place: SignalPlace,
): { group: PickerGroup; place: SignalPlace }[] {
  return [
    ...place.groups.map((group) => ({ group, place })),
    ...place.places.flatMap(placeGroups),
  ];
}

export function countSignals(place: SignalPlace) {
  return placeGroups(place).reduce(
    (n, { group }) => n + group.signals.length,
    0,
  );
}

/** The place with this id anywhere among these. */
export const findPlace = (places: readonly SignalPlace[], id: string | null) =>
  findNode(places, id, (p) => p.places);

/** The place a group sits in. */
export function placeOf(
  places: readonly SignalPlace[],
  groupKey: string,
): SignalPlace | undefined {
  for (const place of places) {
    if (place.groups.some((g) => g.key === groupKey)) return place;
    const found = placeOf(place.places, groupKey);
    if (found) return found;
  }
  return undefined;
}

/**
 * The signals that match every word of the query, in their name, their group or the names of the places they sit in,
 * so "kitchen temp" finds the temperatures of the kitchen's devices.
 */
export function searchSignals(places: readonly SignalPlace[], query: string) {
  const words = searchWords(query);
  const found: {
    signal: SignalInfo;
    group: PickerGroup;
    place: SignalPlace;
  }[] = [];
  const walk = (place: SignalPlace, path: string) => {
    for (const group of place.groups)
      for (const signal of group.signals) {
        if (
          matchesWords(
            `${path} ${group.label} ${group.type} ${signal.name}`,
            words,
          )
        )
          found.push({ signal, group, place });
      }
    for (const child of place.places) walk(child, `${path} ${child.name}`);
  };
  if (words.length) for (const place of places) walk(place, place.name);
  return found;
}
