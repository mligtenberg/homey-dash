import { AccountSelect } from '../account-select';
import {
  booleanAttribute,
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
import { Tile, WEATHER_PLACE } from '@homey-dash/api-client';
import { TileSize } from '@homey-dash/layout';
import { deviceLook, deviceType, TileData, TileKind, TileSettings, usesHomeyAccount } from '@homey-dash/tiles';
import { PhotoSetField } from './photo-set-field';
import { PlexTargetField } from './plex-target-field';
import { SizePicker } from './size-picker';
import { TargetPicker } from './target-picker';
import { allOptions, buildTree, TargetNode } from './target-tree';
import { LucideChartLine, LucideSparkles, LucideWorkflow, ReorderButtons, moved, removedAt } from '@homey-dash/design-system';

/**
 * Settings of the selected tile: its target, its kind's own settings, label and size. A tile a logic tile holds is
 * `nested`: it takes the logic tile's size. Content projected into it shows below the kind's own settings.
 */
@Component({
  selector: 'hd-tile-panel',
  imports: [AccountSelect, PhotoSetField, PlexTargetField, SizePicker, TargetPicker, ReorderButtons],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="hd-section-title">{{ kind()?.label ?? 'Unknown tile' }}</h2>

    @if (kind(); as kind) {
      @if (homeyAccounts(); as accounts) {
        <div class="hd-field">
          <label class="hd-field__label" for="tile-account">Homey</label>
          <hd-account-select selectId="tile-account" [accounts]="accounts" [selected]="homey()?.accountId" (picked)="setAccount($event)" />
        </div>
      }
      @if (kind.target === 'none') {
        <!-- Points at nothing itself, such as a logic tile. -->
      } @else if (kind.target === 'energy') {
        <!-- Always the energy of its Homey. -->
      } @else if (kind.target === 'weather') {
        <!-- Where its Homey is, or a place of its own: the kind's own settings choose. -->
      } @else if (kind.target === 'photoSet') {
        <hd-photo-set-field [value]="settings().target" (picked)="setTarget($event)" />
      } @else if (kind.target === 'plexPlayer' || kind.target === 'plexLibrary') {
        <hd-plex-target-field
          [type]="kind.target"
          [value]="settings().target"
          [account]="settings().account"
          (picked)="setTarget($event)"
          (accountPicked)="setAccount($event)"
        />
      } @else if (kind.multiple) {
        <div class="hd-field">
          <label class="hd-field__label" for="tile-target">{{ targetsLabel() }}</label>
          @for (picked of pickedTargets(); track picked.id; let i = $index, last = $last) {
            <div class="picked">
              <span class="picked__name" [class.missing]="!picked.found">{{ picked.label }}</span>
              <hd-reorder-buttons [label]="picked.label" [first]="i === 0" [last]="last" (moved)="moveTarget(i, $event)" (removed)="removeTarget(i)" />
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
      <ng-content />

      @if (kind.target !== 'none') {
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
      }

      @if (!nested()) {
        <div class="hd-field">
          <span class="hd-field__label">Size</span>
          <hd-size-picker [value]="tile().size" [enabled]="sizeEnabled()" (picked)="resized.emit($event)" />
        </div>
      }
    } @else {
      <p class="hd-muted">No installed module registers the kind "{{ tile().kind }}". It shows as missing until you remove it.</p>
    }

    <button type="button" class="hd-btn hd-btn--danger remove" (click)="removed.emit()">
      {{ nested() ? 'Remove from logic tile' : 'Remove tile' }}
    </button>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--space-4); }
    .remove { align-self: flex-start; margin-top: var(--space-2); }
    .picked { display: flex; align-items: center; gap: var(--space-1); }
    .picked__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .picked__name.missing { color: var(--danger); }
  `,
})
export class TilePanel {
  readonly tile = input.required<Tile>();
  readonly kind = input.required<TileKind | undefined>();
  /** Whether the tile could take a size at its position. */
  readonly fitsSize = input.required<(size: TileSize) => boolean>();
  /** The sizes the tile can take; its kind's, unless a logic tile, which takes only those of every tile it holds. */
  readonly sizes = input<readonly TileSize[]>();
  /** A tile a logic tile holds, which takes the logic tile's size. */
  readonly nested = input(false, { transform: booleanAttribute });

  readonly settingsChanged = output<TileSettings>();
  readonly resized = output<TileSize>();
  readonly removed = output<void>();

  private readonly data = inject(TileData);

  protected readonly settings = computed(() => this.tile().settings as TileSettings);

  /** The Homey of the tile's account, whose devices, flows, moods and recorded values it can point at. */
  protected readonly homey = computed(() => this.data.homey(this.settings().account));
  /** Every Homey, for a Homey or weather kind to pick from once there is more than one. */
  protected readonly homeyAccounts = computed(() => {
    const kind = this.kind();
    const homeys = this.data.homeys() ?? [];
    // A weather tile at a place of its own needs no Homey.
    const placed = this.settings().target === WEATHER_PLACE;
    return kind && usesHomeyAccount(kind.target) && !placed && homeys.length > 1 ? homeys : null;
  });

  protected readonly targetNoun = computed(
    () =>
      ({ device: 'device', flow: 'flow', mood: 'mood', insight: 'recorded value', photoSet: 'photo set', plexPlayer: 'player', plexLibrary: 'library', weather: 'place', energy: 'energy', none: 'target' })[this.kind()?.target ?? 'device'],
  );

  /** What a kind that takes several targets calls them: `Moods`. */
  protected readonly targetsLabel = computed(() => `${this.targetNoun().replace(/^./, (c) => c.toUpperCase())}s`);
  protected readonly labelPlaceholder = computed(() =>
    this.kind()?.multiple ? this.targetsLabel() : this.kind()?.target === 'weather' ? 'The place' : "The target's name",
  );

  // Devices, moods and recorded values sit in Homey's zones; flows in its flow folders.
  protected readonly targets = computed<TargetNode>(() => {
    const homey = this.homey();
    if (!homey) return buildTree([], []);
    const zones = homey.zones.values();
    const required = this.kind()?.requiresCapability;
    switch (this.kind()?.target) {
      case 'device':
        return buildTree(
          zones,
          [...homey.devices.values()]
            .filter((d) => !required || d.capabilities[required])
            .map((d) => ({
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
          homey.flowFolders.values(),
          [...homey.flows.values()].map((f) => ({
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
          [...homey.moods.values()].map((m) => ({
            id: m.id,
            label: m.name,
            type: 'Mood',
            icon: LucideSparkles,
            hue: 'mood' as const,
            groupId: m.zoneId,
          })),
        );
      case 'insight': {
        const devices = homey.devices;
        return buildTree(
          zones,
          [...homey.insights.values()].map((l) => {
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
    const sizes = this.sizes() ?? kind?.sizes ?? [];
    return (size: TileSize) => size === this.tile().size || (sizes.includes(size) && fits(size));
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

  // Another account's targets are others, so the tile starts over at its kind's default.
  protected setAccount(account: number) {
    const kind = this.kind();
    const target = (kind?.defaultSettings as TileSettings | undefined)?.target ?? null;
    this.settingsChanged.emit({ ...this.settings(), account, target, ...(kind?.multiple ? { targets: [] } : {}) });
  }

  protected setTarget(target: string) {
    this.settingsChanged.emit({ ...this.settings(), target: target || null });
  }

  protected addTarget(id: string) {
    const targets = this.settings().targets ?? [];
    if (id && !targets.includes(id)) this.setTargets([...targets, id]);
  }

  protected removeTarget(index: number) {
    this.setTargets(removedAt((this.settings().targets ?? []), index));
  }

  protected moveTarget(index: number, by: -1 | 1) {
    const targets = moved((this.settings().targets ?? []), index, by);
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
