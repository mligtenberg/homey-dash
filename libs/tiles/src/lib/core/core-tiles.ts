import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { LucideChartLine, LucideDynamicIcon, LucideSparkles, LucideWorkflow } from '@lucide/angular';
import { TileSettings } from '../tile-data';
import { TileModule } from '../tile-kind';
import { deviceDetail, deviceLook } from './device-look';
import { TILE_FACE_HOST, TILE_FACE_TEMPLATE, TileFace, TileView } from './tile-view';

// The tile kinds HomeyDash ships with. These are the basic versions the editor places; controls,
// tap actions and the statistic chart follow in slice 6.

@Component({
  selector: 'hd-device-tile',
  imports: [LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: TILE_FACE_HOST,
  template: TILE_FACE_TEMPLATE,
})
export class DeviceTile extends TileView {
  readonly face = computed<TileFace>(() => {
    const device = this.data.devices().get(this.settings().target ?? '');
    const look = deviceLook(device);
    if (!device) return this.absentFace({ ...look, noun: 'Device' });
    const { detail, active } = deviceDetail(device);
    return { ...look, name: this.settings().label || device.name, detail, active, state: device.available ? 'ok' : 'unavailable' };
  });
}

@Component({
  selector: 'hd-flow-tile',
  imports: [LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: TILE_FACE_HOST,
  template: TILE_FACE_TEMPLATE,
})
export class FlowTile extends TileView {
  readonly face = computed<TileFace>(() => {
    const flow = this.data.flows().get(this.settings().target ?? '');
    const base = { icon: LucideWorkflow, hue: 'flow' as const };
    if (!flow) return this.absentFace({ ...base, noun: 'Flow' });
    return { ...base, name: this.settings().label || flow.name, detail: flow.enabled ? 'Flow' : 'Flow · turned off', state: 'ok' };
  });
}

@Component({
  selector: 'hd-mood-tile',
  imports: [LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: TILE_FACE_HOST,
  template: TILE_FACE_TEMPLATE,
})
export class MoodTile extends TileView {
  readonly face = computed<TileFace>(() => {
    const mood = this.data.moods().get(this.settings().target ?? '');
    const base = { icon: LucideSparkles, hue: 'mood' as const };
    if (!mood) return this.absentFace({ ...base, noun: 'Mood' });
    return { ...base, name: this.settings().label || mood.name, detail: 'Mood', state: 'ok' };
  });
}

@Component({
  selector: 'hd-statistic-tile',
  imports: [LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: TILE_FACE_HOST,
  template: TILE_FACE_TEMPLATE,
})
export class StatisticTile extends TileView {
  readonly face = computed<TileFace>(() => {
    const log = this.data.insights().get(this.settings().target ?? '');
    const base = { icon: LucideChartLine, hue: 'energy' as const };
    if (!log) return this.absentFace({ ...base, noun: 'Statistic' });
    const name = this.settings().label || [log.ownerName, log.title].filter(Boolean).join(' · ');
    return { ...base, name, detail: log.units ? `${log.title} in ${log.units}` : log.title, state: 'ok' };
  });
}

const empty: TileSettings = { target: null };

export const CORE_TILES: TileModule = {
  name: 'Core',
  kinds: [
    { id: 'device', label: 'Device tile', target: 'device', sizes: ['small', 'wide', 'large'], defaultSettings: empty, component: DeviceTile },
    { id: 'flow', label: 'Flow tile', target: 'flow', sizes: ['small', 'wide'], defaultSettings: empty, component: FlowTile },
    { id: 'mood', label: 'Mood tile', target: 'mood', sizes: ['small', 'wide'], defaultSettings: empty, component: MoodTile },
    {
      id: 'statistic',
      label: 'Statistic tile',
      target: 'insight',
      sizes: ['wide', 'full', 'large', 'full-large'],
      defaultSettings: empty,
      component: StatisticTile,
    },
  ],
};
