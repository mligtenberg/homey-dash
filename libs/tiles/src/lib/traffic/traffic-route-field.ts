import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output } from '@angular/core';
import { samePlaces, TrafficPlace, TrafficRoute } from '@homey-dash/api-client';
import { TrafficPlaceField } from './traffic-place-field';
import { TranslatePipe } from '@homey-dash/i18n';

/**
 * Management's choice of a route (ADR-0015): a name, and an origin and destination found by name. Used by a traffic tile's
 * settings and by a lock screen's traffic widget. Emits the route once two different places are chosen, and only then (a half chosen route is kept here, not in settings); it names itself
 * `Origin → Destination` until it has a name of its own.
 */
@Component({
  selector: 'hd-traffic-route-field',
  imports: [TrafficPlaceField, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <div class="hd-field">
      <label class="hd-field__label" [for]="idPrefix() + '-name'">{{ 'Route name' | t }}</label>
      <input
        [id]="idPrefix() + '-name'"
        class="hd-input"
        autocomplete="off"
        [placeholder]="suggested() || 'Such as Home to work'"
        [value]="name()"
        (change)="rename($any($event.target).value)"
      />
    </div>
    <hd-traffic-place-field [id]="idPrefix() + '-origin'" [label]="'From' | t" [place]="origin()" [account]="account()" (picked)="pick('origin', $event)" />
    <hd-traffic-place-field [id]="idPrefix() + '-destination'" [label]="'To' | t" [place]="destination()" [account]="account()" (picked)="pick('destination', $event)" />
    @if (same()) {
      <p class="error" role="alert">{{ 'From and To are the same place. Pick two different places.' | t }}</p>
    }
  `,
  styles: `
    .error { color: var(--danger); margin: 0; }
  `,
})
export class TrafficRouteField {
  /** Starts the ids of its fields; one per page. */
  readonly idPrefix = input('route');
  readonly route = input<TrafficRoute | null | undefined>(null);
  /** The TomTom account that searches. */
  readonly account = input<number | null | undefined>(null);
  readonly changed = output<TrafficRoute>();

  // Follow the route, but keep a place chosen before the other.
  protected readonly origin = linkedSignal<TrafficPlace | null>(() => this.route()?.origin ?? null);
  protected readonly destination = linkedSignal<TrafficPlace | null>(() => this.route()?.destination ?? null);
  protected readonly name = linkedSignal(() => this.route()?.name ?? '');

  /** Both places are the same (to about 100 m), which has no traffic, so such a route is never emitted. */
  protected readonly same = computed(() => {
    const [origin, destination] = [this.origin(), this.destination()];
    return !!origin && !!destination && samePlaces({ origin, destination });
  });

  /** `Utrecht → Amsterdam`, once both places are known. */
  protected readonly suggested = computed(() => {
    const [from, to] = [this.origin(), this.destination()];
    return from && to ? `${from.name} → ${to.name}` : '';
  });

  protected rename(name: string) {
    this.name.set(name.trim());
    this.emit(this.name() === '');
  }

  protected pick(end: 'origin' | 'destination', place: TrafficPlace) {
    // A name made of the places follows them; one typed stays.
    const before = this.suggested();
    const auto = !this.name() || this.name() === before;
    (end === 'origin' ? this.origin : this.destination).set(place);
    this.emit(auto);
  }

  private emit(auto: boolean) {
    const [origin, destination] = [this.origin(), this.destination()];
    if (!origin || !destination || this.same()) return;
    const name = auto ? `${origin.name} → ${destination.name}` : this.name();
    this.name.set(name);
    this.changed.emit({ name, origin, destination });
  }
}
