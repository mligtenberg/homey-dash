import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { AirPlayPlayback, PlexTracks, Realtime } from '@homey-dash/api-client';
import { LucidePause, LucidePlay, LucideSquare } from '@homey-dash/design-system';
import { LucideDynamicIcon } from '@lucide/angular';
import { reason } from './hub-reason';

/**
 * What plays on an Apple TV, in the Plex dialog: what it is, and buttons to pause or resume it, stop it and, when the
 * item has more than one, choose its audio and subtitles. The host is the `hd-plex-recent__now` row.
 */
@Component({
  selector: 'hd-plex-airplay-controls',
  imports: [LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'hd-plex-recent__now', role: 'group', '[attr.aria-label]': "'Playing on ' + playing().deviceName" },
  template: `
    <div class="hd-plex-recent__now-text">
      <strong>{{ playing().title }}</strong>
      @if (playing().detail) {
        <span>{{ playing().detail }}</span>
      }
      <span>{{ busy() ? 'Starting on' : playing().paused ? 'Paused on' : 'Playing on' }} {{ playing().deviceName }}</span>
    </div>
    <button type="button" class="hd-plex-recent__receiver" [disabled]="busy()" (click)="togglePause()">
      <svg [lucideIcon]="playing().paused ? playIcon : pauseIcon" />{{ playing().paused ? 'Resume' : 'Pause' }}
    </button>
    <button type="button" class="hd-plex-recent__receiver" (click)="stop()"><svg [lucideIcon]="stopIcon" />Stop</button>
    @if (tracks(); as t) {
      @if (t.audio.length > 1) {
        <label class="hd-plex-recent__track">
          <span>Audio</span>
          <select [disabled]="busy()" (change)="pickAudio($any($event.target).value)">
            @for (a of t.audio; track a.id) {
              <option [value]="a.id" [selected]="a.id === audio()">{{ a.label }}</option>
            }
          </select>
        </label>
      }
      @if (t.subtitles.length) {
        <label class="hd-plex-recent__track">
          <span>Subtitles</span>
          <select [disabled]="busy()" (change)="pickSubtitle($any($event.target).value)">
            <option value="" [selected]="!playing().subtitleStreamId">Off</option>
            @for (sub of t.subtitles; track sub.id) {
              <option [value]="sub.id" [selected]="sub.id === playing().subtitleStreamId">{{ sub.label }}</option>
            }
          </select>
        </label>
      }
    }
    @if (error(); as error) {
      <div class="hd-plex-recent__cast-error" role="alert">{{ error }}</div>
    }
  `,
})
export class PlexAirPlayControls {
  readonly playing = input.required<AirPlayPlayback>();

  private readonly realtime = inject(Realtime);

  protected readonly playIcon = LucidePlay;
  protected readonly pauseIcon = LucidePause;
  protected readonly stopIcon = LucideSquare;

  protected readonly busy = signal(false);
  protected readonly error = signal('');
  /** The tracks of what plays, by the account and item they were asked for; without them there is nothing to choose. */
  private readonly loaded = signal<{ key: string; tracks: PlexTracks } | null>(null);
  private loading = '';

  private readonly key = computed(() => `${this.playing().accountId}:${this.playing().itemId}`);
  protected readonly tracks = computed(() => (this.loaded()?.key === this.key() ? this.loaded()!.tracks : undefined));
  /** The audio track in use: the choice made, else the one Plex plays by default. */
  protected readonly audio = computed(() => {
    const tracks = this.tracks();
    return this.playing().audioStreamId ?? tracks?.audio.find((t) => t.selected)?.id ?? tracks?.audio[0]?.id;
  });

  constructor() {
    // Each thing that plays gets its tracks, to choose between.
    effect(() => {
      const { accountId, itemId } = this.playing();
      untracked(() => void this.loadTracks(accountId, itemId, this.key()));
    });
  }

  private async loadTracks(accountId: number, itemId: string, key: string) {
    if (this.loaded()?.key === key || this.loading === key) return;
    this.loading = key;
    try {
      this.loaded.set({ key, tracks: await this.realtime.plexTracks(accountId, itemId) });
    } catch {
      // Without its tracks there is nothing to choose; pausing and stopping still work.
    } finally {
      this.loading = '';
    }
  }

  protected togglePause() {
    const { deviceId, deviceName, paused } = this.playing();
    return this.attempt(() => this.realtime.setAirPlayPaused(deviceId, !paused), `Could not ${paused ? 'resume' : 'pause'} ${deviceName}.`);
  }

  protected stop() {
    const { deviceId, deviceName } = this.playing();
    return this.attempt(() => this.realtime.stopAirPlay(deviceId), `Could not stop ${deviceName}.`);
  }

  protected pickAudio(audioStreamId: string) {
    return this.changeTracks(audioStreamId, this.playing().subtitleStreamId);
  }

  protected pickSubtitle(subtitleStreamId: string) {
    return this.changeTracks(this.tracks() ? (this.audio() ?? null) : this.playing().audioStreamId, subtitleStreamId || null);
  }

  private async changeTracks(audio: string | null | undefined, subtitle: string | null | undefined) {
    const { deviceId, deviceName } = this.playing();
    this.busy.set(true);
    try {
      await this.attempt(() => this.realtime.changeAirPlayTracks(deviceId, audio ?? null, subtitle ?? null), `Could not change the tracks on ${deviceName}.`);
    } finally {
      this.busy.set(false);
    }
  }

  private async attempt(action: () => Promise<void>, fallback: string) {
    try {
      await action();
      this.error.set('');
    } catch (error) {
      this.error.set(reason(error, fallback));
    }
  }
}
