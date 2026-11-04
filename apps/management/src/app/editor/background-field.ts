import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { DashboardBackground, DashboardsApi } from '@homey-dash/api-client';
import { BACKGROUND_STYLES, BACKGROUND_SUBJECTS, backgroundStyle } from '@homey-dash/tiles';

/** The directions a gradient runs in, as CSS angles: towards the top, clockwise. */
export const GRADIENT_ANGLES = [
  { angle: 0, label: '↑ Upwards' },
  { angle: 45, label: '↗ To the top right' },
  { angle: 90, label: '→ To the right' },
  { angle: 135, label: '↘ To the bottom right' },
  { angle: 180, label: '↓ Downwards' },
  { angle: 225, label: '↙ To the bottom left' },
  { angle: 270, label: '← To the left' },
  { angle: 315, label: '↖ To the top left' },
];

/** What a new colour or gradient starts as: the dark theme's ground, into a deep blue. */
const START = { color: '#1a1c24', to: '#1f3b5c' };

/** The built-in image picked first: the first style's first subject. */
const FIRST_PRESET = `${BACKGROUND_STYLES[0].id}/${BACKGROUND_SUBJECTS[0].id}`;

/**
 * Picks a dashboard's background: the theme's own, one colour, a gradient between two, one of the built-in images (a
 * style, then a subject drawn in it, by day in the light theme and by night in the dark one), or an image uploaded from
 * this computer. A colour or gradient keeps its colours
 * when switching between the two.
 */
@Component({
  selector: 'hd-background-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hd-field">
      <label class="hd-field__label" for="dashboard-background">Background</label>
      <div class="row">
        <select id="dashboard-background" class="hd-select" (change)="setKind($any($event.target).value)">
          <option value="" [selected]="!background()">Theme</option>
          <option value="color" [selected]="background()?.kind === 'color'">Colour</option>
          <option value="gradient" [selected]="background()?.kind === 'gradient'">Gradient</option>
          <option value="preset" [selected]="background()?.kind === 'preset'">Built-in image</option>
          <option value="image" [selected]="background()?.kind === 'image' || picking()">Image</option>
        </select>
        <span class="swatch" [style.background]="swatch()" aria-hidden="true"></span>
      </div>
      @switch (background()?.kind) {
        @case ('color') {
          <input type="color" class="color" aria-label="Background colour" [value]="colors().color" (change)="setColor('color', $any($event.target).value)" />
        }
        @case ('gradient') {
          <div class="row">
            <input type="color" class="color" aria-label="Gradient from" [value]="colors().color" (change)="setColor('color', $any($event.target).value)" />
            <input type="color" class="color" aria-label="Gradient to" [value]="colors().to" (change)="setColor('to', $any($event.target).value)" />
            <select class="hd-select" aria-label="Gradient direction" (change)="setAngle(+$any($event.target).value)">
              @for (direction of angles; track direction.angle) {
                <option [value]="direction.angle" [selected]="direction.angle === angle()">{{ direction.label }}</option>
              }
            </select>
          </div>
        }
        @case ('preset') {
          <select class="hd-select" aria-label="Image style" (change)="setPreset($any($event.target).value, preset().subject)">
            @for (style of styles; track style.id) {
              <option [value]="style.id" [selected]="style.id === preset().style">{{ style.label }}</option>
            }
          </select>
          <div class="presets" role="group" aria-label="Image subject">
            @for (subject of subjects; track subject.id) {
              <button
                type="button"
                class="preset"
                [attr.aria-pressed]="subject.id === preset().subject"
                [title]="subject.label"
                [attr.aria-label]="subject.label"
                (click)="setPreset(preset().style, subject.id)"
              >
                <span class="thumb" [style.background]="thumb(preset().style, subject.id)"></span>
              </button>
            }
          </div>
        }
      }
      @if (background()?.kind === 'image' || picking()) {
        <label class="hd-btn upload" [class.is-busy]="uploading()">
          {{ uploading() ? 'Uploading…' : background()?.kind === 'image' ? 'Choose another image' : 'Choose an image' }}
          <input type="file" accept="image/jpeg,image/png,image/webp" [disabled]="uploading()" (change)="upload($any($event.target))" />
        </label>
        <p class="hint">JPEG, PNG or WebP, at most 15 MB. Tiles turn to glass over it.</p>
      }
      @if (error(); as error) {
        <p class="error" role="alert">{{ error }}</p>
      }
    </div>
  `,
  styles: `
    .row { display: flex; align-items: center; gap: var(--space-2); }
    .row .hd-select { flex: 1; min-width: 0; }
    .swatch { flex: none; width: 36px; height: 36px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--ground); }
    .color { flex: none; width: 48px; height: 36px; padding: 2px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--chrome); cursor: pointer; }
    .hd-field { gap: var(--space-2); }
    .upload { position: relative; align-self: flex-start; cursor: pointer; }
    .upload input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
    .upload.is-busy { opacity: .6; cursor: progress; }
    .hint { margin: 0; color: var(--ink-muted); font-size: 13px; }
    .error { margin: 0; color: var(--danger); font-weight: 700; font-size: 13px; }
    .presets { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-2); }
    .preset { padding: 0; border: 2px solid transparent; border-radius: var(--radius-control); background: none; cursor: pointer; overflow: hidden; }
    .thumb { display: block; width: 100%; aspect-ratio: 16 / 10; }
    .preset[aria-pressed='true'] { border-color: var(--brand); }
    .preset:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
  `,
})
export class BackgroundField {
  readonly background = input.required<DashboardBackground | null>();
  readonly changed = output<DashboardBackground | null>();

  private readonly api = inject(DashboardsApi);

  protected readonly angles = GRADIENT_ANGLES;
  protected readonly styles = BACKGROUND_STYLES;
  protected readonly subjects = BACKGROUND_SUBJECTS;
  // Image picked in the select, before one is uploaded: the draft keeps its background until then.
  protected readonly picking = signal(false);
  protected readonly uploading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly swatch = computed(() => backgroundStyle(this.background()));
  protected readonly colors = computed(() => {
    const background = this.background();
    return {
      color: background?.kind === 'color' || background?.kind === 'gradient' ? background.color : START.color,
      to: background?.kind === 'gradient' ? background.to : START.to,
    };
  });
  protected readonly angle = computed(() => {
    const background = this.background();
    return background?.kind === 'gradient' ? background.angle : 180;
  });

  protected readonly preset = computed(() => {
    const background = this.background();
    const [style, subject] = (background?.kind === 'preset' ? background.preset : FIRST_PRESET).split('/');
    return { style, subject };
  });

  protected setKind(kind: string) {
    this.error.set(null);
    this.picking.set(kind === 'image');
    const { color, to } = this.colors();
    if (kind === '') this.changed.emit(null);
    else if (kind === 'color') this.changed.emit({ kind, color });
    else if (kind === 'gradient') this.changed.emit({ kind, color, to, angle: this.angle() });
    else if (kind === 'preset') this.changed.emit({ kind, preset: FIRST_PRESET });
  }

  /** A subject's thumbnail in the style, by day or by night as the theme is, like the dashboard. */
  protected thumb(style: string, subject: string) {
    return backgroundStyle({ kind: 'preset', preset: `${style}/${subject}` });
  }

  protected setPreset(style: string, subject: string) {
    this.changed.emit({ kind: 'preset', preset: `${style}/${subject}` });
  }

  protected setColor(which: 'color' | 'to', value: string) {
    const background = this.background();
    if (background?.kind === 'color' || background?.kind === 'gradient') this.changed.emit({ ...background, [which]: value });
  }

  protected setAngle(angle: number) {
    const background = this.background();
    if (background?.kind === 'gradient') this.changed.emit({ ...background, angle });
  }

  protected upload(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.error.set(null);
    this.uploading.set(true);
    this.api.uploadBackground(file).subscribe({
      next: ({ id }) => {
        this.uploading.set(false);
        this.picking.set(false);
        this.changed.emit({ kind: 'image', imageId: id });
      },
      error: (e) => {
        this.uploading.set(false);
        this.error.set(e?.error?.errors?.file?.[0] ?? 'Could not upload the image. Try again.');
      },
    });
  }
}
