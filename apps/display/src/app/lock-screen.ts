import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, input } from '@angular/core';
import { capabilitySignal, HomeyWeather, LOCK_SPOTS, LockWidget, Rule } from '@homey-dash/api-client';
import { ago, capabilityText, delayLevel, delayText, duration, NewsData, ruleAnswersOf, TileData, TrafficData } from '@homey-dash/tiles';
import { LucideDynamicIcon, LucideIconInput } from '@lucide/angular';
import { LucideCar, LucideNewspaper, LucideCloud, LucideCloudDrizzle, LucideCloudFog, LucideCloudLightning, LucideCloudRain, LucideCloudSnow, LucideCloudSun, LucideSun, minuteClock } from '@homey-dash/design-system';

import { Backdrop, css, inkOver, inverseOf, luminance, prominentColour, Rgb } from './lock-ink';
import { formatTag, t } from '@homey-dash/i18n';
/** What a widget shows now; a weather Homey hasn't told, or a value whose device is gone, shows nothing. */
type Shown =
  | { kind: 'clock'; time: string; date: string }
  | { kind: 'weather'; temperature: string; state: string; icon: LucideIconInput }
  | { kind: 'value'; name: string; value: string; units: string; unavailable: boolean }
  | { kind: 'traffic'; name: string; time: string; delay: string; level: 'none' | 'some' | 'heavy'; unavailable: boolean }
  | { kind: 'news'; headline: string; name: string; age: string; unavailable: boolean };

// Homey's conditions, after OpenWeatherMap's main groups, by the start of the word.
const WEATHER: [RegExp, LucideIconInput, string][] = [
  [/^thunder/i, LucideCloudLightning, 'Thunderstorm'],
  [/^drizzle/i, LucideCloudDrizzle, 'Drizzle'],
  [/^rain|^shower/i, LucideCloudRain, 'Rain'],
  [/^snow|^sleet/i, LucideCloudSnow, 'Snow'],
  [/^mist|^fog|^haze|^smoke|^dust/i, LucideCloudFog, 'Fog'],
  [/^clear|^sun/i, LucideSun, 'Clear'],
  [/^cloud|^overcast/i, LucideCloud, 'Cloudy'],
];

export function weatherLook(state: string | null): { icon: LucideIconInput; label: string } {
  const found = WEATHER.find(([match]) => state && match.test(state));
  return found ? { icon: found[1], label: t(found[2]) } : { icon: LucideCloudSun, label: state ?? '' };
}

/**
 * What a display's lock screen shows over the photo set or colour an idle rule plays: its widgets in their spots, the
 * clock and weather large and in the middle when put there. Touches go through it, to what it lies over.
 */
@Component({
  selector: 'hd-lock-screen',
  imports: [LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (spot of spots(); track spot.spot) {
      <div [class]="'spot spot--' + spot.spot">
        @for (widget of spot.widgets; track $index) {
          @switch (widget.kind) {
            @case ('clock') {
              <div class="clock">
                <div class="clock__time">{{ widget.time }}</div>
                <div class="clock__date">{{ widget.date }}</div>
              </div>
            }
            @case ('weather') {
              <div class="weather" role="group" [attr.aria-label]="widget.state + ', ' + widget.temperature">
                <svg class="weather__icon" [lucideIcon]="widget.icon" />
                <span class="weather__temperature">{{ widget.temperature }}</span>
                <span class="weather__state">{{ widget.state }}</span>
              </div>
            }
            @case ('traffic') {
              <div class="traffic" role="group" [class.is-unavailable]="widget.unavailable" [attr.data-delay]="widget.level" [attr.aria-label]="widget.name + ', ' + widget.time + ', ' + widget.delay">
                <svg class="traffic__icon" [lucideIcon]="car" />
                <span class="traffic__time">{{ widget.time }}</span>
                <span class="traffic__name">{{ widget.name }} · {{ widget.delay }}</span>
              </div>
            }
            @case ('news') {
              <div class="news" role="group" [class.is-unavailable]="widget.unavailable" [attr.aria-label]="widget.name + ': ' + widget.headline">
                <svg class="news__icon" [lucideIcon]="newspaper" />
                <span class="news__headline">{{ widget.headline }}</span>
                <span class="news__name">{{ widget.name }} · {{ widget.age }}</span>
              </div>
            }
            @case ('value') {
              <div class="value" [class.is-unavailable]="widget.unavailable">
                <span class="value__reading">{{ widget.value }}<span class="value__units">{{ widget.units }}</span></span>
                <span class="value__name">{{ widget.name }}</span>
              </div>
            }
          }
        }
      </div>
    }
  `,
  styles: `
    /*
     * The content is the subject; the widgets are a quiet layer on it. Nothing covers the photo: each widget's type takes
     * the inverse of the average colour right behind it (measured below), held to the lightest and darkest colour there.
     */
    :host {
      position: fixed; inset: 0; z-index: 10; pointer-events: none; box-sizing: border-box;
      display: grid; grid-template: 'tl . tr' auto '. c .' 1fr 'bl . br' auto / 1fr auto 1fr;
      --edge: var(--lock-edge, clamp(20px, 5vh, 56px));
      padding: var(--edge); color: #fff; --u: 1vh;
    }
    /* Over a photo, the bottom spots stay above the caption line along its bottom (styled in the app, to the same margins): when and where it was taken, and who. */
    :host(.over-photo) { padding-bottom: calc(var(--edge) + 7vh); }
    .spot { position: relative; display: flex; flex-direction: column; gap: calc(3 * var(--u)); animation: spot-in .9s cubic-bezier(.2, .7, .2, 1) backwards; }
    .clock, .weather, .traffic, .value, .news {
      color: var(--ink, #fff); transition: color .8s ease;
    }
    .spot--top-left { grid-area: tl; justify-self: start; align-items: flex-start; }
    .spot--top-right { grid-area: tr; justify-self: end; align-items: flex-end; text-align: right; animation-delay: .08s; }
    .spot--center { grid-area: c; justify-self: center; align-self: center; align-items: center; text-align: center; --u: 1.8vh; animation-delay: .04s; }
    .spot--bottom-left { grid-area: bl; justify-self: start; align-items: flex-start; justify-content: flex-end; animation-delay: .12s; }
    .spot--bottom-right { grid-area: br; justify-self: end; align-items: flex-end; justify-content: flex-end; text-align: right; animation-delay: .16s; }
    @keyframes spot-in { from { opacity: 0; translate: 0 calc(2 * var(--u)); } }
    @media (prefers-reduced-motion: reduce) { .spot { animation: none; } }

    /* The time is the one large thing: light and tight, with the date set small beneath it. */
    .clock__time { font-size: calc(13 * var(--u)); font-weight: 300; line-height: .9; font-variant-numeric: tabular-nums; letter-spacing: -.035em; }
    .clock__date { font-size: max(var(--text-floor), calc(2.3 * var(--u))); font-weight: 500; letter-spacing: .01em; margin-top: calc(1.4 * var(--u)); opacity: .9; }

    /* Everything else is a reading over its label, the same shape whatever it measures. */
    .weather, .traffic { display: grid; grid-template-columns: auto auto; column-gap: calc(1.2 * var(--u)); align-items: center; }
    .spot--center .weather, .spot--center .traffic { justify-content: center; }
    .weather__icon, .traffic__icon { width: calc(4 * var(--u)); height: calc(4 * var(--u)); stroke-width: 1.6; }
    .weather__temperature, .traffic__time, .value__reading { font-size: calc(4.6 * var(--u)); font-weight: 500; line-height: 1; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
    .weather__state, .traffic__name, .value__name { grid-column: 1 / -1; font-size: max(var(--text-floor), calc(1.9 * var(--u))); font-weight: 500; letter-spacing: .01em; opacity: .82; white-space: nowrap; margin-top: calc(.7 * var(--u)); }
    .traffic[data-delay='some'] .traffic__time, .traffic[data-delay='some'] .traffic__icon { color: var(--lock-warn); }
    .traffic[data-delay='heavy'] .traffic__time, .traffic[data-delay='heavy'] .traffic__icon { color: var(--lock-danger); }
    /* A headline is a sentence, not a reading: it wraps at a comfortable measure, never running into the middle of the screen. */
    .news { display: grid; grid-template-columns: auto minmax(0, calc(52 * var(--u))); column-gap: calc(1.2 * var(--u)); align-items: start; }
    .spot--center .news { justify-content: center; text-align: left; }
    .news__icon { width: calc(3.2 * var(--u)); height: calc(3.2 * var(--u)); stroke-width: 1.6; margin-top: calc(.4 * var(--u)); }
    .news__headline { font-size: calc(3 * var(--u)); font-weight: 500; line-height: 1.2; letter-spacing: -.01em; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
    .news__name { grid-column: 2; font-size: max(var(--text-floor), calc(1.9 * var(--u))); font-weight: 500; letter-spacing: .01em; opacity: .82; margin-top: calc(.7 * var(--u)); }
    .value { display: flex; flex-direction: column; }
    .value__units { font-size: .5em; font-weight: 500; margin-left: .15em; opacity: .85; }
    .value__name { margin-top: calc(.7 * var(--u)); }
    .is-unavailable { opacity: .5; }
  `,
})
export class LockScreen {
  readonly widgets = input.required<readonly LockWidget[]>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly destroyRef = inject(DestroyRef);
  private readonly data = inject(TileData);
  private readonly traffic = inject(TrafficData);
  private readonly news = inject(NewsData);
  protected readonly car = LucideCar;
  protected readonly newspaper = LucideNewspaper;
  // Ticks on every minute, for the clock.
  private readonly now = minuteClock();

  constructor() {
    // What lies behind a widget changes as photos fade in and out, so it is measured about once a second.
    afterNextRender(() => {
      this.ink();
      const timer = setInterval(() => this.ink(), 1000);
      this.destroyRef.onDestroy(() => {
        clearInterval(timer);
        document.documentElement.style.removeProperty('--inverse');
        document.documentElement.style.removeProperty('--inverse-size');
        document.querySelectorAll<HTMLElement>('.slideshow :is(.hd-photo__text, .hd-photo__people)').forEach((e) => e.style.removeProperty('--inverse'));
        if (this.image) URL.revokeObjectURL(this.image);
      });
    });
  }

  private busy = false;
  private previous: Uint8ClampedArray | null = null;
  // The inverse picture's pixels, which each area's one colour is taken from.
  private inverted: Uint8ClampedArray | null = null;
  private image: string | null = null;

  /**
   * Sets the type colour of each widget, and of the photo's caption, from the average colour of the picture or fill
   * directly behind it, and the picture's inverse, which the type is cut out of.
   */
  private async ink() {
    if (this.busy) return;
    this.busy = true;
    const widgets = [
      ...this.host.querySelectorAll<HTMLElement>('.clock, .weather, .traffic, .value, .news'),
      ...document.querySelectorAll<HTMLElement>('.slideshow :is(.hd-photo__label, .hd-photo__about, .hd-photo__people)'),
    ];
    try {
      // The picture or fill is the frame everything is measured in, wherever it is on the page and however large.
      const frame = document.querySelector('.slideshow, .fill')?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
      if (frame.width < 1 || frame.height < 1) return;
      const width = 240;
      const scale = width / frame.width;
      const canvas = new OffscreenCanvas(width, Math.max(1, Math.round(frame.height * scale)));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context || !widgets.length) return;
      let drawn = false;
      // A colour fill, then the photos over it, each as opaque as it has faded in so far.
      const fill = document.querySelector<HTMLElement>('.fill');
      if (fill) {
        context.fillStyle = getComputedStyle(fill).backgroundColor;
        context.fillRect(0, 0, canvas.width, canvas.height);
        drawn = true;
      }
      for (const img of document.querySelectorAll<HTMLImageElement>('.slideshow img')) {
        const opacity = effectiveOpacity(img);
        if (!img.complete || !img.naturalWidth || opacity <= 0) continue;
        const box = img.getBoundingClientRect();
        // object-fit: cover, as the photo tile draws it.
        const fit = Math.max(box.width / img.naturalWidth, box.height / img.naturalHeight);
        const [w, h] = [img.naturalWidth * fit, img.naturalHeight * fit];
        context.globalAlpha = opacity;
        context.drawImage(img, (box.left - frame.left + (box.width - w) / 2) * scale, (box.top - frame.top + (box.height - h) / 2) * scale, w * scale, h * scale);
        context.globalAlpha = 1;
        drawn = true;
      }
      if (!drawn) {
        this.clear(widgets);
        return;
      }
      await this.invert(context, canvas);
      document.documentElement.style.setProperty('--inverse-size', `${frame.width}px ${frame.height}px`);
      for (const widget of widgets) {
        const backdrop = backdropOf(context, within(extent(widget), frame), scale);
        if (!backdrop) {
          this.clear([widget]);
          continue;
        }
        const box = widget.getBoundingClientRect();
        widget.style.setProperty('--ink', css(inkOver(backdrop)));
        // The inverse is as large as the frame, so its place behind this widget is the widget's place in the frame.
        widget.style.setProperty('--bx', `${frame.left - box.left}px`);
        widget.style.setProperty('--by', `${frame.top - box.top}px`);
        widget.classList.add('hd-ink');
        for (const icon of widget.querySelectorAll<SVGElement>('svg')) {
          const at = icon.getBoundingClientRect();
          icon.style.setProperty('--ink', css(inkOver(backdrop)));
          icon.style.setProperty('--mask', this.mask(icon));
          icon.style.setProperty('--bx', `${frame.left - at.left}px`);
          icon.style.setProperty('--by', `${frame.top - at.top}px`);
          icon.classList.add('hd-ink-icon');
        }
      }
      this.flatten(frame, scale, canvas.width, canvas.height);
    } catch {
      // A picture the browser won't let it read: the type stays white.
      this.clear(widgets);
    } finally {
      this.busy = false;
    }
  }

  /**
   * Each area (top left, centre, ..., and the photo's caption on each side) has its type in one colour: the most prominent of the inverse under its rendered
   * type and icons. It replaces the picture the type is cut out of, so that the type no longer changes along a line.
   */
  private flatten(frame: DOMRect, scale: number, width: number, height: number) {
    const data = this.inverted;
    if (!data) return;
    // The widgets' areas, and the photo's caption: its words on the left, and the people on the right.
    const areas = [...this.host.querySelectorAll<HTMLElement>('.spot'), ...document.querySelectorAll<HTMLElement>('.slideshow :is(.hd-photo__text, .hd-photo__people)')];
    for (const area of areas) {
      const rects: DOMRect[] = [];
      for (const widget of [area, ...area.querySelectorAll<HTMLElement>('.hd-ink')].filter((e) => e.classList.contains('hd-ink'))) {
        const walker = document.createTreeWalker(widget, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          rects.push(...Array.from(range.getClientRects()));
        }
        for (const icon of widget.querySelectorAll('svg')) rects.push(icon.getBoundingClientRect());
      }
      const colour = prominentColour(
        data,
        width,
        height,
        rects.map((r) => new DOMRect((r.x - frame.x) * scale, (r.y - frame.y) * scale, r.width * scale, r.height * scale)),
      );
      if (!colour) continue;
      // The picture is replaced by a plain fill of the colour, for the area and so for everything in it.
      area.style.setProperty('--inverse', `linear-gradient(${css(colour)}, ${css(colour)})`);
    }
  }

  private readonly masks = new WeakMap<SVGElement, { key: string; mask: string }>();

  /** An icon's own drawing, in black, as an image a mask can be made of. */
  private mask(icon: SVGElement): string {
    const key = icon.innerHTML + getComputedStyle(icon).strokeWidth;
    const known = this.masks.get(icon);
    if (known?.key === key) return known.mask;
    const copy = icon.cloneNode(true) as SVGElement;
    for (const name of ['class', 'style', 'width', 'height']) copy.removeAttribute(name);
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    copy.setAttribute('viewBox', icon.getAttribute('viewBox') ?? '0 0 24 24');
    copy.setAttribute('fill', 'none');
    copy.setAttribute('stroke', '#000');
    copy.setAttribute('stroke-width', getComputedStyle(icon).strokeWidth);
    copy.setAttribute('stroke-linecap', 'round');
    copy.setAttribute('stroke-linejoin', 'round');
    const mask = `url("data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}")`;
    this.masks.set(icon, { key, mask });
    return mask;
  }

  private clear(widgets: HTMLElement[]) {
    for (const widget of widgets) {
      widget.style.removeProperty('--ink');
      widget.classList.remove('hd-ink');
      widget.querySelectorAll('svg').forEach((icon) => icon.classList.remove('hd-ink-icon'));
    }
  }

  /**
   * The picture, blurred and then as OKLab inverts it, colour by colour (light for dark, the opposite hue), as an image the size of the
   * screen. It is made again only when the picture has changed, and shown only once it can be drawn.
   */
  private async invert(context: OffscreenCanvasRenderingContext2D, canvas: OffscreenCanvas) {
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    if (this.previous?.length === data.length && this.previous.every((v, i) => v === data[i])) return;
    // The picture is blurred first, and inverted after: a letter over a ridge of dark against light takes the inverse of
    // their mean, a colour that is then pushed light or dark, not the mean of two inverses, which is a grey. The colour
    // comes from a heavy blur, so that it changes slowly along a line of type; what is light and what is dark from a
    // light one, so that it stays where the picture is, and does not smear far from a dark edge.
    const soft = blurred(canvas, INVERSE_BLUR);
    const near = blurred(canvas, NEAR_BLUR);
    if (!soft || !near) return;
    const out = new ImageData(canvas.width, canvas.height);
    const known = new Map<number, Rgb>();
    for (let i = 0; i < soft.length; i += 4) {
      // 5 bits of each channel tell colours apart well enough, and spare working most of them out again.
      const key = ((soft[i] >> 3) << 25) | ((soft[i + 1] >> 3) << 20) | ((soft[i + 2] >> 3) << 15) | ((near[i] >> 3) << 10) | ((near[i + 1] >> 3) << 5) | (near[i + 2] >> 3);
      let inverse = known.get(key);
      if (!inverse) known.set(key, (inverse = inverseOf([soft[i], soft[i + 1], soft[i + 2]], [near[i], near[i + 1], near[i + 2]])));
      out.data.set([inverse[0], inverse[1], inverse[2], 255], i);
    }
    const target = new OffscreenCanvas(canvas.width, canvas.height);
    target.getContext('2d')?.putImageData(out, 0, 0);
    const url = URL.createObjectURL(await target.convertToBlob());
    const picture = new Image();
    picture.src = url;
    await picture.decode();
    document.documentElement.style.setProperty('--inverse', `url("${url}")`);
    if (this.image) URL.revokeObjectURL(this.image);
    this.image = url;
    this.previous = data;
    this.inverted = out.data;
  }

  // The widgets shown now: not the hidden ones, and those with a rule only while HomeyDash says it holds. One whose
  // rule has not answered yet, or was refused, is left out.
  private readonly ruled = computed(() => this.widgets().filter((w) => !w.hidden && w.rule));
  private readonly heard = ruleAnswersOf(() => this.ruled().map((w) => w.rule as Rule));
  private readonly shown = computed(() => {
    const holding = new Set(this.ruled().filter((_, i) => this.heard()[i] === true));
    return this.widgets().filter((w) => !w.hidden && (!w.rule || holding.has(w)));
  });

  protected readonly spots = computed(() => {
    const widgets = this.shown();
    return LOCK_SPOTS.map((spot) => ({
      spot,
      widgets: widgets.filter((w) => w.spot === spot).map((w) => this.show(w)).filter((s): s is Shown => !!s),
    })).filter((s) => s.widgets.length);
  });

  private show(widget: LockWidget): Shown | null {
    switch (widget.kind) {
      case 'clock': {
        const now = this.now();
        return {
          kind: 'clock',
          time: now.toLocaleTimeString(formatTag(), { hour: '2-digit', minute: '2-digit' }),
          date: now.toLocaleDateString(formatTag(), { weekday: 'long', day: 'numeric', month: 'long' }),
        };
      }
      case 'weather':
        return this.weather(this.data.homey(widget.account ?? undefined)?.weather ?? null);
      case 'traffic': {
        // Nothing to show until a route is chosen and TomTom has answered once.
        const result = this.traffic.traffic(widget.route);
        if (!widget.route || !this.traffic.hasResult(result)) return null;
        return {
          kind: 'traffic',
          name: widget.route.name,
          time: duration(result.travelSeconds),
          delay: delayText(result.delaySeconds, result.usualSeconds),
          level: delayLevel(result.delaySeconds, result.usualSeconds),
          unavailable: result.status === 'disconnected',
        };
      }
      case 'news': {
        // Nothing to show until the feed has been read once.
        const feed = this.news.feed(widget.source);
        const item = feed?.items[0];
        if (!feed || !item) return null;
        return { kind: 'news', headline: item.title, name: feed.name, age: ago(item.publishedAt, this.now().getTime()), unavailable: feed.status === 'disconnected' };
      }
      case 'value': {
        const named = capabilitySignal(widget.signal);
        if (!named) return null;
        const device = this.data.homey(named.account)?.devices.get(named.device);
        const capability = device?.capabilities[named.capability];
        const text = capability && capabilityText(capability);
        if (!device || !text) return null;
        // A word such as Locked says what it is about; a number needs its capability's name.
        const name = typeof capability.value === 'number' ? `${device.name} · ${capability.title}` : device.name;
        return { kind: 'value', name, ...text, unavailable: !device.available };
      }
    }
  }

  private weather(weather: HomeyWeather | null): Shown | null {
    if (weather?.temperature === null || weather?.temperature === undefined) return null;
    const look = weatherLook(weather.state);
    return { kind: 'weather', temperature: `${Math.round(weather.temperature)}°`, state: look.label, icon: look.icon };
  }
}

// How far the picture is blurred for the lightness of the inverse, in the same pixels.
const NEAR_BLUR = 3;

// How far the inverse picture is blurred, in pixels of its 240-wide size: about 6% of the screen's width.
const INVERSE_BLUR = 14;

// A copy of the canvas, blurred. It is set on a larger canvas, at its own size, over a stretched copy of itself, so that its
// edges blur into more of itself rather than into nothing, and nothing in it is moved.
function blurred(canvas: OffscreenCanvas, radius: number): Uint8ClampedArray | null {
  const margin = 3 * radius;
  const padded = new OffscreenCanvas(canvas.width + 2 * margin, canvas.height + 2 * margin);
  const paint = padded.getContext('2d');
  paint?.drawImage(canvas, 0, 0, padded.width, padded.height);
  paint?.drawImage(canvas, margin, margin);
  const result = new OffscreenCanvas(canvas.width, canvas.height).getContext('2d', { willReadFrequently: true });
  if (!result) return null;
  result.filter = `blur(${radius}px)`;
  result.drawImage(padded, -margin, -margin);
  return result.getImageData(0, 0, canvas.width, canvas.height).data;
}

// A rectangle as it lies in a frame, with the frame's corner as its origin.
function within(rect: DOMRect, frame: DOMRect): DOMRect {
  return new DOMRect(rect.x - frame.x, rect.y - frame.y, rect.width, rect.height);
}

// How visible an element is: its own opacity times that of everything around it.
function effectiveOpacity(element: Element | null): number {
  let opacity = 1;
  for (; element; element = element.parentElement) opacity *= Number(getComputedStyle(element).opacity);
  return opacity;
}

// Where an element's type is: a caption line is as wide as the screen, its words are not.
function extent(element: HTMLElement): DOMRect {
  if (!element.className.startsWith('hd-photo__')) return element.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(element);
  return range.getBoundingClientRect();
}

// The average, lightest and darkest colour of the canvas under a screen rectangle; null when nothing of it is on the canvas.
function backdropOf(context: OffscreenCanvasRenderingContext2D, rect: DOMRect, scale: number): Backdrop | null {
  const x = Math.max(0, Math.floor(rect.left * scale));
  const y = Math.max(0, Math.floor(rect.top * scale));
  const w = Math.min(context.canvas.width, Math.ceil(rect.right * scale)) - x;
  const h = Math.min(context.canvas.height, Math.ceil(rect.bottom * scale)) - y;
  if (w < 1 || h < 1) return null;
  const { data } = context.getImageData(x, y, w, h);
  const pixels = data.length / 4;
  const sum = [0, 0, 0];
  const lights = new Float32Array(pixels);
  for (let i = 0; i < pixels; i++) {
    for (let c = 0; c < 3; c++) sum[c] += data[i * 4 + c];
    lights[i] = luminance([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
  }
  // The lightest and darkest as the 95th and 5th percentile, so that one glint or speck doesn't decide.
  const order = Array.from(lights.keys()).sort((p, q) => lights[p] - lights[q]);
  const at = (share: number): Rgb => {
    const i = order[Math.min(pixels - 1, Math.floor(pixels * share))] * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  return { average: [Math.round(sum[0] / pixels), Math.round(sum[1] / pixels), Math.round(sum[2] / pixels)], lightest: at(0.95), darkest: at(0.05) };
}
