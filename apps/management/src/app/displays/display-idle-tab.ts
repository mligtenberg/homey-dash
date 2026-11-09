import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DisplayInfo, Rule } from '@homey-dash/api-client';
import { RouterLink } from '@angular/router';
import { RuleEditor } from '../editor/rule-editor';
import { describeRule } from '../editor/rule-text';
import { SignalCatalogue } from '../editor/signal-catalogue';
import { DisplayContext } from './display-context';
import { DisplaysStore } from './displays-store';
import { LucideChevronDown, LucidePlus, ReorderButtons } from '@homey-dash/design-system';
import { LucideDynamicIcon } from '@lucide/angular';

/** What a display does when left alone: the first idle rule whose rule holds decides what it shows. */
@Component({
  selector: 'hd-display-idle-tab',
  imports: [RuleEditor, RouterLink, ReorderButtons, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (context.display(); as display) {
      @if (!display.dashboardIds.length) {
        <p class="hd-hint">Offer a dashboard on the <a routerLink="../dashboards">Dashboards</a> page first.</p>
      } @else {
        <div class="idle">
          <p class="hd-lead">
            After a minute without a touch, the display goes through these rules from the top and does the first one whose
            condition holds. If none does, it stays as it is. A touch brings it back.
          </p>
          @if (!kiosk(display)) {
            <p class="hd-hint note">
              Turning the screen off needs Fully Kiosk Browser with its JavaScript interface on; this display doesn't report it.
            </p>
          }
          @for (idle of display.idleRules; track $index; let i = $index, last = $last) {
            <div class="entry hd-item" [class.hd-item--on]="isOpen(display, i)">
              <div class="hd-item__head">
                <span class="num" aria-hidden="true">{{ i + 1 }}</span>
                <h2 class="hd-item__title grow">Rule {{ i + 1 }}</h2>
                <hd-reorder-buttons [label]="'rule ' + (i + 1)" [first]="i === 0" [last]="last" (moved)="move(display, i, $event)" (removed)="remove(display, i)" />
              </div>
              <div class="line">
                <span class="line__label">Then show</span>
                <div class="line__body">
              <select
                class="hd-select"
                [attr.aria-label]="'What rule ' + (i + 1) + ' does'"
                (change)="store.setIdleAction(display, i, $any($event.target).value)"
              >
                <optgroup label="Show dashboard">
                  @for (id of display.dashboardIds; track id) {
                    <option [value]="'dashboard:' + id" [selected]="id === idle.dashboardId">{{ store.dashboardName(id) }}</option>
                  }
                </optgroup>
                @if (idle.photoSetId || store.photoSets().length) {
                  <optgroup label="Play photo set">
                    @if (idle.photoSetId && !store.photoSetName(idle.photoSetId)) {
                      <option selected disabled>Photo set not found</option>
                    }
                    @for (set of store.photoSets(); track set.id) {
                      <option [value]="'photos:' + set.id" [selected]="set.id === idle.photoSetId">{{ set.name }}</option>
                    }
                  </optgroup>
                }
                <optgroup label="Fill with colour">
                  <option value="color" [selected]="!!idle.color">Colour</option>
                </optgroup>
                <optgroup label="Screen">
                  <option value="screen-off" [selected]="!!idle.screenOff" [disabled]="!kiosk(display) && !idle.screenOff">
                    Turn screen off{{ kiosk(display) ? '' : ' (Fully Kiosk Browser only)' }}
                  </option>
                </optgroup>
              </select>
              @if (idle.color) {
                <input
                  type="color"
                  class="hd-color-input color"
                  [attr.aria-label]="'Colour of rule ' + (i + 1)"
                  [value]="idle.color"
                  (change)="store.setIdleColor(display, i, $any($event.target).value)"
                />
              }
              @if (idle.photoSetId || idle.color || idle.screenOff) {
                <select
                  class="hd-select"
                  [attr.aria-label]="'Where a touch goes back to for rule ' + (i + 1)"
                  (change)="store.setIdleReturn(display, i, $any($event.target).value)"
                >
                  <option value="" [selected]="!idle.returnDashboardId">Back to the last used</option>
                  @for (id of display.dashboardIds; track id) {
                    <option [value]="id" [selected]="id === idle.returnDashboardId">Back to {{ store.dashboardName(id) }}</option>
                  }
                </select>
              }
                </div>
              </div>
              <div class="line">
                <span class="line__label">When</span>
                <button type="button" class="rule" [attr.aria-expanded]="isOpen(display, i)" (click)="toggleRule(display, i)">
                  <span class="rule__text">{{ describe(idle.rule) }}</span>
                  <svg class="rule__chevron" [lucideIcon]="chevron" aria-hidden="true" />
                </button>
              </div>
              @if (isOpen(display, i)) {
                <hd-rule-editor class="editor" [rule]="idle.rule" (changed)="store.setIdleRule(display, i, $event)" />
              }
            </div>
          }
          <button type="button" class="hd-btn idle-add" (click)="add(display)"><svg [lucideIcon]="plus" aria-hidden="true" />Add a rule</button>
        </div>
      }
    }
  `,
  styles: `
    .idle { display: flex; flex-direction: column; gap: var(--space-3); }
    .note { padding: var(--space-2) var(--space-3); border-radius: 10px; background: color-mix(in oklab, var(--warn) 12%, transparent); color: var(--ink); }
    .num { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: color-mix(in oklab, var(--brand) 14%, transparent); color: var(--brand); font-weight: 800; font-size: 13px; font-variant-numeric: tabular-nums; }
    .grow { flex: 1; }
    .line { display: flex; align-items: flex-start; gap: var(--space-3); }
    .line__label { flex: none; width: 76px; padding-top: 10px; font-size: 12px; font-weight: 700; color: var(--ink-muted); }
    .line__body { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
    .line__body .hd-select { flex: 0 1 220px; min-width: 0; }
    .color { width: 44px; height: 38px; }
    .rule {
      flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--space-1); padding: 9px 12px; border: 1px solid var(--line); border-radius: 10px;
      background: var(--chrome); color: var(--ink); font: inherit; font-size: 13px; text-align: left; cursor: pointer;
    }
    .rule:hover, .rule[aria-expanded='true'] { border-color: var(--brand); }
    .rule:focus-visible { outline: 3px solid var(--brand); outline-offset: 2px; }
    .rule__text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rule__chevron { flex: none; width: 16px; height: 16px; color: var(--ink-muted); transition: transform .15s; }
    .rule[aria-expanded='true'] .rule__chevron { transform: rotate(180deg); }
    .editor { display: block; padding-top: var(--space-3); border-top: 1px solid var(--line); }
    .idle-add { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; }
    .idle-add svg { width: 16px; height: 16px; }
    @media (max-width: 560px) { .line { flex-direction: column; gap: var(--space-1); } .line__label { width: auto; padding-top: 0; } .line > * { align-self: stretch; } }
    @media (prefers-reduced-motion: reduce) { .rule__chevron { transition: none; } }
  `,
})
export class DisplayIdleTab {
  protected readonly context = inject(DisplayContext);
  protected readonly store = inject(DisplaysStore);
  protected readonly chevron = LucideChevronDown;
  protected readonly plus = LucidePlus;
  private readonly catalogue = inject(SignalCatalogue);
  // The index of the rule whose editor is open; this page shows one display, so that is enough.
  private readonly openRule = signal<number | null>(null);

  // Only a screen in Fully Kiosk Browser can turn itself off; elsewhere it could only go black.
  protected kiosk(display: DisplayInfo) {
    return display.status.kiosk;
  }

  protected describe(rule: Rule) {
    return describeRule(rule, this.catalogue.byId());
  }

  protected isOpen(_display: DisplayInfo, index: number) {
    return this.openRule() === index;
  }

  protected toggleRule(display: DisplayInfo, index: number) {
    this.openRule.set(this.isOpen(display, index) ? null : index);
  }

  // A new rule opens to be set up.
  protected add(display: DisplayInfo) {
    this.store.addIdle(display);
    this.openRule.set(display.idleRules.length);
  }

  protected move(display: DisplayInfo, index: number, by: -1 | 1) {
    const open = this.openRule();
    if (open === index) this.openRule.set(index + by);
    else if (open === index + by) this.openRule.set(index);
    this.store.moveIdle(display, index, by);
  }

  protected remove(display: DisplayInfo, index: number) {
    if (this.openRule() === index) this.openRule.set(null);
    this.store.removeIdle(display, index);
  }
}
