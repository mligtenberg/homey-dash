import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import {
  HomeyApi,
  HomeyCatalog,
  HomeyDevice,
  HomeyFlow,
  HomeyFlowFolder,
  HomeyInsightLog,
  HomeyMood,
  HomeyStatus,
  HomeyZone,
  PhotoSet,
  Realtime,
} from '@homey-dash/api-client';
import { TileData } from './tile-data';

function byId<T extends { id: string }>(items: T[]): ReadonlyMap<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

/** Tile data from HomeyDash's realtime connection: a snapshot on every (re)connect, then each change as it happens. */
@Injectable({ providedIn: 'root' })
export class RealtimeTileData extends TileData {
  private readonly realtime = inject(Realtime);
  private readonly homey = inject(HomeyApi);

  readonly loaded = signal(false);
  readonly devices = signal<ReadonlyMap<string, HomeyDevice>>(new Map());
  readonly flows = signal<ReadonlyMap<string, HomeyFlow>>(new Map());
  readonly moods = signal<ReadonlyMap<string, HomeyMood>>(new Map());
  readonly insights = signal<ReadonlyMap<string, HomeyInsightLog>>(new Map());
  readonly zones = signal<ReadonlyMap<string, HomeyZone>>(new Map());
  readonly flowFolders = signal<ReadonlyMap<string, HomeyFlowFolder>>(new Map());
  readonly photoSets = signal<ReadonlyMap<string, PhotoSet>>(new Map());
  readonly photoSetsLoaded = signal(false);
  /** HomeyDash's connection to Homey; null until the first snapshot. */
  readonly status = signal<HomeyStatus | null>(null);

  // Changes that arrive while a snapshot loads wait for it, so the snapshot cannot undo them.
  private queued: (() => void)[] | null = null;
  private insightsLoaded = false;

  constructor() {
    super();
    const stops = [
      this.realtime.on('DeviceChanged', (device) =>
        this.apply(() => this.devices.update((devices) => new Map(devices).set(device.id, device))),
      ),
      this.realtime.on('DeviceRemoved', (id) =>
        this.apply(() =>
          this.devices.update((devices) => {
            const next = new Map(devices);
            next.delete(id);
            return next;
          }),
        ),
      ),
      // Homey sends its catalog once its data first arrives.
      this.realtime.on('Catalog', (catalog) =>
        this.apply(() => {
          this.setCatalog(catalog);
          this.loaded.set(true);
        }),
      ),
      this.realtime.on('HomeyStatus', (status) => this.apply(() => this.status.set(status))),
      this.realtime.on('PhotoSets', (sets) => this.setPhotoSets(sets)),
      this.realtime.whenConnected(() => this.load()),
      this.realtime.whenConnected(() => this.loadPhotoSets()),
    ];
    inject(DestroyRef).onDestroy(() => stops.forEach((stop) => stop()));
  }

  private apply(change: () => void) {
    if (this.queued) this.queued.push(change);
    else change();
  }

  private setCatalog({ flows, moods, zones, flowFolders }: HomeyCatalog) {
    this.flows.set(byId(flows));
    this.moods.set(byId(moods));
    this.zones.set(byId(zones));
    this.flowFolders.set(byId(flowFolders));
  }

  private setPhotoSets(sets: PhotoSet[]) {
    this.photoSets.set(new Map(sets.map((set) => [set.target, set])));
    this.photoSetsLoaded.set(true);
  }

  private async loadPhotoSets() {
    try {
      this.setPhotoSets(await this.realtime.photoSets());
    } catch {
      // The connection dropped again; the next reconnect loads them.
    }
  }

  private async load() {
    this.queued = [];
    try {
      const snapshot = await this.realtime.homey();
      this.status.set(snapshot.status);
      this.devices.set(byId(snapshot.devices));
      this.setCatalog(snapshot);
      this.loaded.set(snapshot.loaded);
    } catch {
      // The connection dropped again; the next reconnect loads it.
    } finally {
      const queued = this.queued ?? [];
      this.queued = null;
      queued.forEach((change) => change());
    }
    this.loadInsights();
  }

  // Insight logs are many and rarely change, so they load over REST until they once succeed.
  private loadInsights() {
    if (this.insightsLoaded) return;
    this.homey.insights().subscribe({
      next: (logs) => {
        this.insights.set(byId(logs));
        this.insightsLoaded = true;
      },
      error: () => undefined, // Homey unreachable: statistic tiles show as missing until the next connect.
    });
  }
}
