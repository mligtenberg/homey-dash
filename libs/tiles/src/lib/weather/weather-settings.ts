import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { PlaceMatch, WEATHER_HERE, WEATHER_PLACE, WeatherApi } from '@homey-dash/api-client';
import { firstValueFrom } from 'rxjs';
import { TileData } from '../tile-data';
import { WeatherData, WeatherTileSettings } from './weather-data';

/** How long typing rests before it searches. */
const SEARCH_AFTER_MS = 300;

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
          <button type="button" class="hd-btn" (click)="useHomey()">Use where {{ homeyName() }} is</button>
        } @else {
          <span>Homey location{{ town() ? ': ' + town() : '' }}</span>
        }
      </p>
      <input
        id="weather-place"
        class="hd-input"
        type="search"
        autocomplete="off"
        [placeholder]="settings().place ? 'Search another town' : 'Search a town to use instead'"
        [value]="query()"
        (input)="search($any($event.target).value)"
        (keydown.escape)="search('')"
      />
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      } @else if (query().trim().length >= 2 && searched() && !matches().length) {
        <p class="muted">No town found</p>
      }
      @if (matches().length) {
        <ul class="matches" aria-label="Towns">
          @for (match of matches(); track $index) {
            <li>
              <button type="button" class="match" (click)="choose(match)">
                <span class="match__name">{{ match.name }}</span>
                <span class="match__detail">{{ detail(match) }}</span>
              </button>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    .current { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); margin: 0 0 var(--space-2); }
    .current span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .current .hd-btn { flex: none; padding-inline: 10px; }
    .muted { color: var(--ink-muted); margin: var(--space-1) 0 0; }
    .error { color: var(--danger); margin: var(--space-1) 0 0; }
    .matches { list-style: none; margin: var(--space-1) 0 0; padding: 0; display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: var(--radius-control); overflow: hidden; }
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

  /** The town Homey's own weather names, once its forecast has come. */
  protected readonly town = computed(() => this.weather.forecast({ ...this.settings(), place: undefined, target: WEATHER_HERE })?.place ?? null);
  protected readonly homeyName = computed(() => this.data.homey(this.settings().account)?.accountName ?? 'Homey');

  private timer?: ReturnType<typeof setTimeout>;
  private seq = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
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
      this.matches.set(matches);
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
