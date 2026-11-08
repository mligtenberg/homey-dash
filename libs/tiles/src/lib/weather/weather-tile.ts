import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { RainPoint, WEATHER_PLACE, WeatherDay, WeatherHour } from '@homey-dash/api-client';
import { LucideCloudSun } from '@homey-dash/design-system';
import { LucideDynamicIcon } from '@lucide/angular';
import { TileDetails } from '../core/tile-details';
import { TILE_FACE_HOST, TileFace, TileView } from '../core/tile-view';
import { clockTime, degrees, RAIN_FROM, rainSummary, WeatherData, weatherIdle, weatherLook, WeatherTileSettings } from './weather-data';

/** How many hours ahead, and days, each size shows; a large tile shows the rain instead of hours while rain comes. */
const HOURS = { small: 0, wide: 3, full: 5, large: 5, 'full-large': 6, 'full-tall': 6 } as const;
const DAYS = { small: 0, wide: 0, full: 0, large: 4, 'full-large': 6, 'full-tall': 6 } as const;

/** Rain heavier than this fills a bar of the rain chart: a downpour. */
const RAIN_TOP = 5;

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Today, or a short weekday: `Tue`. */
export function dayName(day: WeatherDay, index: number): string {
  if (index === 0) return 'Today';
  const [y, m, d] = day.date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short' });
}

/**
 * The weather where the tile's Homey is, or at a place of its own (ADR-0013), from Open-Meteo, with Buienradar's rain of the next two hours: the
 * weather now and the day's high and low, and from wide up the coming hours; large tiles add the coming days, and show the
 * rain instead of the hours while rain comes. A press opens the full forecast.
 */
@Component({
  selector: 'hd-weather-tile',
  imports: [TileDetails, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { ...TILE_FACE_HOST, class: 'hd-tile hd-weather', '[class.has-forecast]': '!!now()' },
  template: `
    @if (now(); as now) {
      <div class="hd-row hd-row--top hd-weather__now">
        <svg class="hd-icon" [lucideIcon]="look().icon" [attr.aria-label]="look().text" />
        <span class="hd-value" [class.hd-value--l]="size() !== 'small' && size() !== 'wide'" [class.hd-value--m]="size() === 'small' || size() === 'wide'">{{ degrees(now.temperature) }}</span>
      </div>
      <div class="hd-weather__titles">
        <div class="hd-tile__name">{{ face().name }}</div>
        <div class="hd-tile__detail">{{ face().detail }}</div>
      </div>
      @if (showRain()) {
        <div class="hd-weather__ahead hd-weather__rain" role="img" [attr.aria-label]="rain() ?? ''">
          <svg class="hd-weather__bars" viewBox="0 0 240 60" preserveAspectRatio="none" aria-hidden="true">
            @for (point of rainAhead(); track point.time; let i = $index) {
              <rect [attr.x]="i * 10 + 1" [attr.y]="60 - barHeight(point)" width="8" [attr.height]="barHeight(point)" rx="2" />
            }
          </svg>
          <div class="hd-weather__axis"><span>Now</span><span>{{ inAnHour() }}</span><span>{{ inTwoHours() }}</span></div>
        </div>
      } @else if (hours().length) {
        <ol class="hd-weather__ahead hd-weather__strip">
          @for (hour of hours(); track hour.time) {
            <li>
              <span class="hd-weather__when">{{ hourName(hour) }}</span>
              <svg class="hd-icon" [lucideIcon]="lookOf(hour.code, hour.day).icon" [attr.aria-label]="lookOf(hour.code, hour.day).text" />
              <span class="hd-weather__temp">{{ degrees(hour.temperature) }}</span>
            </li>
          }
        </ol>
      }
      @if (days().length) {
        <ol class="hd-weather__days hd-weather__strip">
          @for (day of days(); track day.date; let i = $index) {
            <li>
              <span class="hd-weather__when">{{ dayName(day, i) }}</span>
              <svg class="hd-icon" [lucideIcon]="lookOf(day.code).icon" [attr.aria-label]="lookOf(day.code).text" />
              <span class="hd-weather__temp">{{ degrees(day.high) }}<span class="hd-weather__low">{{ degrees(day.low) }}</span></span>
            </li>
          }
        </ol>
      }
    } @else {
      <svg class="hd-icon" [lucideIcon]="face().icon" />
      <div>
        <div class="hd-tile__name">{{ face().name }}</div>
        <div class="hd-tile__detail">{{ face().detail }}</div>
      </div>
    }
    <hd-tile-details [screen]="true" [name]="face().name" [icon]="look().icon" [subtitle]="detailsSubtitle()">
      @if (forecast(); as forecast) {
        <div class="hd-weather__pane">
          @if (forecast.now; as now) {
            <section class="hd-weather__hero">
              <svg class="hd-icon" [lucideIcon]="look().icon" aria-hidden="true" />
              <div>
                <div class="hd-value hd-value--xl">{{ degrees(now.temperature) }}</div>
                <div class="hd-details__state">{{ look().text }} · Feels like {{ degrees(now.feelsLike) }}</div>
              </div>
            </section>
            <dl class="hd-stat__figures">
              <div class="hd-stat__figure"><dt class="hd-details__label">Humidity</dt><dd class="hd-stat__figure-value">{{ percent(now.humidity) }}</dd></div>
              <div class="hd-stat__figure"><dt class="hd-details__label">Wind</dt><dd class="hd-stat__figure-value">{{ wind(now.wind, now.windDirection) }}</dd></div>
              @if (forecast.days[0]; as today) {
                <div class="hd-stat__figure"><dt class="hd-details__label">Sunrise</dt><dd class="hd-stat__figure-value">{{ clockTime(today.sunrise) }}</dd></div>
                <div class="hd-stat__figure"><dt class="hd-details__label">Sunset</dt><dd class="hd-stat__figure-value">{{ clockTime(today.sunset) }}</dd></div>
              }
            </dl>
          }
          @if (forecast.rain) {
            <section class="hd-weather__section">
              <h3 class="hd-details__label">{{ rain() ?? 'Dry for the next 2 hours' }}</h3>
              <div class="hd-weather__rain" role="img" [attr.aria-label]="rain() ?? 'Dry for the next 2 hours'">
                <svg class="hd-weather__bars" viewBox="0 0 240 60" preserveAspectRatio="none" aria-hidden="true">
                  @for (point of rainAhead(); track point.time; let i = $index) {
                    <rect [attr.x]="i * 10 + 1" [attr.y]="60 - barHeight(point)" width="8" [attr.height]="barHeight(point)" rx="2" />
                  }
                </svg>
                <div class="hd-weather__axis"><span>Now</span><span>{{ inAnHour() }}</span><span>{{ inTwoHours() }}</span></div>
              </div>
            </section>
          }
          <section class="hd-weather__section">
            <h3 class="hd-details__label">Next 24 hours</h3>
            <ol class="hd-weather__strip hd-weather__strip--scroll">
              @for (hour of allHours(); track hour.time) {
                <li>
                  <span class="hd-weather__when">{{ hourName(hour) }}</span>
                  <svg class="hd-icon" [lucideIcon]="lookOf(hour.code, hour.day).icon" [attr.aria-label]="lookOf(hour.code, hour.day).text" />
                  <span class="hd-weather__temp">{{ degrees(hour.temperature) }}</span>
                  <span class="hd-weather__chance">{{ hour.precipitationChance >= 20 ? hour.precipitationChance + '%' : '' }}</span>
                </li>
              }
            </ol>
          </section>
          <section class="hd-weather__section">
            <h3 class="hd-details__label">7 days</h3>
            <ol class="hd-weather__week">
              @for (day of forecast.days; track day.date; let i = $index) {
                <li>
                  <span class="hd-weather__when">{{ dayName(day, i) }}</span>
                  <svg class="hd-icon" [lucideIcon]="lookOf(day.code).icon" aria-hidden="true" />
                  <span class="hd-weather__what">{{ lookOf(day.code).text }}</span>
                  <span class="hd-weather__chance">{{ day.precipitationChance >= 20 ? day.precipitationChance + '%' : '' }}</span>
                  <span class="hd-weather__temp">{{ degrees(day.low) }} – {{ degrees(day.high) }}</span>
                </li>
              }
            </ol>
          </section>
          <p class="hd-weather__credit">
            Forecast by Open-Meteo{{ forecast.rain ? ', rain by Buienradar' : '' }}{{ forecast.updatedAt ? ' · ' + clockTime(forecast.updatedAt) : '' }}
          </p>
        </div>
      }
    </hd-tile-details>
  `,
})
export class WeatherTile extends TileView<WeatherTileSettings> {
  private readonly weather = inject(WeatherData);

  protected readonly degrees = degrees;
  protected readonly clockTime = clockTime;
  protected readonly dayName = dayName;
  protected readonly lookOf = weatherLook;

  /** Ticks every minute, so the hours and rain move on between forecasts. */
  private readonly clock = signal(Date.now());

  protected readonly forecast = computed(() => this.weather.forecast(this.settings()));
  protected readonly now = computed(() => this.forecast()?.now ?? null);
  protected readonly look = computed(() => {
    const now = this.now();
    return now ? weatherLook(now.code, now.day) : { icon: LucideCloudSun, text: '' };
  });

  /** The hours from the current one on. */
  protected readonly allHours = computed(() => {
    const clock = this.clock();
    return (this.forecast()?.hours ?? []).filter((h) => new Date(h.time).getTime() + 3_600_000 > clock);
  });
  /** The hours after the current one, as many as the size has room for. */
  protected readonly hours = computed(() => this.allHours().slice(1, 1 + HOURS[this.size()]));
  protected readonly days = computed(() => (this.forecast()?.days ?? []).slice(0, DAYS[this.size()]));

  /** The rain from the five minutes that hold now, two hours ahead. */
  protected readonly rainAhead = computed(() => {
    const clock = this.clock();
    return (this.forecast()?.rain ?? []).filter((p) => new Date(p.time).getTime() + 300_000 > clock).slice(0, 24);
  });
  protected readonly rain = computed(() => rainSummary(this.forecast()?.rain ?? null, this.clock()));
  /** Large tiles chart the rain in place of the hours while rain comes. */
  protected readonly showRain = computed(() => !!this.rain() && (this.size() === 'large' || this.size() === 'full-large'));
  protected readonly inAnHour = computed(() => clockTime(this.clock() + 3_600_000));
  protected readonly inTwoHours = computed(() => clockTime(this.clock() + 7_200_000));

  readonly face = computed<TileFace>(() => {
    const look = { icon: LucideCloudSun, hue: 'climate' as const };
    const { label, account, target, place } = this.settings();
    const forecast = this.forecast();
    const atPlace = target === WEATHER_PLACE;
    const name = label || (atPlace ? place?.name : forecast?.place) || 'Weather';
    const now = this.now();
    if (!target || (atPlace && !place)) return { ...look, name, detail: 'Pick a place', state: 'unset' };
    if (now) {
      const today = forecast?.days[0];
      const range = today ? ` · ${degrees(today.high)} / ${degrees(today.low)}` : '';
      return { ...look, name, detail: this.rain() ?? `${this.look().text}${range}`, details: true, state: 'ok' };
    }
    // A place's forecast comes a moment after the place was chosen.
    if (!this.weather.forecasts() || (atPlace && !forecast)) return { ...look, name, detail: '…', state: 'loading' };
    if (!forecast) return { ...look, name, detail: weatherIdle(undefined, account !== undefined), state: account !== undefined ? 'missing' : 'unavailable' };
    return {
      ...look,
      name,
      detail: weatherIdle(forecast, true),
      state: forecast.status === 'loading' ? 'loading' : 'unavailable',
    };
  });

  /** What it is like, and the place when a label names the tile otherwise. */
  protected readonly detailsSubtitle = computed(() => {
    const place = this.forecast()?.place;
    return [place !== this.face().name ? place : null, this.rain() ?? this.look().text].filter(Boolean).join(' · ');
  });

  constructor() {
    super();
    const ticker = setInterval(() => this.clock.set(Date.now()), 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(ticker));
  }

  protected hourName(hour: WeatherHour) {
    return new Date(hour.time).toLocaleTimeString(undefined, { hour: 'numeric' });
  }

  // Square-root, so a drizzle still shows beside a downpour.
  protected barHeight(point: RainPoint) {
    return point.rate < RAIN_FROM ? 2 : Math.max(6, Math.sqrt(Math.min(point.rate, RAIN_TOP) / RAIN_TOP) * 58);
  }

  protected percent(fraction: number) {
    return `${Math.round(fraction * 100)}%`;
  }

  protected wind(speed: number, direction: number) {
    return `${Math.round(speed)} km/h ${COMPASS[Math.round(direction / 45) % 8]}`;
  }
}
