import { ChangeDetectionStrategy, Component, computed, Directive, inject } from '@angular/core';
import { Realtime } from '@homey-dash/api-client';
import { LucideDynamicIcon, LucideSparkles, LucideWorkflow } from '@lucide/angular';
import { TILE_FACE_HOST, TILE_FACE_TEMPLATE, TileFace, TileView } from './tile-view';

/** A tile that runs its target once per press and briefly confirms it; flows and moods have no state to show. */
@Directive()
abstract class ActionTile extends TileView {
  protected readonly realtime = inject(Realtime);

  protected abstract run(target: string): Promise<unknown>;

  protected override tap() {
    const target = this.settings().target;
    if (target) this.send(() => this.run(target), 'early');
  }

  protected withFlash(face: TileFace, done: string, failed: string): TileFace {
    if (face.state !== 'ok') return face;
    const flash = this.flash();
    return { ...face, tappable: true, detail: flash === 'ok' ? done : flash === 'error' ? failed : face.detail };
  }
}

@Component({
  selector: 'hd-flow-tile',
  imports: [LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: TILE_FACE_HOST,
  template: TILE_FACE_TEMPLATE,
})
export class FlowTile extends ActionTile {
  readonly face = computed<TileFace>(() => {
    const flow = this.data.flows().get(this.settings().target ?? '');
    const base = { icon: LucideWorkflow, hue: 'flow' as const };
    if (!flow) return this.absentFace({ ...base, noun: 'Flow' });
    const face: TileFace = { ...base, name: this.settings().label || flow.name, detail: flow.enabled ? 'Flow' : 'Flow · turned off', state: 'ok' };
    return this.withFlash(face, 'Started', 'Could not start');
  });

  protected run(target: string) {
    return this.realtime.triggerFlow(target);
  }
}

@Component({
  selector: 'hd-mood-tile',
  imports: [LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: TILE_FACE_HOST,
  template: TILE_FACE_TEMPLATE,
})
export class MoodTile extends ActionTile {
  readonly face = computed<TileFace>(() => {
    const mood = this.data.moods().get(this.settings().target ?? '');
    const base = { icon: LucideSparkles, hue: 'mood' as const };
    if (!mood) return this.absentFace({ ...base, noun: 'Mood' });
    const face: TileFace = { ...base, name: this.settings().label || mood.name, detail: 'Mood', state: 'ok' };
    return this.withFlash(face, 'Activated', 'Could not activate');
  });

  protected run(target: string) {
    return this.realtime.activateMood(target);
  }
}
