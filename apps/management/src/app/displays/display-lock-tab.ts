import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LOCK_SPOTS, LockSpot } from '@homey-dash/api-client';
import { SignalPicker } from '../editor/signal-picker';
import { DisplayContext } from './display-context';
import { DisplaysStore, isCapabilitySignal, MAX_LOCK_WIDGETS } from './displays-store';

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
  imports: [SignalPicker],
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
            </select>
            <select class="hd-select" [attr.aria-label]="'Where widget ' + (i + 1) + ' sits'" (change)="store.setLockSpot(display, i, $any($event.target).value)">
              @for (spot of spots; track spot) {
                <option [value]="spot" [selected]="spot === widget.spot">{{ spotName(spot) }}</option>
              }
            </select>
            @if (widget.kind === 'weather' && store.homeys().length > 1) {
              <select class="hd-select" [attr.aria-label]="'Whose weather widget ' + (i + 1) + ' shows'" (change)="store.setLockAccount(display, i, $any($event.target).value)">
                @for (homey of store.homeys(); track homey.accountId) {
                  <option [value]="homey.accountId" [selected]="(widget.account ?? store.homeys()[0].accountId) === homey.accountId">{{ homey.accountName }}</option>
                }
              </select>
            } @else if (widget.kind === 'value') {
              <hd-signal-picker class="signal" [value]="widget.signal" [only]="isCapability" (picked)="store.setLockSignal(display, i, $event)" />
            } @else {
              <span class="spacer"></span>
            }
            <button type="button" class="hd-btn" [attr.aria-label]="'Move widget ' + (i + 1) + ' up'" [disabled]="i === 0" (click)="store.moveLock(display, i, -1)">↑</button>
            <button type="button" class="hd-btn" [attr.aria-label]="'Move widget ' + (i + 1) + ' down'" [disabled]="last" (click)="store.moveLock(display, i, 1)">↓</button>
            <button type="button" class="hd-btn" [attr.aria-label]="'Remove widget ' + (i + 1)" (click)="store.removeLock(display, i)">✕</button>
          </div>
        }
        <button type="button" class="hd-btn lock__add" [disabled]="display.lockWidgets.length >= maxLock" (click)="store.addLock(display)">Add a widget</button>
      </div>
    }
  `,
  styles: `
    .lock { display: flex; flex-direction: column; gap: var(--space-2); }
    .entry { display: flex; align-items: center; gap: var(--space-1); }
    .entry .hd-select { flex: 0 1 170px; min-width: 0; }
    .entry .hd-btn { padding-inline: 10px; }
    .signal, .spacer { flex: 1 1 0; min-width: 0; display: block; }
    .lock__add { align-self: flex-start; }
  `,
})
export class DisplayLockTab {
  protected readonly context = inject(DisplayContext);
  protected readonly store = inject(DisplaysStore);
  protected readonly spots = LOCK_SPOTS;
  protected readonly maxLock = MAX_LOCK_WIDGETS;
  protected readonly isCapability = isCapabilitySignal;

  protected spotName(spot: LockSpot) {
    return SPOT_NAMES[spot];
  }
}
