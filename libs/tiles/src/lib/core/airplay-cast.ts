import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { AirPlayDevice, AirPlayPlayback, Realtime } from '@homey-dash/api-client';
import { LucideAirplay, LucidePause, LucidePlay, LucideSquare } from '@homey-dash/design-system';
import { LucideDynamicIcon } from '@lucide/angular';
import { reason } from '../plex/hub-reason';

/**
 * Playing something on an Apple TV (ADR-0012): the button, looking for the paired Apple TVs, choosing one and starting. What to
 * start is the caller's: `start` gets the receiver and plays it, and fails with a reason to show. Once it plays, every screen
 * shows it from `AirPlayData`, so this only says `started`.
 */
@Component({
  selector: 'hd-airplay-cast',
  imports: [LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'hd-cast' },
  template: `
    @switch (step()) {
      @case ('idle') {
        <button type="button" class="hd-cast__button" (click)="find()"><svg [lucideIcon]="airPlayIcon" aria-hidden="true" />{{ label() }}</button>
      }
      @case ('searching') {
        <div class="hd-cast__note">Looking for Apple TVs…</div>
      }
      @case ('choosing') {
        <div class="hd-cast__note">Play on</div>
        <div class="hd-cast__receivers">
          @for (d of devices(); track d.id) {
            <button type="button" class="hd-cast__button hd-cast__button--quiet" (click)="choose(d)">{{ d.name }}</button>
          } @empty {
            <div class="hd-cast__note">No paired Apple TV. Pair one in Management under Accounts.</div>
          }
        </div>
      }
      @case ('starting') {
        <div class="hd-cast__note">Starting on {{ device()?.name }}…</div>
      }
    }
    @if (error(); as error) {
      <div class="hd-cast__error" role="alert">{{ error }}</div>
    }
  `,
})
export class AirPlayCast {
  readonly label = input('Play on AirPlay');
  readonly start = input.required<(device: AirPlayDevice) => Promise<unknown>>();
  readonly started = output<void>();

  private readonly realtime = inject(Realtime);
  protected readonly airPlayIcon = LucideAirplay;

  protected readonly step = signal<'idle' | 'searching' | 'choosing' | 'starting'>('idle');
  protected readonly devices = signal<AirPlayDevice[]>([]);
  protected readonly device = signal<AirPlayDevice | null>(null);
  protected readonly error = signal('');

  protected async find() {
    this.error.set('');
    this.step.set('searching');
    try {
      const info = await this.realtime.airPlayDevices();
      if (!info.available) {
        this.error.set('AirPlay is not set up in HomeyDash yet.');
        return this.step.set('idle');
      }
      // Only an Apple TV takes video.
      this.devices.set(info.devices.filter((d) => d.kind === 'tv'));
      this.step.set('choosing');
    } catch (error) {
      this.error.set(reason(error, 'Could not look for Apple TVs.'));
      this.step.set('idle');
    }
  }

  protected async choose(device: AirPlayDevice) {
    this.device.set(device);
    this.step.set('starting');
    try {
      await this.start()(device);
      this.step.set('idle');
      this.started.emit();
    } catch (error) {
      this.error.set(reason(error, `Could not play on ${device.name}.`));
      this.step.set('idle');
    }
  }
}

/**
 * What plays on an Apple TV because a screen started it, with buttons to pause or resume it and to stop it. For what has
 * nothing to choose, such as audio tracks (Plex has its own row for that).
 */
@Component({
  selector: 'hd-airplay-now',
  imports: [LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'hd-cast hd-cast__now', role: 'group', '[attr.aria-label]': "'Playing on ' + playing().deviceName" },
  template: `
    <svg class="hd-cast__icon" [lucideIcon]="airPlayIcon" aria-hidden="true" />
    <div class="hd-cast__text">
      <strong>{{ playing().title }}</strong>
      <span>{{ playing().paused ? 'Paused on' : 'Playing on' }} {{ playing().deviceName }}@if (playing().detail) { · {{ playing().detail }} }</span>
    </div>
    <button type="button" class="hd-cast__button hd-cast__button--quiet" (click)="togglePause()">
      <svg [lucideIcon]="playing().paused ? playIcon : pauseIcon" aria-hidden="true" />{{ playing().paused ? 'Resume' : 'Pause' }}
    </button>
    <button type="button" class="hd-cast__button hd-cast__button--quiet" (click)="stop()"><svg [lucideIcon]="stopIcon" aria-hidden="true" />Stop</button>
    @if (error(); as error) {
      <div class="hd-cast__error" role="alert">{{ error }}</div>
    }
  `,
})
export class AirPlayNowControls {
  readonly playing = input.required<AirPlayPlayback>();

  private readonly realtime = inject(Realtime);
  protected readonly airPlayIcon = LucideAirplay;
  protected readonly playIcon = LucidePlay;
  protected readonly pauseIcon = LucidePause;
  protected readonly stopIcon = LucideSquare;
  protected readonly error = signal('');

  protected togglePause() {
    const { deviceId, deviceName, paused } = this.playing();
    return this.attempt(() => this.realtime.setAirPlayPaused(deviceId, !paused), `Could not ${paused ? 'resume' : 'pause'} ${deviceName}.`);
  }

  protected stop() {
    const { deviceId, deviceName } = this.playing();
    return this.attempt(() => this.realtime.stopAirPlay(deviceId), `Could not stop ${deviceName}.`);
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
