import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { HomeyApi, HomeyInsightEntry, HomeyInsightLog, InsightResolution } from '@homey-dash/api-client';
import { STATISTIC_WINDOWS, statisticTone, WINDOW_TABS } from './statistic-chart';
import { Segmented } from './segmented';
import { SegmentedStrip } from './segmented-strip';
import { StatisticReadings } from './statistic-readings';


/**
 * The history of what a device measures, as a page of its detail view: the value, a chart to scrub along, and
 * the lowest, highest, average and change under it. A device with several logs (temperature and humidity) picks
 * between them; a tab picks the time window. It fetches only while it is on screen, and it is the pane itself, so
 * the detail view gives it the statistic's full-screen look.
 */
@Component({
  selector: 'hd-statistic-history',
  imports: [StatisticReadings, Segmented, SegmentedStrip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'hd-stat__pane hd-hist', '[attr.data-tone]': 'tone()' },
  template: `
    @if (logs().length > 1) {
      <hd-segmented-strip label="Reading" [options]="logOptions()" [value]="log().id" (picked)="logId.set($event)" />
    }
    <div class="hd-hist__bar">
      <hd-segmented label="Time window" [options]="windows" [value]="window()" (picked)="window.set($event)" />
    </div>
    <hd-statistic-readings [entries]="entries()" [window]="windowInfo()" [units]="log().units">
      @if (!history.isLoading() && entries().length === 0) {
        <div class="hd-details__label">No history for this window</div>
      }
    </hd-statistic-readings>
  `,
})
export class StatisticHistory {
  private readonly homeyApi = inject(HomeyApi);

  /** The logs of the device, at least one. */
  readonly logs = input.required<readonly HomeyInsightLog[]>();
  readonly account = input<number>();
  /** The log it opens on; the first when absent or not among them. */
  readonly initial = input<string>();
  /** The time window it opens on. */
  readonly initialWindow = input<InsightResolution>('last24Hours');

  protected readonly windows = WINDOW_TABS;
  protected readonly window = linkedSignal<InsightResolution>(() => this.initialWindow());
  protected readonly logId = linkedSignal<string | undefined>(() => this.initial());

  protected readonly logOptions = computed(() => this.logs().map((l) => ({ id: l.id, label: l.title })));
  protected readonly log = computed(() => this.logs().find((l) => l.id === this.logId()) ?? this.logs()[0]);
  protected readonly windowInfo = computed(() => STATISTIC_WINDOWS[this.window()]);
  protected readonly tone = computed(() => statisticTone(this.log()));

  protected readonly history = rxResource({
    params: () => ({ log: this.log().id, window: this.window(), account: this.account() }),
    stream: ({ params }) => this.homeyApi.insightEntries(params.log, params.window, params.account),
  });
  protected readonly entries = computed<readonly HomeyInsightEntry[]>(() => (this.history.hasValue() ? this.history.value() : []));
}
