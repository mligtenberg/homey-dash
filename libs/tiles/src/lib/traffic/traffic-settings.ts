import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TomTomAccountApi } from '@homey-dash/api-client';
import { TrafficTileSettings } from './traffic-data';
import { TrafficRouteField } from './traffic-route-field';
import { TranslatePipe } from '@homey-dash/i18n';

/**
 * Management's choice of a traffic tile's route (ADR-0015): a name and two places found by name with TomTom, and which TomTom
 * account asks once there are several.
 */
@Component({
  selector: 'hd-traffic-tile-settings',
  imports: [TrafficRouteField, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (accounts()?.accounts; as accounts) {
      @if (accounts.length > 1) {
        <div class="hd-field">
          <label class="hd-field__label" for="traffic-account">{{ 'TomTom account' | t }}</label>
          <select id="traffic-account" class="hd-select" (change)="setAccount($any($event.target).value)">
            @for (account of accounts; track account.id; let first = $first) {
              <option [value]="account.id" [selected]="settings().account === account.id || (settings().account === undefined && first)">{{ account.name }}</option>
            }
          </select>
        </div>
      } @else if (!accounts.length) {
        <p class="hd-hint">{{ 'Set up a TomTom account under Accounts to find places and show traffic.' | t }}</p>
      }
    }
    <hd-traffic-route-field idPrefix="traffic" [route]="settings().route" [account]="settings().account" (changed)="changed.emit({ route: $event })" />
  `,
})
export class TrafficTileSettingsEditor {
  readonly settings = input.required<TrafficTileSettings>();
  readonly changed = output<Partial<TrafficTileSettings>>();

  protected readonly accounts = toSignal(inject(TomTomAccountApi).list(), { initialValue: null });

  // The oldest account is the one a tile without an account uses.
  protected setAccount(value: string) {
    const first = this.accounts()?.accounts[0]?.id;
    const id = Number(value);
    this.changed.emit({ account: id === first ? undefined : id });
  }
}
