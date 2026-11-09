import { AccountOption, AccountSelect } from '../account-select';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DisplayInfo, LOCK_SPOTS, LockSpot, LockWidget, Rule, TomTomAccountApi } from '@homey-dash/api-client';
import { TrafficRouteField } from '@homey-dash/tiles';
import { RuleEditor } from '../editor/rule-editor';
import { SignalPicker } from '../editor/signal-picker';
import { DisplayContext } from './display-context';
import { DisplaysStore, isCapabilitySignal, MAX_LOCK_WIDGETS } from './displays-store';
import { LucideCar, LucideChevronDown, LucideClock, LucideCloud, LucidePlus, LucideThermometer, RemoveButton, ReorderButtons } from '@homey-dash/design-system';
import { LucideDynamicIcon } from '@lucide/angular';
import { describeRule } from '../editor/rule-text';
import { SignalCatalogue } from '../editor/signal-catalogue';

interface Placed {
  widget: LockWidget;
  index: number;
}
interface SpotGroup {
  spot: LockSpot;
  items: Placed[];
}
type Visibility = 'always' | 'never' | 'rule';

const SPOT_NAMES: Record<LockSpot, string> = {
  'top-left': 'Top left',
  'top-right': 'Top right',
  center: 'Middle',
  'bottom-left': 'Bottom left',
  'bottom-right': 'Bottom right',
};

const KIND_ICONS = { clock: LucideClock, weather: LucideCloud, value: LucideThermometer, traffic: LucideCar };
const KIND_NAMES = { clock: 'Time and date', weather: 'Weather', value: 'Device value', traffic: 'Traffic' };

/** The widgets a display's lock screen shows over a photo set or colour while an idle rule plays it. */
@Component({
  selector: 'hd-display-lock-tab',
  imports: [AccountSelect, RuleEditor, SignalPicker, ReorderButtons, RemoveButton, TrafficRouteField, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (context.display(); as display) {
      <div class="lock">
        <p class="hd-hint intro">
          These sit on top of a photo set or colour while an idle rule plays it. Pick a spot on the screen to add a widget, or choose one to change it.
        </p>

        <div class="screen" role="group" aria-label="Preview of the lock screen">
          @for (spot of spots; track spot) {
            @let items = placedAt(display, spot);
            <div class="slot slot--{{ spot }}" [class.slot--empty]="!items.length">
              @for (item of items; track item.index) {
                <button
                  type="button"
                  class="chip"
                  [class.chip--off]="item.widget.hidden"
                  [class.chip--on]="selected() === item.index"
                  [attr.aria-pressed]="selected() === item.index"
                  [attr.aria-label]="'Edit ' + label(item.widget) + ' at ' + spotName(spot).toLowerCase()"
                  (click)="select(item.index)"
                >
                  <svg class="chip__icon" [lucideIcon]="icon(item.widget)" aria-hidden="true" />
                  <span class="chip__text">{{ label(item.widget) }}</span>
                </button>
              } @empty {
                <button type="button" class="slot__add" [disabled]="full(display)" [attr.aria-label]="'Add a widget at ' + spotName(spot).toLowerCase()" (click)="add(display, spot)">
                  <svg [lucideIcon]="plus" aria-hidden="true" />
                  <span>{{ spotName(spot) }}</span>
                </button>
              }
            </div>
          }
        </div>

        @for (group of groups(display); track group.spot) {
          <section class="spot" [attr.aria-label]="spotName(group.spot)">
            <h3 class="spot__name">
              {{ spotName(group.spot) }}
              @if (group.items.length > 1) {
                <span class="spot__note">stacked top to bottom</span>
              }
            </h3>
            @for (item of group.items; track item.index; let first = $first, last = $last) {
              @let widget = item.widget;
              @let i = item.index;
              <article class="widget" [id]="'lock-widget-' + i" [class.widget--off]="widget.hidden" [class.widget--on]="selected() === i" (focusin)="selected.set(i)">
                <div class="widget__head">
                  <span class="badge" aria-hidden="true"><svg [lucideIcon]="icon(widget)" /></span>
                  <label class="field kind">
                    <span class="field__label">Shows</span>
                    <select class="hd-select" [attr.aria-label]="'What widget ' + (i + 1) + ' shows'" (change)="store.setLockKind(display, i, $any($event.target).value)">
                      @for (kind of kinds; track kind) {
                        <option [value]="kind" [selected]="widget.kind === kind">{{ kindName(kind) }}</option>
                      }
                    </select>
                  </label>
                  <div class="field">
                    <span class="field__label" [id]="'lock-spot-' + i">Position</span>
                    <div class="spots" role="radiogroup" [attr.aria-labelledby]="'lock-spot-' + i">
                      @for (spot of spots; track spot) {
                        <button
                          type="button"
                          role="radio"
                          class="spots__dot spots__dot--{{ spot }}"
                          [attr.aria-checked]="spot === widget.spot"
                          [attr.aria-label]="spotName(spot)"
                          [title]="spotName(spot)"
                          (click)="spot !== widget.spot && store.setLockSpot(display, i, spot)"
                        ></button>
                      }
                    </div>
                  </div>
                  <span class="grow"></span>
                  <div class="actions">
                    @if (group.items.length > 1) {
                      <hd-reorder-buttons [label]="'widget ' + (i + 1)" [first]="first" [last]="last" [removable]="false" (moved)="move(display, group, i, $event)" />
                    }
                    <hd-remove-button [label]="'widget ' + (i + 1)" (removed)="remove(display, i)" />
                  </div>
                </div>

                @if (widget.kind === 'weather' && store.homeys().length > 1) {
                  <hd-account-select
                    [accounts]="store.homeys()"
                    [selected]="widget.account ?? store.homeys()[0].accountId"
                    [ariaLabel]="'Whose weather widget ' + (i + 1) + ' shows'"
                    (picked)="store.setLockAccount(display, i, '' + $event)"
                  />
                } @else if (widget.kind === 'value') {
                  <hd-signal-picker [value]="widget.signal" [only]="isCapability" (picked)="store.setLockSignal(display, i, $event)" />
                } @else if (widget.kind === 'traffic') {
                  @if (tomtoms().length > 1) {
                    <hd-account-select
                      [accounts]="tomtoms()"
                      [selected]="widget.account ?? tomtoms()[0].accountId"
                      [ariaLabel]="'Which TomTom account widget ' + (i + 1) + ' asks'"
                      (picked)="store.setLockAccount(display, i, '' + $event, tomtoms()[0].accountId)"
                    />
                  }
                  <hd-traffic-route-field [idPrefix]="'lock-traffic-' + i" [route]="widget.route" [account]="widget.account" (changed)="store.setLockRoute(display, i, $event)" />
                }

                <div class="when">
                  <span class="field__label" [id]="'lock-when-' + i">Visible</span>
                  <div class="seg" role="radiogroup" [attr.aria-labelledby]="'lock-when-' + i">
                    @for (choice of choices; track choice.value) {
                      <button type="button" role="radio" class="seg__btn" [attr.aria-checked]="visibility(widget) === choice.value" (click)="setVisibility(display, i, choice.value)">
                        {{ choice.label }}
                      </button>
                    }
                  </div>
                  @if (widget.rule && !widget.hidden) {
                    <button type="button" class="rule" [attr.aria-expanded]="isOpen(i)" [attr.aria-label]="'Rule of widget ' + (i + 1)" (click)="toggle(i)">
                      <span class="rule__text">{{ describe(widget.rule) }}</span>
                      <svg class="rule__chevron" [lucideIcon]="chevron" aria-hidden="true" />
                    </button>
                  }
                </div>
                @if (widget.rule && !widget.hidden && isOpen(i)) {
                  <hd-rule-editor class="editor" [rule]="widget.rule" (changed)="store.setLockRule(display, i, $event)" />
                }
              </article>
            }
          </section>
        }

        <div class="foot">
          <button type="button" class="hd-btn lock__add" [disabled]="full(display)" (click)="add(display)">
            <svg [lucideIcon]="plus" aria-hidden="true" />
            Add a widget
          </button>
          @if (full(display)) {
            <span class="hd-hint">That's the most a lock screen holds ({{ maxLock }}).</span>
          }
        </div>
      </div>
    }
  `,
  styles: `
    .lock { display: flex; flex-direction: column; gap: var(--space-4); max-width: 760px; min-width: 0; }
    .intro { max-width: 62ch; }

    /* The preview: a stand-in screen with the five places a widget can sit. */
    .screen {
      display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr 1fr; gap: var(--space-2); padding: var(--space-3);
      aspect-ratio: 16 / 9; width: 100%; box-sizing: border-box; max-width: 560px; border-radius: 16px; border: 1px solid var(--line);
      background: linear-gradient(160deg, color-mix(in oklab, var(--brand) 38%, #10131c), #10131c 70%);
      box-shadow: 0 8px 24px rgb(0 0 0 / .18);
    }
    .slot { display: flex; flex-direction: column; gap: 6px; min-width: 0; min-height: 0; }
    .slot--top-left { grid-area: 1 / 1; align-items: flex-start; }
    .slot--top-right { grid-area: 1 / 2; align-items: flex-end; }
    .slot--center { grid-area: 2 / 1 / 3 / 3; align-items: center; justify-content: center; }
    .slot--bottom-left { grid-area: 3 / 1; align-items: flex-start; justify-content: flex-end; }
    .slot--bottom-right { grid-area: 3 / 2; align-items: flex-end; justify-content: flex-end; }
    .slot__add {
      display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 10px; font: inherit; font-size: 12px; cursor: pointer;
      border: 1px dashed rgb(255 255 255 / .35); background: transparent; color: rgb(255 255 255 / .72);
    }
    .slot__add svg { width: 14px; height: 14px; }
    .slot__add:hover:not(:disabled) { border-color: #fff; color: #fff; background: rgb(255 255 255 / .1); }
    .slot__add:disabled { opacity: .4; cursor: not-allowed; }
    .chip {
      display: inline-flex; align-items: center; gap: 8px; max-width: 100%; padding: 8px 12px; border-radius: 10px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
      border: 1px solid rgb(255 255 255 / .28); background: rgb(255 255 255 / .16); color: #fff; backdrop-filter: blur(6px);
    }
    .chip:hover { background: rgb(255 255 255 / .26); }
    .chip--on { background: #fff; color: #10131c; border-color: #fff; }
    .chip--off { border-style: dashed; opacity: .6; }
    .chip__icon { width: 16px; height: 16px; flex: none; }
    .chip__text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .chip:focus-visible, .slot__add:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }

    .spot { display: flex; flex-direction: column; gap: var(--space-2); }
    .spot__name { margin: var(--space-2) 0 0; font-size: 14px; font-weight: 700; color: var(--ink); }
    .spot__note { margin-left: 8px; font-size: 12px; font-weight: 500; color: var(--ink-muted); }
    .widget { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-3); border: 1px solid var(--line); border-radius: 12px; background: var(--panel); scroll-margin-top: 80px; }
    .widget--on { border-color: var(--brand); box-shadow: 0 0 0 1px var(--brand); }
    .widget--off .widget__head, .widget--off > :is(hd-account-select, hd-signal-picker, hd-traffic-route-field) { opacity: .6; }
    .widget__head { display: flex; align-items: flex-end; gap: var(--space-3); flex-wrap: wrap; }
    .badge { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; background: color-mix(in oklab, var(--brand) 14%, transparent); color: var(--brand); }
    .badge svg { width: 18px; height: 18px; }
    .field { display: flex; flex-direction: column; gap: 4px; }
    .field__label { font-size: 12px; font-weight: 700; color: var(--ink-muted); }
    .kind .hd-select { min-width: 160px; }
    .grow { flex: 1; }
    .actions { display: flex; gap: var(--space-1); }

    /* The position picker: five dots laid out like the places on the screen. */
    .spots { position: relative; width: 56px; height: 36px; border-radius: 6px; border: 1px solid var(--line); background: var(--chrome); }
    .spots__dot { position: absolute; width: 14px; height: 14px; padding: 0; border-radius: 50%; border: 0; background: var(--line); cursor: pointer; }
    .spots__dot:hover { background: var(--ink-muted); }
    .spots__dot[aria-checked='true'] { background: var(--brand); }
    .spots__dot:focus-visible { outline: 3px solid var(--brand); outline-offset: 2px; }
    .spots__dot--top-left { top: 3px; left: 3px; }
    .spots__dot--top-right { top: 3px; right: 3px; }
    .spots__dot--center { top: 10px; left: 19px; }
    .spots__dot--bottom-left { bottom: 3px; left: 3px; }
    .spots__dot--bottom-right { bottom: 3px; right: 3px; }

    .when { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
    .seg { display: inline-flex; padding: 2px; border-radius: 10px; border: 1px solid var(--line); background: var(--chrome); }
    .seg__btn { padding: 6px 12px; border: 0; border-radius: 8px; background: transparent; color: var(--ink-muted); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
    .seg__btn:hover { color: var(--ink); }
    .seg__btn[aria-checked='true'] { background: var(--brand); color: var(--on-brand); }
    .seg__btn:focus-visible { outline: 3px solid var(--brand); outline-offset: 2px; }
    .rule {
      flex: 1 1 220px; min-width: 0; display: flex; align-items: center; gap: var(--space-1); padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px;
      background: transparent; color: var(--ink-muted); font: inherit; font-size: 13px; text-align: left; cursor: pointer;
    }
    .rule:hover, .rule[aria-expanded='true'] { border-color: var(--brand); }
    .rule__text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rule__chevron { flex: none; width: 16px; height: 16px; transition: transform 0.15s; }
    .rule[aria-expanded='true'] .rule__chevron { transform: rotate(180deg); }
    .editor { display: block; padding-top: var(--space-3); border-top: 1px solid var(--line); }

    .foot { display: flex; align-items: center; gap: var(--space-2); }
    .lock__add { display: inline-flex; align-items: center; gap: 6px; }
    .lock__add svg { width: 16px; height: 16px; }
    @media (prefers-reduced-motion: reduce) { .rule__chevron { transition: none; } }
  `,
})
export class DisplayLockTab {
  protected readonly context = inject(DisplayContext);
  protected readonly store = inject(DisplaysStore);
  protected readonly spots = LOCK_SPOTS;
  protected readonly kinds = ['clock', 'weather', 'value', 'traffic'] as const;
  protected readonly choices: { value: Visibility; label: string }[] = [
    { value: 'always', label: 'Always' },
    { value: 'rule', label: 'When a rule holds' },
    { value: 'never', label: 'Never' },
  ];
  protected readonly maxLock = MAX_LOCK_WIDGETS;
  protected readonly isCapability = isCapabilitySignal;
  protected readonly chevron = LucideChevronDown;
  protected readonly plus = LucidePlus;
  private readonly catalogue = inject(SignalCatalogue);
  // The index of the widget whose rule is open; rules start closed, as they can be long.
  private readonly openRule = signal<number | null>(null);
  // The index of the widget being edited, shown on the preview and on its card.
  protected readonly selected = signal<number | null>(null);

  private readonly tomtomAccounts = toSignal(inject(TomTomAccountApi).list(), { initialValue: null });
  // The TomTom accounts a traffic widget can ask with, oldest first.
  protected readonly tomtoms = computed<AccountOption[]>(() =>
    (this.tomtomAccounts()?.accounts ?? []).map((a) => ({ accountId: a.id, accountName: a.name })),
  );

  protected spotName(spot: LockSpot) {
    return SPOT_NAMES[spot];
  }

  protected kindName(kind: LockWidget['kind']) {
    return KIND_NAMES[kind];
  }

  protected icon(widget: LockWidget) {
    return KIND_ICONS[widget.kind];
  }

  // What a widget is called on the preview.
  protected label(widget: LockWidget) {
    if (widget.kind === 'value') return this.catalogue.byId().get(widget.signal)?.name ?? KIND_NAMES.value;
    if (widget.kind === 'traffic') return widget.route?.name || KIND_NAMES.traffic;
    return KIND_NAMES[widget.kind];
  }

  protected full(display: DisplayInfo) {
    return display.lockWidgets.length >= this.maxLock;
  }

  protected visibility(widget: LockWidget): Visibility {
    return widget.hidden ? 'never' : widget.rule ? 'rule' : 'always';
  }

  protected placedAt(display: DisplayInfo, spot: LockSpot): Placed[] {
    return display.lockWidgets.map((widget, index) => ({ widget, index })).filter((p) => p.widget.spot === spot);
  }

  // The widgets by the place they sit, in the order the places are listed; a place with none is left out.
  protected groups(display: DisplayInfo): SpotGroup[] {
    return this.spots.map((spot) => ({ spot, items: this.placedAt(display, spot) })).filter((g) => g.items.length > 0);
  }

  protected describe(rule: Rule) {
    return describeRule(rule, this.catalogue.byId());
  }

  protected isOpen(index: number) {
    return this.openRule() === index;
  }

  protected toggle(index: number) {
    this.openRule.set(this.isOpen(index) ? null : index);
  }

  // Picking a widget on the preview brings its card into view.
  protected select(index: number) {
    this.selected.set(index);
    const card = document.getElementById('lock-widget-' + index);
    if (!card) return;
    // Scroll only the page's own scroller; scrollIntoView would also move the shell around it.
    let scroller = card.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    if (scroller) {
      const box = scroller.getBoundingClientRect();
      const at = card.getBoundingClientRect();
      const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
      scroller.scrollTo({ top: scroller.scrollTop + at.top - box.top - 80, behavior: smooth ? 'smooth' : 'auto' });
    }
    card.querySelector<HTMLElement>('select, button')?.focus({ preventScroll: true });
  }

  // Choosing "only when a rule holds" opens its rule, to be set up.
  protected setVisibility(display: DisplayInfo, index: number, choice: Visibility) {
    if (choice === this.visibility(display.lockWidgets[index])) return;
    this.store.setLockVisibility(display, index, choice);
    this.openRule.set(choice === 'rule' ? index : this.openRule() === index ? null : this.openRule());
  }

  protected add(display: DisplayInfo, spot?: LockSpot) {
    this.store.addLock(display, spot);
    this.openRule.set(null);
    this.selected.set(display.lockWidgets.length);
  }

  // Moves a widget past its neighbour in the same place, and keeps the open rule and selection with their widget.
  protected move(display: DisplayInfo, group: SpotGroup, index: number, by: -1 | 1) {
    const at = group.items.findIndex((p) => p.index === index);
    const other = group.items[at + by]?.index;
    if (other === undefined) return;
    const swap = (v: number | null) => (v === index ? other : v === other ? index : v);
    this.openRule.set(swap(this.openRule()));
    this.selected.set(swap(this.selected()));
    this.store.swapLock(display, index, other);
  }

  protected remove(display: DisplayInfo, index: number) {
    const shift = (v: number | null) => (v === null || v === index ? null : v > index ? v - 1 : v);
    this.openRule.set(shift(this.openRule()));
    this.selected.set(shift(this.selected()));
    this.store.removeLock(display, index);
  }
}
