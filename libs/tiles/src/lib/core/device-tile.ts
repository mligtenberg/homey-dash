import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { CapabilityValue, HomeyCapability, HomeyDevice, Realtime } from '@homey-dash/api-client';
import { LucideDynamicIcon } from '@lucide/angular';
import { TileData, TileSettings } from '../tile-data';
import { deviceDetail, deviceLook, formatReading } from './device-look';
import { TILE_FACE_HOST, TileFace, TileView } from './tile-view';

export interface DeviceTileSettings extends TileSettings {
  /** The capability the tile is about; absent picks one from the device. */
  capability?: string;
}

/** Capabilities a tile can operate, in the order `auto` prefers them. */
const CONTROLS = ['onoff', 'dim', 'target_temperature', 'windowcoverings_state'];

const COVER_STATES = [
  { value: 'up', label: 'Up' },
  { value: 'idle', label: 'Stop' },
  { value: 'down', label: 'Down' },
];

const THERMOSTAT_STEP = 0.5;

/** The capability a device tile is about: the one picked, or the first it can operate, or its first reading. */
export function primaryCapability(device: HomeyDevice, picked: string | undefined): HomeyCapability | null {
  const caps = device.capabilities;
  if (picked && caps[picked]) return caps[picked];
  const control = CONTROLS.map((id) => caps[id]).find((c) => c?.setable);
  return control ?? Object.values(caps).find((c) => typeof c.value === 'number' && c.id.startsWith('measure_')) ?? null;
}

interface DeviceFace extends TileFace {
  reading?: { value: string; units: string };
  /** The `dim` capability when the tile shows a brightness slider. */
  slider?: HomeyCapability;
  thermostat?: HomeyCapability;
  cover?: HomeyCapability;
}

// The face plus inline controls; a control is left out where the tile size has no room for it.
@Component({
  selector: 'hd-device-tile',
  imports: [LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: TILE_FACE_HOST,
  template: `
    <div class="hd-row top">
      <svg class="hd-icon" [lucideIcon]="face().icon" />
      @if (face().state === 'ok') {
        @if (face().thermostat; as target) {
          <div class="hd-round-btns">
            <button type="button" class="hd-round-btn" aria-label="Lower target" (click)="adjust(target, -1)">−</button>
            <button type="button" class="hd-round-btn" aria-label="Raise target" (click)="adjust(target, 1)">+</button>
          </div>
        } @else if (size() !== 'large' && face().reading; as reading) {
          <div class="hd-value hd-value--m">{{ reading.value }}<span class="hd-unit">{{ reading.units }}</span></div>
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
      <div
        class="hd-slider"
        role="slider"
        [attr.aria-label]="face().name + ' brightness'"
        aria-valuemin="0"
        aria-valuemax="100"
        [attr.aria-valuenow]="percent(dim)"
        [attr.aria-disabled]="face().state !== 'ok' || null"
        [attr.tabindex]="face().state === 'ok' ? 0 : null"
        (pointerdown)="slideStart($event)"
        (pointermove)="slideMove($event)"
        (pointerup)="slideEnd($event)"
        (pointercancel)="dragging.set(null)"
        (keydown.arrowleft)="nudge($event, dim, -0.1)"
        (keydown.arrowright)="nudge($event, dim, 0.1)"
      >
        <div class="hd-slider__fill" [style.width.%]="percent(dim)"></div>
      </div>
    }
    @if (face().cover; as state) {
      <div class="hd-segmented">
        @for (option of coverStates; track option.value) {
          <button
            type="button"
            [attr.aria-pressed]="state.value === option.value"
            [disabled]="face().state !== 'ok'"
            (click)="set('windowcoverings_state', option.value)"
          >
            {{ option.label }}
          </button>
        }
      </div>
    }
    @if (face().state === 'unavailable') {
      <span class="hd-badge">Unavailable</span>
    }
  `,
  styles: `
    .top { align-items: flex-start; }
    .hd-slider[aria-disabled='true'] { pointer-events: none; }
  `,
})
export class DeviceTile extends TileView<DeviceTileSettings> {
  private readonly realtime = inject(Realtime);

  protected readonly coverStates = COVER_STATES;
  /** Where the slider is while a finger is on it, and until Homey has the new brightness. */
  protected readonly dragging = signal<number | null>(null);

  private readonly device = computed(() => this.data.devices().get(this.settings().target ?? ''));

  readonly face = computed<DeviceFace>(() => {
    const device = this.device();
    const look = deviceLook(device);
    if (!device) return this.absentFace({ ...look, noun: 'Device' });

    const { detail, active } = deviceDetail(device);
    const ok = device.available;
    const face: DeviceFace = { ...look, name: this.settings().label || device.name, detail, active, state: ok ? 'ok' : 'unavailable' };
    const caps = device.capabilities;
    const primary = primaryCapability(device, this.settings().capability);
    const roomy = this.size() !== 'small';

    switch (primary?.id) {
      case 'onoff':
      case 'dim':
        face.tappable = ok && !!caps['onoff']?.setable;
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
      default:
        if (typeof primary?.value === 'number') {
          face.reading = formatReading(primary.value, primary.units);
          face.detail = primary.title;
        }
    }
    if (this.flash() === 'error') face.detail = 'Did not respond';
    return face;
  });

  protected override tap() {
    const device = this.device();
    if (device) this.set('onoff', !device.capabilities['onoff']?.value);
  }

  protected set(capability: string, value: CapabilityValue) {
    const id = this.settings().target;
    // The tile changes when Homey reports the new value, not before.
    if (id) return this.send(() => this.realtime.setCapability(id, capability, value), 'quiet');
    return Promise.resolve();
  }

  protected adjust(target: HomeyCapability, direction: 1 | -1) {
    const next = Math.round(((target.value as number) + direction * THERMOSTAT_STEP) / THERMOSTAT_STEP) * THERMOSTAT_STEP;
    this.set(target.id, clamp(next, target.min ?? -Infinity, target.max ?? Infinity));
  }

  protected percent(dim: HomeyCapability) {
    return Math.round((this.dragging() ?? ((dim.value as number) || 0)) * 100);
  }

  protected slideStart(event: PointerEvent) {
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    this.slideMove(event, true);
  }

  protected slideMove(event: PointerEvent, starting = false) {
    if (!starting && this.dragging() === null) return;
    const track = (event.currentTarget as Element).getBoundingClientRect();
    this.dragging.set(clamp((event.clientX - track.left) / (track.width || 1), 0, 1));
  }

  protected async slideEnd(event: PointerEvent) {
    this.slideMove(event);
    const value = this.dragging();
    if (value === null) return;
    await this.set('dim', Math.round(value * 100) / 100);
    this.dragging.set(null);
  }

  protected nudge(event: Event, dim: HomeyCapability, by: number) {
    event.preventDefault();
    this.set('dim', Math.round(clamp(((dim.value as number) || 0) + by, 0, 1) * 100) / 100);
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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
    Object.values(this.data.devices().get(this.settings().target ?? '')?.capabilities ?? {}),
  );

  protected pick(capability: string) {
    this.changed.emit({ capability: capability || undefined });
  }
}
