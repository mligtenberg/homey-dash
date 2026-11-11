import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { SettingSelect } from '../core/setting-select';
import { TileData, TileSettings } from '../tile-data';
import { TranslatePipe } from '@homey-dash/i18n';

export interface SonosTileSettings extends TileSettings {
  /** The id of the room the tile is locked to; absent leaves the tile free to switch rooms. */
  lock?: string;
}

/** Management's choice of the room a Sonos tile is locked to. */
@Component({
  selector: 'hd-sonos-tile-settings',
  imports: [SettingSelect, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hd-setting-select
      [label]="'Locked to' | t"
      selectId="tile-lock"
      emptyLabel="Not locked (pick a room on the tile)"
      [options]="rooms()"
      [value]="isRoom(settings().lock) ? settings().lock : ''"
      (picked)="pick($event)"
    />
  `,
})
export class SonosTileSettingsEditor {
  readonly settings = input.required<SonosTileSettings>();
  readonly changed = output<Partial<SonosTileSettings>>();

  private readonly data = inject(TileData);

  protected readonly rooms = computed(() => {
    const devices = this.data.homey(this.settings().account)?.devices;
    return (this.settings().targets ?? []).map((id) => ({
      value: id,
      label: devices?.get(id)?.name ?? 'Not found',
    }));
  });

  protected isRoom(id: string | undefined) {
    return !!id && (this.settings().targets ?? []).includes(id);
  }

  protected pick(id: string) {
    this.changed.emit({ lock: id || undefined });
  }
}
