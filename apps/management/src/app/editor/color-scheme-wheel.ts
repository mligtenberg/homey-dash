import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { ColorScheme, hexToHsl, hslToHex } from '@homey-dash/tiles';

/** Where a hue and saturation sit on the wheel: hue clockwise from the top, saturation out from the centre (0–1). */
const point = (hue: number, saturation: number, r = 50) => {
  const a = ((hue - 90) * Math.PI) / 180;
  return { x: 50 + Math.cos(a) * saturation * r, y: 50 + Math.sin(a) * saturation * r };
};

/**
 * Picks a colour scheme on a hue wheel: drag the first colour round and in or out (how vivid), and the second round to
 * set the angle between them; the third and fourth sit opposite. Changes while dragging are previewed (at most once a
 * frame) and reported on release; arrow keys move a focused handle (left and right round, up and down in or out).
 */
@Component({
  selector: 'hd-color-scheme-wheel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wheel" (pointerdown)="grab($event)" (pointermove)="drag($event)" (pointerup)="release()" (pointercancel)="release()">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <polygon [attr.points]="outline()" />
        @for (p of points(); track $index) {
          <line x1="50" y1="50" [attr.x2]="p.x" [attr.y2]="p.y" />
        }
      </svg>
      @for (p of points(); track $index) {
        @if ($index < 2) {
          <button
            type="button"
            class="handle"
            [class.primary]="$index === 0"
            [style.left.%]="p.x"
            [style.top.%]="p.y"
            [style.background]="colors()[$index]"
            [attr.aria-label]="$index === 0 ? 'First colour: hue ' + round(hue()) + '°' : 'Second colour: ' + angle() + '° on'"
            (pointerdown)="hold($index, $event)"
            (keydown)="key($index, $event)"
          ></button>
        } @else {
          <span class="handle opposite" [style.left.%]="p.x" [style.top.%]="p.y" [style.background]="colors()[$index]"></span>
        }
      }
    </div>
    <div class="row">
      <input type="color" class="color" aria-label="First colour" [value]="colors()[0]" (change)="pick($any($event.target).value)" />
      @for (c of colors().slice(1); track $index) {
        <span class="swatch" [style.background]="c" aria-hidden="true"></span>
      }
      <label class="angle">
        <input type="number" class="hd-input" min="0" max="359" aria-label="Angle to the second colour" [value]="angle()" (change)="setAngle(+$any($event.target).value)" />°
      </label>
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--space-2); align-items: flex-start; }
    .wheel { position: relative; width: 176px; aspect-ratio: 1; border-radius: 50%; touch-action: none; cursor: crosshair;
      background: radial-gradient(closest-side, hsl(0 0% 50%), hsl(0 0% 50% / 0)),
        conic-gradient(hsl(0 100% 50%), hsl(60 100% 50%), hsl(120 100% 50%), hsl(180 100% 50%), hsl(240 100% 50%), hsl(300 100% 50%), hsl(360 100% 50%)); }
    svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
    polygon { fill: none; stroke: #fff; stroke-width: .8; stroke-opacity: .8; }
    line { stroke: #fff; stroke-width: .5; stroke-opacity: .6; }
    .handle { position: absolute; width: 18px; height: 18px; margin: -9px 0 0 -9px; padding: 0; border: 2px solid #fff; border-radius: 50%;
      box-shadow: 0 0 0 1px rgb(0 0 0 / .4), 0 1px 3px rgb(0 0 0 / .4); cursor: grab; }
    .handle.primary { width: 24px; height: 24px; margin: -12px 0 0 -12px; }
    .handle.opposite { width: 14px; height: 14px; margin: -7px 0 0 -7px; cursor: inherit; pointer-events: none; }
    .handle:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
    .row { display: flex; align-items: center; gap: var(--space-2); max-width: 100%; }
    .color { width: 36px; height: 36px; padding: 2px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--chrome); cursor: pointer; }
    .swatch { flex: none; width: 24px; height: 24px; border: 1px solid var(--line); border-radius: var(--radius-control); }
    .angle { display: flex; flex: 1; min-width: 0; align-items: center; gap: 4px; }
    .angle input { width: 100%; min-width: 0; max-width: 72px; }
  `,
})
export class ColorSchemeWheel {
  readonly scheme = input.required<ColorScheme>();
  readonly changed = output<ColorScheme>();
  /** The scheme being dragged to, before it is let go of. */
  readonly previewed = output<ColorScheme>();

  // While dragging, the wheel shows the scheme being picked rather than the one saved.
  private readonly live = signal<ColorScheme | null>(null);
  protected readonly dragging = signal<number | null>(null);
  private readonly current = computed(() => this.live() ?? this.scheme());

  protected readonly hue = computed(() => hexToHsl(this.current().color)[0]);
  private readonly saturation = computed(() => hexToHsl(this.current().color)[1]);
  protected readonly angle = computed(() => this.current().angle);
  private readonly hues = computed(() => {
    const [h, a] = [this.hue(), this.angle()];
    return [h, h + a, h + 180, h + a + 180].map((x) => x % 360);
  });
  protected readonly colors = computed(() => this.hues().map((h) => hslToHex(h, this.saturation(), 0.5)));
  protected readonly points = computed(() => this.hues().map((h) => point(h, this.saturation())));
  protected readonly outline = computed(() => this.points().map((p) => `${p.x},${p.y}`).join(' '));

  constructor() {
    // A saved scheme replaces what was shown while dragging.
    effect(() => {
      this.scheme();
      if (this.dragging() === null) this.live.set(null);
    });
  }

  protected round = Math.round;
  private frame = 0;

  /** Grabbing the wheel itself moves the first colour there. */
  protected grab(event: PointerEvent) {
    this.dragging.set(0);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.drag(event);
  }

  /** Grabbing a handle moves it only once the pointer does. */
  protected hold(which: number, event: PointerEvent) {
    event.stopPropagation();
    this.dragging.set(which);
    ((event.currentTarget as HTMLElement).parentElement as HTMLElement).setPointerCapture(event.pointerId);
  }

  protected drag(event: PointerEvent) {
    const which = this.dragging();
    if (which === null) return;
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const [dx, dy] = [event.clientX - box.left - box.width / 2, event.clientY - box.top - box.height / 2];
    const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 360) % 360;
    if (which === 0) {
      const saturation = Math.min(1, Math.hypot(dx, dy) / (box.width / 2));
      this.live.set({ color: hslToHex(hue, saturation, 0.5), angle: this.angle() });
    } else {
      this.live.set({ color: this.current().color, angle: Math.round(hue - this.hue() + 360) % 360 });
    }
    this.frame ||= requestAnimationFrame(() => {
      this.frame = 0;
      const live = this.live();
      if (live && this.dragging() !== null) this.previewed.emit(live);
    });
  }

  protected release() {
    if (this.dragging() === null) return;
    this.dragging.set(null);
    const live = this.live();
    if (live) this.changed.emit(live);
  }

  protected key(which: number, event: KeyboardEvent) {
    const step = event.shiftKey ? 15 : 5;
    const round = { ArrowLeft: -step, ArrowRight: step }[event.key] ?? 0;
    const out = which === 0 ? ({ ArrowDown: -0.05, ArrowUp: 0.05 }[event.key] ?? 0) : 0;
    if (!round && !out) return;
    event.preventDefault();
    if (which === 0) {
      const saturation = Math.max(0, Math.min(1, this.saturation() + out));
      this.changed.emit({ color: hslToHex((this.hue() + round + 360) % 360, saturation, 0.5), angle: this.angle() });
    } else this.setAngle(this.angle() + round);
  }

  protected pick(color: string) {
    this.changed.emit({ color, angle: this.angle() });
  }

  protected setAngle(angle: number) {
    if (Number.isFinite(angle)) this.changed.emit({ color: this.current().color, angle: ((Math.round(angle) % 360) + 360) % 360 });
  }
}
