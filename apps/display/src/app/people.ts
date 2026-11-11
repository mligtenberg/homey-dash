import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, signal } from '@angular/core';
import { LucideMapPinOff, LucideMoon } from '@homey-dash/design-system';
import { LucideDynamicIcon } from '@lucide/angular';
import { homeyUserAvatarUrl, Realtime } from '@homey-dash/api-client';
import { TileData } from '@homey-dash/tiles';
import { TranslatePipe } from '@homey-dash/i18n';

/** The room the column of people takes from the left edge: its width plus a gap either side (44px + 2 x --space-3). */
export const PEOPLE_GUTTER = 68;

/**
 * The people of every Homey, as a column of circles in the top left of the gutter: an initial, a small mark when the
 * person is away or asleep (home and awake carry none), and dimmed while away. Pressing one opens a sheet beside it to
 * set them home or away, and awake or sleeping, in Homey. Nothing shows while Homey tells of no one.
 */
@Component({
  imports: [LucideDynamicIcon, TranslatePipe],
  selector: 'hd-people',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'close()', '(document:pointerdown)': 'outside($event)' },
  template: `
    @if (people().length) {
      <nav class="people" [attr.aria-label]="'People' | t">
        @for (person of people(); track person.key) {
          <div class="person">
            <button
              class="person__face"
              type="button"
              [class.is-away]="!person.present"
              [attr.aria-expanded]="open() === person.key"
              [attr.aria-label]="person.name + ', ' + person.state"
              (click)="toggle(person.key)"
            >
              @if (person.avatar && !failed().has(person.key)) {
                <img class="person__photo" [src]="person.avatar" alt="" (error)="fail(person.key)" />
              } @else {
                {{ person.initial }}
              }
              @if (!person.present) {
                <span class="person__mark person__mark--away" aria-hidden="true"><svg [lucideIcon]="awayIcon" /></span>
              }
              @if (person.asleep) {
                <span class="person__mark person__mark--asleep" aria-hidden="true"><svg [lucideIcon]="sleepIcon" /></span>
              }
            </button>
            @if (open() === person.key) {
              <div class="person__sheet" role="dialog" [attr.aria-label]="person.name">
                <h2>{{ person.name }}</h2>
                <div class="choice" role="group" [attr.aria-label]="'Home or away' | t">
                  <button type="button" [attr.aria-pressed]="person.present" (click)="set(person, { present: true })">{{ 'Home' | t }}</button>
                  <button type="button" [attr.aria-pressed]="!person.present" (click)="set(person, { present: false })">{{ 'Away' | t }}</button>
                </div>
                <div class="choice" role="group" [attr.aria-label]="'Awake or sleeping' | t">
                  <button type="button" [attr.aria-pressed]="!person.asleep" (click)="set(person, { asleep: false })">{{ 'Awake' | t }}</button>
                  <button type="button" [attr.aria-pressed]="person.asleep" (click)="set(person, { asleep: true })">{{ 'Sleeping' | t }}</button>
                </div>
              </div>
            }
          </div>
        }
      </nav>
    }
  `,
  styles: `
    .people { position: absolute; z-index: 5; left: var(--space-3); top: var(--space-3); display: flex; flex-direction: column; gap: var(--space-2); }
    .person { position: relative; }
    .person__face {
      position: relative; width: 44px; height: 44px; padding: 0; border: 0; border-radius: var(--radius-pill);
      display: grid; place-items: center; cursor: pointer;
      background: color-mix(in oklab, var(--panel) 72%, transparent); backdrop-filter: blur(12px);
      box-shadow: 0 1px 3px color-mix(in oklab, var(--emboss-shade) 60%, transparent);
      color: var(--ink); font: 800 16px/1 var(--font-sans); text-transform: uppercase;
      transition: transform .12s ease-out;
    }
    .person__photo { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: inherit; object-fit: cover; }
    .person__face.is-away .person__photo { opacity: .55; }
    .person__face:active { transform: scale(.96); }
    .person__face:focus-visible, .choice button:focus-visible { outline: 3px solid var(--brand); outline-offset: 2px; }
    /* Away is intensity: the letter fades, the marks stay at full strength. */
    .person__face.is-away { color: var(--ink-muted); }
    .person__mark {
      position: absolute; bottom: -3px; width: 18px; height: 18px; border-radius: var(--radius-pill);
      display: grid; place-items: center; background: var(--ink); color: var(--panel);
      box-shadow: 0 0 0 2px var(--tile-surface);
    }
    .person__mark--away { left: -3px; }
    .person__mark--asleep { right: -3px; }
    .person__mark svg { width: 11px; height: 11px; }
    .person__sheet {
      position: absolute; left: calc(100% + var(--space-2)); top: 0; z-index: 1; width: max-content; min-width: 224px;
      display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3);
      border-radius: var(--radius-lg); background: var(--panel);
      box-shadow: 0 1px 2px color-mix(in oklab, var(--emboss-shade) 60%, transparent), 0 8px 24px color-mix(in oklab, var(--emboss-shade) 70%, transparent);
    }
    .person__sheet h2 { margin: 0 0 var(--space-1); font: 700 15px/1.2 var(--font-sans); color: var(--ink); }
    .choice { display: flex; gap: var(--space-1); padding: 4px; border-radius: var(--radius-pill); background: var(--tile-surface); }
    .choice button {
      flex: 1; min-height: 44px; padding: 0 var(--space-4); border: 0; border-radius: var(--radius-pill);
      background: none; color: var(--ink-muted); font: 700 15px/1 var(--font-sans); cursor: pointer;
      transition: background-color .15s, color .15s;
    }
    .choice button[aria-pressed='true'] { background: var(--ink); color: var(--panel); }
    @media (prefers-reduced-motion: reduce) { .person__face, .choice button { transition: none; } }
  `,
})
export class People {
  private readonly data = inject(TileData);
  private readonly realtime = inject(Realtime);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly awayIcon = LucideMapPinOff;
  protected readonly sleepIcon = LucideMoon;
  protected readonly open = signal<string | null>(null);
  // People whose picture would not load, who show their initial instead.
  protected readonly failed = signal<ReadonlySet<string>>(new Set());

  /** Every Homey's people, each Homey's by name; the key tells the same name in two Homeys apart. */
  readonly people = computed(() =>
    (this.data.homeys() ?? []).flatMap((homey) =>
      [...homey.users.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((user) => ({
          key: `${homey.accountId}:${user.id}`,
          accountId: homey.accountId,
          id: user.id,
          name: user.name,
          avatar: user.hasAvatar ? homeyUserAvatarUrl(homey.accountId, user.id) : null,
          initial: [...user.name.trim()][0] ?? '?',
          present: user.present,
          asleep: user.asleep,
          state: `${user.present ? 'home' : 'away'}, ${user.asleep ? 'asleep' : 'awake'}`,
        })),
    ),
  );

  protected fail(key: string) {
    this.failed.update((failed) => new Set(failed).add(key));
  }

  protected toggle(key: string) {
    this.open.update((open) => (open === key ? null : key));
  }

  // A press anywhere but on the people closes the sheet; the press goes on to what is under it.
  protected outside(event: Event) {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.close();
  }

  protected close() {
    this.open.set(null);
  }

  protected set(person: { accountId: number; id: string }, change: { present?: boolean; asleep?: boolean }) {
    this.realtime.setUser(person.accountId, person.id, change).catch(() => undefined);
  }
}
