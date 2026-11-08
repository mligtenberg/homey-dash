import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Realtime, SpeakerMusic, SpeakerMusicKind } from '@homey-dash/api-client';
import { LucideAudioLines, LucideMusic, LucideSearch } from '@homey-dash/design-system';
import { LucideDynamicIcon } from '@lucide/angular';
import { brokenImages } from '../core/loadable-art';

/** What a result of the music picker plays as, with where it came from. */
interface MusicItem {
  kind: SpeakerMusicKind;
  music: SpeakerMusic;
}

/**
 * What a speaker can play, picked in the detail view: its Sonos favorites and playlists from Homey, with their
 * covers. Plays in the speaker's group. It renders only while its tab is open, so it asks
 * Homey only then.
 */
@Component({
  selector: 'hd-sonos-music',
  imports: [LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'hd-sonos__music' },
  template: `
    <label class="hd-sonos__search">
      <svg [lucideIcon]="searchIcon" />
      <input
        type="search"
        autocomplete="off"
        [placeholder]="kind() === 'favorite' ? 'Search favorites' : 'Search playlists'"
        [attr.aria-label]="kind() === 'favorite' ? 'Search favorites' : 'Search playlists'"
        [value]="query()"
        (input)="query.set($any($event.target).value)"
      />
    </label>
    @if (error()) {
      <div class="hd-note">{{ error() }}</div>
    } @else if (items() === null) {
      <div class="hd-note">Loading…</div>
    } @else {
      <div class="hd-sonos__list">
        @for (item of shown(); track item.kind + item.music.name) {
          <button
            type="button"
            class="hd-sonos__item"
            [class.is-playing]="playing() === key(item)"
            [attr.aria-pressed]="playing() === key(item)"
            (click)="play(item)"
          >
            <span class="hd-sonos__cover">
              @if (item.music.image && !images.has(item.music.image)) {
                <img
                  [src]="item.music.image"
                  alt=""
                  loading="lazy"
                  referrerpolicy="no-referrer"
                  (error)="images.mark(item.music.image)"
                />
              } @else {
                <svg [lucideIcon]="noteIcon" />
              }
              @if (playing() === key(item)) {
                <span class="hd-sonos__cover-state"
                  ><svg [lucideIcon]="playingIcon"
                /></span>
              }
            </span>
            <span class="hd-sonos__item-text">
              <span class="hd-sonos__item-name">{{ item.music.name }}</span>
              @if (item.music.description) {
                <span class="hd-sonos__item-sub">{{
                  item.music.description
                }}</span>
              }
            </span>
          </button>
        } @empty {
          <div class="hd-note">
            {{ query().trim() ? 'No matches' : 'Nothing here yet' }}
          </div>
        }
      </div>
    }
  `,
})
export class SonosMusic {
  private readonly realtime = inject(Realtime);

  protected readonly noteIcon = LucideMusic;
  protected readonly searchIcon = LucideSearch;
  protected readonly playingIcon = LucideAudioLines;

  readonly account = input<number>();
  readonly deviceId = input.required<string>();
  readonly kind = input.required<SpeakerMusicKind>();

  protected readonly items = signal<MusicItem[] | null>(null);
  /** What is typed in the search bar; the music shown is what matches. */
  protected readonly query = signal('');
  protected readonly shown = computed(() => {
    const words = this.query().toLowerCase().split(/\s+/).filter(Boolean);
    return (this.items() ?? []).filter((i) => {
      const text = `${i.music.name} ${i.music.description ?? ''}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  });
  protected readonly error = signal('');
  protected readonly playing = signal('');
  /** Covers that did not load, so the note shows instead of a broken picture. */
  protected readonly images = brokenImages();

  constructor() {
    effect((onCleanup) => {
      const [account, deviceId, kind] = [this.account(), this.deviceId(), this.kind()];
      this.error.set('');
      this.items.set(null);
      this.query.set('');
      let stale = false;
      onCleanup(() => (stale = true));
      this.realtime.speakerMusic(account, deviceId, kind).then(
        (found) =>
          !stale && this.items.set(found.map((music): MusicItem => ({ kind, music }))),
        () => !stale && this.error.set('Homey did not respond'),
      );
    });
  }

  protected key(item: MusicItem) {
    return `${item.kind}:${item.music.name}`;
  }

  protected play(item: MusicItem) {
    this.playing.set(this.key(item));
    this.error.set('');
    this.realtime
      .playSpeakerMusic(this.account(), this.deviceId(), item.kind, item.music)
      .catch(() => {
        this.playing.set('');
        this.error.set(`Could not play ${item.music.name}`);
      });
  }
}
