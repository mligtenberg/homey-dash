import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { DashboardsApi } from '@homey-dash/api-client';
import { RealtimeTileData } from '@homey-dash/tiles';
import { filter, map } from 'rxjs';
import { LucideDynamicIcon, LucideImages, LucideKeyRound, LucideMonitor, LucidePlus } from '@lucide/angular';
import { DashboardsStore } from './dashboards-store';
import { DisplaysStore } from './displays/displays-store';

/** Management's frame: the sidebar with dashboards, and the current page. */
@Component({
  selector: 'hd-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'hd-app' },
  template: `
    <aside class="sidebar">
      <a class="brand" routerLink="/">HomeyDash</a>
      <nav class="hd-nav" aria-label="Dashboards">
        <div class="hd-nav__group">Dashboards</div>
        @for (dashboard of store.list(); track dashboard.id) {
          <a
            class="hd-nav__item"
            [routerLink]="['/dashboards', dashboard.id]"
            routerLinkActive
            ariaCurrentWhenActive="page"
          >
            <span>{{ dashboard.name }}</span>
            <span class="marks">
              @if (dashboard.missingTiles > 0) {
                <span
                  class="hd-dot-warn"
                  role="img"
                  [attr.aria-label]="missingLabel(dashboard.missingTiles)"
                  [title]="missingLabel(dashboard.missingTiles)"
                ></span>
              }
              @if (dashboard.hasUnpublishedChanges) {
                <span class="hd-pill hd-pill--warn">Draft</span>
              }
            </span>
          </a>
        } @empty {
          @if (store.loaded()) {
            <p class="muted">No dashboards yet.</p>
          }
        }
        @if (naming()) {
          <form class="new" (submit)="create($event, name.value)">
            <label class="sr-only" for="new-dashboard">Dashboard name</label>
            <input #name id="new-dashboard" class="hd-input" placeholder="Name, such as Hallway" (keydown.escape)="naming.set(false)" />
            <div class="row">
              <button class="hd-btn hd-btn--primary" type="submit">Create dashboard</button>
              <button class="hd-btn" type="button" (click)="naming.set(false)">Cancel</button>
            </div>
          </form>
        } @else {
          <button class="hd-nav__item add" type="button" (click)="naming.set(true)">
            <span>New dashboard</span>
            <svg class="icon" [lucideIcon]="plus" />
          </button>
        }
        <div class="hd-nav__group">Displays</div>
        <a class="hd-nav__item" routerLink="/displays" [routerLinkActiveOptions]="{ exact: true }" routerLinkActive ariaCurrentWhenActive="page">
          <span>All displays</span>
          <svg class="icon" [lucideIcon]="monitor" />
        </a>
        @for (display of displays.list(); track display.id) {
          <a class="hd-nav__item" [routerLink]="['/displays', display.id]" routerLinkActive ariaCurrentWhenActive="page">
            <span>{{ display.name }}</span>
            <span
              class="status-dot"
              role="img"
              [class.status-dot--on]="display.status.held && display.status.connected"
              [attr.aria-label]="display.status.held && display.status.connected ? 'Connected' : 'Not connected'"
            ></span>
          </a>
        }
        <div class="hd-nav__group">Photos</div>
        <a class="hd-nav__item" routerLink="/photo-sets" routerLinkActive ariaCurrentWhenActive="page">
          <span>Photo sets</span>
          <svg class="icon" [lucideIcon]="images" />
        </a>
        <div class="hd-nav__group">Accounts</div>
        <a class="hd-nav__item" routerLink="/accounts" routerLinkActive ariaCurrentWhenActive="page">
          <span>Accounts</span>
          <span class="marks">
            @if (homeyNotSetUp()) {
              <span class="hd-dot-warn" role="img" aria-label="Homey is not set up" title="Homey is not set up"></span>
            }
            <svg class="icon" [lucideIcon]="key" />
          </span>
        </a>
      </nav>
    </aside>
    <main class="page">
      @if (homeyNotSetUp() && !onAccounts()) {
        <div class="setup" role="status">
          <span>Homey isn't set up yet, so tiles show no devices, flows or moods.</span>
          <a class="hd-btn hd-btn--primary" routerLink="/accounts">Set up Homey</a>
        </div>
      }
      <router-outlet />
    </main>
  `,
  styles: `
    :host { display: grid; grid-template-columns: 240px 1fr; min-height: 100dvh; }
    .sidebar { border-right: 1px solid var(--line); padding: var(--space-4) var(--space-3); display: flex; flex-direction: column; gap: var(--space-2); }
    .brand { font-weight: 800; font-size: 20px; color: var(--ink); text-decoration: none; padding: 0 10px; }
    .hd-nav__item { text-decoration: none; }
    .add { color: var(--brand); }
    .marks { display: flex; align-items: center; gap: 8px; }
    .marks:empty { display: none; }
    .icon { width: 18px; height: 18px; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--line); }
    .status-dot--on { background: var(--ok); }
    .muted { color: var(--ink-muted); margin: 0; padding: 4px 10px; }
    .new { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-2) 4px; }
    .row { display: flex; gap: var(--space-2); }
    .page { min-width: 0; }
    .setup { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-3) var(--space-6); border-bottom: 1px solid var(--line); color: var(--warn); font-weight: 700; }
    .setup .hd-btn { text-decoration: none; white-space: nowrap; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    @media (max-width: 860px) {
      :host { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
      .sidebar { border-right: 0; border-bottom: 1px solid var(--line); flex-direction: row; align-items: center; overflow-x: auto; }
      .hd-nav { flex-direction: row; align-items: center; }
      .hd-nav__group { display: none; }
      .hd-nav__item { white-space: nowrap; }
    }
  `,
})
export class Shell {
  protected readonly store = inject(DashboardsStore);
  protected readonly displays = inject(DisplaysStore);
  private readonly api = inject(DashboardsApi);
  private readonly router = inject(Router);

  protected readonly plus = LucidePlus;
  protected readonly monitor = LucideMonitor;
  protected readonly key = LucideKeyRound;
  protected readonly images = LucideImages;
  private readonly homey = inject(RealtimeTileData);
  protected readonly homeyNotSetUp = computed(() => this.homey.homeys()?.length === 0);
  protected readonly onAccounts = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url.startsWith('/accounts')),
    ),
    { initialValue: this.router.url.startsWith('/accounts') },
  );
  protected readonly naming = signal(false);
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('name');

  constructor() {
    this.store.load();
    effect(() => this.nameInput()?.nativeElement.focus());
  }

  protected missingLabel(count: number) {
    return count === 1 ? '1 tile not found in Homey' : `${count} tiles not found in Homey`;
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
