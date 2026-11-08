import { ChangeDetectionStrategy, Component, computed, inject, input, output, viewChild } from '@angular/core';
import { CapabilityValue, HomeyCapability, HomeyDevice, homeyImageUrl, Realtime } from '@homey-dash/api-client';
import { LucideDynamicIcon, LucideIconInput, LucidePause, LucidePlay, LucidePower } from '@lucide/angular';
import { TileData, TileSettings } from '../tile-data';
import { CapabilityDriver, DeviceSegments, DeviceSlider, DeviceStepper } from './device-controls';
import { DeviceDetails } from './device-details';
import { loadableArt } from './loadable-art';
import { CONTROLS, deviceDetail, deviceLook, formatReading } from './device-look';
import { describeDevice, deviceLogs, sameLogs } from './device-view';
import { TILE_FACE_HOST, TileFace, TileView } from './tile-view';

export interface DeviceTileSettings extends TileSettings {
  /** The capability the tile is about; absent picks one from the device. */
  capability?: string;
}

const COVER_STATES = [
  { value: 'up', label: 'Up' },
  { value: 'idle', label: 'Stop' },
  { value: 'down', label: 'Down' },
];

/** The capability a device tile is about: the one picked, or the first it can operate, or its first reading. */
export function primaryCapability(device: HomeyDevice, picked: string | undefined): HomeyCapability | null {
  const caps = device.capabilities;
  if (picked && caps[picked]) return caps[picked];
  const control = CONTROLS.map((id) => caps[id]).find((c) => c?.setable);
  return control ?? Object.values(caps).find((c) => typeof c.value === 'number' && c.id.startsWith('measure_')) ?? null;
}

/** Device classes that usually open apps (an Apple TV, a smart TV, a game console). */
const APP_CLASSES = new Set(['tv', 'settopbox', 'gameconsole']);

interface DeviceFace extends TileFace {
  /** The icon on the quick action's button; a power button unless said otherwise. */
  actionIcon?: LucideIconInput;
  /** The album art of what the device plays, which the tile shows behind its face. */
  art?: string;
  reading?: { value: string; units: string };
  /** The `dim` capability when the tile shows a brightness slider. */
  slider?: HomeyCapability;
  /** The `volume_set` capability when a speaker's tile shows a volume slider. */
  volume?: HomeyCapability;
  thermostat?: HomeyCapability;
  cover?: HomeyCapability;
}

// The face plus inline controls; a control is left out where the tile size has no room for it. The detail view
// has them all, so a small tile can still be fully operated.
@Component({
  selector: 'hd-device-tile',
  imports: [LucideDynamicIcon, DeviceDetails, DeviceSegments, DeviceSlider, DeviceStepper],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { ...TILE_FACE_HOST, '[class.has-art]': '!!face().art', '[style.--art]': "face().art ? 'url(' + face().art + ')' : null" },
  template: `
    <div class="hd-row hd-row--top">
      <!-- A small tile has no room for the icon beside a reading, and the reading says more. -->
      @if (size() === 'small' && face().state === 'ok' && face().reading; as reading) {
        <div class="hd-value hd-value--m">{{ reading.value }}<span class="hd-unit">{{ reading.units }}</span></div>
      } @else {
        <svg class="hd-icon" [lucideIcon]="face().icon" />
        @if (face().action; as action) {
          <button type="button" class="hd-round-btn hd-tile__action" [attr.aria-label]="action" [disabled]="face().state !== 'ok'" (click)="act()">
            <svg [lucideIcon]="face().actionIcon ?? powerIcon" />
          </button>
        } @else if (face().state === 'ok') {
          @if (face().thermostat; as target) {
            <hd-device-stepper [capability]="target" [disabled]="face().state !== 'ok'" [driver]="drive" />
          } @else if (size() !== 'large' && face().reading; as reading) {
            <div class="hd-value hd-value--m">{{ reading.value }}<span class="hd-unit">{{ reading.units }}</span></div>
          }
        }
      }
    </div>
    @if (size() === 'large' && face().reading; as reading) {
      <div class="hd-value hd-value--xl">{{ reading.value }}<span class="hd-unit">{{ reading.units }}</span></div>
    }
    <div>
      <div class="hd-tile__name">{{ face().name }}</div>
      <div class="hd-tile__detail">{{ face().detail }}</div>
    </div>
    @if (face().slider; as dim) {
      <hd-device-slider [capability]="dim" [label]="face().name + ' brightness'" [disabled]="face().state !== 'ok'" [driver]="drive" />
    }
    @if (face().volume; as volume) {
      <div class="hd-tile__volume">
        <span class="hd-tile__volume-label">Volume</span>
        <hd-device-slider [capability]="volume" [label]="face().name + ' volume'" [disabled]="face().state !== 'ok'" [driver]="drive" />
      </div>
    }
    @if (face().cover; as cover) {
      <hd-device-segments [capability]="cover" [options]="coverStates" [disabled]="face().state !== 'ok'" [driver]="drive" />
    }
    @if (face().state === 'unavailable') {
      <span class="hd-badge">Unavailable</span>
    }
    @if (device(); as device) {
      <hd-device-details [account]="settings().account" [deviceId]="device.id" [name]="face().name" [icon]="face().icon" />
    }
  `,
})
export class DeviceTile extends TileView<DeviceTileSettings> {
  private readonly realtime = inject(Realtime);

  protected readonly coverStates = COVER_STATES;
  protected readonly powerIcon = LucidePower;
  protected readonly drive = new CapabilityDriver((capability, value) => this.set(capability, value));

  protected readonly device = computed(() => this.homey()?.devices.get(this.settings().target ?? ''));
  private readonly deviceDetails = viewChild(DeviceDetails);

  /** The album art of what the device plays, once it is known to load. */
  private readonly art = loadableArt(() => {
    const device = this.device();
    const accountId = this.homey()?.accountId;
    return device?.capabilities['speaker_playing']?.value === true && device.albumArt && accountId !== undefined ? homeyImageUrl(accountId, device.albumArt) : null;
  });

  /** The insight logs of the device's readings that can be charted, which its detail view shows the history of. */
  private readonly logs = computed(() => deviceLogs(this.homey()?.insights, this.device()?.id ?? ''), { equal: sameLogs });

  readonly face = computed<DeviceFace>(() => {
    const device = this.device();
    const look = deviceLook(device);
    if (!device) return this.absentFace({ ...look, noun: 'Device' });

    const { detail, active } = deviceDetail(device);
    const ok = device.available;
    const name = this.settings().label || device.name;
    const face: DeviceFace = { ...look, name, detail, active, state: ok ? 'ok' : 'unavailable' };
    const caps = device.capabilities;
    const primary = primaryCapability(device, this.settings().capability);
    const roomy = this.size() !== 'small';

    switch (primary?.id) {
      case 'onoff':
      case 'dim':
        if (caps['onoff']?.setable) face.action = active ? 'Turn off' : 'Turn on';
        if (roomy && caps['dim']?.setable) face.slider = caps['dim'];
        break;
      case 'target_temperature': {
        const target = formatReading(primary.value as number, primary.units);
        const measured = caps['measure_temperature'];
        if (roomy) face.thermostat = primary;
        if (roomy && this.size() !== 'large') break; // A wide tile has the buttons where the reading would go.
        face.reading = typeof measured?.value === 'number' ? formatReading(measured.value, measured.units) : target;
        face.detail = `Set to ${target.value}${target.units}`;
        break;
      }
      case 'windowcoverings_state':
        if (roomy) face.cover = primary;
        break;
      case 'speaker_playing':
        face.action = primary.value ? 'Pause' : 'Play';
        face.actionIcon = primary.value ? LucidePause : LucidePlay;
        if (roomy && caps['volume_set']?.setable) face.volume = caps['volume_set'];
        break;
      default:
        if (typeof primary?.value === 'number') {
          face.reading = formatReading(primary.value, primary.units);
          face.detail = primary.title;
        }
    }
    const art = this.art();
    if (art) face.art = art;
    if (this.flash() === 'error') face.detail = 'Did not respond';
    face.details = this.addsToFace(face, face.reading && (primary?.id === 'target_temperature' ? 'measure_temperature' : primary?.id));
    return face;
  });

  protected override openDetails() {
    this.deviceDetails()?.open();
  }

  protected override closeDetails() {
    this.deviceDetails()?.close();
  }

  /**
   * Whether the detail view shows more than the face, whose reading is the capability `shown`: a control or reading
   * the tile has no room for, or why the device is unavailable. A view that only repeats the tile does not open.
   */
  private addsToFace(face: DeviceFace, shown: string | undefined): boolean {
    const device = this.device();
    if (!device) return false;
    const c = describeDevice(device, this.homey()?.accountId, false);
    return (
      (!device.available && !!device.unavailableMessage) ||
      (!!c.onoff && !face.action) ||
      (!!c.dim && !face.slider) ||
      (!!c.thermostat && !face.thermostat) ||
      (!!c.cover && !face.cover) ||
      this.logs().length > 0 ||
      !!c.position ||
      !!c.lock ||
      (!!c.volume && !face.volume) ||
      !!c.progress ||
      !!c.remote ||
      !!c.volumeKeys ||
      !!c.channel ||
      // These may open apps, which only the backend knows.
      APP_CLASSES.has(device.class) ||
      (c.mode === 'speaker' && (!!c.next || !!c.previous || !!c.art)) ||
      c.readings.some((r) => r.id !== shown)
    );
  }

  protected override act() {
    const device = this.device();
    if (!device) return;
    const id = primaryCapability(device, this.settings().capability)?.id === 'speaker_playing' ? 'speaker_playing' : 'onoff';
    this.set(id, !device.capabilities[id]?.value);
  }

  protected set(capability: string, value: CapabilityValue) {
    const id = this.settings().target;
    // The tile changes when Homey reports the new value, not before.
    if (id) return this.send(() => this.realtime.setCapability(this.settings().account, id, capability, value), 'quiet');
    return Promise.resolve();
  }
}

/** Management's choice of the capability a device tile is about. */
@Component({
  selector: 'hd-device-tile-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hd-field">
      <label class="hd-field__label" for="tile-capability">Shows</label>
      <select id="tile-capability" class="hd-select" (change)="pick($any($event.target).value)">
        <option value="" [selected]="!settings().capability">Automatic</option>
        @for (capability of capabilities(); track capability.id) {
          <option [value]="capability.id" [selected]="capability.id === settings().capability">{{ capability.title }}</option>
        }
      </select>
    </div>
  `,
})
export class DeviceTileSettingsEditor {
  readonly settings = input.required<DeviceTileSettings>();
  readonly changed = output<Partial<DeviceTileSettings>>();

  private readonly data = inject(TileData);

  protected readonly capabilities = computed(() =>
    Object.values(this.data.homey(this.settings().account)?.devices.get(this.settings().target ?? '')?.capabilities ?? {}),
  );

  protected pick(capability: string) {
    this.changed.emit({ capability: capability || undefined });
  }
}
