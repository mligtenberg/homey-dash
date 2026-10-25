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
import { TileData, TileKind, TileSettings } from '@homey-dash/tiles';
import { SizePicker } from './size-picker';

interface TargetOption {
  id: string;
  label: string;
}

/** Settings of the selected tile: its target, its kind's own settings, label and size. */
@Component({
  selector: 'hd-tile-panel',
  imports: [SizePicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2>{{ kind()?.label ?? 'Unknown tile' }}</h2>

    @if (kind(); as kind) {
      <div class="hd-field">
        <label class="hd-field__label" for="tile-target">Target</label>
        <select id="tile-target" class="hd-select" (change)="setTarget($any($event.target).value)">
          <option value="" disabled [selected]="!settings().target">Pick a {{ targetNoun() }}</option>
          @if (settings().target && !targetKnown()) {
            <option [value]="settings().target" selected>Not found in Homey</option>
          }
          @for (option of options(); track option.id) {
            <option [value]="option.id" [selected]="option.id === settings().target">{{ option.label }}</option>
          }
        </select>
      </div>

      <ng-container #kindSettings />

      <div class="hd-field">
        <label class="hd-field__label" for="tile-label">Label</label>
        <input
          id="tile-label"
          class="hd-input"
          [value]="settings().label ?? ''"
          placeholder="The target's name"
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
    () => ({ device: 'device', flow: 'flow', mood: 'mood', insight: 'recorded value' })[this.kind()?.target ?? 'device'],
  );

  protected readonly options = computed<TargetOption[]>(() => {
    const byLabel = (a: TargetOption, b: TargetOption) => a.label.localeCompare(b.label);
    switch (this.kind()?.target) {
      case 'device':
        return [...this.data.devices().values()]
          .map((d) => ({ id: d.id, label: d.zoneName ? `${d.name} — ${d.zoneName}` : d.name }))
          .sort(byLabel);
      case 'flow':
        return [...this.data.flows().values()].map((f) => ({ id: f.id, label: f.name })).sort(byLabel);
      case 'mood':
        return [...this.data.moods().values()].map((m) => ({ id: m.id, label: m.name })).sort(byLabel);
      case 'insight':
        return [...this.data.insights().values()]
          .map((l) => ({ id: l.id, label: [l.ownerName, l.title].filter(Boolean).join(' — ') }))
          .sort(byLabel);
      default:
        return [];
    }
  });

  protected readonly targetKnown = computed(() => this.options().some((o) => o.id === this.settings().target));

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

  protected setLabel(label: string) {
    const next: TileSettings = { ...this.settings(), label: label.trim() };
    if (!next.label) delete next.label;
    this.settingsChanged.emit(next);
  }
}
