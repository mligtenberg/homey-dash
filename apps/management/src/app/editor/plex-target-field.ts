import { AccountSelect } from '../account-select';
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ALL_PLEX_LIBRARIES, ANY_PLEX_PLAYER, plexLibraryTarget, plexPlayerTarget } from '@homey-dash/api-client';
import { PlexData } from '@homey-dash/tiles';
import { TranslatePipe } from '@homey-dash/i18n';

/**
 * A Plex tile's target: for now playing, any player or one that played something since HomeyDash started; for recently
 * added, every library or one of them. With several Plex accounts, the account comes first; another account starts the
 * tile over at any player or every library.
 */
@Component({
  selector: 'hd-plex-target-field',
  imports: [RouterLink, AccountSelect, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (accounts().length > 1) {
      <div class="hd-field">
        <label class="hd-field__label" for="tile-account">{{ 'Plex account' | t }}</label>
        <hd-account-select selectId="tile-account" [accounts]="accounts()" [selected]="overview()?.accountId" (picked)="accountPicked.emit($event)" />
      </div>
    }
    <div class="hd-field">
      <label class="hd-field__label" for="tile-target">{{ type() === 'plexPlayer' ? 'Player' : 'Library' }}</label>
      <select id="tile-target" class="hd-select" (change)="picked.emit($any($event.target).value)">
        @for (option of options(); track option.target) {
          <option [value]="option.target" [selected]="option.target === value()">{{ option.label }}</option>
        }
        @if (value() && !known()) {
          <option [value]="value()" selected>{{ type() === 'plexPlayer' ? 'A player not seen lately' : 'Library not found in Plex' }}</option>
        }
      </select>
      @if (type() === 'plexPlayer') {
        <span class="hd-hint">{{ 'Players show up here once they played something.' | t }}</span>
      }
      @if (status(); as status) {
        <span class="hd-hint">{{ status }} <a routerLink="/settings/accounts">{{ 'Go to Accounts' | t }}</a></span>
      }
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--space-4); }
    a { color: var(--brand); }
  `,
})
export class PlexTargetField {
  readonly type = input.required<'plexPlayer' | 'plexLibrary'>();
  readonly value = input.required<string | null>();
  /** The tile's `settings.account`; absent for the oldest. */
  readonly account = input<number>();
  readonly picked = output<string>();
  readonly accountPicked = output<number>();

  private readonly plex = inject(PlexData);

  protected readonly accounts = computed(() => this.plex.overviews() ?? []);
  protected readonly overview = computed(() => this.plex.overview(this.account()));

  protected readonly options = computed(() => {
    const overview = this.overview();
    return this.type() === 'plexPlayer'
      ? [{ target: ANY_PLEX_PLAYER, label: 'Any player' }, ...(overview?.players ?? []).map((p) => ({ target: plexPlayerTarget(p), label: p.name }))]
      : [
          { target: ALL_PLEX_LIBRARIES, label: 'All libraries' },
          ...(overview?.libraries ?? []).map((l) => ({ target: plexLibraryTarget(l), label: l.title })),
        ];
  });

  protected readonly known = computed(() => this.options().some((o) => o.target === this.value()));

  protected readonly status = computed(() => {
    switch (this.plex.status(this.account())) {
      case 'notSetUp':
        return 'Plex is not set up.';
      case 'choosingServer':
        return 'Choose a Plex server first.';
      case 'disconnected':
        return 'HomeyDash can’t reach Plex right now.';
      default:
        return null;
    }
  });
}
