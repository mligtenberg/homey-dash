import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, input, viewChild, ViewEncapsulation } from '@angular/core';
import { ColorScheme, presetSvg, schemeProperties } from './background-colors';

/**
 * A built-in image inlined behind its parent's content (position the parent), by day in the light theme and by night in
 * the dark one, recoloured by its colour scheme through CSS custom properties, so changing the scheme shows at once. For
 * the Editor's stage; displays show a pre-rendered image (`loadBackgroundStyle`).
 */
@Component({
  selector: 'hd-background-art',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The SVGs are inlined as HTML, which emulated styles can't reach.
  encapsulation: ViewEncapsulation.None,
  host: {
    'aria-hidden': 'true',
    '[style.--scheme-hue]': 'properties()?.["--scheme-hue"]',
    '[style.--scheme-angle]': 'properties()?.["--scheme-angle"]',
    '[style.--scheme-chroma]': 'properties()?.["--scheme-chroma"]',
  },
  template: `<div #day class="hd-background-art__day"></div><div #night class="hd-background-art__night"></div>`,
  styles: `
    hd-background-art { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
    hd-background-art > div { position: absolute; inset: 0; }
    hd-background-art svg { display: block; width: 100%; height: 100%; }
    .hd-background-art__night { display: none; }
    :root[data-theme='dark'] .hd-background-art__day { display: none; }
    :root[data-theme='dark'] .hd-background-art__night { display: block; }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme='light']) .hd-background-art__day { display: none; }
      :root:not([data-theme='light']) .hd-background-art__night { display: block; }
    }
  `,
})
export class BackgroundArt {
  /** The built-in image, such as `flat/garden`. */
  readonly preset = input.required<string>();
  readonly scheme = input<ColorScheme | null>(null);

  private readonly day = viewChild.required<ElementRef<HTMLElement>>('day');
  private readonly night = viewChild.required<ElementRef<HTMLElement>>('night');
  protected readonly properties = computed(() => {
    const scheme = this.scheme();
    return scheme ? schemeProperties(scheme) : null;
  });

  constructor() {
    effect(() => {
      const preset = this.preset();
      for (const [variant, host] of [['day', this.day()], ['night', this.night()]] as const) {
        presetSvg(preset, variant).then(
          (svg) => this.preset() === preset && (host.nativeElement.innerHTML = svg),
          () => this.preset() === preset && (host.nativeElement.innerHTML = ''),
        );
      }
    });
  }
}
