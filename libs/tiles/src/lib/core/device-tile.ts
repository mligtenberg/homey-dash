import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { CapabilityValue, HomeyCapability, HomeyDevice, Realtime } from '@homey-dash/api-client';
import { LucideDynamicIcon, LucidePower } from '@lucide/angular';
import { TileData, TileSettings } from '../tile-data';
import { deviceDetail, deviceLook, formatReading } from './device-look';
import { TileDetails } from './tile-details';
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

const ON_OFF_STATES = [
  { value: false, label: 'Off' },
  { value: true, label: 'On' },
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

// The face plus inline controls; a control is left out where the tile size has no room for it. The detail view
// has them all, so a small tile can still be fully operated.
@Component({
  selector: 'hd-device-tile',
  imports: [LucideDynamicIcon, NgTemplateOutlet, TileDetails],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: TILE_FACE_HOST,
  template: `
    <ng-template #thermostatButtons let-target>
      <div class="hd-round-btns">
        <button type="button" class="hd-round-btn" aria-label="Lower target" [disabled]="face().state !== 'ok'" (click)="adjust(target, -1)">−</button>
        <button type="button" class="hd-round-btn" aria-label="Raise target" [disabled]="face().state !== 'ok'" (click)="adjust(target, 1)">+</button>
      </div>
    </ng-template>
    <ng-template #slider let-dim>
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
    </ng-template>
    <ng-template #segments let-capability="capability" let-options="options">
      <div class="hd-segmented">
        @for (option of options; track option.value) {
          <button
            type="button"
            [attr.aria-pressed]="capability.value === option.value"
            [disabled]="face().state !== 'ok'"
            (click)="set(capability.id, option.value)"
          >
            {{ option.label }}
          </button>
        }
      </div>
    </ng-template>

    <div class="hd-row hd-row--top">
      <!-- A small tile has no room for the icon beside a reading, and the reading says more. -->
      @if (size() === 'small' && face().state === 'ok' && face().reading; as reading) {
        <div class="hd-value hd-value--m">{{ reading.value }}<span class="hd-unit">{{ reading.units }}</span></div>
      } @else {
        <svg class="hd-icon" [lucideIcon]="face().icon" />
        @if (face().action; as action) {
          <button type="button" class="hd-round-btn hd-tile__action" [attr.aria-label]="action" [disabled]="face().state !== 'ok'" (click)="act()">
            <svg [lucideIcon]="powerIcon" />
          </button>
        } @else if (face().state === 'ok') {
          @if (face().thermostat; as target) {
            <ng-container *ngTemplateOutlet="thermostatButtons; context: { $implicit: target }" />
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
      <ng-container *ngTemplateOutlet="slider; context: { $implicit: dim }" />
    }
    @if (face().cover; as cover) {
      <ng-container *ngTemplateOutlet="segments; context: { capability: cover, options: coverStates }" />
    }
    @if (face().state === 'unavailable') {
      <span class="hd-badge">Unavailable</span>
    }
    <hd-tile-details [name]="face().name" [icon]="face().icon" [subtitle]="controls()?.room ?? ''">
      @if (controls(); as c) {
        @if (c.state) {
          <div class="hd-details__state">{{ c.state }}</div>
        }
        @if (c.onoff; as onoff) {
          <ng-container *ngTemplateOutlet="segments; context: { capability: onoff, options: onOffStates }" />
        }
        @if (c.dim; as dim) {
          <div class="hd-details__row">
            <span class="hd-details__label">Brightness</span>
            <span class="hd-value hd-value--m">{{ percent(dim) }}<span class="hd-unit">%</span></span>
          </div>
          <ng-container *ngTemplateOutlet="slider; context: { $implicit: dim }" />
        }
        @if (c.thermostat; as target) {
          <div class="hd-details__row">
            <div>
              @if (c.measured; as measured) {
                <div class="hd-value hd-value--l">{{ measured.value }}<span class="hd-unit">{{ measured.units }}</span></div>
              }
              <div class="hd-details__label">Set to {{ c.target?.value }}{{ c.target?.units }}</div>
            </div>
            <ng-container *ngTemplateOutlet="thermostatButtons; context: { $implicit: target }" />
          </div>
        }
        @if (c.cover; as cover) {
          <ng-container *ngTemplateOutlet="segments; context: { capability: cover, options: coverStates }" />
        }
        @if (c.readings.length) {
          <dl class="hd-details__readings">
            @for (reading of c.readings; track reading.id) {
              <dt class="hd-details__label">{{ reading.title }}</dt>
              <dd>{{ reading.value }}<span class="hd-unit">{{ reading.units }}</span></dd>
            }
          </dl>
        }
      }
    </hd-tile-details>
  `,
  styles: `
    .hd-slider[aria-disabled='true'] { pointer-events: none; }
  `,
})
export class DeviceTile extends TileView<DeviceTileSettings> {
  private readonly realtime = inject(Realtime);

  protected readonly coverStates = COVER_STATES;
  protected readonly onOffStates = ON_OFF_STATES;
  protected readonly powerIcon = LucidePower;
  /** Where the slider is while a finger is on it, and until Homey has the new brightness. */
  protected readonly dragging = signal<number | null>(null);

  private readonly device = computed(() => this.data.devices().get(this.settings().target ?? ''));

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
      default:
        if (typeof primary?.value === 'number') {
          face.reading = formatReading(primary.value, primary.units);
          face.detail = primary.title;
        }
    }
    if (this.flash() === 'error') face.detail = 'Did not respond';
    face.details = this.addsToFace(face, face.reading && (primary?.id === 'target_temperature' ? 'measure_temperature' : primary?.id));
    return face;
  });

  /** Everything the detail view shows: every control the device has, whatever the tile size. */
  protected readonly controls = computed(() => {
    const device = this.device();
    if (!device) return null;
    const caps = device.capabilities;
    const control = (id: string) => (caps[id]?.setable ? caps[id] : undefined);
    const reading = (c: HomeyCapability | undefined) =>
      typeof c?.value === 'number' ? formatReading(c.value, c.units) : undefined;
    const thermostat = control('target_temperature');
    // A thermostat's row says it all, so its state line only shows when something is wrong.
    const shown = new Set([...CONTROLS, ...(thermostat ? ['measure_temperature'] : [])]);
    return {
      room: device.zoneName ?? '',
      state: this.flash() === 'error' ? 'Did not respond' : device.available ? (thermostat ? '' : deviceDetail(device).detail) : device.unavailableMessage || 'Unavailable',
      onoff: control('onoff'),
      dim: control('dim'),
      thermostat,
      target: reading(thermostat),
      measured: reading(caps['measure_temperature']),
      cover: control('windowcoverings_state'),
      readings: Object.values(caps)
        .filter((c) => !shown.has(c.id) && !c.setable && typeof c.value === 'number')
        .map((c) => ({ id: c.id, title: c.title, ...formatReading(c.value as number, c.units) })),
    };
  });

  /**
   * Whether the detail view shows more than the face, whose reading is the capability `shown`: a control or reading
   * the tile has no room for, or why the device is unavailable. A view that only repeats the tile does not open.
   */
  private addsToFace(face: DeviceFace, shown: string | undefined): boolean {
    const c = this.controls();
    const device = this.device();
    if (!c || !device) return false;
    return (
      (!device.available && !!device.unavailableMessage) ||
      (!!c.onoff && !face.action) ||
      (!!c.dim && !face.slider) ||
      (!!c.thermostat && !face.thermostat) ||
      (!!c.cover && !face.cover) ||
      c.readings.some((r) => r.id !== shown)
    );
  }

  protected override act() {
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
