import { Transport } from './transport';
import { brokenImages } from './loadable-art';
import { Segmented } from './segmented';
import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, resource, signal, viewChild } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { CapabilityValue, DeviceApp, HomeyApi, InsightResolution, Realtime } from '@homey-dash/api-client';
import { LucideDynamicIcon, LucideIconInput } from '@lucide/angular';
import { catchError, forkJoin, map, of } from 'rxjs';
import { TileData } from '../tile-data';
import { DeviceApps } from './device-apps';
import { CapabilityDriver, COVER_STATES, DeviceRemote, DeviceSegments, DeviceSlider, DeviceStepper } from './device-controls';
import { clamp, clockTime, describeDevice, deviceLogs, sameLogs } from './device-view';
import { StatisticHistory } from './statistic-history';
import { TileDetails } from './tile-details';
import { flasher } from './tile-view';
import { LucideLock, LucideLockOpen, LucideSpeaker, LucideVolume2, LucideVolumeX, clock } from '@homey-dash/design-system';


const ON_OFF_STATES = [
  { value: false, label: 'Off' },
  { value: true, label: 'On' },
];

const LOCK_STATES = [
  { value: true, label: 'Lock' },
  { value: false, label: 'Unlock' },
];

/**
 * A device's detail view, full screen, with a design for what kind of device it is and, when it has numeric readings
 * with something to draw, a second page with their history. The device tile and a statistic tile of one of its readings
 * both open it; the statistic tile opens it on that reading's history.
 */
@Component({
  selector: 'hd-device-details',
  imports: [LucideDynamicIcon, NgTemplateOutlet, Segmented, Transport, DeviceApps, DeviceRemote, DeviceSegments, DeviceSlider, DeviceStepper, StatisticHistory, TileDetails],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Not a box of its own, so it does not take part in the tile's layout.
  host: { style: 'display: contents' },
  template: `
    <hd-tile-details #dialog [screen]="true" [name]="name()" [icon]="icon()" [subtitle]="view()?.room ?? ''" (closed)="page.set('device')">
      @if (pages().length > 1) {
        <hd-segmented hdDetailsHead label="Show" [options]="pages()" [value]="page()" (picked)="page.set($event)" />
      }
      @if (probing()) {
        <div class="hd-details__label">Loading…</div>
      } @else if (page() === 'history' && graphable().length) {
        <hd-statistic-history [logs]="graphable()" [account]="account()" [initial]="log()" [initialWindow]="window()" />
      } @else if (page() === 'apps' && appList().length) {
        <hd-device-apps [account]="account()" [deviceId]="deviceId()" [apps]="appList()" [current]="view()?.app ?? ''" [disabled]="!ok()" />
      } @else if (view(); as c) {
        <div class="hd-dev" [attr.data-mode]="c.mode" [class.is-on]="c.on" [style.--level]="c.level" [style.--fraction]="c.fraction" [style.--closed]="c.closed">
          <section class="hd-dev__hero">
            @switch (c.mode) {
              @case ('light') {
                <div class="hd-dev__disc"><svg class="hd-dev__glyph" [lucideIcon]="icon()" /></div>
                <div class="hd-dev__big">
                  @if (c.dim; as dim) {
                    {{ c.on ? drive.percent(dim) : 0 }}<span class="hd-unit">%</span>
                  } @else {
                    {{ c.on ? 'On' : 'Off' }}
                  }
                </div>
              }
              @case ('climate') {
                <div class="hd-dev__dial">
                  <div class="hd-dev__dial-inner">
                    @if (c.measured ?? c.target; as main) {
                      <div class="hd-value hd-value--l">{{ main.value }}<span class="hd-unit">{{ main.units }}</span></div>
                    }
                    @if (c.target; as target) {
                      <div class="hd-details__label">Set to {{ target.value }}{{ target.units }}</div>
                    }
                  </div>
                </div>
              }
              @case ('cover') {
                <div class="hd-dev__window"><div class="hd-dev__shade"></div></div>
                <div class="hd-dev__big">{{ c.coverText }}</div>
              }
              @case ('speaker') {
                <div class="hd-dev__art">
                  @if (c.art; as art) {
                    @if (!images.has(art)) {
                      <img [src]="art" alt="" draggable="false" (error)="images.mark(art)" />
                    } @else {
                      <svg class="hd-dev__glyph" [lucideIcon]="speakerIcon" />
                    }
                  } @else {
                    <svg class="hd-dev__glyph" [lucideIcon]="speakerIcon" />
                  }
                </div>
                @if (c.remote) {
                  <ng-container [ngTemplateOutlet]="titles" [ngTemplateOutletContext]="{ $implicit: c, progress: progress() }" />
                }
              }
              @case ('lock') {
                <div class="hd-dev__disc"><svg class="hd-dev__glyph" [lucideIcon]="c.locked ? lockIcon : unlockIcon" /></div>
                <div class="hd-dev__big">{{ c.locked ? 'Locked' : 'Unlocked' }}</div>
              }
              @default {
                <div class="hd-dev__disc"><svg class="hd-dev__glyph" [lucideIcon]="icon()" /></div>
              }
            }
            @if (c.state && c.showState) {
              <div class="hd-details__state">{{ c.state }}</div>
            }
          </section>
          <section class="hd-dev__controls">
            @if (c.mode === 'speaker') {
              @if (!c.remote) {
                <ng-container [ngTemplateOutlet]="titles" [ngTemplateOutletContext]="{ $implicit: c, progress: progress() }" />
              }
              @if (c.playback; as playing) {
                @if (!c.remote || c.previous || c.next) {
                  <hd-transport
                    class="hd-dev__transport"
                    playClass="hd-dev__play"
                    [playing]="!!playing.value"
                    [previous]="!!c.previous"
                    [next]="!!c.next"
                    [disabled]="!ok()"
                    (toggled)="drive.set(playing.id, !playing.value)"
                    (skippedBack)="c.previous && drive.set(c.previous.id, true)"
                    (skippedForward)="c.next && drive.set(c.next.id, true)"
                  />
                }
              }
            }
            @if (c.volume; as volume) {
              <div class="hd-dev__level">
                <svg class="hd-dev__level-icon" [lucideIcon]="volumeIcon" />
                <hd-device-slider [capability]="volume" label="Volume" [disabled]="!ok()" [driver]="drive" />
                @if (c.mute; as mute) {
                  <button
                    type="button"
                    class="hd-round-btn hd-dev__mute"
                    aria-label="Mute"
                    [attr.aria-pressed]="mute.value === true"
                    [disabled]="!ok()"
                    (click)="drive.press(mute)"
                  >
                    <svg [lucideIcon]="muteIcon" />
                  </button>
                }
                <span class="hd-details__label">{{ drive.percent(volume) }}%</span>
              </div>
            }
            @if (c.remote || c.volumeKeys || c.channel) {
              <hd-device-remote [remote]="c.remote" [volume]="c.volumeKeys" [channel]="c.channel" [playsElsewhere]="!!c.playback" [playback]="c.remote && !c.previous && !c.next ? c.playback ?? null : null" [disabled]="!ok()" [driver]="drive" />
            }
            @if (c.lock; as lock) {
              <hd-device-segments [capability]="lock" [options]="lockStates" [disabled]="!ok()" [driver]="drive" />
            }
            @if (c.onoff; as onoff) {
              <hd-device-segments [capability]="onoff" [options]="onOffStates" [disabled]="!ok()" [driver]="drive" />
            }
            @if (c.dim; as dim) {
              <div class="hd-dev__level">
                <span class="hd-details__label">Brightness</span>
                <hd-device-slider [capability]="dim" [label]="brightnessLabel()" [disabled]="!ok()" [driver]="drive" />
                @if (c.mode !== 'light') {
                  <span class="hd-details__label">{{ drive.percent(dim) }}%</span>
                }
              </div>
            }
            @if (c.thermostat; as target) {
              <div class="hd-dev__stepper">
                <hd-device-stepper [capability]="target" [disabled]="!ok()" [driver]="drive" />
              </div>
            }
            @if (c.cover; as cover) {
              <hd-device-segments [capability]="cover" [options]="coverStates" [disabled]="!ok()" [driver]="drive" />
            }
            @if (c.position; as position) {
              <div class="hd-dev__level">
                <span class="hd-details__label">Open</span>
                <hd-device-slider [capability]="position" label="Open" [disabled]="!ok()" [driver]="drive" />
                <span class="hd-details__label">{{ drive.percent(position) }}%</span>
              </div>
            }
            @if (c.alarms.length) {
              <ul class="hd-dev__alarms">
                @for (alarm of c.alarms; track alarm.id) {
                  <li [class.is-alarm]="alarm.active">
                    <span class="hd-details__label">{{ alarm.title }}</span>
                    <span>{{ alarm.text }}</span>
                  </li>
                }
              </ul>
            }
            @if (c.readings.length) {
              <dl class="hd-details__readings hd-dev__figures">
                @for (reading of c.readings; track reading.id) {
                  <div class="hd-dev__figure">
                    <dt class="hd-details__label">{{ reading.title }}</dt>
                    <dd>{{ reading.value }}<span class="hd-unit">{{ reading.units }}</span></dd>
                  </div>
                }
              </dl>
            }
          </section>
        </div>
      }
      <ng-template #titles let-c let-progress="progress">
        <div class="hd-dev__titles">
          <div class="hd-dev__big">{{ c.track || c.state }}</div>
          @if (c.artist) {
            <div class="hd-dev__artist">{{ c.artist }}</div>
          }
          @if (c.track && c.state) {
            <div class="hd-details__state">{{ c.playing ? 'Playing' : 'Not playing' }}</div>
          }
          @if (progress) {
            <div class="hd-dev__progress" role="progressbar" aria-label="Playback" aria-valuemin="0" [attr.aria-valuemax]="progress.duration" [attr.aria-valuenow]="progress.position">
              <div class="hd-progress"><div class="hd-progress__bar" [style.width.%]="progress.fraction * 100"></div></div>
              <div class="hd-dev__progress-times"><span>{{ progress.elapsed }}</span><span>{{ progress.total }}</span></div>
            </div>
          }
        </div>
      </ng-template>
    </hd-tile-details>
  `,
})
export class DeviceDetails {
  private readonly data = inject(TileData);
  private readonly realtime = inject(Realtime);
  private readonly homeyApi = inject(HomeyApi);

  readonly account = input<number>();
  readonly deviceId = input.required<string>();
  readonly name = input.required<string>();
  readonly icon = input.required<LucideIconInput>();
  /** The log its history opens on, when it has one for it. */
  readonly log = input<string>();
  /** The time window its history opens on. */
  readonly window = input<InsightResolution>('last24Hours');

  private readonly dialog = viewChild.required(TileDetails);
  readonly isOpen = computed(() => this.dialog().isOpen());

  protected readonly coverStates = COVER_STATES;
  protected readonly onOffStates = ON_OFF_STATES;
  protected readonly lockStates = LOCK_STATES;
  /** The pages there are to show: always the device, and its apps and the history of its readings when it has them. */
  protected readonly pages = computed(() => [
    { id: 'device' as const, label: 'Device' },
    ...(this.appList().length ? [{ id: 'apps' as const, label: 'Apps' }] : []),
    ...(this.graphable().length ? [{ id: 'history' as const, label: 'History' }] : []),
  ]);
  /** Which page shows: the device's state and controls, its apps, or the history of its readings. */
  protected readonly page = signal<'device' | 'apps' | 'history'>('device');
  protected readonly volumeIcon = LucideVolume2;
  protected readonly muteIcon = LucideVolumeX;
  protected readonly speakerIcon = LucideSpeaker;
  /** The cover that did not load, so the speaker's icon shows instead of a broken picture. */
  protected readonly images = brokenImages();
  protected readonly lockIcon = LucideLock;
  protected readonly unlockIcon = LucideLockOpen;

  private readonly homey = computed(() => this.data.homey(this.account()));
  private readonly device = computed(() => this.homey()?.devices.get(this.deviceId()));
  protected readonly brightnessLabel = computed(() => `${this.name()} brightness`);
  protected readonly ok = computed(() => this.device()?.available ?? false);

  /** Whether the last command went unanswered, for a moment. */
  private readonly failure = flasher<true>();

  protected readonly view = computed(() => {
    const device = this.device();
    return device ? describeDevice(device, this.homey()?.accountId, !!this.failure.value()) : null;
  });

  /** The time now, ticking while the view is open, so that what plays moves on between the device's reports. */
  private readonly clock = clock(1000, () => this.isOpen());

  /** How far what plays has come, moved on by the time since the device last said. */
  protected readonly progress = computed(() => {
    const p = this.view()?.progress;
    if (!p) return null;
    const position = clamp(p.position + (p.playing && p.updated ? (this.clock() - p.updated) / 1000 : 0), 0, p.duration);
    return { position, duration: p.duration, fraction: position / p.duration, elapsed: clockTime(position), total: clockTime(p.duration) };
  });

  protected readonly drive = new CapabilityDriver((capability, value) => this.set(capability, value));

  /** The insight logs of the device's readings that can be charted. */
  readonly logs = computed(() => deviceLogs(this.homey()?.insights, this.deviceId()), { equal: sameLogs });

  /** Which of those logs have something to draw, found while open: two values in the last 31 days. */
  protected readonly drawn = rxResource({
    params: () => (this.isOpen() && this.logs().length ? { logs: this.logs(), account: this.account() } : undefined),
    stream: ({ params }) =>
      forkJoin(
        params.logs.map((log) =>
          this.homeyApi.insightEntries(log.id, 'last31Days', params.account).pipe(
            map((entries) => entries.filter((e) => e.v !== null).length >= 2),
            catchError(() => of(false)),
          ),
        ),
      ).pipe(map((has) => params.logs.filter((_, i) => has[i]))),
  });

  /** The apps the device can open, asked for once its view is open; none when it opens none. */
  private readonly apps = resource({
    params: () => (this.isOpen() ? { account: this.account(), deviceId: this.deviceId() } : undefined),
    loader: ({ params }) => this.realtime.deviceApps(params.account, params.deviceId).catch((): DeviceApp[] => []),
  });
  protected readonly appList = computed(() => (this.apps.hasValue() ? this.apps.value() : []));

  /** The logs the history offers; none until they are known, so the tab shows only when there is a graph. */
  protected readonly graphable = computed(() => (this.drawn.hasValue() ? this.drawn.value() : []));
  /** Whether the history was asked for but it is not known yet which logs it has. */
  protected readonly probing = computed(() => this.page() === 'history' && this.logs().length > 0 && !this.drawn.hasValue());

  constructor() {
    inject(DestroyRef).onDestroy(() => this.drive.holdEnd());
  }

  open(page: 'device' | 'history' = 'device') {
    this.page.set(page);
    this.dialog().open();
  }

  close() {
    this.drive.holdEnd();
    this.dialog().close();
  }

  private async set(capability: string, value: CapabilityValue) {
    try {
      await this.realtime.setCapability(this.account(), this.deviceId(), capability, value);
    } catch {
      this.failure.show(true);
    }
  }
}
