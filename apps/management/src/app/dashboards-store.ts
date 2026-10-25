import { inject, Injectable, signal } from '@angular/core';
import { DashboardDetail, DashboardsApi, DashboardSummary } from '@homey-dash/api-client';

/** The dashboard list in the sidebar, kept current as the editor saves and publishes. */
@Injectable({ providedIn: 'root' })
export class DashboardsStore {
  private readonly api = inject(DashboardsApi);

  readonly list = signal<DashboardSummary[]>([]);
  readonly loaded = signal(false);

  load() {
    this.api.list().subscribe((list) => {
      this.list.set(list);
      this.loaded.set(true);
    });
  }

  upsert({ id, name, publishedVersion, publishedAt, hasUnpublishedChanges }: DashboardDetail) {
    const summary = { id, name, publishedVersion, publishedAt, hasUnpublishedChanges };
    this.list.update((list) =>
      [...list.filter((d) => d.id !== id), summary].sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  remove(id: string) {
    this.list.update((list) => list.filter((d) => d.id !== id));
  }
}
