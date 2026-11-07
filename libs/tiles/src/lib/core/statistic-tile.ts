import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { HomeyApi, HomeyInsightEntry, HomeyInsightLog, InsightResolution, Realtime } from '@homey-dash/api-client';
import { LucideChartLine, LucideDynamicIcon } from '@lucide/angular';
import { KindHue } from '../tile-kind';
import { TileSettings } from '../tile-data';
import { DeviceDetails } from './device-details';
import { deviceLook, formatReading } from './device-look';
import { STATISTIC_WINDOWS, StatisticChart, statisticFigures, statisticStamp, statisticTone, logOwner } from './statistic-chart';
import { TileDetails } from './tile-details';
import { TILE_FACE_HOST, TileFace, TileView } from './tile-view';

// The chart and what is computed for it live in their own file, so the device's detail view can show them too.
export * from './statistic-chart';

export interface StatisticTileSettings extends TileSettings {
  /** The time window the chart shows; absent is the last 24 hours. */
  window?: InsightResolution;
}

function logHue(log: HomeyInsightLog, ownerHue: KindHue): KindHue {
  const units = log.units ?? '';
  if (/power|meter|energy/.test(log.id) || /^(k?Wh?|A|V)$/.test(units))
    return 'energy';
  if (/temperature/.test(log.id) || units.startsWith('°')) return 'climate';
  return ownerHue === 'neutral' ? 'energy' : ownerHue;
}

@Component({
  selector: 'hd-statistic-tile',
  imports: [LucideDynamicIcon, StatisticChart, TileDetails, DeviceDetails],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    ...TILE_FACE_HOST,
    '[class.hd-stat]':
      "face().state === 'ok' || face().state === 'unavailable'",
  },
  template: `
    @if (face().state === 'ok' || face().state === 'unavailable') {
      <div class="hd-stat__head">
        <div>
          <div class="hd-tile__name">{{ face().name }}</div>
          <div class="hd-tile__detail">{{ face().detail }}</div>
        </div>
        @if (current(); as current) {
          <!-- Beside the name, a large tile only has room for a medium value. -->
          <div class="hd-value" [class.hd-value--m]="size() === 'large'" [class.hd-value--l]="size() !== 'large'">{{ current.value }}<span class="hd-unit">{{ current.units }}</span></div>
        }
      </div>
      <hd-statistic-chart [entries]="entries()" [window]="window()" />
      @if (face().state === 'unavailable') {
        <span class="hd-badge">Unavailable</span>
      }
    } @else {
      <svg class="hd-icon" [lucideIcon]="face().icon" />
      <div>
        <div class="hd-tile__name">{{ face().name }}</div>
        <div class="hd-tile__detail">{{ face().detail }}</div>
      </div>
    }
    @if (ownerDevice(); as device) {
      <!-- A reading of a device opens the device's own detail view, on the history of this reading. -->
      <hd-device-details
        [account]="settings().account"
        [deviceId]="device.id"
        [name]="device.name"
        [icon]="deviceIcon()"
        [log]="settings().target ?? undefined"
        [window]="windowId()"
      />
    } @else {
      <hd-tile-details
        [screen]="true"
        [name]="face().name"
        [icon]="face().icon"
        [subtitle]="face().detail"
      >
        <div
          class="hd-segmented"
          hdDetailsHead
          role="group"
          aria-label="Time window"
        >
          @for (w of windows; track w.id) {
            <button
              type="button"
              [attr.aria-pressed]="shownWindow() === w.id"
              (click)="viewWindow.set(w.id)"
            >
              {{ w.tab }}
            </button>
          }
        </div>
        <div class="hd-stat__pane" [attr.data-tone]="tone()">
          @if (readout(); as readout) {
            <div class="hd-stat__readout">
              <div class="hd-value hd-value--xl">
                {{ readout.value
                }}<span class="hd-unit">{{ readout.units }}</span>
              </div>
              <div class="hd-details__label">{{ pickedAt() ?? 'Now' }}</div>
            </div>
          }
          <hd-statistic-chart
            [entries]="shownEntries()"
            [window]="shownWindowInfo()"
            [scrub]="true"
            (picked)="picked.set($event)"
          />
          @if (figures(); as figures) {
            <dl class="hd-stat__figures">
              @for (f of figures; track f.label) {
                <div class="hd-stat__figure">
                  <dt class="hd-details__label">{{ f.label }}</dt>
                  <dd class="hd-stat__figure-value">{{ f.value }}</dd>
                  @if (f.note) {
                    <dd class="hd-stat__figure-note">{{ f.note }}</dd>
                  }
                </div>
              }
            </dl>
          }
        </div>
      </hd-tile-details>
    }
  `,
})
export class StatisticTile extends TileView<StatisticTileSettings> {
  private readonly homeyApi = inject(HomeyApi);
  private readonly realtime = inject(Realtime);

  private readonly log = computed(() =>
    this.homey()?.insights.get(this.settings().target ?? ''),
  );
  private readonly owner = computed(() => {
    const owner = logOwner(this.settings().target ?? '');
    return owner
      ? {
          device: this.homey()?.devices.get(owner.deviceId),
          capability: owner.capability,
        }
      : null;
  });
  /** The device whose reading the tile shows; absent for a log that is not a device's, such as the weather's. */
  protected readonly ownerDevice = computed(() => this.owner()?.device);
  protected readonly deviceIcon = computed(
    () => deviceLook(this.ownerDevice()).icon,
  );
  private readonly deviceDetails = viewChild(DeviceDetails);
  private readonly windowId = computed<InsightResolution>(
    () => this.settings().window ?? 'last24Hours',
  );
  protected readonly window = computed(
    () => STATISTIC_WINDOWS[this.windowId()],
  );

  private readonly history = rxResource({
    params: () => {
      const log = this.log();
      return log
        ? {
            log: log.id,
            window: this.windowId(),
            account: this.settings().account,
          }
        : undefined;
    },
    stream: ({ params }) =>
      this.homeyApi.insightEntries(params.log, params.window, params.account),
  });

  /** The window the detail view shows: the tile's own until another tab is pressed, and again once it is closed. */
  protected readonly viewWindow = signal<InsightResolution | null>(null);
  protected readonly windows = Object.entries(STATISTIC_WINDOWS).map(
    ([id, { tab }]) => ({ id: id as InsightResolution, tab }),
  );
  protected readonly shownWindow = computed(
    () => this.viewWindow() ?? this.windowId(),
  );
  protected readonly shownWindowInfo = computed(
    () => STATISTIC_WINDOWS[this.shownWindow()],
  );
  /** The history of another tab's window, fetched only while the detail view is open on it. */
  private readonly otherHistory = rxResource({
    params: () => {
      const log = this.log();
      const window = this.viewWindow();
      return log && window && window !== this.windowId()
        ? { log: log.id, window, account: this.settings().account }
        : undefined;
    },
    stream: ({ params }) =>
      this.homeyApi.insightEntries(params.log, params.window, params.account),
  });
  /** The history with the owner device's live values appended. */
  private readonly entries = linkedSignal<HomeyInsightEntry[]>(() =>
    this.history.hasValue() ? this.history.value() : [],
  );

  readonly face = computed<TileFace>(() => {
    const log = this.log();
    const device = this.owner()?.device;
    const base = {
      icon: LucideChartLine,
      hue: log ? logHue(log, deviceLook(device).hue) : ('energy' as const),
    };
    if (!log) return this.absentFace({ ...base, noun: 'Statistic' });
    const name =
      this.settings().label ||
      [log.ownerName, log.title].filter(Boolean).join(' · ');
    return {
      ...base,
      name,
      detail: this.window().label,
      details: true,
      state: device && !device.available ? 'unavailable' : 'ok',
    };
  });

  protected override openDetails() {
    if (this.ownerDevice()) this.deviceDetails()?.open('history');
    else super.openDetails();
  }

  protected override closeDetails() {
    if (this.ownerDevice()) this.deviceDetails()?.close();
    else super.closeDetails();
  }

  /** The entry picked along the chart in the detail view. */
  protected readonly picked = signal<HomeyInsightEntry | null>(null);

  /** The entries of the window the detail view shows. */
  protected readonly shownEntries = computed(() =>
    this.shownWindow() === this.windowId()
      ? this.entries()
      : this.otherHistory.hasValue()
        ? this.otherHistory.value()
        : [],
  );

  private readonly latest = computed(() =>
    [...this.entries()].reverse().find((e) => e.v !== null),
  );
  protected readonly current = computed(() => this.reading(this.latest()));
  protected readonly readout = computed(() => {
    const shown = this.shownEntries();
    return this.reading(
      this.picked() ?? [...shown].reverse().find((e) => e.v !== null),
    );
  });
  protected readonly tone = computed(() => statisticTone(this.log()));

  protected readonly pickedAt = computed(() => {
    const picked = this.picked();
    return picked ? this.stamp(picked.t) : null;
  });

  /** The lowest, highest, average and change of the shown window. */
  protected readonly figures = computed(() =>
    statisticFigures(
      this.shownEntries(),
      this.shownWindowInfo(),
      this.log()?.units ?? null,
    ),
  );

  private stamp(iso: string) {
    return statisticStamp(iso, this.shownWindowInfo().ms);
  }

  private reading(entry: HomeyInsightEntry | undefined) {
    return entry
      ? formatReading(entry.v as number, this.log()?.units ?? null)
      : null;
  }

  constructor() {
    super();
    // The detail view opens on the tile's own window every time.
    effect(() => {
      if (!this.details()?.isOpen()) untracked(() => this.viewWindow.set(null));
    });

    // Values missed while the connection was down are only in Homey's history.
    let wasConnected = untracked(this.realtime.connected);
    effect(() => {
      const connected = this.realtime.connected();
      if (connected && !wasConnected) untracked(() => this.history.reload());
      wasConnected = connected;
    });

    effect(() => {
      const owner = this.owner();
      const capability = owner?.device?.capabilities[owner.capability];
      if (typeof capability?.value !== 'number') return;
      const entry = {
        t: capability.lastUpdated ?? new Date().toISOString(),
        v: capability.value,
      };
      const windowMs = untracked(this.window).ms;
      untracked(() =>
        this.entries.update((entries) => {
          const last = entries[entries.length - 1];
          if (last && Date.parse(last.t) >= Date.parse(entry.t)) return entries;
          const start = Date.parse(entry.t) - windowMs;
          return [...entries.filter((e) => Date.parse(e.t) >= start), entry];
        }),
      );
    });
  }
}

/** Management's choice of the time window a statistic tile shows. */
@Component({
  selector: 'hd-statistic-tile-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hd-field">
      <label class="hd-field__label" for="tile-window">Time window</label>
      <select
        id="tile-window"
        class="hd-select"
        (change)="changed.emit({ window: $any($event.target).value })"
      >
        @for (option of windows; track option.id) {
          <option
            [value]="option.id"
            [selected]="option.id === (settings().window ?? 'last24Hours')"
          >
            {{ option.label }}
          </option>
        }
      </select>
    </div>
  `,
})
export class StatisticTileSettingsEditor {
  readonly settings = input.required<StatisticTileSettings>();
  readonly changed = output<Partial<StatisticTileSettings>>();

  protected readonly windows = Object.entries(STATISTIC_WINDOWS).map(
    ([id, { label }]) => ({ id, label }),
  );
}
