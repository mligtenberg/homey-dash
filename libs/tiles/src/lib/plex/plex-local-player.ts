import { signal } from '@angular/core';
import { plexAudioUrl, PlexItem } from '@homey-dash/api-client';

/** Music playing on this screen: the tracks to play and which one plays now, and the album they are part of. */
export interface LocalPlay {
  queue: PlexItem[];
  index: number;
  paused: boolean;
  album: PlexItem | null;
}

/** What a track that plays here tells Plex: that it plays, is paused or stopped, and where it is (ms). */
export type TrackReport = (track: PlexItem, state: 'playing' | 'paused' | 'stopped', timeMs: number) => void;

/**
 * The music a Plex screen plays in its own speakers: a track, or an album track after track. It goes on when the cover is
 * closed, and tells Plex what plays. `error` is what went wrong with it, or with a video the screen plays, until the next
 * thing is played.
 */
export class PlexLocalPlayer {
  readonly play = signal<LocalPlay | null>(null);
  readonly error = signal('');
  private audio?: HTMLAudioElement;

  /**
   * `accountId` is the Plex account the tracks stream from, `report` tells Plex, and `beforeStart` runs before a track
   * starts, such as to stop a show's theme.
   */
  constructor(
    private readonly accountId: () => number,
    private readonly report: TrackReport,
    private readonly beforeStart: () => void,
  ) {}

  /** What the track is part of: the artist, the album and its place in it; for a lone track, what the server says of it. */
  detail(play: LocalPlay) {
    const { album, index, queue } = play;
    return album
      ? `${album.subtitle ? album.subtitle + ' — ' : ''}${album.title} · ${index + 1} of ${queue.length}`
      : queue[index].subtitle;
  }

  start(play: LocalPlay) {
    this.beforeStart();
    this.audio ??= new Audio();
    const audio = this.audio;
    const track = play.queue[play.index];
    const fail = () => {
      this.error.set(`Could not play ${track.title}.`);
      this.stop();
    };
    audio.onended = () => {
      this.report(track, 'stopped', track.durationMs ?? 0);
      if (play.index + 1 >= play.queue.length) this.stop(false);
      else this.start({ ...play, index: play.index + 1 });
    };
    audio.onerror = fail;
    audio.src = plexAudioUrl(this.accountId(), track.id);
    this.play.set(play);
    this.report(track, 'playing', 0);
    audio.play()?.catch(fail);
  }

  toggle() {
    const play = this.play();
    if (!play || !this.audio) return;
    if (play.paused) this.audio.play()?.catch(() => this.stop());
    else this.audio.pause();
    this.report(play.queue[play.index], play.paused ? 'playing' : 'paused', this.audio.currentTime * 1000);
    this.play.set({ ...play, paused: !play.paused });
  }

  /** Stops the music; `report` is false for a track that just ended and has told Plex already. */
  stop(report = true) {
    const audio = this.audio;
    const play = this.play();
    if (report && play && audio) this.report(play.queue[play.index], 'stopped', audio.currentTime * 1000);
    if (audio) {
      audio.onended = audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
    }
    this.play.set(null);
  }
}
