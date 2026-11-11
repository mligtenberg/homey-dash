import { ChangeDetectionStrategy, Component, computed, Directive, inject } from '@angular/core';
import { Realtime } from '@homey-dash/api-client';
import { LucidePlay, LucideSparkles, LucideWorkflow } from '@homey-dash/design-system';
import { LucideDynamicIcon } from '@lucide/angular';
import { moodTint } from './mood-tint';
import { TILE_FACE_HOST, TileFace, TileView } from './tile-view';
import { TranslatePipe } from '@homey-dash/i18n';

// The corner button runs the target. There is no detail view: it could only repeat that button.
const ACTION_TEMPLATE = `
  <div class="hd-row hd-row--top">
    <svg class="hd-icon" [lucideIcon]="face().icon" />
    @if (face().action; as action) {
      <button type="button" class="hd-round-btn hd-tile__action hd-tile__action--run"[attr.aria-label]="action" (click)="act()">
        <svg [lucideIcon]="playIcon" />
      </button>
    }
  </div>
  <div>
    <div class="hd-tile__name">{{ face().name | t }}</div>
    <div class="hd-tile__detail">{{ face().detail | t }}</div>
  </div>
`;

/** A tile that runs its target once per press and briefly confirms it; flows and moods have no state to show. */
@Directive()
abstract class ActionTile extends TileView {
  protected readonly realtime = inject(Realtime);

  /** The action's label: `Start`, `Activate`. */
  protected abstract readonly verb: string;
  protected readonly playIcon = LucidePlay;

  protected abstract run(target: string): Promise<unknown>;

  protected override act() {
    const target = this.settings().target;
    if (target) this.send(() => this.run(target), 'early');
  }

  protected withFlash(face: TileFace, done: string, failed: string): TileFace {
    if (face.state !== 'ok') return face;
    const flash = this.flash();
    return { ...face, action: this.verb, detail: flash === 'ok' ? done : flash === 'error' ? failed : face.detail };
  }
}

@Component({
  selector: 'hd-flow-tile',
  imports: [LucideDynamicIcon, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: TILE_FACE_HOST,
  template: ACTION_TEMPLATE,
})
export class FlowTile extends ActionTile {
  protected readonly verb = 'Start';

  readonly face = computed<TileFace>(() => {
    const flow = this.homey()?.flows.get(this.settings().target ?? '');
    const base = { icon: LucideWorkflow, hue: 'flow' as const };
    if (!flow) return this.absentFace({ ...base, noun: 'Flow' });
    const face: TileFace = { ...base, name: this.settings().label || flow.name, detail: flow.enabled ? 'Flow' : 'Flow · turned off', state: 'ok' };
    return this.withFlash(face, 'Started', 'Could not start');
  });

  protected run(target: string) {
    return this.realtime.triggerFlow(this.settings().account, target);
  }
}

/** The tile is washed in its mood's colours, and glows in them while it confirms; its kind has no detail view. */
@Component({
  selector: 'hd-mood-tile',
  imports: [LucideDynamicIcon, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    ...TILE_FACE_HOST,
    '[class.has-tint]': '!!tint()',
    '[style.--tile-tint]': 'tint()',
  },
  template: ACTION_TEMPLATE,
})
export class MoodTile extends ActionTile {
  protected readonly verb = 'Activate';

  protected readonly tint = computed(() => {
    const mood = this.homey()?.moods.get(this.settings().target ?? '');
    return mood ? moodTint(mood.colors) : null;
  });

  readonly face = computed<TileFace>(() => {
    const mood = this.homey()?.moods.get(this.settings().target ?? '');
    const base = { icon: LucideSparkles, hue: 'mood' as const };
    if (!mood) return this.absentFace({ ...base, noun: 'Mood' });
    const face: TileFace = { ...base, name: this.settings().label || mood.name, detail: 'Mood', state: 'ok' };
    return this.withFlash(face, 'Activated', 'Could not activate');
  });

  protected run(target: string) {
    return this.realtime.activateMood(this.settings().account, target);
  }
}
