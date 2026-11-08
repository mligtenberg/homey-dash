import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DisplayInfo, Rule } from '@homey-dash/api-client';
import { RouterLink } from '@angular/router';
import { RuleEditor } from '../editor/rule-editor';
import { describeRule } from '../editor/rule-text';
import { SignalCatalogue } from '../editor/signal-catalogue';
import { DisplayContext } from './display-context';
import { DisplaysStore } from './displays-store';

/** What a display does when left alone: the first idle rule whose rule holds decides what it shows. */
@Component({
  selector: 'hd-display-idle-tab',
  imports: [RuleEditor, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (context.display(); as display) {
      @if (!display.dashboardIds.length) {
        <p class="hd-hint">Offer a dashboard on the <a routerLink="../dashboards">Dashboards</a> page first.</p>
      } @else {
        <div class="idle">
          <p class="hd-hint">
            A minute after the last touch, and for as long as no one touches it, it does the first of these whose rule
            holds. While none holds, it stays on what it shows. A photo set or colour fills the screen until someone touches it.
          </p>
          @if (!kiosk(display)) {
            <p class="hd-hint">
              Turning the screen off needs Fully Kiosk Browser with its JavaScript interface on; this display doesn't report it.
            </p>
          }
          @for (idle of display.idleRules; track $index; let i = $index, last = $last) {
            <div class="entry">
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
              <button type="button" class="rule" [attr.aria-expanded]="isOpen(display, i)" (click)="toggleRule(display, i)">
                {{ describe(idle.rule) }}
              </button>
              <button type="button" class="hd-btn" [attr.aria-label]="'Move rule ' + (i + 1) + ' up'" [disabled]="i === 0" (click)="move(display, i, -1)">↑</button>
              <button type="button" class="hd-btn" [attr.aria-label]="'Move rule ' + (i + 1) + ' down'" [disabled]="last" (click)="move(display, i, 1)">↓</button>
              <button type="button" class="hd-btn" [attr.aria-label]="'Remove rule ' + (i + 1)" (click)="remove(display, i)">✕</button>
            </div>
            @if (isOpen(display, i)) {
              <hd-rule-editor class="editor" [rule]="idle.rule" (changed)="store.setIdleRule(display, i, $event)" />
            }
          }
          <button type="button" class="hd-btn idle-add" (click)="add(display)">Add a rule</button>
        </div>
      }
    }
  `,
  styles: `
    .color { width: 40px; }
    .idle { display: flex; flex-direction: column; gap: var(--space-2); }
    .entry { display: flex; align-items: center; gap: var(--space-1); }
    .entry .hd-select { flex: 0 1 200px; min-width: 0; }
    .entry .hd-btn { padding-inline: 10px; }
    .rule {
      flex: 1; min-width: 0; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel);
      color: var(--ink-muted); font: inherit; font-size: 13px; text-align: left; cursor: pointer;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .rule:hover, .rule[aria-expanded='true'] { border-color: var(--brand); }
    .editor { padding: var(--space-3); border: 1px solid var(--line); border-radius: 10px; }
    .idle-add { align-self: flex-start; }
  `,
})
export class DisplayIdleTab {
  protected readonly context = inject(DisplayContext);
  protected readonly store = inject(DisplaysStore);
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
