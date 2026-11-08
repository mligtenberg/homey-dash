import { AccountOption, AccountSelect } from '../account-select';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { LOCK_SPOTS, LockSpot, TomTomAccountApi } from '@homey-dash/api-client';
import { TrafficRouteField } from '@homey-dash/tiles';
import { SignalPicker } from '../editor/signal-picker';
import { DisplayContext } from './display-context';
import { DisplaysStore, isCapabilitySignal, MAX_LOCK_WIDGETS } from './displays-store';
import { ReorderButtons } from '@homey-dash/design-system';

const SPOT_NAMES: Record<LockSpot, string> = {
  'top-left': 'Top left',
  'top-right': 'Top right',
  center: 'Middle',
  'bottom-left': 'Bottom left',
  'bottom-right': 'Bottom right',
};

/** The widgets a display's lock screen shows over a photo set or colour while an idle rule plays it. */
@Component({
  selector: 'hd-display-lock-tab',
  imports: [AccountSelect, SignalPicker, ReorderButtons, TrafficRouteField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (context.display(); as display) {
      <div class="lock">
        <p class="hd-hint">Shown over a photo set or colour while an idle rule plays it. Widgets in the same place stack in this order.</p>
        @for (widget of display.lockWidgets; track $index; let i = $index, last = $last) {
          <div class="entry">
            <select class="hd-select" [attr.aria-label]="'What widget ' + (i + 1) + ' shows'" (change)="store.setLockKind(display, i, $any($event.target).value)">
              <option value="clock" [selected]="widget.kind === 'clock'">Time and date</option>
              <option value="weather" [selected]="widget.kind === 'weather'">Weather</option>
              <option value="value" [selected]="widget.kind === 'value'">Device value</option>
              <option value="traffic" [selected]="widget.kind === 'traffic'">Traffic</option>
            </select>
            <select class="hd-select" [attr.aria-label]="'Where widget ' + (i + 1) + ' sits'" (change)="store.setLockSpot(display, i, $any($event.target).value)">
              @for (spot of spots; track spot) {
                <option [value]="spot" [selected]="spot === widget.spot">{{ spotName(spot) }}</option>
              }
            </select>
            @if (widget.kind === 'weather' && store.homeys().length > 1) {
              <hd-account-select
                [accounts]="store.homeys()"
                [selected]="widget.account ?? store.homeys()[0].accountId"
                [ariaLabel]="'Whose weather widget ' + (i + 1) + ' shows'"
                (picked)="store.setLockAccount(display, i, '' + $event)"
              />
            } @else if (widget.kind === 'traffic' && tomtoms().length > 1) {
              <hd-account-select
                [accounts]="tomtoms()"
                [selected]="widget.account ?? tomtoms()[0].accountId"
                [ariaLabel]="'Which TomTom account widget ' + (i + 1) + ' asks'"
                (picked)="store.setLockAccount(display, i, '' + $event, tomtoms()[0].accountId)"
              />
            } @else if (widget.kind === 'value') {
              <hd-signal-picker class="signal" [value]="widget.signal" [only]="isCapability" (picked)="store.setLockSignal(display, i, $event)" />
            } @else {
              <span class="spacer"></span>
            }
            <hd-reorder-buttons [label]="'widget ' + (i + 1)" [first]="i === 0" [last]="last" (moved)="store.moveLock(display, i, $event)" (removed)="store.removeLock(display, i)" />
          </div>
          @if (widget.kind === 'traffic') {
            <div class="route">
              <hd-traffic-route-field [idPrefix]="'lock-traffic-' + i" [route]="widget.route" [account]="widget.account" (changed)="store.setLockRoute(display, i, $event)" />
            </div>
          }
        }
        <button type="button" class="hd-btn lock__add" [disabled]="display.lockWidgets.length >= maxLock" (click)="store.addLock(display)">Add a widget</button>
      </div>
    }
  `,
  styles: `
    .lock { display: flex; flex-direction: column; gap: var(--space-2); }
    .entry { display: flex; align-items: center; gap: var(--space-1); }
    .entry .hd-select { flex: 0 1 170px; min-width: 0; }
    .signal, .spacer { flex: 1 1 0; min-width: 0; display: block; }
    .route { display: flex; flex-direction: column; gap: var(--space-2); padding-inline-start: var(--space-3); border-inline-start: 2px solid var(--line); }
    .lock__add { align-self: flex-start; }
  `,
})
export class DisplayLockTab {
  protected readonly context = inject(DisplayContext);
  protected readonly store = inject(DisplaysStore);
  protected readonly spots = LOCK_SPOTS;
  protected readonly maxLock = MAX_LOCK_WIDGETS;
  protected readonly isCapability = isCapabilitySignal;

  private readonly tomtomAccounts = toSignal(inject(TomTomAccountApi).list(), { initialValue: null });
  // The TomTom accounts a traffic widget can ask with, oldest first.
  protected readonly tomtoms = computed<AccountOption[]>(() =>
    (this.tomtomAccounts()?.accounts ?? []).map((a) => ({ accountId: a.id, accountName: a.name })),
  );

  protected spotName(spot: LockSpot) {
    return SPOT_NAMES[spot];
  }
}
