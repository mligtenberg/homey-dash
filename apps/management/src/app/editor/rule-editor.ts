import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { Condition, ConditionValue, isGroup, Operator, Rule, SpanUnit, Weekday } from '@homey-dash/api-client';
import { LucideX } from '@homey-dash/design-system';
import { alwaysRule } from '@homey-dash/tiles';
import { LucideDynamicIcon } from '@lucide/angular';
import {
  defaultValue,
  describeRuleFull,
  MONTHS,
  notAllowed,
  onSignal,
  operatorLabel,
  operatorsFor,
  SPAN_UNITS,
  WEEKDAYS,
  withValue,
} from './rule-text';
import { SignalCatalogue } from './signal-catalogue';
import { SignalPicker } from './signal-picker';
import { TranslatePipe } from '@homey-dash/i18n';

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-12-24T18:00" in local time, for a datetime-local input. */
function localInput(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * One condition, set out as a line you can read across: the signal on top, picked in a dialog by where it comes from,
 * and under it how it is compared ("not", the operator, the value). It has no frame of its own; the rule it sits in
 * draws the rail that joins it to its neighbours.
 */
@Component({
  selector: 'hd-condition-editor',
  imports: [NgTemplateOutlet, SignalPicker, LucideDynamicIcon, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="top">
      <hd-signal-picker [value]="condition().signal" (picked)="pickSignal($event)" />
      @if (removable()) {
        <button type="button" class="drop" [attr.aria-label]="'Remove condition' | t" (click)="removed.emit()">
          <svg [lucideIcon]="x" aria-hidden="true" />
        </button>
      }
    </div>
    @if (!signal()) {
      <p class="warn">HomeyDash no longer has the signal "{{ condition().signal }}". Pick another, or remove this condition.</p>
    }

    <div class="how">
      <button type="button" class="not" [attr.aria-pressed]="!!condition().not" (click)="setNot(!condition().not)">{{ 'Not' | t }}</button>
      <select class="hd-select op" [attr.aria-label]="'Operator' | t" (change)="setOperator($any($event.target).value)">
        @for (op of operators(); track op) {
          <option [value]="op" [selected]="op === condition().operator">{{ label(op) }}</option>
        }
      </select>

      @switch (condition().operator) {
        @case ('between') {
          <div class="val">
            <input class="hd-input" type="number" [attr.aria-label]="'From' | t" [attr.min]="signal()?.min" [attr.max]="signal()?.max" [attr.step]="signal()?.step"
              [value]="range().min" (change)="set({ min: +$any($event.target).value, max: range().max })" />
            <span>{{ 'and' | t }}</span>
            <input class="hd-input" type="number" [attr.aria-label]="'To' | t" [attr.min]="signal()?.min" [attr.max]="signal()?.max" [attr.step]="signal()?.step"
              [value]="range().max" (change)="set({ min: range().min, max: +$any($event.target).value })" />
            @if (signal()?.unit; as unit) {
              <span>{{ unit }}</span>
            }
          </div>
        }
        @case ('timeOfDayBetween') {
          <div class="val">
            <input class="hd-input" type="time" step="1" [attr.aria-label]="'From' | t" [value]="fromTo().from" (change)="setFromTo('from', $any($event.target).value)" />
            <span>{{ 'and' | t }}</span>
            <input class="hd-input" type="time" step="1" [attr.aria-label]="'To' | t" [value]="fromTo().to" (change)="setFromTo('to', $any($event.target).value)" />
          </div>
        }
        @case ('dateBetween') {
          <div class="val wide stack">
            @for (end of ends; track end) {
              <div class="val">
                <span class="end">{{ end === 'from' ? 'From' : 'To' }}</span>
                <select class="hd-select" [attr.aria-label]="(end === 'from' ? 'From' : 'To') + ' month'" (change)="setDay(end, +$any($event.target).value, day(end).day)">
                  @for (month of months; track $index) {
                    <option [value]="$index + 1" [selected]="$index + 1 === day(end).month">{{ month }}</option>
                  }
                </select>
                <input class="hd-input" type="number" min="1" max="31" [attr.aria-label]="(end === 'from' ? 'From' : 'To') + ' day'"
                  [value]="day(end).day" (change)="setDay(end, day(end).month, +$any($event.target).value)" />
              </div>
            }
          </div>
        }
        @case ('onWeekdays') {
          <div class="val wide days" role="group" [attr.aria-label]="'Days' | t">
            @for (d of weekdays; track d.id) {
              <label class="day">
                <input type="checkbox" [checked]="days().includes(d.id)" (change)="toggleDay(d.id, $any($event.target).checked)" />
                <span>{{ d.label }}</span>
              </label>
            }
          </div>
        }
        @case ('withinLast') {
          <ng-container *ngTemplateOutlet="spanInputs" />
        }
        @case ('longerAgoThan') {
          <ng-container *ngTemplateOutlet="spanInputs" />
        }
        @case ('before') {
          <div class="val wide">
            <input class="hd-input" type="datetime-local" [attr.aria-label]="'Moment' | t" [value]="moment()" (change)="setMoment($any($event.target).value)" />
          </div>
        }
        @case ('after') {
          <div class="val wide">
            <input class="hd-input" type="datetime-local" [attr.aria-label]="'Moment' | t" [value]="moment()" (change)="setMoment($any($event.target).value)" />
          </div>
        }
        @case ('isTrue') {}
        @case ('isFalse') {}
        @case ('isEmpty') {}
        @default {
          @if (signal()?.allowedValues; as allowed) {
            <div class="val">
              <select class="hd-select" [attr.aria-label]="'Value' | t" (change)="set($any($event.target).value)">
                @if (stale()) {
                  <option [value]="condition().value" selected>{{ condition().value }} (no longer offered)</option>
                }
                @for (v of allowed; track v.value) {
                  <option [value]="v.value" [selected]="v.value === condition().value">{{ v.label }}</option>
                }
              </select>
            </div>
          } @else if (isNumber()) {
            <div class="val">
              <input class="hd-input" type="number" [attr.aria-label]="'Value' | t" [attr.min]="signal()?.min" [attr.max]="signal()?.max" [attr.step]="signal()?.step"
                [value]="condition().value" (change)="set(+$any($event.target).value)" />
              @if (signal()?.unit; as unit) {
                <span>{{ unit }}</span>
              }
            </div>
          } @else {
            <div class="val">
              <input class="hd-input" [attr.aria-label]="'Value' | t" [value]="condition().value ?? ''" (change)="set($any($event.target).value)" />
            </div>
          }
        }
      }
    </div>
    @if (stale()) {
      <p class="warn">"{{ condition().value }}" is no longer one of this signal's values, so this condition never holds.</p>
    }

    <ng-template #spanInputs>
      <div class="val">
        <input class="hd-input" type="number" min="1" [attr.aria-label]="'Amount' | t" [value]="span().amount" (change)="set({ amount: +$any($event.target).value, unit: span().unit })" />
        <select class="hd-select" [attr.aria-label]="'Unit' | t" (change)="set({ amount: span().amount, unit: $any($event.target).value })">
          @for (unit of units; track unit) {
            <option [value]="unit" [selected]="unit === span().unit">{{ unit }}</option>
          }
        </select>
      </div>
    </ng-template>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    .top { display: flex; align-items: center; gap: var(--space-1); }
    .top hd-signal-picker { flex: 1; min-width: 0; display: flex; }
    .top ::ng-deep .hd-picker__trigger { flex: 1; min-width: 0; font-weight: 700; }
    .drop {
      flex: none; display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: var(--radius-control);
      background: none; color: var(--ink-muted); cursor: pointer;
    }
    .drop:hover { background: color-mix(in oklab, var(--danger) 12%, transparent); color: var(--danger); }
    .drop svg { width: 16px; height: 16px; }
    .how { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 8px; }
    .not {
      flex: none; padding: 7px 10px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--panel); color: var(--ink-muted);
      font: 700 12px/1.3 var(--font-sans); cursor: pointer;
    }
    .not[aria-pressed='true'] { background: var(--ink); border-color: var(--ink); color: var(--panel); }
    .op { flex: 1 1 130px; min-width: 0; }
    .val { flex: 1 1 130px; min-width: 0; display: flex; align-items: center; gap: var(--space-2); color: var(--ink-muted); }
    .val.wide { flex-basis: 100%; }
    .val.stack { flex-direction: column; align-items: stretch; }
    .val > .hd-select, .val > .hd-input { flex: 1; min-width: 0; }
    .end { width: 3em; flex: none; }
    .days { flex-wrap: wrap; gap: 6px; }
    .day { position: relative; cursor: pointer; }
    .day input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
    .day span {
      display: block; min-width: 42px; padding: 7px 4px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--panel);
      color: var(--ink-muted); font: 700 12px/1.3 var(--font-sans); text-align: center;
    }
    .day input:checked + span { background: color-mix(in oklab, var(--brand) 14%, var(--panel)); border-color: var(--brand); color: var(--brand); }
    .day input:focus-visible + span { outline: 3px solid var(--brand); outline-offset: 2px; }
    .warn { color: var(--danger); margin: 0; font-size: 13px; }
  `,
})
export class ConditionEditor {
  readonly condition = input.required<Condition>();
  readonly removable = input(true);
  readonly changed = output<Condition>();
  readonly removed = output<void>();

  private readonly catalogue = inject(SignalCatalogue);

  protected readonly x = LucideX;
  protected readonly weekdays = WEEKDAYS;
  protected readonly units = SPAN_UNITS;
  protected readonly months = MONTHS;
  protected readonly ends = ['from', 'to'] as const;

  protected readonly signal = computed(() => this.catalogue.byId().get(this.condition().signal));
  protected readonly operators = computed(() => operatorsFor(this.signal(), this.condition()));
  protected readonly stale = computed(() => notAllowed(this.condition(), this.signal()));
  protected readonly isNumber = computed(() => this.signal()?.type === 'number' || typeof this.condition().value === 'number');

  protected readonly range = computed(() => this.condition().value as { min: number; max: number });
  protected readonly fromTo = computed(() => this.condition().value as { from: string; to: string });
  protected readonly span = computed(() => this.condition().value as { amount: number; unit: SpanUnit });
  protected readonly days = computed(() => (this.condition().value as Weekday[] | undefined) ?? []);
  protected readonly moment = computed(() => localInput(this.condition().value as string));

  protected label(op: Operator) {
    return operatorLabel(op, this.signal());
  }

  protected day(end: 'from' | 'to') {
    const [month, day] = (this.fromTo()[end] ?? '01-01').split('-').map(Number);
    return { month, day };
  }

  protected pickSignal(id: string) {
    const signal = this.catalogue.byId().get(id);
    if (signal) this.changed.emit(onSignal(this.condition(), signal, this.signal()));
  }

  protected setOperator(operator: Operator) {
    this.changed.emit(withValue({ ...this.condition(), operator }, defaultValue(operator, this.signal())));
  }

  protected setNot(not: boolean) {
    this.changed.emit({ ...this.condition(), not: not || undefined });
  }

  protected set(value: ConditionValue) {
    this.changed.emit(withValue(this.condition(), value));
  }

  protected setFromTo(end: 'from' | 'to', value: string) {
    if (value) this.set({ ...this.fromTo(), [end]: value });
  }

  protected setDay(end: 'from' | 'to', month: number, day: number) {
    const last = new Date(2024, month, 0).getDate();
    this.set({ ...this.fromTo(), [end]: `${pad(month)}-${pad(Math.min(Math.max(day || 1, 1), last))}` });
  }

  protected toggleDay(day: Weekday, on: boolean) {
    const days = new Set(this.days());
    if (on) days.add(day);
    else days.delete(day);
    this.set(WEEKDAYS.map((d) => d.id).filter((d) => days.has(d)));
  }

  protected setMoment(local: string) {
    const d = new Date(local);
    if (!isNaN(d.getTime())) this.set(d.toISOString());
  }
}

/**
 * A rule: its conditions and groups, and whether all or any of them must hold. Terms hang on one rail, and the word on
 * the rail between two ("and", "or") is how they combine, so a long rule reads top to bottom. A group is a rule of its
 * own in a tinted block, one level deep, and combines the other way than the rule around it. Once a rule has more than
 * one term it is also written out in words underneath, to check what it says.
 */
@Component({
  selector: 'hd-rule-editor',
  imports: [ConditionEditor, LucideDynamicIcon, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.group]': 'group()' },
  template: `
    <div class="head">
      <span class="label">{{ (group() ? 'Group' : 'Show when') | t }}</span>
      @if (rule().conditions.length > 1) {
        <select class="hd-select" [attr.aria-label]="'Combine conditions' | t" (change)="setMatch($any($event.target).value)">
          <option value="all" [selected]="rule().match === 'all'">{{ 'all of these hold' | t }}</option>
          <option value="any" [selected]="rule().match === 'any'">{{ 'any of these holds' | t }}</option>
        </select>
      }
      @if (group() && removable()) {
        <button type="button" class="drop" [attr.aria-label]="'Remove group' | t" (click)="removed.emit()">
          <svg [lucideIcon]="x" aria-hidden="true" />
        </button>
      }
    </div>

    <ol class="terms">
      @for (term of rule().conditions; track $index; let i = $index) {
        @if (i > 0) {
          <li class="joiner" [class.or]="rule().match === 'any'" aria-hidden="true"><span>{{ rule().match === 'all' ? 'and' : 'or' }}</span></li>
        }
        <li class="term">
          @if (isGroup(term)) {
            <hd-rule-editor
              [rule]="term"
              [group]="true"
              [removable]="rule().conditions.length > 1"
              (changed)="setTerm(i, $event)"
              (removed)="removeTerm(i)"
            />
          } @else {
            <hd-condition-editor
              [condition]="term"
              [removable]="rule().conditions.length > 1"
              (changed)="setTerm(i, $event)"
              (removed)="removeTerm(i)"
            />
          }
        </li>
      }
    </ol>

    <div class="actions">
      <button type="button" class="add" (click)="addCondition()">{{ '+ Condition' | t }}</button>
      @if (!group()) {
        <button type="button" class="add" (click)="addGroup()">{{ '+ Group' | t }}</button>
      }
    </div>

    @if (!group() && complex()) {
      <p class="words"><span class="label">{{ 'In words' | t }}</span>{{ words() }}</p>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; min-width: 0; }
    :host(.group) { padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-panel); background: color-mix(in oklab, var(--ink) 4%, transparent); }
    .label { font: 700 12px/1.3 var(--font-sans); color: var(--ink-muted); }
    .head { display: flex; margin-bottom: var(--space-3); align-items: center; gap: var(--space-2); min-height: 32px; }
    .head .hd-select { flex: 1; min-width: 0; }
    .drop {
      flex: none; display: grid; place-items: center; width: 32px; height: 32px; margin-left: auto; padding: 0; border: 0; border-radius: var(--radius-control);
      background: none; color: var(--ink-muted); cursor: pointer;
    }
    .drop:hover { background: color-mix(in oklab, var(--danger) 12%, transparent); color: var(--danger); }
    .drop svg { width: 16px; height: 16px; }

    /* The rail every term hangs on; the joining word sits on it between two terms. */
    .terms { list-style: none; margin: 0; padding: 4px 0 4px 18px; border-left: 2px solid var(--line); display: flex; flex-direction: column; }
    .term { min-width: 0; }
    .joiner { display: flex; margin: 14px 0; margin-left: -21px; }
    .joiner span {
      padding: 1px 8px; border: 1px solid var(--line); border-radius: var(--radius-pill); background: var(--panel); color: var(--ink-muted);
      font: 800 10px/1.5 var(--font-sans); letter-spacing: .08em; text-transform: uppercase;
    }
    .joiner.or span { color: var(--ink); border-color: var(--ink-muted); }
    :host(.group) .joiner span { background: color-mix(in oklab, var(--ink) 4%, var(--panel)); }

    .actions { display: flex; gap: var(--space-2); margin-top: var(--space-4); }
    .add {
      padding: 6px 10px; border: 1px dashed var(--line); border-radius: var(--radius-control); background: none; color: var(--brand);
      font: 700 13px/1.3 var(--font-sans); cursor: pointer;
    }
    .add:hover { border-style: solid; border-color: var(--brand); }
    .add:focus-visible { outline: 3px solid var(--brand); outline-offset: 2px; }

    .words { display: flex; flex-direction: column; gap: 2px; margin: var(--space-4) 0 0; padding-top: var(--space-4); border-top: 1px solid var(--line); color: var(--ink); font-size: 13px; text-wrap: pretty; }
  `,
})
export class RuleEditor {
  readonly rule = input.required<Rule>();
  /** Whether this is a group within a rule, which can be removed but holds no groups of its own. */
  readonly group = input(false);
  readonly removable = input(true);
  readonly changed = output<Rule>();
  readonly removed = output<void>();

  private readonly catalogue = inject(SignalCatalogue);

  protected readonly isGroup = isGroup;
  protected readonly x = LucideX;

  protected readonly complex = computed(() => this.rule().conditions.length > 1 || this.rule().conditions.some(isGroup));
  protected readonly words = computed(() => describeRuleFull(this.rule(), this.catalogue.byId()));

  protected setMatch(match: Rule['match']) {
    this.changed.emit({ ...this.rule(), match });
  }

  protected setTerm(index: number, term: Condition | Rule) {
    this.changed.emit({ ...this.rule(), conditions: this.rule().conditions.map((c, i) => (i === index ? term : c)) });
  }

  protected removeTerm(index: number) {
    this.changed.emit({ ...this.rule(), conditions: this.rule().conditions.filter((_, i) => i !== index) });
  }

  // Starts as "the clock is on any day", which always holds, until another signal is picked.
  protected addCondition() {
    this.changed.emit({ ...this.rule(), conditions: [...this.rule().conditions, ...alwaysRule().conditions] });
  }

  // A group combines its conditions the other way than the rule does, or it would change nothing.
  protected addGroup() {
    const match = this.rule().match === 'all' ? 'any' : 'all';
    this.changed.emit({ ...this.rule(), conditions: [...this.rule().conditions, { match, conditions: alwaysRule().conditions }] });
  }
}
