import { inject, Injectable, signal } from '@angular/core';
import { HomeyApi, HomeyCatalog, HomeySnapshot, PhotoSet, Realtime, stopOnDestroy } from '@homey-dash/api-client';
import { HomeyData, TileData } from './tile-data';

function byId<T extends { id: string }>(items: T[]): ReadonlyMap<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function catalog({ flows, moods, zones, flowFolders }: Omit<HomeyCatalog, 'accountId'>) {
  return { flows: byId(flows), moods: byId(moods), zones: byId(zones), flowFolders: byId(flowFolders) };
}

/** Tile data from HomeyDash's realtime connection: a snapshot on every (re)connect, then each change as it happens. */
@Injectable({ providedIn: 'root' })
export class RealtimeTileData extends TileData {
  private readonly realtime = inject(Realtime);
  private readonly homeyApi = inject(HomeyApi);

  readonly homeys = signal<readonly HomeyData[] | null>(null);
  readonly photoSets = signal<ReadonlyMap<string, PhotoSet>>(new Map());
  readonly photoSetsLoaded = signal(false);

  // Changes that arrive while a snapshot loads wait for it, so the snapshot cannot undo them.
  private queued: (() => void)[] | null = null;
  // Accounts whose insight logs loaded, or are loading.
  private readonly insightsLoaded = new Set<number>();

  constructor() {
    super();
    stopOnDestroy(
      this.realtime.on('Homeys', (snapshots) => this.apply(() => this.setHomeys(snapshots))),
      this.realtime.on('DeviceChanged', ({ accountId, device }) =>
        this.apply(() => this.change(accountId, (h) => ({ ...h, devices: new Map(h.devices).set(device.id, device) }))),
      ),
      this.realtime.on('DeviceRemoved', ({ accountId, deviceId }) =>
        this.apply(() =>
          this.change(accountId, (h) => {
            const devices = new Map(h.devices);
            devices.delete(deviceId);
            return { ...h, devices };
          }),
        ),
      ),
      // A Homey sends its catalog once its data first arrives.
      this.realtime.on('Catalog', (message) =>
        this.apply(() => this.change(message.accountId, (h) => ({ ...h, ...catalog(message), loaded: true }))),
      ),
      this.realtime.on('Weather', ({ accountId, weather }) => this.apply(() => this.change(accountId, (h) => ({ ...h, weather })))),
      this.realtime.on('Energy', ({ accountId, energy }) => this.apply(() => this.change(accountId, (h) => ({ ...h, energy })))),
      this.realtime.on('HomeyStatus', (status) =>
        this.apply(() => {
          this.change(status.accountId, (h) => ({ ...h, status }));
          if (status.connection === 'connected') this.loadInsights(status.accountId);
        }),
      ),
      this.realtime.on('PhotoSets', (sets) => this.setPhotoSets(sets)),
      this.realtime.whenConnected(() => this.load()),
      this.realtime.whenConnected(() => this.loadPhotoSets()),
    );
  }

  private apply(change: () => void) {
    if (this.queued) this.queued.push(change);
    else change();
  }

  private change(accountId: number, change: (homey: HomeyData) => HomeyData) {
    this.homeys.update((homeys) => homeys?.map((h) => (h.accountId === accountId ? change(h) : h)) ?? null);
  }

  // Insight logs already loaded stay, for they don't come with the snapshot.
  private setHomeys(snapshots: HomeySnapshot[]) {
    const before = new Map((this.homeys() ?? []).map((h) => [h.accountId, h]));
    this.homeys.set(
      snapshots.map((s) => ({
        accountId: s.accountId,
        accountName: s.accountName,
        status: s.status,
        loaded: s.loaded,
        devices: byId(s.devices),
        ...catalog(s),
        weather: s.weather ?? null,
        energy: s.energy ?? null,
        insights: before.get(s.accountId)?.insights ?? new Map(),
      })),
    );
    for (const id of this.insightsLoaded) if (!snapshots.some((s) => s.accountId === id)) this.insightsLoaded.delete(id);
    snapshots.forEach((s) => this.loadInsights(s.accountId));
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
      this.setHomeys(await this.realtime.homey());
    } catch {
      // The connection dropped again; the next reconnect loads it.
    } finally {
      const queued = this.queued ?? [];
      this.queued = null;
      queued.forEach((change) => change());
    }
  }

  // Insight logs are many and rarely change, so they load over REST, per Homey, until they once succeed.
  private loadInsights(accountId: number) {
    if (this.insightsLoaded.has(accountId)) return;
    this.insightsLoaded.add(accountId);
    this.homeyApi.insights(accountId).subscribe({
      next: (logs) => this.change(accountId, (h) => ({ ...h, insights: byId(logs) })),
      // Homey unreachable: statistic tiles show as missing until it connects again.
      error: () => this.insightsLoaded.delete(accountId),
    });
  }
}
