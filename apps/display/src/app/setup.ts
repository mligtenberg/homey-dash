import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { DisplaysApi, DisplaySummary } from '@homey-dash/api-client';
import { Observable } from 'rxjs';

/** First run on a screen: become a new display, or take over an existing one. */
@Component({
  selector: 'hd-setup',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="setup">
      <h1>Set up this screen</h1>

      <form class="hd-panel card" (submit)="setUp($event, name.value)">
        <h2 class="hd-panel__title">New display</h2>
        <div class="hd-field">
          <label class="hd-field__label" for="display-name">Name</label>
          <input #name id="display-name" class="hd-input" placeholder="Name, such as Kitchen wall" autocomplete="off" enterkeyhint="done" />
        </div>
        <button class="hd-btn hd-btn--primary" type="submit" [disabled]="busy()">Set up as new display</button>
      </form>

      @if (displays().length > 0) {
        <section class="hd-panel card">
          <h2 class="hd-panel__title">Take over a display</h2>
          <p class="hd-muted">This screen gets that display's name and dashboard. The screen showing it now goes back to setup.</p>
          <ul>
            @for (display of displays(); track display.id) {
              <li>
                <span class="name">{{ display.name }}</span>
                @if (confirming() === display.id) {
                  <button class="hd-btn hd-btn--primary" type="button" [disabled]="busy()" (click)="takeOver(display.id)">
                    Take over {{ display.name }}
                  </button>
                  <button class="hd-btn" type="button" (click)="confirming.set(null)">Cancel</button>
                } @else {
                  <button class="hd-btn" type="button" (click)="confirming.set(display.id)">Take over</button>
                }
              </li>
            }
          </ul>
        </section>
      }

      @if (error(); as error) {
        <p class="hd-error" role="alert">{{ error }}</p>
      }
    </div>
  `,
  styles: `
    :host { display: grid; place-items: center; min-height: 100%; padding: var(--space-6) var(--space-4); box-sizing: border-box; overflow-y: auto; }
    .setup { width: min(480px, 100%); display: flex; flex-direction: column; gap: var(--space-4); }
    h1 { font-size: var(--text-screen-title); line-height: 1.15; font-weight: 800; margin: 0; text-wrap: balance; }
    .card { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-5); }
    .hd-input, .hd-btn { font-size: var(--text-touch); padding: 14px 18px; }
    ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
    li { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
    .name { flex: 1 1 8ch; min-width: 0; overflow-wrap: anywhere; font-weight: 700; }
  `,
})
export class Setup {
  readonly screenId = input.required<string>();
  /** The screen is now a display. */
  readonly done = output<void>();

  private readonly api = inject(DisplaysApi);
  protected readonly displays = signal<DisplaySummary[]>([]);
  protected readonly confirming = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    this.api.list().subscribe({ next: (list) => this.displays.set(list), error: () => undefined });
  }

  protected setUp(event: Event, name: string) {
    event.preventDefault();
    if (!name.trim()) {
      this.error.set('Give this display a name.');
      return;
    }
    this.run(this.api.setUp(name, this.screenId()));
  }

  protected takeOver(id: string) {
    this.run(this.api.takeOver(id, this.screenId()));
  }

  private run(request: Observable<unknown>) {
    this.busy.set(true);
    this.error.set(null);
    request.subscribe({
      next: () => this.done.emit(),
      error: () => {
        this.busy.set(false);
        this.error.set('HomeyDash could not be reached. Try again.');
      },
    });
  }
}
