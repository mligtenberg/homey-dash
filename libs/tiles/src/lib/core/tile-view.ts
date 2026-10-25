import { DestroyRef, Directive, inject, input, Signal, signal } from '@angular/core';
import { LucideIconInput } from '@lucide/angular';
import { TileSize } from '@homey-dash/layout';
import { TileData, TileSettings } from '../tile-data';
import { KindHue } from '../tile-kind';

/** What a basic tile shows; the core kinds differ only in how they derive it from their target. */
export interface TileFace {
  name: string;
  detail: string;
  icon: LucideIconInput;
  hue: KindHue;
  active?: boolean;
  /** Whether pressing the tile acts on its target (see `tap`). */
  tappable?: boolean;
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
  '[attr.data-tap]': "face().tappable ? '' : null",
  '[attr.role]': "face().tappable ? 'button' : null",
  '[attr.tabindex]': 'face().tappable ? 0 : null',
  '(click)': 'onPress($event)',
  '(keydown.enter)': 'onKey($event)',
  '(keydown.space)': 'onKey($event)',
};

/** How long a tile shows the outcome of a press, such as "Started". */
export const FLASH_MS = 1400;

export const TILE_FACE_TEMPLATE = `
  <svg class="hd-icon" [lucideIcon]="face().icon" />
  <div>
    <div class="hd-tile__name">{{ face().name }}</div>
    <div class="hd-tile__detail">{{ face().detail }}</div>
  </div>
  @if (face().state === 'unavailable') {
    <span class="hd-badge">Unavailable</span>
  }
`;

@Directive()
export abstract class TileView<TSettings extends TileSettings = TileSettings> {
  readonly settings = input.required<TSettings>();
  readonly size = input.required<TileSize>();

  protected readonly data = inject(TileData);

  abstract readonly face: Signal<TileFace>;

  /** The outcome of the last press while it shows: `.is-feedback` or `.is-error`. */
  protected readonly flash = signal<'ok' | 'error' | null>(null);
  private flashTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.flashTimer));
  }

  /** What pressing a tappable tile does. */
  protected tap(): void {
    // Not tappable by default.
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
    // Inline controls handle their own presses.
    if (!this.face().tappable || (event.target as Element).closest('button, [role="slider"]')) return;
    this.tap();
  }

  protected onKey(event: Event) {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    this.onPress(event);
  }

  /** The face of a tile whose target is not in Homey's data: not picked yet, not loaded yet, or missing. */
  protected absentFace(base: Pick<TileFace, 'icon' | 'hue'> & { noun: string }): TileFace {
    const { target, label } = this.settings();
    const { noun, ...look } = base;
    const name = label || noun;
    if (!target) return { ...look, name, detail: `Pick a ${noun.toLowerCase()}`, state: 'unset' };
    if (!this.data.loaded()) return { ...look, name, detail: '…', state: 'loading' };
    return { ...look, name, detail: 'Not found in Homey', state: 'missing' };
  }
}
