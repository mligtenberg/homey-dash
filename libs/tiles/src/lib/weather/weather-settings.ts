import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { PlaceMatch, WEATHER_HERE, WEATHER_PLACE, WeatherApi } from '@homey-dash/api-client';
import { firstValueFrom } from 'rxjs';
import { TileData } from '../tile-data';
import { WeatherData, WeatherTileSettings } from './weather-data';

/** How long typing rests before it searches. */
const SEARCH_AFTER_MS = 300;

/** How far apart two places are, in kilometres, along the earth's surface. */
export function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(h));
}

/** Whether a popover is showing; false where there are no popovers. */
function popoverOpen(element: HTMLElement): boolean {
  try {
    return element.matches(':popover-open');
  } catch {
    return false;
  }
}

/** Region and country, to tell namesakes apart: `Utrecht, Netherlands`. */
export function placeDetail(match: PlaceMatch): string {
  return [match.region, match.country].filter(Boolean).join(', ');
}

/**
 * Management's choice of where a weather tile's forecast is for: where its Homey is (the default), or a town found by name,
 * which then overrides it (ADR-0013).
 */
@Component({
  selector: 'hd-weather-tile-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hd-field">
      <label class="hd-field__label" for="weather-place">Place</label>
      <p class="current">
        @if (settings().place; as place) {
          <span>{{ place.name }}</span>
          <button type="button" class="hd-btn" (click)="useHomey()">Use Homey's location</button>
        } @else {
          <span>Homey location{{ town() ? ': ' + town() : '' }}</span>
        }
      </p>
      <input
        #input
        id="weather-place"
        class="hd-input"
        type="search"
        autocomplete="off"
        [placeholder]="settings().place ? 'Search another town' : 'Search a town to use instead'"
        [value]="query()"
        (input)="search($any($event.target).value)"
        (keydown.escape)="search('')"
        (focus)="open.set(true)"
        (blur)="closeUnlessInList($event)"
      />
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      } @else if (query().trim().length >= 2 && searched() && !matches().length) {
        <p class="muted">No town found</p>
      }
      <!-- A popover, so it floats over the settings under it instead of pushing them down; the press stays on the input. -->
      <ul #list class="matches" popover="manual" aria-label="Towns" (pointerdown)="$event.preventDefault()">
        @for (match of matches(); track $index) {
          <li>
            <button type="button" class="match" (click)="choose(match)">
              <span class="match__name">{{ match.name }}</span>
              <span class="match__detail">{{ detail(match) }}</span>
            </button>
          </li>
        }
      </ul>
    </div>
  `,
  styles: `
    .current { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); margin: 0 0 var(--space-2); }
    .current span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .current .hd-btn { flex: none; padding-inline: 10px; }
    .muted { color: var(--ink-muted); margin: var(--space-1) 0 0; }
    .error { color: var(--danger); margin: var(--space-1) 0 0; }
    .matches { position: fixed; inset: auto; margin: 0; padding: 0; list-style: none; background: var(--panel); color: var(--ink); border: 1px solid var(--line); border-radius: var(--radius-control); box-shadow: 0 8px 24px rgb(0 0 0 / .18); overflow: hidden auto; }
    .matches li + li { border-top: 1px solid var(--line); }
    .match { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; padding: var(--space-2) var(--space-3); border: 0; background: none; color: inherit; font: inherit; text-align: start; cursor: pointer; }
    .match:hover, .match:focus-visible { background: color-mix(in oklab, var(--brand) 12%, transparent); outline: none; }
    .match__name { font-weight: 600; }
    .match__detail { font-size: 12px; color: var(--ink-muted); }
  `,
})
export class WeatherTileSettingsEditor {
  readonly settings = input.required<WeatherTileSettings>();
  readonly changed = output<Partial<WeatherTileSettings>>();

  private readonly api = inject(WeatherApi);
  private readonly data = inject(TileData);
  private readonly weather = inject(WeatherData);

  protected readonly query = signal('');
  protected readonly matches = signal<PlaceMatch[]>([]);
  protected readonly searched = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly detail = placeDetail;
  /** Whether the towns are shown: while the search has the focus, or something in them does. */
  protected readonly open = signal(true);
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');
  private readonly input = viewChild<ElementRef<HTMLElement>>('input');

  /** The town Homey's own weather names, once its forecast has come. */
  private readonly homeForecast = computed(() => this.weather.forecast({ ...this.settings(), place: undefined, target: WEATHER_HERE }));
  protected readonly town = computed(() => this.homeForecast()?.place ?? null);
  protected readonly homeyName = computed(() => this.data.homey(this.settings().account)?.accountName ?? 'Homey');

  private timer?: ReturnType<typeof setTimeout>;
  private seq = 0;

  constructor() {
    const reposition = () => this.place();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.timer);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    });
    effect(() => {
      const list = this.list()?.nativeElement;
      if (!list) return;
      const show = this.matches().length > 0 && this.open();
      const shown = popoverOpen(list);
      if (show) {
        this.place();
        if (!shown) list.showPopover?.();
      } else if (shown) list.hidePopover?.();
    });
  }

  /** Puts the towns under the search, as wide as it. */
  private place() {
    const list = this.list()?.nativeElement;
    const box = this.input()?.nativeElement.getBoundingClientRect();
    if (!list || !box) return;
    const top = box.bottom + 4;
    list.style.top = `${top}px`;
    list.style.left = `${box.left}px`;
    list.style.width = `${box.width}px`;
    list.style.maxHeight = `${Math.max(120, window.innerHeight - top - 12)}px`;
  }

  protected closeUnlessInList(event: FocusEvent) {
    if (!this.list()?.nativeElement.contains(event.relatedTarget as Node | null)) this.open.set(false);
  }

  protected search(query: string) {
    this.query.set(query);
    this.searched.set(false);
    this.error.set(null);
    clearTimeout(this.timer);
    if (query.trim().length < 2) {
      this.seq++;
      this.matches.set([]);
      return;
    }
    this.timer = setTimeout(() => this.find(query.trim()), SEARCH_AFTER_MS);
  }

  // Only the answer to the latest search counts.
  private async find(query: string) {
    const seq = ++this.seq;
    const language = (navigator.language || 'en').slice(0, 2).toLowerCase();
    try {
      const matches = await firstValueFrom(this.api.places(query, language));
      if (seq !== this.seq) return;
      const here = this.homeForecast()?.location;
      // The towns nearest Homey first, which are the ones people mean.
      this.matches.set(here ? [...matches].sort((a, b) => distanceKm(here, a) - distanceKm(here, b)) : matches);
      this.searched.set(true);
    } catch {
      if (seq !== this.seq) return;
      this.matches.set([]);
      this.error.set("Couldn't search: Open-Meteo can't be reached.");
    }
  }

  // A place of its own needs no Homey, so the tile stops naming one.
  protected choose(match: PlaceMatch) {
    this.changed.emit({
      target: WEATHER_PLACE,
      place: { name: match.name, latitude: match.latitude, longitude: match.longitude },
      account: undefined,
    });
    this.search('');
  }

  protected useHomey() {
    this.changed.emit({ target: WEATHER_HERE, place: undefined });
  }
}
