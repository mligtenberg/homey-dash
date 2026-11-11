import { ChangeDetectionStrategy, Component, inject, Injector, input, output, signal } from '@angular/core';
import { AirPlayAccountApi, AirPlayDevice, AirPlayPlayback, apiProblem, Realtime } from '@homey-dash/api-client';
import { firstValueFrom } from 'rxjs';
import { LucideAirplay, LucidePause, LucidePlay, LucideSquare } from '@homey-dash/design-system';
import { LucideDynamicIcon } from '@lucide/angular';
import { reason } from '../plex/hub-reason';
import { TranslatePipe, t } from '@homey-dash/i18n';

/**
 * Choosing an Apple TV to play on (ADR-0012): looks for the paired ones and offers each, with a way to add another (it asks the
 * Apple TV for its PIN and pairs it here, as Management does) and a way back. Shared by everything that plays on an Apple TV.
 */
@Component({
  selector: 'hd-airplay-receivers',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'hd-cast hd-cast--receivers' },
  imports: [TranslatePipe],
  template: `
    @switch (step()) {
      @case ('searching') {
        <div class="hd-cast__note">{{ 'Looking for Apple TVs…' | t }}</div>
      }
      @case ('choosing') {
        <div class="hd-cast__note">{{ 'Play on' | t }}</div>
        <div class="hd-cast__receivers">
          @for (d of devices(); track d.id) {
            <button type="button" class="hd-cast__button hd-cast__button--quiet hd-cast__receiver" (click)="chosen.emit(d)">{{ d.name }}</button>
          } @empty {
            <div class="hd-cast__note">{{ 'No paired Apple TV yet.' | t }}</div>
          }
          <button type="button" class="hd-cast__button hd-cast__button--quiet hd-cast__add" (click)="findNew()">{{ 'Add Apple TV' | t }}</button>
          <button type="button" class="hd-cast__cancel" (click)="cancelled.emit()">{{ 'Cancel' | t }}</button>
        </div>
      }
      @case ('finding') {
        <div class="hd-cast__note">{{ 'Looking for Apple TVs to add…' | t }}</div>
      }
      @case ('adding') {
        <div class="hd-cast__note">{{ 'Pair' | t }}</div>
        <div class="hd-cast__receivers">
          @for (d of unpaired(); track d.id) {
            <button type="button" class="hd-cast__button hd-cast__button--quiet hd-cast__unpaired" (click)="startPairing(d)">{{ d.name }}</button>
          } @empty {
            <div class="hd-cast__note">{{ 'No other Apple TV found on the network.' | t }}</div>
          }
          <button type="button" class="hd-cast__cancel" (click)="back()">{{ 'Back' | t }}</button>
        </div>
      }
      @case ('starting') {
        <div class="hd-cast__note">Asking {{ pairing()?.name }} for a PIN…</div>
      }
      @case ('pin') {
        <form class="hd-cast__pin" (submit)="finishPairing($event, pin.value)">
          <label class="hd-cast__note" for="hd-airplay-pin">PIN shown on {{ pairing()?.name }}</label>
          <input #pin id="hd-airplay-pin" class="hd-cast__input" inputmode="numeric" autocomplete="one-time-code" maxlength="8" />
          <button type="submit" class="hd-cast__button">{{ 'Pair' | t }}</button>
          <button type="button" class="hd-cast__cancel" (click)="back()">{{ 'Back' | t }}</button>
        </form>
      }
      @case ('finishing') {
        <div class="hd-cast__note">Pairing with {{ pairing()?.name }}…</div>
      }
    }
    @if (error(); as error) {
      <div class="hd-cast__error" role="alert">{{ error }}</div>
    }
  `,
})
export class AirPlayReceivers {
  readonly chosen = output<AirPlayDevice>();
  readonly cancelled = output<void>();

  private readonly realtime = inject(Realtime);
  private readonly injector = inject(Injector);

  protected readonly step = signal<'searching' | 'choosing' | 'finding' | 'adding' | 'starting' | 'pin' | 'finishing'>('searching');
  protected readonly devices = signal<AirPlayDevice[]>([]);
  protected readonly unpaired = signal<AirPlayDevice[]>([]);
  protected readonly pairing = signal<AirPlayDevice | null>(null);
  protected readonly error = signal('');

  constructor() {
    void this.load();
  }

  /** The paired Apple TVs; only an Apple TV takes video. Nothing to choose from when AirPlay is not set up. */
  private async load() {
    this.step.set('searching');
    try {
      const info = await this.realtime.airPlayDevices();
      if (!info.available) {
        this.error.set(t('AirPlay is not set up in HomeyDash yet.'));
        return this.step.set('choosing');
      }
      this.error.set('');
      this.devices.set(info.devices.filter((d) => d.kind === 'tv'));
      this.step.set('choosing');
    } catch (error) {
      this.error.set(reason(error, 'Could not look for Apple TVs.'));
      this.step.set('choosing');
    }
  }

  private get api() {
    return this.injector.get(AirPlayAccountApi);
  }

  protected async findNew() {
    this.error.set('');
    this.step.set('finding');
    try {
      const status = await firstValueFrom(this.api.status());
      this.unpaired.set(status.devices.filter((d) => d.kind === 'tv' && !d.paired));
    } catch (error) {
      this.error.set(apiProblem(error, t('Could not look for Apple TVs. Try again.')));
      this.unpaired.set([]);
    }
    this.step.set('adding');
  }

  protected async startPairing(device: AirPlayDevice) {
    this.error.set('');
    this.pairing.set(device);
    this.step.set('starting');
    try {
      await firstValueFrom(this.api.startPairing(device.id));
      this.step.set('pin');
    } catch (error) {
      this.error.set(apiProblem(error, `Could not start pairing with ${device.name}.`));
      this.step.set('adding');
    }
  }

  protected async finishPairing(event: Event, pin: string) {
    event.preventDefault();
    const device = this.pairing();
    if (!device) return;
    this.error.set('');
    this.step.set('finishing');
    try {
      await firstValueFrom(this.api.finishPairing(device.id, pin));
      await this.load();
    } catch (error) {
      // The Apple TV forgets the PIN it showed after a wrong try, so pairing starts over.
      this.error.set(apiProblem(error, t('Could not pair. Try again.')));
      this.step.set('adding');
    }
  }

  protected back() {
    this.error.set('');
    this.step.set('choosing');
  }
}

/**
 * Playing something on an Apple TV (ADR-0012): the button, looking for the paired Apple TVs, choosing one and starting. What to
 * start is the caller's: `start` gets the receiver and plays it, and fails with a reason to show. Once it plays, every screen
 * shows it from `AirPlayData`, so this only says `started`.
 */
@Component({
  selector: 'hd-airplay-cast',
  imports: [LucideDynamicIcon, AirPlayReceivers],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'hd-cast' },
  template: `
    @switch (step()) {
      @case ('idle') {
        <button type="button" class="hd-cast__button" (click)="find()"><svg [lucideIcon]="airPlayIcon" aria-hidden="true" />{{ label() }}</button>
      }
      @case ('choosing') {
        <hd-airplay-receivers (chosen)="choose($event)" (cancelled)="step.set('idle')" />
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

  protected readonly airPlayIcon = LucideAirplay;

  protected readonly step = signal<'idle' | 'choosing' | 'starting'>('idle');
  protected readonly device = signal<AirPlayDevice | null>(null);
  protected readonly error = signal('');

  protected find() {
    this.error.set('');
    this.step.set('choosing');
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
  imports: [LucideDynamicIcon, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'hd-cast hd-cast__now', role: 'group', '[attr.aria-label]': "'Playing on ' + playing().deviceName" },
  template: `
    <svg class="hd-cast__icon" [lucideIcon]="airPlayIcon" aria-hidden="true" />
    <div class="hd-cast__text">
      <strong>{{ playing().title }}</strong>
      <span>{{ (playing().paused ? 'Paused on' : 'Playing on') | t }} {{ playing().deviceName }}@if (playing().detail) { · {{ playing().detail }} }</span>
    </div>
    <button type="button" class="hd-cast__button hd-cast__button--quiet" (click)="togglePause()">
      <svg [lucideIcon]="playing().paused ? playIcon : pauseIcon" aria-hidden="true" />{{ (playing().paused ? 'Resume' : 'Pause') | t }}
    </button>
    <button type="button" class="hd-cast__button hd-cast__button--quiet" (click)="stop()"><svg [lucideIcon]="stopIcon" aria-hidden="true" />{{ 'Stop' | t }}</button>
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
