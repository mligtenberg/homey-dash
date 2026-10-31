import { HomeyDevice, SignalInfo } from '@homey-dash/api-client';
import { HomeyData } from '@homey-dash/tiles';
import { groupSignals } from './signal-catalogue';
import { buildPlaces, findPlace, placeGroups, searchSignals } from './signal-tree';

const homeySignal = (id: string, name: string, group: string): SignalInfo => ({
  id: `homey:1:${id}`,
  source: 'homey',
  type: 'number',
  name,
  group,
  account: 1,
  accountName: 'Home',
});

const signals: SignalInfo[] = [
  homeySignal('capability:lamp:dim', 'Dim level', 'Reading lamp'),
  homeySignal('capability:thermo:measure_temperature', 'Temperature', 'Thermostat'),
  homeySignal('changed:thermo:measure_temperature', 'Temperature last changed', 'Thermostat'),
  homeySignal('capability:stray:dim', 'Dim level', 'Stray lamp'),
  homeySignal('variable:v1', 'Guests', 'Variables'),
  { id: 'clock:now', source: 'clock', type: 'dateTime', name: 'Now', group: 'Clock' },
  { id: 'display:name', source: 'display', type: 'text', name: 'Name', group: 'Display' },
];

const device = (id: string, zoneId: string | null) => ({ id, name: id, class: 'light', zoneId, capabilities: {} }) as unknown as HomeyDevice;

const homey = {
  accountId: 1,
  accountName: 'Home',
  devices: new Map([
    ['lamp', device('lamp', 'living')],
    ['thermo', device('thermo', 'bedroom')],
    ['stray', device('stray', 'gone')],
  ]),
  zones: new Map([
    ['home', { id: 'home', name: 'Home', parentId: null }],
    ['living', { id: 'living', name: 'Living room', parentId: 'home' }],
    ['upstairs', { id: 'upstairs', name: 'Upstairs', parentId: 'home' }],
    ['bedroom', { id: 'bedroom', name: 'Bedroom', parentId: 'upstairs' }],
    ['garden', { id: 'garden', name: 'Garden', parentId: 'home' }],
  ]),
} as unknown as HomeyData;

describe('buildPlaces', () => {
  const places = buildPlaces(groupSignals(signals), [homey]);

  it('puts each account first and HomeyDash’s own signals last', () => {
    expect(places.map((p) => p.name)).toEqual(['Homey — Home', 'HomeyDash']);
    expect(places[1].groups.map((g) => g.label)).toEqual(['Clock', 'Display']);
  });

  it('nests device groups in their zones, with the home as the account itself and empty zones left out', () => {
    const [account] = places;
    expect(account.places.map((p) => p.name)).toEqual(['Living room', 'Upstairs']);
    expect(account.places[1].places.map((p) => p.name)).toEqual(['Bedroom']);
    expect(account.groups.map((g) => g.label)).toEqual(['Stray lamp', 'Variables']);
  });

  it('lists every group below a place', () => {
    expect(placeGroups(places[0]).map((e) => e.group.label)).toEqual(['Stray lamp', 'Variables', 'Reading lamp', 'Thermostat']);
    expect(placeGroups(findPlace(places, 'homey|1|upstairs')!).map((e) => e.group.label)).toEqual(['Thermostat']);
  });

  it('finds signals by every word, in their places too', () => {
    expect(searchSignals(places, 'bedroom temp').map((f) => f.signal.name)).toEqual(['Temperature', 'Temperature last changed']);
    expect(searchSignals(places, '')).toEqual([]);
  });
});
