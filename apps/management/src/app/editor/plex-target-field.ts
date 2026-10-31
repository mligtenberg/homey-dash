import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ALL_PLEX_LIBRARIES, ANY_PLEX_PLAYER, plexLibraryTarget, plexPlayerTarget } from '@homey-dash/api-client';
import { PlexData } from '@homey-dash/tiles';

/**
 * A Plex tile's target: for now playing, any player or one that played something since HomeyDash started; for recently
 * added, every library or one of them.
 */
@Component({
  selector: 'hd-plex-target-field',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
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
        <span class="hint">Players show up here once they played something.</span>
      }
      @if (status(); as status) {
        <span class="hint">{{ status }} <a routerLink="/accounts">Go to Accounts</a></span>
      }
    </div>
  `,
  styles: `
    .hint { font-size: 13px; color: var(--ink-muted); }
    a { color: var(--brand); }
  `,
})
export class PlexTargetField {
  readonly type = input.required<'plexPlayer' | 'plexLibrary'>();
  readonly value = input.required<string | null>();
  readonly picked = output<string>();

  private readonly plex = inject(PlexData);

  protected readonly options = computed(() => {
    const overview = this.plex.overview();
    return this.type() === 'plexPlayer'
      ? [{ target: ANY_PLEX_PLAYER, label: 'Any player' }, ...(overview?.players ?? []).map((p) => ({ target: plexPlayerTarget(p), label: p.name }))]
      : [
          { target: ALL_PLEX_LIBRARIES, label: 'All libraries' },
          ...(overview?.libraries ?? []).map((l) => ({ target: plexLibraryTarget(l), label: l.title })),
        ];
  });

  protected readonly known = computed(() => this.options().some((o) => o.target === this.value()));

  protected readonly status = computed(() => {
    switch (this.plex.overview()?.status) {
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
