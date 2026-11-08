import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DisplayInfo, FULLY_FUNCTIONS } from '@homey-dash/api-client';
import { describeUserAgent } from './browser-text';
import { DisplayContext } from './display-context';
import { DisplayScreenshot } from './display-screenshot';
import { DisplaysStore } from './displays-store';

/** A display's name, a screenshot of it and what its screen and browser say about themselves; removing it too. */
@Component({
  selector: 'hd-display-details-tab',
  imports: [DecimalPipe, DisplayScreenshot],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (context.display(); as display) {
      <section class="hd-panel wide">
        <h2 class="hd-section-title">Screenshot</h2>
        <hd-display-screenshot [display]="display" />
      </section>
      @if (display.status.details; as d) {
        <section class="hd-panel">
          <h2 class="hd-section-title">Screen</h2>
          <dl>
            <dt>Resolution</dt>
            <dd>{{ size(d.screenWidth, d.screenHeight) }}&ngsp;@if (physical(); as p) { <span class="hd-hint">({{ p }} pixels)</span> }</dd>
            <dt>Page size</dt>
            <dd>{{ size(d.viewportWidth, d.viewportHeight) }}</dd>
            <dt>Pixel ratio</dt>
            <dd>{{ d.pixelRatio ?? 'Unknown' }}</dd>
            <dt>Orientation</dt>
            <dd>{{ orientation(d.orientation) }}</dd>
            <dt>Touch</dt>
            <dd>{{ d.touchPoints ? d.touchPoints + ' points' : 'No touch' }}</dd>
          </dl>
        </section>
        <section class="hd-panel">
          <h2 class="hd-section-title">Browser</h2>
          <dl>
            <dt>Browser</dt>
            <dd>{{ text().browser ?? 'Unknown' }}</dd>
            <dt>System</dt>
            <dd>{{ text().system ?? 'Unknown' }}</dd>
            <dt>Language</dt>
            <dd>{{ d.language ?? 'Unknown' }}</dd>
            <dt>Time zone</dt>
            <dd>{{ d.timeZone ?? 'Unknown' }}</dd>
            <dt>Secure context</dt>
            <dd>
              {{ d.secureContext ? 'Yes' : 'No' }}
              @if (!d.secureContext) {
                <span class="hd-hint">The camera and light sensor need https or localhost.</span>
              }
            </dd>
            @if (d.userAgent) {
              <dt>User agent</dt>
              <dd class="ua">{{ d.userAgent }}</dd>
            }
          </dl>
        </section>
        <section class="hd-panel">
          <h2 class="hd-section-title">Fully Kiosk Browser</h2>
          @if (d.fully; as fully) {
            <dl>
              <dt>JavaScript interface</dt>
              <dd><span class="hd-pill hd-pill--ok">Supported</span></dd>
              @if (fully.version) {
                <dt>Version</dt>
                <dd>{{ fully.version }}</dd>
              }
              <dt>Functions</dt>
              <dd>
                <ul class="api">
                  @for (name of fullyApi(); track name) {
                    <li [class.api--off]="!fully.api.includes(name)">{{ fullyText(name) }}</li>
                  }
                </ul>
              </dd>
            </dl>
          } @else {
            <p class="hd-hint">
              Not supported here: the page doesn't run in Fully Kiosk Browser, or its "JavaScript Interface" setting is off. Idle rules can't turn
              this screen off; it goes black instead.
            </p>
          }
        </section>
        <section class="hd-panel">
          <h2 class="hd-section-title">Light</h2>
          <dl>
            <dt>Current</dt>
            <dd>
              @if (display.status.lux !== null) {
                {{ display.status.lux | number: '1.0-0' }} lx
                @if (!display.status.connected) {
                  <span class="hd-hint">as last measured</span>
                }
              } @else {
                None measured yet
              }
            </dd>
            <dt>Measured with</dt>
            <dd>{{ lightSource() }}</dd>
          </dl>
        </section>
        <section class="hd-panel">
          <h2 class="hd-section-title">Device</h2>
          <dl>
            <dt>Battery</dt>
            <dd>{{ battery() }}</dd>
            <dt>Connection</dt>
            <dd>{{ d.connection ?? 'Unknown' }}</dd>
            <dt>Page loaded</dt>
            <dd>{{ d.loadedAt ? store.ago(d.loadedAt) : 'Unknown' }}</dd>
            <dt>Last seen</dt>
            <dd>{{ display.status.connected ? 'Connected now' : display.status.lastSeenAt ? store.ago(display.status.lastSeenAt) : 'Never' }}</dd>
          </dl>
        </section>
      } @else {
        <div class="hd-panel hd-empty">
          <h2 class="hd-section-title">No details yet</h2>
          <p class="hd-hint">
            A screen tells HomeyDash about itself when it connects. @if (display.status.held) { Open or reload the display page on it. } @else {
              This display has no screen; take it over from setup on a screen.
            }
          </p>
        </div>
      }
      <section class="hd-panel">
        <h2 class="hd-section-title">Display</h2>
        <div class="hd-field">
          <label class="hd-field__label" for="display-name">Name</label>
          <input
            class="hd-input"
            id="display-name"
            [value]="display.name"
            (change)="store.rename(display, name.value)"
            (keydown.enter)="name.blur()"
            #name
          />
        </div>
        <div class="remove">
          @if (removing()) {
            <span class="hd-hint">Its screen goes back to setup.</span>
            <button class="hd-btn hd-btn--primary" type="button" (click)="remove(display)">Remove</button>
            <button class="hd-btn" type="button" (click)="removing.set(false)">Cancel</button>
          } @else {
            <button class="hd-btn hd-btn--danger" type="button" (click)="removing.set(true)">Remove display</button>
          }
        </div>
      </section>
    }
  `,
  styles: `
    h2 { margin-bottom: var(--space-3); }
    :host { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: var(--space-3); align-items: start; }
    section { padding: var(--space-4); }
    .wide { grid-column: 1 / -1; }
    .remove { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-top: var(--space-3); }
    .hd-empty { grid-column: 1 / -1; --empty-padding: var(--space-5); }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: var(--space-2) var(--space-4); margin: 0; }
    dt { color: var(--ink-muted); }
    dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    .ua { color: var(--ink-muted); font-size: 12px; }
    .api { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
    .api li::before { content: '✓ '; color: var(--ok); }
    .api li.api--off { color: var(--ink-muted); }
    .api li.api--off::before { content: '✕ '; color: var(--ink-muted); }
  `,
})
export class DisplayDetailsTab {
  protected readonly context = inject(DisplayContext);
  protected readonly store = inject(DisplaysStore);
  private readonly router = inject(Router);
  protected readonly removing = signal(false);

  protected readonly text = computed(() => describeUserAgent(this.context.display()?.status.details?.userAgent ?? null));

  // The screen in real pixels, when that differs from CSS pixels.
  protected readonly physical = computed(() => {
    const d = this.context.display()?.status.details;
    if (!d?.screenWidth || !d.screenHeight || !d.pixelRatio || d.pixelRatio === 1) return null;
    return this.size(Math.round(d.screenWidth * d.pixelRatio), Math.round(d.screenHeight * d.pixelRatio));
  });

  // The functions of Fully's interface HomeyDash knows of, those it has first.
  protected readonly fullyApi = computed(() => {
    const has = this.context.display()?.status.details?.fully?.api ?? [];
    const known = Object.keys(FULLY_FUNCTIONS);
    return [...known.filter((n) => has.includes(n)), ...known.filter((n) => !has.includes(n))];
  });

  protected readonly lightSource = computed(() => {
    const light = this.context.display()?.status.details?.light;
    if (!light?.available) return "This screen can't measure light";
    if (light.source === 'sensor') return 'Light sensor';
    if (light.source === 'camera') return 'Camera (an estimate)';
    return 'Not measured yet';
  });

  protected readonly battery = computed(() => {
    const battery = this.context.display()?.status.details?.battery;
    if (battery?.level == null) return 'Unknown';
    const level = `${Math.round(battery.level * 100)}%`;
    return battery.charging ? `${level}, charging` : level;
  });

  protected remove(display: DisplayInfo) {
    this.store.remove(display, () => this.router.navigate(['/displays']));
  }

  protected size(width: number | null, height: number | null) {
    return width && height ? `${width} × ${height}` : 'Unknown';
  }

  protected orientation(type: string | null) {
    if (!type) return 'Unknown';
    return `${type.startsWith('portrait') ? 'Portrait' : 'Landscape'}`;
  }

  protected fullyText(name: string) {
    return FULLY_FUNCTIONS[name];
  }
}
