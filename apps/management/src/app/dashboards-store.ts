import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { DashboardDetail, DashboardsApi, DashboardSummary, Realtime } from '@homey-dash/api-client';

/**
 * The dashboard list in the sidebar. The editor updates it as it saves and publishes; changes made elsewhere,
 * such as in another Management window, arrive over the realtime connection.
 */
@Injectable({ providedIn: 'root' })
export class DashboardsStore {
  private readonly api = inject(DashboardsApi);
  private readonly realtime = inject(Realtime);

  readonly list = signal<DashboardSummary[]>([]);
  readonly loaded = signal(false);

  constructor() {
    const stops = [
      this.realtime.on('Dashboards', (list) => this.list.set(list)),
      // Joining again after a reconnect, and reloading what was missed while the connection was down.
      this.realtime.whenConnected(() => {
        this.realtime.joinManagement().then(() => this.load(), () => undefined);
      }),
    ];
    inject(DestroyRef).onDestroy(() => stops.forEach((stop) => stop()));
  }

  load() {
    this.api.list().subscribe((list) => {
      this.list.set(list);
      this.loaded.set(true);
    });
  }

  upsert({ id, name, publishedVersion, publishedAt, hasUnpublishedChanges, missingTiles }: DashboardDetail) {
    const summary = { id, name, publishedVersion, publishedAt, hasUnpublishedChanges, missingTiles };
    this.list.update((list) =>
      [...list.filter((d) => d.id !== id), summary].sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  remove(id: string) {
    this.list.update((list) => list.filter((d) => d.id !== id));
  }
}
