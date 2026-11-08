import { brokenImages } from './loadable-art';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { DeviceApp, Realtime } from '@homey-dash/api-client';
import { LucideDynamicIcon } from '@lucide/angular';
import { appIcon } from './app-icons';

/**
 * The apps a device can open, such as an Apple TV's, as buttons to tap; the one that is open is marked. Apps with a
 * known category are grouped under it, and those without one come last.
 */
@Component({
  selector: 'hd-device-apps',
  imports: [LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'hd-apps' },
  template: `
    @for (group of groups(); track group.title) {
      <section class="hd-apps__group">
        @if (group.title) {
          <h3 class="hd-details__label">{{ group.title }}</h3>
        }
        <div class="hd-apps__grid" role="group" [attr.aria-label]="group.title || 'Open an app'">
          @for (app of group.apps; track app.name) {
            <button
              type="button"
              class="hd-apps__app"
              [attr.aria-label]="app.name"
              [attr.aria-pressed]="isOpen(app)"
              [class.is-busy]="opening() === app.name"
              [disabled]="disabled()"
              (click)="open(app)"
            >
              <span class="hd-apps__icon" aria-hidden="true">
                @if (app.image && !images.has(app.image)) {
                  <img [src]="app.image" alt="" draggable="false" (error)="images.mark(app.image)" />
                } @else if (icon(app); as symbol) {
                  <svg [lucideIcon]="symbol" />
                } @else {
                  {{ app.name.charAt(0) }}
                }
              </span>
              <span class="hd-apps__name">{{ app.name }}</span>
            </button>
          }
        </div>
      </section>
    }
    @if (error(); as message) {
      <div class="hd-details__label" role="alert">{{ message }}</div>
    }
  `,
})
export class DeviceApps {
  private readonly realtime = inject(Realtime);

  readonly account = input<number>();
  readonly deviceId = input.required<string>();
  readonly apps = input.required<readonly DeviceApp[]>();
  /** The name of the app that is open on the device now, when it says. */
  readonly current = input('');
  readonly disabled = input(false);

  /**
   * The apps by category: the categories of media apps first, then the others, each alphabetically, and the apps with
   * no category last. There are no headings when no app has a category.
   */
  protected readonly groups = computed(() => {
    const apps = this.apps();
    if (!apps.some((app) => app.category)) return [{ title: '', apps }];
    const byCategory = new Map<string, DeviceApp[]>();
    for (const app of apps) byCategory.set(app.category ?? '', [...(byCategory.get(app.category ?? '') ?? []), app]);
    const rank = (title: string) => (!title ? 2 : byCategory.get(title)!.some((app) => app.media) ? 0 : 1);
    const titles = [...byCategory.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    return titles.map((title) => ({ title: title || 'Other', apps: byCategory.get(title)! }));
  });

  /** The app being opened, until Homey answers. */
  protected readonly opening = signal<string | null>(null);
  protected readonly error = signal('');
  protected readonly images = brokenImages();

  protected readonly icon = appIcon;

  protected isOpen(app: DeviceApp) {
    return !!this.current() && app.name.toLowerCase() === this.current().toLowerCase();
  }

  protected async open(app: DeviceApp) {
    this.opening.set(app.name);
    this.error.set('');
    try {
      await this.realtime.openDeviceApp(this.account(), this.deviceId(), app);
    } catch {
      this.error.set(`Could not open ${app.name}`);
    } finally {
      this.opening.set(null);
    }
  }
}
