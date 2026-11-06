import { computed, DestroyRef, Directive, inject, input, Signal, signal, viewChild } from '@angular/core';
import { LucideIconInput } from '@lucide/angular';
import { TileSize } from '@homey-dash/layout';
import { TileData, TileSettings } from '../tile-data';
import { KindHue } from '../tile-kind';
import { TileDetails } from './tile-details';

/** What a basic tile shows; the core kinds differ only in how they derive it from their target. */
export interface TileFace {
  name: string;
  detail: string;
  icon: LucideIconInput;
  hue: KindHue;
  active?: boolean;
  /** The label of the corner button that acts on the target at once (see `act`), such as `Turn off` or `Start`. */
  action?: string;
  /** Whether the tile has a detail view, which a press anywhere else on the tile opens. */
  details?: boolean;
  /** `unset`: no target picked yet; `loading`: Homey's data has not arrived. */
  state: 'ok' | 'unavailable' | 'missing' | 'unset' | 'loading';
}

// Shared by the core kinds' components, whose host element is the tile itself.
export const TILE_FACE_HOST = {
  class: 'hd-tile',
  '[attr.data-size]': 'size()',
  '[attr.data-kind]': "face().state === 'missing' || face().hue === 'neutral' ? null : face().hue",
  '[class.is-active]': "face().active && face().state === 'ok'",
  '[class.is-unavailable]': "face().state === 'unavailable'",
  '[class.is-missing]': "face().state === 'missing'",
  '[class.is-feedback]': "flash() === 'ok'",
  '[class.is-error]': "flash() === 'error'",
  '[attr.data-tap]': "opensDetails() ? '' : null",
  '[attr.role]': "opensDetails() ? 'button' : null",
  '[attr.tabindex]': 'opensDetails() ? 0 : null',
  '(click)': 'onPress($event)',
  '(keydown.enter)': 'onKey($event)',
  '(keydown.space)': 'onKey($event)',
};

/** How long a tile shows the outcome of a press, such as "Started". */
export const FLASH_MS = 1400;

@Directive()
export abstract class TileView<TSettings extends TileSettings = TileSettings> {
  readonly settings = input.required<TSettings>();
  readonly size = input.required<TileSize>();
  /** False when the tile's kind turns the detail view off (`TileKind.details`). */
  readonly detailView = input(true);

  protected readonly data = inject(TileData);
  /** The Homey of the tile's account, for kinds that point at something in Homey. */
  protected readonly homey = computed(() => this.data.homey(this.settings().account));

  abstract readonly face: Signal<TileFace>;

  /** The outcome of the last press while it shows: `.is-feedback` or `.is-error`. */
  protected readonly flash = signal<'ok' | 'error' | null>(null);
  private flashTimer?: ReturnType<typeof setTimeout>;

  /** Whether a press on the tile opens its detail view. */
  protected readonly opensDetails = computed(() => this.detailView() && !!this.face().details);

  /** The component's `hd-tile-details`, if it has one. */
  protected readonly details = viewChild(TileDetails);

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.flashTimer));
  }

  /** What the corner button does. */
  protected act(): void {
    // No action by default.
  }

  /**
   * Runs a command against Homey, flashing its outcome. `success` says when a success shows: `quiet` never,
   * `early` on press, since Homey can take seconds to answer (a mood waits for all its devices).
   */
  protected async send(command: () => Promise<unknown>, success: 'answered' | 'early' | 'quiet' = 'answered') {
    if (success === 'early') this.showFlash('ok');
    try {
      await command();
      if (success === 'answered') this.showFlash('ok');
    } catch {
      this.showFlash('error');
    }
  }

  private showFlash(outcome: 'ok' | 'error') {
    clearTimeout(this.flashTimer);
    this.flash.set(outcome);
    this.flashTimer = setTimeout(() => this.flash.set(null), FLASH_MS);
  }

  protected onPress(event: Event) {
    if (!isInline(event) && this.opensDetails()) this.openDetails();
  }

  protected onKey(event: Event) {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    this.onPress(event);
  }

  protected openDetails() {
    this.details()?.open();
  }

  protected closeDetails() {
    this.details()?.close();
  }

  /**
   * The face of a tile whose target is not in its Homey's data: not picked yet, not loaded yet, or missing (also when
   * its account was removed).
   */
  protected absentFace(base: Pick<TileFace, 'icon' | 'hue'> & { noun: string }): TileFace {
    const { target, label } = this.settings();
    const { noun, ...look } = base;
    const name = label || noun;
    if (!target) return { ...look, name, detail: `Pick a ${noun.toLowerCase()}`, state: 'unset' };
    if (!this.homeyLoaded()) return { ...look, name, detail: '…', state: 'loading' };
    return { ...look, name, detail: 'Not found in Homey', state: 'missing' };
  }

  /** Whether what the tile's Homey holds can be told yet; a tile naming a removed account can. */
  protected homeyLoaded() {
    const homey = this.homey();
    return homey ? homey.loaded : this.data.homeys() !== null && this.settings().account !== undefined;
  }
}

/** Whether a press is on an inline control or in the detail view, which handle their own presses. */
function isInline(event: Event) {
  return !!(event.target as Element).closest('button, [role="slider"], dialog');
}
