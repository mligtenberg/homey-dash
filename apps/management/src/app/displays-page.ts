import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DisplaysApi, DisplaySummary } from '@homey-dash/api-client';
import { DashboardsStore } from './dashboards-store';

/** Every display, with the dashboard it shows. Displays are added by running setup on a screen. */
@Component({
  selector: 'hd-displays-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="header">
      <h1>Displays</h1>
    </header>
    <div class="body">
      @if (loaded() && displays().length === 0) {
        <div class="empty hd-panel">
          <h2>No displays yet</h2>
          <p>Open HomeyDash's display address on a screen in the home. It asks for a name and then shows up here.</p>
        </div>
      }
      @for (display of displays(); track display.id) {
        <div class="display hd-panel">
          <div class="hd-field">
            <label class="hd-field__label" [for]="'name-' + display.id">Name</label>
            <input
              class="hd-input"
              [id]="'name-' + display.id"
              [value]="display.name"
              (change)="rename(display, name.value)"
              (keydown.enter)="name.blur()"
              #name
            />
          </div>
          <div class="hd-field">
            <label class="hd-field__label" [for]="'dashboard-' + display.id">Dashboard</label>
            <select class="hd-select" [id]="'dashboard-' + display.id" (change)="assign(display, dashboard.value)" #dashboard>
              <option value="" [selected]="!display.dashboardId">None (waiting)</option>
              @for (option of dashboards(); track option.id) {
                <option [value]="option.id" [selected]="option.id === display.dashboardId" [disabled]="!option.published">
                  {{ option.name }}{{ option.published ? '' : ' (not published)' }}
                </option>
              }
            </select>
          </div>
          <div class="status">
            @if (!display.dashboardId) {
              <span class="hd-pill hd-pill--dot">Waiting for a dashboard</span>
            }
          </div>
          @if (removing() === display.id) {
            <div class="confirm">
              <span>Its screen goes back to setup.</span>
              <button class="hd-btn hd-btn--primary" type="button" (click)="remove(display)">Remove</button>
              <button class="hd-btn" type="button" (click)="removing.set(null)">Cancel</button>
            </div>
          } @else {
            <button class="hd-btn hd-btn--danger remove" type="button" (click)="removing.set(display.id)">Remove display</button>
          }
        </div>
      }
      @if (error(); as error) {
        <p class="error" role="alert">{{ error }}</p>
      }
    </div>
  `,
  styles: `
    .header { display: flex; align-items: center; padding: var(--space-4) var(--space-6); border-bottom: 1px solid var(--line); }
    h1 { font-size: 22px; font-weight: 800; margin: 0; }
    h2 { font-size: 18px; font-weight: 800; margin: 0 0 var(--space-2); }
    .body { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-5); max-width: 900px; }
    .empty { padding: var(--space-6); }
    .empty p { margin: 0; color: var(--ink-muted); }
    .display { display: grid; grid-template-columns: 1fr 1fr auto auto; align-items: end; gap: var(--space-4); padding: var(--space-4); }
    .status { padding-bottom: 10px; white-space: nowrap; }
    .remove { padding-bottom: 10px; }
    .confirm { display: flex; align-items: center; gap: var(--space-2); color: var(--ink-muted); }
    .error { margin: 0; color: var(--danger); font-weight: 700; }
    @media (max-width: 860px) {
      .display { grid-template-columns: 1fr; align-items: stretch; }
    }
  `,
})
export class DisplaysPage {
  private readonly api = inject(DisplaysApi);
  private readonly store = inject(DashboardsStore);

  protected readonly displays = signal<DisplaySummary[]>([]);
  protected readonly loaded = signal(false);
  protected readonly removing = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly dashboards = computed(() =>
    this.store.list().map((d) => ({ id: d.id, name: d.name, published: d.publishedVersion > 0 })),
  );

  constructor() {
    this.api.list().subscribe((list) => {
      this.displays.set(list);
      this.loaded.set(true);
    });
  }

  protected rename(display: DisplaySummary, name: string) {
    if (!name.trim() || name.trim() === display.name) return;
    this.api.rename(display.id, name).subscribe({ next: (d) => this.replace(d), error: () => this.fail('rename') });
  }

  protected assign(display: DisplaySummary, dashboardId: string) {
    this.api.assign(display.id, dashboardId || null).subscribe({ next: (d) => this.replace(d), error: () => this.fail('assign') });
  }

  protected remove(display: DisplaySummary) {
    this.api.delete(display.id).subscribe({
      next: () => this.displays.update((list) => list.filter((d) => d.id !== display.id)),
      error: () => this.fail('remove'),
    });
  }

  private replace(display: DisplaySummary) {
    this.error.set(null);
    this.displays.update((list) => list.map((d) => (d.id === display.id ? display : d)));
  }

  private fail(what: string) {
    this.error.set(`Could not ${what} the display. Try again.`);
  }
}
