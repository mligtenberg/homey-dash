import { ChangeDetectionStrategy, Component, DestroyRef, effect, ElementRef, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import type Hls from 'hls.js';
import { t } from '@homey-dash/i18n';

/** How often a playing stream says it is in use (ms): the screen's detail view closes by itself when nobody touches it. */
const ACTIVE_EVERY = 5_000;

/**
 * Plays one of NOS's HLS streams, a video or a livestream, in a video element: hls.js, or the screen's own player where that cannot run (Safari on iPhone). It starts at once and has the player's own controls.
 */
@Component({
  selector: 'hd-news-player',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'hd-news__player' },
  template: `
    <video #video class="hd-news__video" controls autoplay playsinline [attr.aria-label]="title()" (timeupdate)="tick()"></video>
    @if (error()) {
      <div class="hd-news__player-error">{{ error() }}</div>
    }
  `,
})
export class NewsPlayer {
  readonly url = input.required<string>();
  readonly title = input('');
  /** Says now and then that the stream is playing. */
  readonly active = output<void>();

  protected readonly error = signal('');
  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');
  private hls?: Hls;
  private last = 0;

  constructor() {
    effect(() => {
      const video = this.video()?.nativeElement;
      const url = this.url();
      if (video) untracked(() => void this.attach(video, url));
    });
    inject(DestroyRef).onDestroy(() => this.hls?.destroy());
  }

  protected tick() {
    const now = Date.now();
    if (now - this.last >= ACTIVE_EVERY) {
      this.last = now;
      this.active.emit();
    }
  }

  private async attach(video: HTMLVideoElement, url: string) {
    this.hls?.destroy();
    this.hls = undefined;
    this.error.set('');
    // hls.js first: it only picks what the screen can decode. Where it cannot run (iPhone's Safari has no MSE) the screen's own player does.
    const { default: HlsPlayer } = await import('hls.js');
    if (HlsPlayer.isSupported()) {
      const hls = new HlsPlayer();
      hls.on(HlsPlayer.Events.ERROR, (_, data) => data.fatal && this.error.set(t('The stream cannot be played.')));
      hls.loadSource(url);
      hls.attachMedia(video);
      this.hls = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
    } else {
      this.error.set(t('This screen cannot play the stream.'));
      return;
    }
    video.play().catch(() => {
      // Blocked until someone presses play; the controls are there.
    });
  }
}
