import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HomeyApi, HomeyDevice, HomeyFlow, HomeyInsightLog, HomeyMood } from '@homey-dash/api-client';
import { TileData } from '@homey-dash/tiles';
import { forkJoin, switchMap, timer } from 'rxjs';

const REFRESH_MS = 10_000;

function byId<T extends { id: string }>(items: T[]): ReadonlyMap<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

/** Tile data for the editor and Preview, read from the API and refreshed every few seconds. */
@Injectable({ providedIn: 'root' })
export class RestTileData extends TileData {
  private readonly homey = inject(HomeyApi);

  readonly loaded = signal(false);
  readonly devices = signal<ReadonlyMap<string, HomeyDevice>>(new Map());
  readonly flows = signal<ReadonlyMap<string, HomeyFlow>>(new Map());
  readonly moods = signal<ReadonlyMap<string, HomeyMood>>(new Map());
  readonly insights = signal<ReadonlyMap<string, HomeyInsightLog>>(new Map());

  constructor() {
    super();
    const destroyed = inject(DestroyRef);

    // Insight logs are many and rarely change, so they load once.
    this.homey.insights().pipe(takeUntilDestroyed(destroyed)).subscribe({
      next: (logs) => this.insights.set(byId(logs)),
      error: () => undefined, // Homey unreachable: statistic tiles show as missing until a reload.
    });

    timer(0, REFRESH_MS)
      .pipe(
        switchMap(() => forkJoin([this.homey.devices(), this.homey.flows(), this.homey.moods()])),
        takeUntilDestroyed(destroyed),
      )
      .subscribe(([devices, flows, moods]) => {
        this.devices.set(byId(devices));
        this.flows.set(byId(flows));
        this.moods.set(byId(moods));
        this.loaded.set(true);
      });
  }
}
