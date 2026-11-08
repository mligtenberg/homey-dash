import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { capabilitySignal, HomeyWeather, LOCK_SPOTS, LockWidget, Rule } from '@homey-dash/api-client';
import { capabilityText, ruleAnswersOf, TileData } from '@homey-dash/tiles';
import {
  LucideCloud,
  LucideCloudDrizzle,
  LucideCloudFog,
  LucideCloudLightning,
  LucideCloudRain,
  LucideCloudSnow,
  LucideCloudSun,
  LucideDynamicIcon,
  LucideIconInput,
  LucideSun,
} from '@lucide/angular';
import { minuteClock } from '@homey-dash/design-system';

/** What a widget shows now; a weather Homey hasn't told, or a value whose device is gone, shows nothing. */
type Shown =
  | { kind: 'clock'; time: string; date: string }
  | { kind: 'weather'; temperature: string; state: string; icon: LucideIconInput }
  | { kind: 'value'; name: string; value: string; units: string; unavailable: boolean };

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
              <div class="weather" [attr.aria-label]="widget.state + ', ' + widget.temperature">
                <svg class="weather__icon" [lucideIcon]="widget.icon" />
                <span class="weather__temperature">{{ widget.temperature }}</span>
                <span class="weather__state">{{ widget.state }}</span>
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
    :host {
      position: fixed; inset: 0; z-index: 10; pointer-events: none; box-sizing: border-box;
      display: grid; grid-template: 'tl . tr' auto '. c .' 1fr 'bl . br' auto / 1fr auto 1fr;
      padding: clamp(16px, 4vh, 48px); color: #fff; text-shadow: 0 1px 2px rgb(0 0 0 / .5), 0 0 24px rgb(0 0 0 / .35);
      --u: 1vh;
    }
    /* Over a photo, the bottom spots stay above the caption along its bottom (see .hd-photo__caption): when and where it was taken, and who. */
    :host(.over-photo) { padding-bottom: calc(clamp(16px, 4vh, 48px) + 100dvh / 3 * .45); }
    .spot { display: flex; flex-direction: column; gap: calc(2 * var(--u)); }
    .spot--top-left { grid-area: tl; align-items: flex-start; }
    .spot--top-right { grid-area: tr; align-items: flex-end; text-align: right; }
    .spot--center { grid-area: c; align-self: center; align-items: center; text-align: center; --u: 1.8vh; }
    .spot--bottom-left { grid-area: bl; align-items: flex-start; justify-content: flex-end; }
    .spot--bottom-right { grid-area: br; align-items: flex-end; justify-content: flex-end; text-align: right; }
    .clock__time { font-size: calc(10 * var(--u)); font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
    .clock__date { font-size: calc(2.6 * var(--u)); font-weight: 600; margin-top: var(--u); }
    .weather { display: grid; grid-template-columns: auto auto; column-gap: var(--u); align-items: center; }
    .spot--center .weather { justify-content: center; }
    .weather__icon { width: calc(5 * var(--u)); height: calc(5 * var(--u)); filter: drop-shadow(0 1px 2px rgb(0 0 0 / .5)); }
    .weather__temperature { font-size: calc(5 * var(--u)); font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; }
    .weather__state { grid-column: 1 / -1; font-size: calc(2.2 * var(--u)); font-weight: 600; }
    .value { display: flex; flex-direction: column; }
    .value__reading { font-size: calc(4.5 * var(--u)); font-weight: 800; line-height: 1.05; font-variant-numeric: tabular-nums; }
    .value__units { font-size: .55em; font-weight: 700; margin-left: .1em; }
    .value__name { font-size: calc(2 * var(--u)); font-weight: 600; opacity: .85; white-space: nowrap; }
    .value.is-unavailable { opacity: .55; }
  `,
})
export class LockScreen {
  readonly widgets = input.required<readonly LockWidget[]>();

  private readonly data = inject(TileData);
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
