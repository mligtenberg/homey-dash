import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { PlexProfile, PlexProfileList, Realtime } from '@homey-dash/api-client';
import { LucideLock, LucideUser } from '@homey-dash/design-system';
import { LucideDynamicIcon } from '@lucide/angular';
import { reason } from './hub-reason';

/** The next number for a picker's popover and its anchor. */
let nextId = 0;

/**
 * Whose watching it is in a Plex Home: the profile in use, named on a button that opens the others. A profile with a PIN
 * asks for it first. Nothing shows for an account with fewer than two profiles. The profiles are asked for each time the
 * dialog it sits in opens (`active`), so a change made elsewhere shows; `switched` says that another profile is in use,
 * so what was loaded for the one before is stale.
 */
@Component({
  selector: 'hd-plex-profile-picker',
  imports: [LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (name(); as name) {
      <button
        type="button"
        class="hd-plex-recent__receiver hd-plex-recent__profile"
        [attr.popovertarget]="id"
        [style.anchor-name]="'--' + id"
        aria-haspopup="true"
      >
        <svg [lucideIcon]="profileIcon" />{{ name }}
      </button>
      <div
        #panel
        class="hd-plex-recent__profiles"
        popover
        role="group"
        aria-label="Profile"
        [id]="id"
        [style.position-anchor]="'--' + id"
        (toggle)="onToggle($any($event).newState)"
      >
        @for (p of profiles()?.profiles ?? []; track p.id) {
          <button
            type="button"
            class="hd-plex-recent__profile-option"
            [attr.aria-pressed]="p.id === profiles()?.currentId"
            [disabled]="switching()"
            (click)="choose(p)"
          >
            {{ p.name }}
            @if (p.protected) {
              <svg role="img" aria-label="PIN" [lucideIcon]="lockIcon" />
            }
          </button>
        }
        @if (pinFor(); as p) {
          <form class="hd-plex-recent__pin" (submit)="$event.preventDefault(); switchTo(p, pin.value)">
            <input #pin type="password" inputmode="numeric" autocomplete="off" [placeholder]="'PIN for ' + p.name" [attr.aria-label]="'PIN for ' + p.name" />
            <button type="submit" class="hd-plex-recent__play" [disabled]="switching()">Switch</button>
          </form>
        }
        @if (error(); as error) {
          <div class="hd-plex-recent__cast-error" role="alert">{{ error }}</div>
        }
      </div>
    }
  `,
})
export class PlexProfilePicker {
  readonly accountId = input.required<number>();
  /** The profile the account's overview names as in use, when it does. */
  readonly current = input<string | null | undefined>();
  /** Whether the dialog is open. */
  readonly active = input.required<boolean>();
  readonly switched = output<void>();

  private readonly realtime = inject(Realtime);
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  /** Gives each picker's popover and its anchor a name of their own. */
  protected readonly id = `hd-plex-profiles-${nextId++}`;
  protected readonly profiles = signal<PlexProfileList | null>(null);
  /** The profile with a PIN that is being switched to, until the PIN is given. */
  protected readonly pinFor = signal<PlexProfile | null>(null);
  protected readonly switching = signal(false);
  protected readonly error = signal('');
  protected readonly profileIcon = LucideUser;
  protected readonly lockIcon = LucideLock;

  /** The profile in use; nothing when the account has only one. */
  protected readonly name = computed(() => {
    const { profiles = [], currentId = null } = this.profiles() ?? {};
    if (profiles.length < 2) return '';
    return this.current() ?? profiles.find((p) => p.id === currentId)?.name ?? profiles[0].name;
  });

  constructor() {
    effect(() => {
      if (this.active()) untracked(() => void this.load());
      else untracked(() => this.reset());
    });
  }

  private async load() {
    try {
      this.profiles.set(await this.realtime.plexProfiles(this.accountId()));
    } catch {
      // No home, or Plex can't be reached: there is nothing to choose.
      this.profiles.set(null);
    }
  }

  /** Closed, by choosing, a press outside or Escape (the popover does that itself): the next opening starts clean. */
  protected onToggle(state: string) {
    if (state !== 'open') this.reset();
  }

  private reset() {
    this.close();
    this.pinFor.set(null);
    this.error.set('');
  }

  private close() {
    this.panel()?.nativeElement.hidePopover?.();
  }

  protected choose(profile: PlexProfile) {
    this.error.set('');
    if (profile.id === this.profiles()?.currentId) return this.close();
    if (profile.protected) return this.pinFor.set(profile);
    void this.switchTo(profile, null);
  }

  protected async switchTo(profile: PlexProfile, pin: string | null) {
    this.switching.set(true);
    this.error.set('');
    try {
      await this.realtime.plexSelectProfile(this.accountId(), profile.id, pin || null);
      this.close();
      this.pinFor.set(null);
      this.switched.emit();
      await this.load();
    } catch (error) {
      this.error.set(reason(error, `Could not switch to ${profile.name}.`));
    } finally {
      this.switching.set(false);
    }
  }
}
