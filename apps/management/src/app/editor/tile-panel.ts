import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  inputBinding,
  output,
  outputBinding,
  untracked,
  viewChild,
  ViewContainerRef,
} from '@angular/core';
import { Tile } from '@homey-dash/api-client';
import { TileSize } from '@homey-dash/layout';
import { LucideChartLine, LucideSparkles, LucideWorkflow } from '@lucide/angular';
import { deviceLook, deviceType, TileData, TileKind, TileSettings } from '@homey-dash/tiles';
import { PhotoSetField } from './photo-set-field';
import { PlexTargetField } from './plex-target-field';
import { SizePicker } from './size-picker';
import { TargetPicker } from './target-picker';
import { allOptions, buildTree, TargetNode } from './target-tree';

/** Settings of the selected tile: its target, its kind's own settings, label and size. */
@Component({
  selector: 'hd-tile-panel',
  imports: [PhotoSetField, PlexTargetField, SizePicker, TargetPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2>{{ kind()?.label ?? 'Unknown tile' }}</h2>

    @if (kind(); as kind) {
      @if (kind.target === 'photoSet') {
        <hd-photo-set-field [value]="settings().target" (picked)="setTarget($event)" />
      } @else if (kind.target === 'plexPlayer' || kind.target === 'plexLibrary') {
        <hd-plex-target-field [type]="kind.target" [value]="settings().target" (picked)="setTarget($event)" />
      } @else if (kind.multiple) {
        <div class="hd-field">
          <label class="hd-field__label" for="tile-target">{{ targetsLabel() }}</label>
          @for (picked of pickedTargets(); track picked.id; let i = $index, last = $last) {
            <div class="picked">
              <span class="picked__name" [class.missing]="!picked.found">{{ picked.label }}</span>
              <button type="button" class="hd-btn" [attr.aria-label]="'Move ' + picked.label + ' up'" [disabled]="i === 0" (click)="moveTarget(i, -1)">↑</button>
              <button type="button" class="hd-btn" [attr.aria-label]="'Move ' + picked.label + ' down'" [disabled]="last" (click)="moveTarget(i, 1)">↓</button>
              <button type="button" class="hd-btn" [attr.aria-label]="'Remove ' + picked.label" (click)="removeTarget(i)">✕</button>
            </div>
          }
          <hd-target-picker
            pickerId="tile-target"
            [tree]="targets()"
            [value]="null"
            [noun]="targetNoun()"
            [groupNoun]="kind.target === 'flow' ? 'Folder' : 'Zone'"
            (picked)="addTarget($event)"
          />
        </div>
      } @else {
        <div class="hd-field">
          <label class="hd-field__label" for="tile-target">Target</label>
          <hd-target-picker
            pickerId="tile-target"
            [tree]="targets()"
            [value]="settings().target"
            [noun]="targetNoun()"
            [groupNoun]="kind.target === 'flow' ? 'Folder' : 'Zone'"
            (picked)="setTarget($event)"
          />
        </div>
      }

      <ng-container #kindSettings />

      <div class="hd-field">
        <label class="hd-field__label" for="tile-label">Label</label>
        <input
          id="tile-label"
          class="hd-input"
          [value]="settings().label ?? ''"
          [placeholder]="labelPlaceholder()"
          (change)="setLabel($any($event.target).value)"
        />
      </div>

      <div class="hd-field">
        <span class="hd-field__label">Size</span>
        <hd-size-picker [value]="tile().size" [enabled]="sizeEnabled()" (picked)="resized.emit($event)" />
      </div>
    } @else {
      <p class="muted">No installed module registers the kind "{{ tile().kind }}". It shows as missing until you remove it.</p>
    }

    <button type="button" class="hd-btn hd-btn--danger remove" (click)="removed.emit()">Remove tile</button>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--space-4); }
    h2 { font-size: 16px; font-weight: 800; margin: 0; }
    .muted { color: var(--ink-muted); margin: 0; }
    .remove { align-self: flex-start; margin-top: var(--space-2); }
    .picked { display: flex; align-items: center; gap: var(--space-1); }
    .picked__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .picked__name.missing { color: var(--danger); }
    .picked .hd-btn { padding-inline: 10px; }
  `,
})
export class TilePanel {
  readonly tile = input.required<Tile>();
  readonly kind = input.required<TileKind | undefined>();
  /** Whether the tile could take a size at its position. */
  readonly fitsSize = input.required<(size: TileSize) => boolean>();

  readonly settingsChanged = output<TileSettings>();
  readonly resized = output<TileSize>();
  readonly removed = output<void>();

  private readonly data = inject(TileData);

  protected readonly settings = computed(() => this.tile().settings as TileSettings);

  protected readonly targetNoun = computed(
    () =>
      ({ device: 'device', flow: 'flow', mood: 'mood', insight: 'recorded value', photoSet: 'photo set', plexPlayer: 'player', plexLibrary: 'library' })[this.kind()?.target ?? 'device'],
  );

  /** What a kind that takes several targets calls them: `Moods`. */
  protected readonly targetsLabel = computed(() => `${this.targetNoun().replace(/^./, (c) => c.toUpperCase())}s`);
  protected readonly labelPlaceholder = computed(() => (this.kind()?.multiple ? this.targetsLabel() : "The target's name"));

  // Devices, moods and recorded values sit in Homey's zones; flows in its flow folders.
  protected readonly targets = computed<TargetNode>(() => {
    const zones = this.data.zones().values();
    switch (this.kind()?.target) {
      case 'device':
        return buildTree(
          zones,
          [...this.data.devices().values()].map((d) => ({
            id: d.id,
            label: d.name,
            summary: d.zoneName ? `${d.name} — ${d.zoneName}` : d.name,
            type: deviceType(d),
            ...deviceLook(d),
            groupId: d.zoneId,
          })),
        );
      case 'flow':
        return buildTree(
          this.data.flowFolders().values(),
          [...this.data.flows().values()].map((f) => ({
            id: f.id,
            label: f.name,
            type: [f.advanced ? 'Advanced flow' : 'Flow', f.enabled ? '' : 'disabled'].filter(Boolean).join(' · '),
            icon: LucideWorkflow,
            hue: 'flow' as const,
            groupId: f.folderId,
          })),
        );
      case 'mood':
        return buildTree(
          zones,
          [...this.data.moods().values()].map((m) => ({
            id: m.id,
            label: m.name,
            type: 'Mood',
            icon: LucideSparkles,
            hue: 'mood' as const,
            groupId: m.zoneId,
          })),
        );
      case 'insight': {
        const devices = this.data.devices();
        return buildTree(
          zones,
          [...this.data.insights().values()].map((l) => {
            const owner = devices.get(l.ownerUri.replace(/^homey:device:/, ''));
            return {
              id: l.id,
              label: [l.ownerName, l.title].filter(Boolean).join(' — '),
              type: l.units ? `Recorded value · ${l.units}` : 'Recorded value',
              icon: LucideChartLine,
              hue: deviceLook(owner).hue,
              groupId: owner?.zoneId ?? null,
            };
          }),
        );
      }
      default:
        return buildTree([], []);
    }
  });

  /** The targets of a kind that takes several, in the tile's order. */
  protected readonly pickedTargets = computed(() => {
    const options = new Map(allOptions(this.targets()).map((o) => [o.id, o]));
    return (this.settings().targets ?? []).map((id) => {
      const option = options.get(id);
      return { id, label: option ? (option.summary ?? option.label) : 'Not found in Homey', found: !!option };
    });
  });

  protected readonly sizeEnabled = computed(() => {
    const kind = this.kind();
    const fits = this.fitsSize();
    return (size: TileSize) => size === this.tile().size || (!!kind?.sizes.includes(size) && fits(size));
  });

  private readonly kindSettings = viewChild('kindSettings', { read: ViewContainerRef });
  private readonly kindSettingsComponent = computed(() => this.kind()?.settings);

  constructor() {
    // The kind's settings component, created once per kind and fed the tile's current settings.
    effect(() => {
      const container = this.kindSettings();
      const component = this.kindSettingsComponent();
      untracked(() => {
        container?.clear();
        if (!container || !component) return;
        container.createComponent(component, {
          bindings: [
            inputBinding('settings', this.settings),
            outputBinding<Partial<TileSettings>>('changed', (patch) => this.patch(patch)),
          ],
        });
      });
    });
  }

  protected patch(patch: Partial<TileSettings>) {
    const next = { ...this.settings(), ...patch } as Record<string, unknown>;
    Object.keys(next).forEach((key) => next[key] === undefined && delete next[key]);
    this.settingsChanged.emit(next as unknown as TileSettings);
  }

  protected setTarget(target: string) {
    this.settingsChanged.emit({ ...this.settings(), target: target || null });
  }

  protected addTarget(id: string) {
    const targets = this.settings().targets ?? [];
    if (id && !targets.includes(id)) this.setTargets([...targets, id]);
  }

  protected removeTarget(index: number) {
    this.setTargets((this.settings().targets ?? []).filter((_, i) => i !== index));
  }

  protected moveTarget(index: number, by: -1 | 1) {
    const targets = [...(this.settings().targets ?? [])];
    [targets[index], targets[index + by]] = [targets[index + by], targets[index]];
    this.setTargets(targets);
  }

  private setTargets(targets: string[]) {
    this.settingsChanged.emit({ ...this.settings(), target: null, targets });
  }

  protected setLabel(label: string) {
    const next: TileSettings = { ...this.settings(), label: label.trim() };
    if (!next.label) delete next.label;
    this.settingsChanged.emit(next);
  }
}
