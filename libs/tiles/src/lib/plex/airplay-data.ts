import { inject, Injectable, signal } from '@angular/core';
import { AirPlayPlayback, Realtime, stopOnDestroy } from '@homey-dash/api-client';

/**
 * What plays on AirPlay receivers, the same on every screen (ADR-0012): started on one screen, a tile on another shows its
 * controls too. Loaded on every (re)connect, then kept by the `AirPlayNow` messages.
 */
@Injectable({ providedIn: 'root' })
export class AirPlayData {
  private readonly realtime = inject(Realtime);

  readonly playing = signal<AirPlayPlayback[]>([]);

  constructor() {
    stopOnDestroy(
      this.realtime.on('AirPlayNow', (playing) => this.playing.set(playing)),
      this.realtime.whenConnected(() => this.load()),
    );
  }

  private async load() {
    try {
      this.playing.set(await this.realtime.airPlayNowPlaying());
    } catch {
      // The connection dropped again; the next reconnect loads it.
    }
  }
}
