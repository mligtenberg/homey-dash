import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DashboardsApi } from '@homey-dash/api-client';
import { LucideChevronRight, LucideLayoutDashboard, LucidePlus } from '@homey-dash/design-system';
import { LucideDynamicIcon } from '@lucide/angular';
import { map } from 'rxjs';
import { DashboardsStore } from './dashboards-store';
import { DisplaysStore } from './displays/displays-store';
import { PageHeader } from './page-header';
import { TranslatePipe } from '@homey-dash/i18n';

/** Every dashboard, with whether it is published and which displays show it; and where new ones are made. */
@Component({
  selector: 'hd-dashboards-page',
  imports: [RouterLink, PageHeader, LucideDynamicIcon, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'sec-dashboards' },
  template: `
    <hd-page-header section="dashboards" [title]="'Dashboards' | t">
      @if (!naming()) {
        <button class="hd-btn hd-btn--primary new" type="button" (click)="naming.set(true)">
          <svg [lucideIcon]="plus" aria-hidden="true" />{{ 'New dashboard' | t }}
        </button>
      }
    </hd-page-header>
    <div class="hd-page__body">
      @if (picking()) {
        <p class="hint" role="status">{{ 'Pick the dashboard whose tiles you want to change.' | t }}</p>
      }
      @if (naming()) {
        <form class="hd-panel new-form" (submit)="create($event, name.value)">
          <div class="hd-field">
            <label class="hd-field__label" for="new-dashboard">{{ 'Name of the new dashboard' | t }}</label>
            <input #name id="new-dashboard" class="hd-input" [placeholder]="'Such as Hallway or Living room' | t" (keydown.escape)="naming.set(false)" />
          </div>
          <div class="hd-actions">
            <button class="hd-btn hd-btn--primary" type="submit">{{ 'Create dashboard' | t }}</button>
            <button class="hd-btn" type="button" (click)="naming.set(false)">{{ 'Cancel' | t }}</button>
          </div>
        </form>
      }
      @if (store.loaded() && !store.list().length) {
        <div class="hd-panel hd-empty">
          <h2 class="hd-panel__title">{{ 'Build your first dashboard' | t }}</h2>
          <p>{{ 'A dashboard is a layout of tiles that one or more displays show. Choose New dashboard to start one.' | t }}</p>
        </div>
      } @else {
        <section class="hd-panel" [attr.aria-label]="'Dashboards' | t">
          <div class="cols" aria-hidden="true"><span>{{ 'Dashboard' | t }}</span><span>{{ 'Shown on' | t }}</span><span>{{ 'State' | t }}</span></div>
          <ul class="hd-rows">
            @for (row of rows(); track row.id) {
              <li>
                <a class="hd-row-link row" [routerLink]="['/dashboards', row.id]">
                  <span class="hd-mark"><svg [lucideIcon]="icon" /></span>
                  <span class="hd-row-link__text">
                    <span class="hd-row-link__title">{{ row.name }}</span>
                    @if (row.missingTiles) {
                      <span class="hd-row-link__sub missing">{{ row.missingTiles === 1 ? '1 tile' : row.missingTiles + ' tiles' }} not found in Homey</span>
                    }
                  </span>
                  <span class="on">{{ row.shownOn || 'No display yet' }}</span>
                  <span class="state">
                    @if (row.hasUnpublishedChanges) {
                      <span class="hd-pill hd-pill--warn hd-pill--dot">{{ 'Unpublished changes' | t }}</span>
                    } @else if (row.publishedVersion) {
                      <span class="hd-pill">Version {{ row.publishedVersion }}</span>
                    } @else {
                      <span class="hd-pill">{{ 'Not published' | t }}</span>
                    }
                  </span>
                  <svg class="hd-row-link__go" [lucideIcon]="chevron" aria-hidden="true" />
                </a>
              </li>
            }
          </ul>
        </section>
      }
    </div>
  `,
  styles: `
    .hd-page__body { max-width: 1040px; }
    .new { display: inline-flex; align-items: center; gap: 6px; }
    .new svg { width: 16px; height: 16px; }
    .hint { margin: 0; padding: 10px 14px; border-radius: var(--radius-control); background: color-mix(in oklab, var(--sec) 10%, var(--panel)); color: var(--ink); font-weight: 500; border: 1px solid color-mix(in oklab, var(--sec) 30%, var(--line)); }
    .new-form { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4); max-width: 480px; }
    .cols, .row { display: grid; grid-template-columns: 28px minmax(0, 1.4fr) minmax(0, 1fr) 190px 16px; align-items: center; gap: var(--space-3); }
    .cols { padding: 10px var(--space-4); border-bottom: 1px solid var(--line); font: 600 11px/1.3 var(--font-sans); letter-spacing: .1em; text-transform: uppercase; color: var(--ink-muted); }
    .cols span:first-child { grid-column: 2; }
    .on { font-size: 13px; color: var(--ink-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .missing { color: var(--warn); }
    @media (max-width: 720px) {
      .cols { display: none; }
      .row { grid-template-columns: 28px minmax(0, 1fr) auto 16px; }
      .on { display: none; }
    }
  `,
})
export class DashboardsPage {
  protected readonly store = inject(DashboardsStore);
  private readonly displays = inject(DisplaysStore);
  private readonly api = inject(DashboardsApi);
  private readonly router = inject(Router);

  protected readonly icon = LucideLayoutDashboard;
  protected readonly plus = LucidePlus;
  protected readonly chevron = LucideChevronRight;
  protected readonly naming = signal(false);
  protected readonly picking = toSignal(inject(ActivatedRoute).queryParamMap.pipe(map((q) => q.has('then'))), { initialValue: false });
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('name');

  protected readonly rows = computed(() =>
    this.store.list().map((d) => ({
      ...d,
      shownOn: this.displays
        .list()
        .filter((display) => display.dashboardIds.includes(d.id))
        .map((display) => display.name)
        .join(', '),
    })),
  );

  constructor() {
    effect(() => this.nameInput()?.nativeElement.focus());
  }

  protected create(event: Event, name: string) {
    event.preventDefault();
    if (!name.trim()) return;
    this.api.create(name).subscribe((dashboard) => {
      this.store.upsert(dashboard);
      this.naming.set(false);
      this.router.navigate(['/dashboards', dashboard.id]);
    });
  }
}
