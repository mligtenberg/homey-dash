import { AccountPanel } from './account-panel';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AirPlayAccountApi, AirPlayDevice, AirPlayStatus, apiProblem } from '@homey-dash/api-client';
import { firstValueFrom } from 'rxjs';

/**
 * The Apple TVs HomeyDash can play Plex covers on through AirPlay (ADR-0012), found on the network. Whether
 * AirPlay is on and looking works shows at the top; an Apple TV that wants a PIN is paired here once, with the PIN
 * it shows on the TV. Speakers and Macs are not listed: they take no video.
 */
@Component({
  selector: 'hd-airplay-panel',
  imports: [AccountPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hd-account-panel key="airplay" title="AirPlay" [error]="error()">
      <ng-container ngProjectAs="[status]">
        @if (status(); as status) {
          @if (!status.configured) {
            <span class="hd-pill hd-pill--warn hd-pill--dot">Not set up</span>
          } @else if (!status.reachable) {
            <span class="hd-pill hd-pill--danger hd-pill--dot">Not reachable</span>
          } @else if (status.fake) {
            <span class="hd-pill hd-pill--ok hd-pill--dot">Fake AirPlay</span>
          } @else {
            <span class="hd-pill hd-pill--ok hd-pill--dot">Connected</span>
          }
        } @else if (!error()) {
          <span class="hd-pill hd-pill--dot">Looking…</span>
        }
      </ng-container>
      @if (status(); as status) {
        @if (!status.configured) {
          <p class="hd-muted">
            AirPlay is switched off, so Plex covers can't play on an Apple TV. Switch it on by removing
            <code>AirPlay:Enabled=false</code> (<code>AirPlay__Enabled</code> in Docker) from HomeyDash's configuration.
          </p>
        } @else if (!status.reachable) {
          <p class="hd-error" role="alert">{{ status.error }}</p>
          <p class="hd-muted">HomeyDash looks for Apple TVs with multicast DNS, which needs to reach your network.</p>
        } @else {
          <p class="hd-muted">
            {{ status.fake ? 'HomeyDash runs against fake Apple TVs, set in its configuration. ' : '' }}Covers in the recently
            added screen play on these. Pair an Apple TV when it asks for a PIN.
          </p>
          @for (device of tvs(status); track device.id) {
            <div class="hd-account__item">
              <div class="hd-account__info">
                <strong>{{ device.name }}</strong>
                <span class="hd-muted">{{ device.paired ? 'Paired' : 'Not paired' }}</span>
              </div>
              @if (renaming()?.id === device.id) {
                <form class="pin" (submit)="saveName($event, device, name.value)">
                  <div class="hd-field">
                    <label class="hd-field__label" [for]="'airplay-name-' + device.id">Name</label>
                    <input #name [id]="'airplay-name-' + device.id" class="hd-input" maxlength="60" [value]="device.name" />
                  </div>
                  <div class="hd-actions">
                    <button class="hd-btn hd-btn--primary" type="submit">Save</button>
                    <button class="hd-btn" type="button" (click)="renaming.set(null)">Cancel</button>
                  </div>
                </form>
              } @else if (pairing()?.id === device.id) {
                @if (pairing()!.step === 'starting') {
                  <span class="hd-muted" role="status">Asking {{ device.name }} for a PIN…</span>
                } @else {
                  <form class="pin" (submit)="finish($event, device, pin.value)">
                    <div class="hd-field">
                      <label class="hd-field__label" for="airplay-pin">PIN shown on {{ device.name }}</label>
                      <input
                        #pin
                        id="airplay-pin"
                        class="hd-input"
                        inputmode="numeric"
                        autocomplete="one-time-code"
                        maxlength="8"
                        [attr.aria-invalid]="!!pairing()!.error"
                      />
                      @if (pairing()!.error; as error) {
                        <span class="hd-error hd-small">{{ error }}</span>
                      }
                    </div>
                    <div class="hd-actions">
                      <button class="hd-btn hd-btn--primary" type="submit" [disabled]="pairing()!.step === 'finishing'">
                        {{ pairing()!.step === 'finishing' ? 'Pairing…' : 'Pair' }}
                      </button>
                      <button class="hd-btn" type="button" (click)="pairing.set(null)">Cancel</button>
                    </div>
                  </form>
                }
              } @else {
                <div class="hd-actions">
                  <button class="hd-btn" type="button" (click)="renaming.set({ id: device.id })">Rename</button>
                  <button class="hd-btn" type="button" [disabled]="!!pairing()" (click)="startPairing(device)">
                    {{ device.paired ? 'Pair again' : 'Pair' }}
                  </button>
                </div>
              }
            </div>
          } @empty {
            <p class="hd-muted hd-account__item">
              No Apple TV found on the network. HomeyDash finds them with multicast DNS, which a container reaches only with
              host networking on Linux (<code>network_mode: host</code>); Docker Desktop on macOS or Windows can't. Run
              HomeyDash directly on the computer there.
            </p>
          }
        }
        @if (status.configured) {
          <div class="hd-actions">
            <button class="hd-btn" type="button" [disabled]="looking()" (click)="load()">
              {{ looking() ? 'Looking…' : 'Look again' }}
            </button>
          </div>
        }
      }
    </hd-account-panel>
  `,
  styles: `
    .pin { display: flex; flex-direction: column; gap: var(--space-4); flex: 1 1 100%; }
  `,
})
export class AirPlayPanel {
  private readonly api = inject(AirPlayAccountApi);

  protected readonly status = signal<AirPlayStatus | null>(null);
  protected readonly looking = signal(false);
  protected readonly error = signal<string | null>(null);
  /** The Apple TV being paired: asking it for a PIN, waiting for the PIN, or checking it. */
  protected readonly pairing = signal<{ id: string; step: 'starting' | 'pin' | 'finishing'; error?: string } | null>(null);

  /** The Apple TV being renamed. */
  protected readonly renaming = signal<{ id: string } | null>(null);

  constructor() {
    this.load();
  }

  protected tvs(status: AirPlayStatus) {
    return status.devices.filter((d) => d.kind === 'tv');
  }

  protected async load() {
    this.looking.set(true);
    try {
      this.status.set(await firstValueFrom(this.api.status()));
      this.error.set(null);
    } catch (e) {
      this.error.set(apiProblem(e, 'Could not look for Apple TVs. Try again.'));
    } finally {
      this.looking.set(false);
    }
  }

  protected async saveName(event: Event, device: AirPlayDevice, name: string) {
    event.preventDefault();
    try {
      await firstValueFrom(this.api.rename(device.id, name));
      this.renaming.set(null);
      await this.load();
    } catch (e) {
      this.error.set(apiProblem(e, `Could not rename ${device.name}.`));
    }
  }

  protected async startPairing(device: AirPlayDevice) {
    this.error.set(null);
    this.pairing.set({ id: device.id, step: 'starting' });
    try {
      await firstValueFrom(this.api.startPairing(device.id));
      this.pairing.set({ id: device.id, step: 'pin' });
    } catch (e) {
      this.pairing.set(null);
      this.error.set(apiProblem(e, `Could not start pairing with ${device.name}.`));
    }
  }

  protected async finish(event: Event, device: AirPlayDevice, pin: string) {
    event.preventDefault();
    this.pairing.set({ id: device.id, step: 'finishing' });
    try {
      await firstValueFrom(this.api.finishPairing(device.id, pin));
      this.pairing.set(null);
      await this.load();
    } catch (e) {
      // The receiver forgets the PIN it showed after a wrong try, so pairing starts over.
      this.pairing.set({ id: device.id, step: 'pin', error: apiProblem(e, 'Could not pair. Try again.') });
    }
  }
}
