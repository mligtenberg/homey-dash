import { HttpErrorResponse } from '@angular/common/http';
import { afterNextRender, ChangeDetectionStrategy, Component, effect, ElementRef, inject, Injector, input, signal, untracked } from '@angular/core';
import { ImmichAccount, ImmichAccountApi, ImmichPartner } from '@homey-dash/api-client';

/**
 * The people who share their photos with an Immich account through partner sharing, as Immich says when it opens.
 * Only they may edit their photos, so displays can rotate one only once it has an API key made in their own account.
 * Nothing shows for an account without partners.
 */
@Component({
  selector: 'hd-immich-partners',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (partners()?.length) {
      <div class="partners" [attr.aria-label]="'Partners of ' + account().name" role="group">
        <span class="hd-field__label">Shared by partners</span>
        @for (partner of partners(); track partner.id) {
          <div class="partner">
            @if (adding() === partner.id) {
              <form class="form" (submit)="save($event, partner, apiKey.value)">
                <div class="hd-field">
                  <label class="hd-field__label" [for]="'partner-key-' + partner.id">API key of {{ partner.name }}</label>
                  <input
                    #apiKey
                    class="hd-input"
                    type="password"
                    autocomplete="off"
                    [id]="'partner-key-' + partner.id"
                    [attr.aria-invalid]="!!keyError()"
                    [attr.aria-describedby]="'partner-key-hint-' + partner.id"
                  />
                  <span [id]="'partner-key-hint-' + partner.id" [class]="keyError() ? 'field-error' : 'hint'">
                    {{
                      keyError() ??
                        'Make one in Immich while signed in as ' + partner.name + ', with user.read, asset.read, asset.edit.get, asset.edit.create and asset.edit.delete.'
                    }}
                  </span>
                </div>
                <div class="actions">
                  <button class="hd-btn hd-btn--primary" type="submit" [disabled]="saving()">
                    {{ saving() ? 'Checking with Immich…' : 'Save key' }}
                  </button>
                  <button class="hd-btn" type="button" (click)="add(null)">Cancel</button>
                </div>
              </form>
            } @else {
              <div class="partner__info">
                <strong>{{ partner.name }}</strong>
                <span class="muted">{{ partner.hasKey ? 'Displays can rotate their photos' : 'Their photos can\\'t be rotated without a key of theirs' }}</span>
              </div>
              <div class="actions">
                @if (partner.hasKey) {
                  <button class="hd-btn" type="button" (click)="add(partner.id)">Change key</button>
                  <button class="hd-btn hd-btn--danger" type="button" (click)="removeKey(partner)">Remove key</button>
                } @else {
                  <button class="hd-btn" type="button" (click)="add(partner.id)">Add API key</button>
                }
              </div>
            }
          </div>
        }
      </div>
    }
    @if (error(); as error) {
      <p class="muted" role="alert">{{ error }}</p>
    }
  `,
  styles: `
    :host { display: contents; }
    .partners { display: flex; flex-direction: column; gap: var(--space-3); flex-basis: 100%; padding-left: var(--space-4); border-left: 2px solid var(--line); }
    .partner { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); }
    .partner__info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .form { display: flex; flex-direction: column; gap: var(--space-3); flex: 1; }
    .actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
    .muted, .hint { color: var(--ink-muted); margin: 0; }
    .muted[role='alert'] { flex-basis: 100%; }
    .hint, .field-error { font-size: 13px; }
    .field-error { color: var(--danger); font-weight: 700; }
  `,
})
export class ImmichPartners {
  readonly account = input.required<ImmichAccount>();

  private readonly api = inject(ImmichAccountApi);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly injector = inject(Injector);

  protected readonly partners = signal<ImmichPartner[] | null>(null);
  /** The partner whose key form is open. */
  protected readonly adding = signal<string | null>(null);
  protected readonly keyError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);

  constructor() {
    effect(() => {
      const id = this.account().id;
      untracked(() =>
        this.api.partners(id).subscribe({
          next: (partners) => this.done(partners),
          error: (e: HttpErrorResponse) => this.fail(e, 'Could not ask Immich who shares photos with this account.'),
        }),
      );
    });
  }

  // With the key field focused, ready to paste into.
  protected add(partnerId: string | null) {
    this.adding.set(partnerId);
    this.keyError.set(null);
    this.error.set(null);
    if (partnerId) afterNextRender(() => this.host.nativeElement.querySelector('input')?.focus(), { injector: this.injector });
  }

  protected save(event: Event, partner: ImmichPartner, apiKey: string) {
    event.preventDefault();
    this.saving.set(true);
    this.api.setPartnerKey(this.account().id, partner.id, apiKey).subscribe({
      next: (partners) => this.done(partners),
      error: (e: HttpErrorResponse) => {
        this.saving.set(false);
        const error = e.status === 400 ? e.error?.errors?.apiKey?.[0] : null;
        if (error) this.keyError.set(error);
        else this.fail(e, 'Could not save the key. Try again.');
      },
    });
  }

  protected removeKey(partner: ImmichPartner) {
    this.api.removePartnerKey(this.account().id, partner.id).subscribe({
      next: (partners) => this.done(partners),
      error: (e: HttpErrorResponse) => this.fail(e, 'Could not remove the key. Try again.'),
    });
  }

  private done(partners: ImmichPartner[]) {
    this.partners.set(partners);
    this.saving.set(false);
    this.add(null);
  }

  // Immich's reason when it gave one, such as a key that may not see partners.
  private fail(e: HttpErrorResponse, fallback: string) {
    const detail = e.status === 502 ? e.error?.detail : null;
    this.error.set(typeof detail === 'string' ? detail : fallback);
  }
}
