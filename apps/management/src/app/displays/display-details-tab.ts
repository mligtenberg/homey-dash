import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DisplayInfo, FULLY_FUNCTIONS } from '@homey-dash/api-client';
import { SOUND_LABELS, TIMER_SOUNDS } from '@homey-dash/tiles';
import { LOCALES, LOCALE_NAMES, t, TranslatePipe } from '@homey-dash/i18n';
import { describeUserAgent } from './browser-text';
import { DisplayContext } from './display-context';
import { DisplayMemos } from './display-memos';
import { DisplayScreenshot } from './display-screenshot';
import { SignalPicker } from '../editor/signal-picker';
import { DisplaysStore, isLuminanceSignal } from './displays-store';

/** A display's name, a screenshot of it and what its screen and browser say about themselves; removing it too. */
@Component({
  selector: 'hd-display-details-tab',
  imports: [DecimalPipe, DisplayMemos, DisplayScreenshot, SignalPicker, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (context.display(); as display) {
      <section class="hd-panel wide name">
        <div class="hd-field">
          <label class="hd-field__label" for="display-name">{{ 'Name' | t }}</label>
          <input class="hd-input" id="display-name" [value]="display.name" (change)="store.rename(display, name.value)" (keydown.enter)="name.blur()" #name />
        </div>
        <div class="hd-field">
          <label class="hd-field__label" for="display-language">{{ 'Language' | t }}</label>
          <select class="hd-input" id="display-language" (change)="store.setLanguage(display, language.value || null)" #language>
            <option value="" [selected]="!display.language">{{ 'Same as its browser' | t }}</option>
            @for (l of locales; track l) {
              <option [value]="l" [selected]="display.language === l">{{ names[l] }}</option>
            }
          </select>
        </div>
        <div class="hd-field">
          <label class="hd-field__label" for="display-zone">{{ 'Zone' | t }}</label>
          <select class="hd-input" id="display-zone" (change)="chooseZone(display, zone.value)" #zone>
            <option value="" [selected]="display.zoneId == null">{{ 'Not in a zone' | t }}</option>
            @for (z of zones(); track z.value) {
              <option [value]="z.value" [selected]="z.value === zoneValue(display)">{{ z.label }}</option>
            }
          </select>
        </div>
        <div class="hd-field">
          <label class="hd-field__label" for="display-timer-sound">{{ 'Timer sound for voice' | t }}</label>
          <select class="hd-input" id="display-timer-sound" (change)="store.setTimerSound(display, sound.value || null)" #sound>
            @for (s of sounds; track s.id) {
              <option [value]="s.id" [selected]="s.id === (display.timerSound ?? 'beep')">{{ s.label | t }}</option>
            }
          </select>
        </div>
      </section>
      <section class="hd-panel wide">
        <h2 class="hd-section-title">{{ 'What it shows now' | t }}</h2>
        <hd-display-screenshot [display]="display" />
      </section>
      <section class="hd-panel wide">
        <h2 class="hd-section-title">{{ 'Voice memos' | t }}</h2>
        <p class="hd-hint">{{ 'Recordings stay on the display until you download them here.' | t }}</p>
        <hd-display-memos [display]="display" />
      </section>
      <section class="hd-panel">
        <h2 class="hd-section-title">{{ 'Light' | t }}</h2>
        <dl>
          <dt>{{ 'Now' | t }}</dt>
          <dd>
            @if (display.status.lux !== null) {
              {{ display.status.lux | number: '1.0-0' }} lx
              @if (!display.status.connected) {
                <span class="hd-hint">{{ 'as last measured' | t }}</span>
              }
            } @else {
              Not measured yet
            }
          </dd>
          <dt>{{ 'Measured with' | t }}</dt>
          <dd>{{ lightSource() }}</dd>
          <dt>{{ 'Source' | t }}</dt>
          <dd class="source">
            <hd-signal-picker [value]="display.lightSignal ?? ''" [only]="isLuminance" (picked)="store.setLightSource(display, $event)" />
            @if (display.lightSignal) {
              <button type="button" class="hd-btn hd-btn--sm" (click)="store.setLightSource(display, null)">{{ 'Use the screen' | t }}</button>
            }
          </dd>
        </dl>
        @if (display.status.details?.secureContext === false) {
          <p class="hd-hint">{{ 'The camera and light sensor need https or localhost. Pick a luminance sensor from Homey instead.' | t }}</p>
        }
      </section>
      @if (display.status.details; as d) {
        <section class="hd-panel">
          <h2 class="hd-section-title">{{ 'Screen' | t }}</h2>
          <dl>
            <dt>{{ 'Resolution' | t }}</dt>
            <dd>{{ size(d.screenWidth, d.screenHeight) }}&ngsp;@if (physical(); as p) { <span class="hd-hint">({{ p }} pixels)</span> }</dd>
            <dt>{{ 'Browser' | t }}</dt>
            <dd>{{ browser() }}</dd>
            <dt>{{ 'Battery' | t }}</dt>
            <dd>{{ battery() }}</dd>
            <dt>{{ 'Last seen' | t }}</dt>
            <dd>{{ display.status.connected ? t('Connected now') : display.status.lastSeenAt ? store.ago(display.status.lastSeenAt) : t('Never') }}</dd>
          </dl>
          <details class="more">
            <summary>{{ 'More' | t }}</summary>
            <dl>
              <dt>{{ 'Page size' | t }}</dt>
              <dd>{{ size(d.viewportWidth, d.viewportHeight) }}</dd>
              <dt>{{ 'Pixel ratio' | t }}</dt>
              <dd>{{ d.pixelRatio ?? t('Unknown') }}</dd>
              <dt>{{ 'Orientation' | t }}</dt>
              <dd>{{ orientation(d.orientation) }}</dd>
              <dt>{{ 'Touch' | t }}</dt>
              <dd>{{ d.touchPoints ? t('{count} points', { count: d.touchPoints }) : t('No touch') }}</dd>
              <dt>{{ 'Language' | t }}</dt>
              <dd>{{ d.language ?? t('Unknown') }}</dd>
              <dt>{{ 'Time zone' | t }}</dt>
              <dd>{{ d.timeZone ?? t('Unknown') }}</dd>
              <dt>{{ 'Connection' | t }}</dt>
              <dd>{{ d.connection ?? t('Unknown') }}</dd>
              <dt>{{ 'Page loaded' | t }}</dt>
              <dd>{{ d.loadedAt ? store.ago(d.loadedAt) : t('Unknown') }}</dd>
              @if (d.userAgent) {
                <dt>{{ 'User agent' | t }}</dt>
                <dd class="ua">{{ d.userAgent }}</dd>
              }
              <dt>{{ 'Fully Kiosk' | t }}</dt>
              <dd>
                @if (d.fully; as fully) {
                  {{ fully.version ?? 'Supported' }}
                  <ul class="api">
                    @for (name of fullyApi(); track name) {
                      <li [class.api--off]="!fully.api.includes(name)">{{ fullyText(name) }}</li>
                    }
                  </ul>
                } @else {
                  <span class="hd-hint">Not here, or its "JavaScript Interface" setting is off. Idle rules can't turn this screen off; it goes black instead.</span>
                }
              </dd>
            </dl>
          </details>
        </section>
      } @else {
        <div class="hd-panel hd-empty">
          <h2 class="hd-section-title">{{ 'No details yet' | t }}</h2>
          <p class="hd-hint">
            A screen tells HomeyDash about itself when it connects. @if (display.status.held) { Open or reload the display page on it. } @else {
              This display has no screen; take it over from setup on a screen.
            }
          </p>
        </div>
      }
      <div class="hd-danger wide">
        @if (removing()) {
          <p>{{ 'Remove' | t }} <strong>{{ display.name }}</strong>{{ '? Its screen goes back to setup.' | t }}</p>
          <div class="hd-actions">
            <button class="hd-btn hd-btn--primary" type="button" (click)="remove(display)">{{ 'Remove' | t }}</button>
            <button class="hd-btn" type="button" (click)="removing.set(false)">{{ 'Cancel' | t }}</button>
          </div>
        } @else {
          <p class="hd-hint">{{ 'Removing a display sends its screen back to setup.' | t }}</p>
          <button class="hd-btn hd-btn--danger" type="button" (click)="removing.set(true)">{{ 'Remove display' | t }}</button>
        }
      </div>
    }
  `,
  styles: `
    h2 { margin-bottom: var(--space-3); }
    :host { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: var(--space-3); align-items: stretch; }
    section { padding: var(--space-4); }
    .wide { grid-column: 1 / -1; }
    .name { display: flex; flex-wrap: wrap; gap: var(--space-4); }
    .name .hd-input { max-width: 360px; }
    .source { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
    .more { margin-top: var(--space-3); }
    .more summary { cursor: pointer; color: var(--ink-muted); font-size: 13px; margin-bottom: var(--space-3); }
    .more .api { margin-top: var(--space-2); }
    .hd-empty { grid-column: 1 / -1; --empty-padding: var(--space-5); }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: var(--space-2) var(--space-4); margin: 0; }
    dt { color: var(--ink-muted); font-size: 13px; }
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
  protected readonly isLuminance = isLuminanceSignal;
  protected readonly t = t;
  protected readonly locales = LOCALES;
  protected readonly names = LOCALE_NAMES;
  protected readonly sounds = TIMER_SOUNDS.map((id) => ({ id, label: SOUND_LABELS[id] }));

  // Every zone of every Homey, by name; the name of its Homey goes with it where there is more than one.
  protected readonly zones = computed(() => {
    const homeys = this.store.homeys();
    return homeys
      .flatMap((h) => [...h.zones.values()].map((z) => ({ value: `${h.accountId}|${z.id}`, label: homeys.length > 1 ? `${z.name} · ${h.accountName}` : z.name })))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  protected zoneValue(display: DisplayInfo) {
    return display.zoneId == null ? '' : `${display.zoneAccountId}|${display.zoneId}`;
  }

  protected chooseZone(display: DisplayInfo, value: string) {
    const [accountId, ...zoneId] = value.split('|');
    this.store.setZone(display, value ? { accountId: Number(accountId), zoneId: zoneId.join('|') } : null);
  }

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
    if (this.context.display()?.lightSignal) return t('A device in Homey');
    const light = this.context.display()?.status.details?.light;
    if (!light?.available) return t("This screen can't measure light");
    if (light.source === 'sensor') return t('Light sensor');
    if (light.source === 'camera') return t('Camera (an estimate)');
    return t('Not measured yet');
  });

  protected readonly browser = computed(() => [this.text().browser, this.text().system].filter(Boolean).join(' on ') || t('Unknown'));

  protected readonly battery = computed(() => {
    const battery = this.context.display()?.status.details?.battery;
    if (battery?.level == null) return t('Unknown');
    const level = `${Math.round(battery.level * 100)}%`;
    return battery.charging ? t('{level}, charging', { level }) : level;
  });

  protected remove(display: DisplayInfo) {
    this.store.remove(display, () => this.router.navigate(['/displays']));
  }

  protected size(width: number | null, height: number | null) {
    return width && height ? `${width} × ${height}` : t('Unknown');
  }

  protected orientation(type: string | null) {
    if (!type) return t('Unknown');
    return type.startsWith('portrait') ? t('Portrait') : t('Landscape');
  }

  protected fullyText(name: string) {
    return FULLY_FUNCTIONS[name];
  }
}
