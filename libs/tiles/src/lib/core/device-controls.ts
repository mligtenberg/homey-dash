import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { CapabilityValue, HomeyCapability } from '@homey-dash/api-client';
import {
  LucideArrowLeft,
  LucideChevronDown,
  LucideChevronLeft,
  LucideChevronRight,
  LucideChevronsDown,
  LucideChevronsUp,
  LucideChevronUp,
  LucideDynamicIcon,
  LucideIconInput,
  LucidePause,
  LucidePlay,
  LucideTv,
  LucideVolume1,
  LucideVolume2,
  LucideVolumeX,
} from '@lucide/angular';
import { ChannelKeys, clamp, RemoteKeys, VolumeKeys } from './device-view';

/** The states a cover without a position moves between, as segments to press. */
export const COVER_STATES = [
  { value: 'up', label: 'Up' },
  { value: 'idle', label: 'Stop' },
  { value: 'down', label: 'Down' },
];

/** How far a thermostat's target moves when its own capability does not say. */
const THERMOSTAT_STEP = 0.5;

/** How long a button is held before it repeats, and how often it repeats then. */
const HOLD_MS = 400;
const REPEAT_MS = 150;

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

  private repeater?: ReturnType<typeof setTimeout>;
  private repeated = false;

  /** Presses a button capability, which is what a tap does; a toggle such as mute is switched instead. */
  press(button: HomeyCapability) {
    if (this.repeated) {
      this.repeated = false; // The hold already pressed it.
      return;
    }
    this.set(button.id, typeof button.value === 'boolean' ? !button.value : true);
  }

  /** A button held down presses again and again, as for volume or an arrow, until it is let go. */
  holdStart(button: HomeyCapability) {
    this.holdEnd();
    this.repeated = false;
    if (typeof button.value === 'boolean') return;
    const again = () => {
      this.repeated = true;
      this.set(button.id, true);
      this.repeater = setTimeout(again, REPEAT_MS);
    };
    this.repeater = setTimeout(again, HOLD_MS);
  }

  holdEnd() {
    clearTimeout(this.repeater);
    this.repeater = undefined;
  }

  adjust(target: HomeyCapability, direction: 1 | -1) {
    // Homey refuses a target that is not a whole number of steps, so a thermostat in whole degrees moves by one.
    const step = target.step && target.step > 0 ? target.step : THERMOSTAT_STEP;
    const next = Math.round(((target.value as number) + direction * step) / step) * step;
    this.set(target.id, clamp(Math.round(next * 100) / 100, target.min ?? -Infinity, target.max ?? Infinity));
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

interface RemoteKey {
  key: keyof RemoteKeys | keyof VolumeKeys | keyof ChannelKeys;
  label: string;
  icon: LucideIconInput | null;
}

const PAD: readonly RemoteKey[] = [
  { key: 'up', label: 'Up', icon: LucideChevronUp },
  { key: 'left', label: 'Left', icon: LucideChevronLeft },
  { key: 'select', label: 'Select', icon: null },
  { key: 'right', label: 'Right', icon: LucideChevronRight },
  { key: 'down', label: 'Down', icon: LucideChevronDown },
];

const SHORTCUTS: readonly RemoteKey[] = [
  { key: 'back', label: 'Back', icon: LucideArrowLeft },
  { key: 'home', label: 'Home', icon: LucideTv },
  { key: 'playpause', label: 'Play or pause', icon: LucidePlay },
];

const CHANNEL: readonly RemoteKey[] = [
  { key: 'up', label: 'Channel up', icon: LucideChevronsUp },
  { key: 'down', label: 'Channel down', icon: LucideChevronsDown },
];

/** The buttons a game controller has besides its arrows, A and B. */
const EXTRAS: readonly { key: keyof RemoteKeys; label: string }[] = [
  { key: 'x', label: 'X' },
  { key: 'y', label: 'Y' },
  { key: 'view', label: 'View' },
  { key: 'menu', label: 'Menu' },
];

// Top to bottom, as on a remote.
const VOLUME: readonly RemoteKey[] = [
  { key: 'up', label: 'Volume up', icon: LucideVolume2 },
  { key: 'mute', label: 'Mute', icon: LucideVolumeX },
  { key: 'down', label: 'Volume down', icon: LucideVolume1 },
];

/**
 * The buttons of a remote control, such as an Apple TV's: arrows around a select button, back and home, and volume
 * where the device has no slider for it. Holding an arrow or a volume button repeats it.
 */
@Component({
  selector: 'hd-device-remote',
  imports: [LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <div class="hd-remote">
      @if (shortcuts().length || playback()) {
        <div class="hd-remote__keys">
          @for (k of shortcuts(); track k.key) {
            <button type="button" class="hd-round-btn" [attr.aria-label]="k.label" [disabled]="disabled()" (click)="driver().press(k.button)">
              <svg [lucideIcon]="k.icon!" />
            </button>
          }
          @if (playback(); as playing) {
            <button
              type="button"
              class="hd-round-btn"
              [attr.aria-label]="playing.value ? 'Pause' : 'Play'"
              [disabled]="disabled()"
              (click)="driver().set(playing.id, !playing.value)"
            >
              <svg [lucideIcon]="playing.value ? pauseIcon : playIcon" />
            </button>
          }
        </div>
      }
      @if (hasPad()) {
        <div class="hd-remote__pad" role="group" aria-label="Navigation">
          @for (k of pad; track k.key) {
            @if (padKey(k); as button) {
              <button
                type="button"
                class="hd-remote__key"
                [attr.data-key]="k.key"
                [attr.aria-label]="k.label"
                [disabled]="disabled()"
                (pointerdown)="driver().holdStart(button)"
                (pointerup)="driver().holdEnd()"
                (pointerleave)="driver().holdEnd()"
                (pointercancel)="driver().holdEnd()"
                (click)="driver().press(button)"
              >
                @if (k.icon; as icon) {
                  <svg [lucideIcon]="icon" />
                }
              </button>
            }
          }
        </div>
      }
      @if (channels().length) {
        <div class="hd-remote__volume hd-remote__channel" role="group" aria-label="Channel">
          @for (k of channels(); track k.key) {
            <button type="button" class="hd-round-btn" [attr.aria-label]="k.label" [disabled]="disabled()" (click)="driver().press(k.button)">
              <svg [lucideIcon]="k.icon!" />
            </button>
          }
        </div>
      }
      @if (volumes().length) {
        <div class="hd-remote__volume" role="group" aria-label="Volume">
          @for (k of volumes(); track k.key) {
            <button
              type="button"
              class="hd-round-btn"
              [attr.aria-label]="k.label"
              [disabled]="disabled()"
              (pointerdown)="driver().holdStart(k.button)"
              (pointerup)="driver().holdEnd()"
              (pointerleave)="driver().holdEnd()"
              (pointercancel)="driver().holdEnd()"
              (click)="driver().press(k.button)"
            >
              <svg [lucideIcon]="k.icon!" />
            </button>
          }
        </div>
      }
    </div>
    @if (extras().length) {
      <div class="hd-remote__extras">
        @for (k of extras(); track k.key) {
          <button type="button" class="hd-remote__extra" [disabled]="disabled()" (click)="driver().press(k.button)">{{ k.label }}</button>
        }
      </div>
    }
  `,
})
export class DeviceRemote {
  readonly remote = input<RemoteKeys | null>(null);
  readonly volume = input<VolumeKeys | null>(null);
  readonly channel = input<ChannelKeys | null>(null);
  /** Whether the device plays and pauses by itself in the view, so a play button here would repeat it. */
  readonly playsElsewhere = input(false);
  /** The capability that plays and pauses, as a button here, when the view has no transport of its own. */
  readonly playback = input<HomeyCapability | null>(null);
  protected readonly playIcon = LucidePlay;
  protected readonly pauseIcon = LucidePause;
  readonly disabled = input(false);
  readonly driver = input.required<CapabilityDriver>();

  protected readonly pad = PAD;
  protected padKey(k: RemoteKey) {
    return this.remote()?.[k.key as keyof RemoteKeys];
  }
  protected readonly hasPad = computed(() => PAD.some((k) => this.remote()?.[k.key as keyof RemoteKeys]));
  protected readonly shortcuts = computed(() =>
    SHORTCUTS.flatMap((k) => {
      const button = this.remote()?.[k.key as keyof RemoteKeys];
      return button && !(k.key === 'playpause' && this.playsElsewhere()) ? [{ ...k, button }] : [];
    }),
  );
  protected readonly channels = computed(() =>
    CHANNEL.flatMap((k) => {
      const button = this.channel()?.[k.key as keyof ChannelKeys];
      return button ? [{ ...k, button }] : [];
    }),
  );
  protected readonly extras = computed(() =>
    EXTRAS.flatMap((k) => {
      const button = this.remote()?.[k.key];
      return button ? [{ ...k, button }] : [];
    }),
  );
  protected readonly volumes = computed(() =>
    VOLUME.flatMap((k) => {
      const button = this.volume()?.[k.key as keyof VolumeKeys];
      return button ? [{ ...k, button }] : [];
    }),
  );
}
