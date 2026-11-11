import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { HomeyInsightEntry, InsightResolution } from '@homey-dash/api-client';
import { formatReading } from './device-look';
import { STATISTIC_WINDOWS, StatisticChart, statisticFigures, statisticStamp } from './statistic-chart';
import { TranslatePipe } from '@homey-dash/i18n';

type StatisticWindow = (typeof STATISTIC_WINDOWS)[InsightResolution];

/**
 * The body of a statistic's full-screen view: the value now, or where the chart is scrubbed to, the chart, and the
 * lowest, highest, average and change of the window under it. What it projects shows between the chart and the
 * figures. It sits in the pane it belongs to.
 */
@Component({
  selector: 'hd-statistic-readings',
  imports: [StatisticChart, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (readout(); as readout) {
      <div class="hd-stat__readout">
        <div class="hd-value hd-value--xl">{{ readout.value }}<span class="hd-unit">{{ readout.units }}</span></div>
        <div class="hd-details__label">{{ pickedAt() ?? 'Now' }}</div>
      </div>
    }
    <hd-statistic-chart [entries]="entries()" [window]="window()" [scrub]="true" (picked)="picked.set($event)" />
    <ng-content />
    @if (figures(); as figures) {
      <dl class="hd-stat__figures">
        @for (f of figures; track f.label) {
          <div class="hd-stat__figure">
            <dt class="hd-details__label">{{ f.label | t }}</dt>
            <dd class="hd-stat__figure-value">{{ f.value }}</dd>
            @if (f.note) {
              <dd class="hd-stat__figure-note">{{ f.note }}</dd>
            }
          </div>
        }
      </dl>
    }
  `,
})
export class StatisticReadings {
  readonly entries = input.required<readonly HomeyInsightEntry[]>();
  readonly window = input.required<StatisticWindow>();
  readonly units = input<string | null>(null);

  /** The entry picked along the chart. */
  protected readonly picked = signal<HomeyInsightEntry | null>(null);
  protected readonly readout = computed(() => {
    const entry = this.picked() ?? [...this.entries()].reverse().find((e) => e.v !== null);
    return entry ? formatReading(entry.v as number, this.units()) : null;
  });
  protected readonly pickedAt = computed(() => {
    const picked = this.picked();
    return picked ? statisticStamp(picked.t, this.window().ms) : null;
  });
  protected readonly figures = computed(() => statisticFigures(this.entries(), this.window(), this.units()));
}
