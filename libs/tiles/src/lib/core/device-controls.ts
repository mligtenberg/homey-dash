import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { CapabilityValue, HomeyCapability } from '@homey-dash/api-client';
import { clamp } from './device-view';

const THERMOSTAT_STEP = 0.5;

/**
 * Operates a device's capabilities for the controls below, which the device tile and its detail view share: sets a
 * value, drags a slider, nudges it with the arrow keys and steps a thermostat. The slider shows where a finger is
 * until Homey has the new value.
 */
export class CapabilityDriver {
  /** Which slider a finger is on and where it is, until Homey has the new value. */
  readonly dragging = signal<{ id: string; value: number } | null>(null);

  constructor(readonly set: (capability: string, value: CapabilityValue) => Promise<unknown>) {}

  percent(dim: HomeyCapability) {
    const drag = this.dragging();
    return Math.round((drag?.id === dim.id ? drag.value : (dim.value as number) || 0) * 100);
  }

  slideStart(event: PointerEvent, dim: HomeyCapability) {
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    this.slideMove(event, dim, true);
  }

  slideMove(event: PointerEvent, dim: HomeyCapability, starting = false) {
    if (!starting && this.dragging()?.id !== dim.id) return;
    const track = (event.currentTarget as Element).getBoundingClientRect();
    this.dragging.set({ id: dim.id, value: clamp((event.clientX - track.left) / (track.width || 1), 0, 1) });
  }

  async slideEnd(event: PointerEvent, dim: HomeyCapability) {
    this.slideMove(event, dim);
    const drag = this.dragging();
    if (drag?.id !== dim.id) return;
    await this.set(dim.id, Math.round(drag.value * 100) / 100);
    this.dragging.set(null);
  }

  nudge(event: Event, dim: HomeyCapability, by: number) {
    event.preventDefault();
    this.set(dim.id, Math.round(clamp(((dim.value as number) || 0) + by, 0, 1) * 100) / 100);
  }

  adjust(target: HomeyCapability, direction: 1 | -1) {
    const next = Math.round(((target.value as number) + direction * THERMOSTAT_STEP) / THERMOSTAT_STEP) * THERMOSTAT_STEP;
    this.set(target.id, clamp(next, target.min ?? -Infinity, target.max ?? Infinity));
  }
}

/** A slider for a fraction capability, such as brightness or volume. */
@Component({
  selector: 'hd-device-slider',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <div
      class="hd-slider"
      role="slider"
      [attr.aria-label]="label()"
      aria-valuemin="0"
      aria-valuemax="100"
      [attr.aria-valuenow]="driver().percent(capability())"
      [attr.aria-disabled]="disabled() || null"
      [attr.tabindex]="disabled() ? null : 0"
      (pointerdown)="driver().slideStart($event, capability())"
      (pointermove)="driver().slideMove($event, capability())"
      (pointerup)="driver().slideEnd($event, capability())"
      (pointercancel)="driver().dragging.set(null)"
      (keydown.arrowleft)="driver().nudge($event, capability(), -0.1)"
      (keydown.arrowright)="driver().nudge($event, capability(), 0.1)"
    >
      <div class="hd-slider__fill" [style.width.%]="driver().percent(capability())"></div>
    </div>
  `,
  styles: `
    .hd-slider[aria-disabled='true'] { pointer-events: none; }
  `,
})
export class DeviceSlider {
  readonly capability = input.required<HomeyCapability>();
  readonly label = input.required<string>();
  readonly disabled = input(false);
  readonly driver = input.required<CapabilityDriver>();
}

/** A choice between the values of a capability, such as Off and On or Up, Stop and Down. */
@Component({
  selector: 'hd-device-segments',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <div class="hd-segmented">
      @for (option of options(); track option.value) {
        <button
          type="button"
          [attr.aria-pressed]="capability().value === option.value"
          [disabled]="disabled()"
          (click)="driver().set(capability().id, option.value)"
        >
          {{ option.label }}
        </button>
      }
    </div>
  `,
})
export class DeviceSegments {
  readonly capability = input.required<HomeyCapability>();
  readonly options = input.required<readonly { value: CapabilityValue; label: string }[]>();
  readonly disabled = input(false);
  readonly driver = input.required<CapabilityDriver>();
}

/** The buttons that lower and raise a thermostat's target. */
@Component({
  selector: 'hd-device-stepper',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <div class="hd-round-btns">
      <button type="button" class="hd-round-btn" aria-label="Lower target" [disabled]="disabled()" (click)="driver().adjust(capability(), -1)">−</button>
      <button type="button" class="hd-round-btn" aria-label="Raise target" [disabled]="disabled()" (click)="driver().adjust(capability(), 1)">+</button>
    </div>
  `,
})
export class DeviceStepper {
  readonly capability = input.required<HomeyCapability>();
  readonly disabled = input(false);
  readonly driver = input.required<CapabilityDriver>();
}
