import type { LucideIconData } from '@lucide/angular';
import { ChangeDetectionStrategy, Component, computed, ElementRef, input, output, signal, viewChild, afterNextRender } from '@angular/core';
import {
  LucideCalendar,
  LucideCar,
  LucideChartLine,
  LucideClapperboard,
  LucideClock,
  LucideTimer,
  LucideCloudSun,
  LucideImage,
  LucideLibrary,
  LucideLightbulb,
  LucideNewspaper,
  LucidePlay,
  LucideSearch,
  LucideSparkles,
  LucideSpeaker,
  LucideVariable,
  LucideWorkflow,
  LucideZap,
  LucideLayers,
} from '@homey-dash/design-system';
import { KindHue, TileKind } from '@homey-dash/tiles';
import { LucideDynamicIcon } from '@lucide/angular';
import { TranslatePipe } from '@homey-dash/i18n';

interface KindInfo {
  icon: LucideIconData;
  hue: KindHue;
  group: string;
  /** What a tile of this kind does, in a few words. */
  about: string;
}

/** How each tile kind is introduced when adding a tile. A kind not listed here still shows, under Other. */
const INFO: Record<string, KindInfo> = {
  device: { icon: LucideLightbulb, hue: 'light', group: 'Homey', about: 'A light, plug, thermostat, lock or any device' },
  flow: { icon: LucideWorkflow, hue: 'flow', group: 'Homey', about: 'Start a flow with a press' },
  mood: { icon: LucideSparkles, hue: 'mood', group: 'Homey', about: 'Set one mood in a room' },
  'mood-list': { icon: LucideLayers, hue: 'mood', group: 'Homey', about: 'Several moods to choose from' },
  statistic: { icon: LucideChartLine, hue: 'climate', group: 'Homey', about: 'A reading and its history as a chart' },
  energy: { icon: LucideZap, hue: 'energy', group: 'Homey', about: 'Power use and solar of the home' },
  logic: { icon: LucideVariable, hue: 'neutral', group: 'Homey', about: 'Shows one of several tiles, by rules' },
  'plex-now-playing': { icon: LucidePlay, hue: 'appliance', group: 'Media', about: 'What plays on a Plex player, with controls' },
  'plex-recent': { icon: LucideClapperboard, hue: 'appliance', group: 'Media', about: 'Films and episodes added lately' },
  'plex-library': { icon: LucideLibrary, hue: 'appliance', group: 'Media', about: 'Browse and play a Plex library' },
  sonos: { icon: LucideSpeaker, hue: 'appliance', group: 'Media', about: 'Sonos rooms, volume and music' },
  photo: { icon: LucideImage, hue: 'neutral', group: 'Media', about: 'Photos from a photo set, one after another' },
  weather: { icon: LucideCloudSun, hue: 'climate', group: 'Information', about: 'Now, the coming hours and rain' },
  traffic: { icon: LucideCar, hue: 'neutral', group: 'Information', about: 'Travel time on a route, with delays' },
  news: { icon: LucideNewspaper, hue: 'neutral', group: 'Information', about: 'Headlines, videos and livestreams' },
  clock: { icon: LucideClock, hue: 'neutral', group: 'Information', about: 'The time' },
  timer: { icon: LucideTimer, hue: 'neutral', group: 'Information', about: 'Timers with an alert' },
  date: { icon: LucideCalendar, hue: 'neutral', group: 'Information', about: 'Today’s date' },
};
const GROUPS = ['Homey', 'Media', 'Information', 'Other'];

/**
 * Choosing what tile to add: every kind with its icon in its own colour and a line on what it does, grouped by where
 * it gets its content, with a search. A kind that has no size fitting the free space is shown but cannot be picked.
 */
@Component({
  selector: 'hd-tile-kind-chooser',
  imports: [LucideDynamicIcon, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <h2 class="hd-section-title">{{ 'Add a tile' | t }}</h2>
      <button class="hd-btn hd-btn--sm" type="button" (click)="cancelled.emit()">{{ 'Cancel' | t }}</button>
    </div>
    <label class="search">
      <svg [lucideIcon]="searchIcon" aria-hidden="true" />
      <input #search class="hd-input" type="search" [placeholder]="'Find a tile' | t" [attr.aria-label]="'Find a tile' | t"
        [value]="query()" (input)="query.set($any($event.target).value)" (keydown.enter)="pickFirst($event)" (keydown.escape)="cancelled.emit()" />
    </label>
    @for (group of groups(); track group.name) {
      <section class="group" [attr.aria-label]="group.name">
        <h3 class="hd-label">{{ group.name }}</h3>
        <ul>
          @for (item of group.items; track item.kind.id) {
            <li>
              <button type="button" class="kind" [disabled]="!item.fits" (click)="picked.emit(item.kind)" [style.--k-ink]="'var(--kind-' + item.info.hue + '-ink)'" [style.--k-fill]="'var(--kind-' + item.info.hue + '-fill)'">
                <span class="icon"><svg [lucideIcon]="item.info.icon" /></span>
                <span class="text">
                  <span class="name">{{ item.name }}</span>
                  <span class="about">{{ item.fits ? item.info.about : 'No size of it fits here' }}</span>
                </span>
              </button>
            </li>
          }
        </ul>
      </section>
    } @empty {
      <p class="hd-muted">No tile called “{{ query() }}”.</p>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--space-3); }
    .head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
    .search { position: relative; display: block; }
    .search svg { position: absolute; left: 10px; top: 50%; translate: 0 -50%; width: 16px; height: 16px; color: var(--ink-muted); pointer-events: none; }
    .search input { width: 100%; box-sizing: border-box; padding-left: 34px; }
    .group { display: flex; flex-direction: column; gap: 4px; }
    .group .hd-label { padding: 6px 2px 2px; }
    ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
    .kind {
      display: flex; align-items: center; gap: 10px; width: 100%;
      padding: 7px 8px; border: 1px solid transparent; border-radius: var(--radius-control);
      background: none; color: var(--ink); font: inherit; text-align: left; cursor: pointer;
      transition: background-color .12s, border-color .12s;
    }
    .kind:hover:not(:disabled) { background: color-mix(in oklab, var(--k-fill) 22%, transparent); border-color: color-mix(in oklab, var(--k-ink) 25%, transparent); }
    .kind:focus-visible { outline: 3px solid var(--brand); outline-offset: 1px; }
    .kind:disabled { cursor: not-allowed; opacity: .55; }
    .icon { display: grid; place-items: center; flex: none; width: 32px; height: 32px; border-radius: 8px; background: color-mix(in oklab, var(--k-fill) 45%, transparent); color: var(--k-ink); }
    .icon svg { width: 17px; height: 17px; }
    .icon svg :is(path, rect, circle) { fill: currentColor; fill-opacity: .22; }
    .text { display: flex; flex-direction: column; min-width: 0; }
    .name { font-weight: 600; }
    .about { font-size: 12px; line-height: 1.35; color: var(--ink-muted); text-wrap: pretty; }
    @media (prefers-reduced-motion: reduce) { .kind { transition: none; } }
  `,
})
export class TileKindChooser {
  readonly kinds = input.required<TileKind[]>();
  readonly fits = input.required<(kind: TileKind) => boolean>();
  readonly picked = output<TileKind>();
  readonly cancelled = output<void>();

  protected readonly searchIcon = LucideSearch;
  protected readonly query = signal('');
  private readonly search = viewChild.required<ElementRef<HTMLInputElement>>('search');

  protected readonly groups = computed(() => {
    const words = this.query().toLowerCase().split(/\s+/).filter(Boolean);
    const items = this.kinds()
      .map((kind) => ({
        kind,
        // "Device tile" reads as "Device" in a list headed Add a tile.
        name: kind.label.replace(/ tile$/, ''),
        info: INFO[kind.id] ?? { icon: LucideSparkles, hue: 'neutral' as KindHue, group: 'Other', about: '' },
        fits: this.fits()(kind),
      }))
      .filter((i) => words.every((w) => `${i.name} ${i.info.about} ${i.info.group}`.toLowerCase().includes(w)));
    return GROUPS.map((name) => ({ name, items: items.filter((i) => i.info.group === name) })).filter((g) => g.items.length);
  });

  constructor() {
    afterNextRender(() => this.search().nativeElement.focus());
  }

  protected pickFirst(event: Event) {
    event.preventDefault();
    const first = this.groups().flatMap((g) => g.items).find((i) => i.fits);
    if (first) this.picked.emit(first.kind);
  }
}
