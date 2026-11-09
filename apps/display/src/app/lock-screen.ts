import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { capabilitySignal, HomeyWeather, LOCK_SPOTS, LockWidget, Rule } from '@homey-dash/api-client';
import { capabilityText, delayLevel, delayText, duration, ruleAnswersOf, TileData, TrafficData } from '@homey-dash/tiles';
import { LucideDynamicIcon, LucideIconInput } from '@lucide/angular';
import { LucideCar, LucideCloud, LucideCloudDrizzle, LucideCloudFog, LucideCloudLightning, LucideCloudRain, LucideCloudSnow, LucideCloudSun, LucideSun, minuteClock } from '@homey-dash/design-system';

/** What a widget shows now; a weather Homey hasn't told, or a value whose device is gone, shows nothing. */
type Shown =
  | { kind: 'clock'; time: string; date: string }
  | { kind: 'weather'; temperature: string; state: string; icon: LucideIconInput }
  | { kind: 'value'; name: string; value: string; units: string; unavailable: boolean }
  | { kind: 'traffic'; name: string; time: string; delay: string; level: 'none' | 'some' | 'heavy'; unavailable: boolean };

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
  return found ? { icon: found[1], label: found[2] } : { icon: LucideCloudSun, label: state ?? '' };
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
     * The content is the subject; the widgets are a quiet layer on it. Nothing covers the photo as a whole: each spot
     * darkens only its own corner, softly, so white type holds on any picture while the middle stays untouched.
     */
    :host {
      position: fixed; inset: 0; z-index: 10; pointer-events: none; box-sizing: border-box;
      display: grid; grid-template: 'tl . tr' auto '. c .' 1fr 'bl . br' auto / 1fr auto 1fr;
      --edge: var(--lock-edge, clamp(20px, 5vh, 56px));
      padding: var(--edge); color: #fff; --u: 1vh;
      text-shadow: 0 1px 2px rgb(0 0 0 / .55), 0 0 14px rgb(0 0 0 / .45), 0 0 36px rgb(0 0 0 / .35);
    }
    /* Over a photo, the bottom spots stay above the caption line along its bottom (styled in the app, to the same margins): when and where it was taken, and who. */
    :host(.over-photo) { padding-bottom: calc(var(--edge) + 7vh); }
    /* Each spot is only as wide as its widgets, so its shade is too, not the whole column's. */
    .spot { position: relative; display: flex; flex-direction: column; gap: calc(3 * var(--u)); animation: spot-in .9s cubic-bezier(.2, .7, .2, 1) backwards; }
    .spot::before {
      content: ''; position: absolute; z-index: -1; inset: calc(-5 * var(--u)) calc(-9 * var(--u));
      background: radial-gradient(closest-side, rgb(0 0 0 / .5), rgb(0 0 0 / .22) 55%, transparent);
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
    .clock__date { font-size: calc(2.3 * var(--u)); font-weight: 500; letter-spacing: .01em; margin-top: calc(1.4 * var(--u)); opacity: .9; }

    /* Everything else is a reading over its label, the same shape whatever it measures. */
    .weather, .traffic { display: grid; grid-template-columns: auto auto; column-gap: calc(1.2 * var(--u)); align-items: center; }
    .spot--center .weather, .spot--center .traffic { justify-content: center; }
    .weather__icon, .traffic__icon { width: calc(4 * var(--u)); height: calc(4 * var(--u)); stroke-width: 1.6; }
    .weather__temperature, .traffic__time, .value__reading { font-size: calc(4.6 * var(--u)); font-weight: 500; line-height: 1; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
    .weather__state, .traffic__name, .value__name { grid-column: 1 / -1; font-size: calc(1.9 * var(--u)); font-weight: 500; opacity: .82; white-space: nowrap; margin-top: calc(.7 * var(--u)); }
    .traffic[data-delay='some'] .traffic__time, .traffic[data-delay='some'] .traffic__icon { color: var(--lock-warn); }
    .traffic[data-delay='heavy'] .traffic__time, .traffic[data-delay='heavy'] .traffic__icon { color: var(--lock-danger); }
    .value { display: flex; flex-direction: column; }
    .value__units { font-size: .5em; font-weight: 500; margin-left: .15em; opacity: .85; }
    .value__name { margin-top: calc(.7 * var(--u)); }
    .is-unavailable { opacity: .5; }
  `,
})
export class LockScreen {
  readonly widgets = input.required<readonly LockWidget[]>();

  private readonly data = inject(TileData);
  private readonly traffic = inject(TrafficData);
  protected readonly car = LucideCar;
  // Ticks on every minute, for the clock.
  private readonly now = minuteClock();

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
          time: now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
          date: now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }),
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
