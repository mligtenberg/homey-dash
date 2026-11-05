import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HomeyCapability, HomeyDevice, Realtime } from '@homey-dash/api-client';
import { FakeRealtime } from '@homey-dash/api-client/testing';
import { TileSize } from '@homey-dash/layout';
import { RealtimeTileData } from '../realtime-tile-data';
import { TileData } from '../tile-data';
import { SONOS_TILES } from './sonos-tiles';
import { SonosTile } from './sonos-tile';

const capability = (
  id: string,
  value: HomeyCapability['value'],
  setable = true,
): HomeyCapability => ({
  id,
  title: id,
  type:
    typeof value === 'boolean'
      ? 'boolean'
      : typeof value === 'number'
        ? 'number'
        : 'string',
  value,
  units: null,
  setable,
  getable: true,
  min: null,
  max: null,
  step: null,
  lastUpdated: null,
});

const speaker = (
  id: string,
  name: string,
  group: string,
  playing = false,
  volume = 0.2,
): HomeyDevice => ({
  id,
  name,
  zoneId: null,
  zoneName: null,
  class: 'speaker',
  available: true,
  unavailableMessage: null,
  capabilities: Object.fromEntries(
    [
      capability('speaker_playing', playing),
      capability('speaker_track', 'Radio 2', false),
      capability('speaker_next', null),
      capability('speaker_prev', null),
      capability('volume_set', volume),
      capability('sonos_group', group, false),
    ].map((c) => [c.id, c]),
  ),
  albumArt: null,
});

describe('Sonos tile', () => {
  let realtime: FakeRealtime;

  beforeEach(() => {
    realtime = new FakeRealtime();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Realtime, useValue: realtime },
        { provide: TileData, useExisting: RealtimeTileData },
      ],
    });
  });

  const settle = () => TestBed.inject(ApplicationRef).whenStable();

  async function render(devices: HomeyDevice[], size: TileSize = 'full-tall') {
    TestBed.inject(TileData);
    await settle();
    for (const device of devices)
      realtime.push('DeviceChanged', { accountId: 1, device });
    const fixture = TestBed.createComponent(SonosTile);
    fixture.componentRef.setInput('settings', {
      target: null,
      targets: devices.map((d) => d.id),
    });
    fixture.componentRef.setInput('size', size);
    await settle();
    return fixture.nativeElement as HTMLElement;
  }

  const button = (root: Element, label: string) =>
    root.querySelector(`button[aria-label="${label}"]`) as HTMLElement;

  it('shows the first room that plays and how many rooms play with it', async () => {
    const tile = await render([
      speaker('a', 'Kitchen', 'Kitchen'),
      speaker('b', 'Living room', 'Living room', true),
      speaker('c', 'Office', 'Living room', true),
    ]);
    expect(tile.textContent).toContain('2 rooms · Radio 2');
    expect(tile.querySelector('.hd-sonos__row.is-in-group')).not.toBeNull();
    expect(button(tile, 'Take Office out of the group')).toBeTruthy();
    expect(button(tile, 'Play in Kitchen')).toBeTruthy();
  });

  it('plays, pauses and skips on the lead room', async () => {
    const tile = await render(
      [speaker('a', 'Kitchen', 'Kitchen', true)],
      'full-large',
    );
    button(tile, 'Pause').click();
    button(tile, 'Next').click();
    await settle();
    expect(realtime.commands).toEqual([
      ['setCapability', undefined, 'a', 'speaker_playing', false],
      ['setCapability', undefined, 'a', 'speaker_next', true],
    ]);
  });

  it("adds a room to the lead room's group and takes one out", async () => {
    const tile = await render([
      speaker('a', 'Living room', 'Living room', true),
      speaker('b', 'Kitchen', 'Kitchen'),
      speaker('c', 'Office', 'Living room'),
    ]);
    button(tile, 'Play in Kitchen').click();
    button(tile, 'Take Office out of the group').click();
    await settle();
    expect(realtime.commands).toEqual([
      ['joinSpeakerGroup', undefined, 'b', 'a'],
      ['leaveSpeakerGroup', undefined, 'c'],
    ]);
  });

  it('lists every room in the detail view of a small tile', async () => {
    HTMLDialogElement.prototype.showModal ??= function (
      this: HTMLDialogElement,
    ) {
      this.open = true;
    };
    const tile = await render(
      [
        speaker('a', 'Living room', 'Living room', true),
        speaker('b', 'Kitchen', 'Kitchen'),
      ],
      'small',
    );
    expect(button(tile, 'Play in Kitchen')).toBeNull();
    tile.click();
    await settle();
    expect(button(tile, 'Play in Kitchen')).toBeTruthy();
  });

  it('registers the kind for several devices', () => {
    expect(SONOS_TILES.kinds.map((k) => [k.id, k.target, k.multiple])).toEqual([
      ['sonos', 'device', true],
    ]);
  });
});
