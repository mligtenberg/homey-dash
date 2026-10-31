import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { Condition, ConditionValue, Operator, Rule, SpanUnit, Weekday } from '@homey-dash/api-client';
import { alwaysRule } from '@homey-dash/tiles';
import {
  defaultValue,
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

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-12-24T18:00" in local time, for a datetime-local input. */
function localInput(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** One condition: its signal, picked in a dialog by where it comes from, then an operator that suits it and a value. */
@Component({
  selector: 'hd-condition-editor',
  imports: [NgTemplateOutlet, SignalPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hd-signal-picker [value]="condition().signal" (picked)="pickSignal($event)" />
    @if (!signal()) {
      <p class="warn">HomeyDash no longer has the signal "{{ condition().signal }}". Pick another, or remove this condition.</p>
    }

    <div class="pick">
      <label class="hd-check not">
        <input type="checkbox" [checked]="!!condition().not" (change)="setNot($any($event.target).checked)" />
        Not
      </label>
      <select class="hd-select" aria-label="Operator" (change)="setOperator($any($event.target).value)">
        @for (op of operators(); track op) {
          <option [value]="op" [selected]="op === condition().operator">{{ label(op) }}</option>
        }
      </select>
    </div>

    @switch (condition().operator) {
      @case ('between') {
        <div class="pick">
          <input class="hd-input" type="number" aria-label="From" [attr.min]="signal()?.min" [attr.max]="signal()?.max" [attr.step]="signal()?.step"
            [value]="range().min" (change)="set({ min: +$any($event.target).value, max: range().max })" />
          <span>and</span>
          <input class="hd-input" type="number" aria-label="To" [attr.min]="signal()?.min" [attr.max]="signal()?.max" [attr.step]="signal()?.step"
            [value]="range().max" (change)="set({ min: range().min, max: +$any($event.target).value })" />
          @if (signal()?.unit; as unit) {
            <span>{{ unit }}</span>
          }
        </div>
      }
      @case ('timeOfDayBetween') {
        <div class="pick">
          <input class="hd-input" type="time" step="1" aria-label="From" [value]="fromTo().from" (change)="setFromTo('from', $any($event.target).value)" />
          <span>and</span>
          <input class="hd-input" type="time" step="1" aria-label="To" [value]="fromTo().to" (change)="setFromTo('to', $any($event.target).value)" />
        </div>
      }
      @case ('dateBetween') {
        @for (end of ends; track end) {
          <div class="pick">
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
      }
      @case ('onWeekdays') {
        <div class="days">
          @for (d of weekdays; track d.id) {
            <label class="hd-check">
              <input type="checkbox" [checked]="days().includes(d.id)" (change)="toggleDay(d.id, $any($event.target).checked)" />
              {{ d.label }}
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
        <input class="hd-input" type="datetime-local" aria-label="Moment" [value]="moment()" (change)="setMoment($any($event.target).value)" />
      }
      @case ('after') {
        <input class="hd-input" type="datetime-local" aria-label="Moment" [value]="moment()" (change)="setMoment($any($event.target).value)" />
      }
      @case ('isTrue') {}
      @case ('isFalse') {}
      @case ('isEmpty') {}
      @default {
        @if (signal()?.allowedValues; as allowed) {
          <select class="hd-select" aria-label="Value" (change)="set($any($event.target).value)">
            @if (stale()) {
              <option [value]="condition().value" selected>{{ condition().value }} (no longer offered)</option>
            }
            @for (v of allowed; track v.value) {
              <option [value]="v.value" [selected]="v.value === condition().value">{{ v.label }}</option>
            }
          </select>
        } @else if (isNumber()) {
          <div class="pick">
            <input class="hd-input" type="number" aria-label="Value" [attr.min]="signal()?.min" [attr.max]="signal()?.max" [attr.step]="signal()?.step"
              [value]="condition().value" (change)="set(+$any($event.target).value)" />
            @if (signal()?.unit; as unit) {
              <span>{{ unit }}</span>
            }
          </div>
        } @else {
          <input class="hd-input" aria-label="Value" [value]="condition().value ?? ''" (change)="set($any($event.target).value)" />
        }
      }
    }
    @if (stale()) {
      <p class="warn">"{{ condition().value }}" is no longer one of this signal's values, so this condition never holds.</p>
    }

    <ng-template #spanInputs>
      <div class="pick">
        <input class="hd-input" type="number" min="1" aria-label="Amount" [value]="span().amount" (change)="set({ amount: +$any($event.target).value, unit: span().unit })" />
        <select class="hd-select" aria-label="Unit" (change)="set({ amount: span().amount, unit: $any($event.target).value })">
          @for (unit of units; track unit) {
            <option [value]="unit" [selected]="unit === span().unit">{{ unit }}</option>
          }
        </select>
      </div>
    </ng-template>

    @if (removable()) {
      <button type="button" class="hd-btn remove" (click)="removed.emit()">Remove condition</button>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--line); border-radius: 10px; }
    .pick { display: flex; gap: var(--space-2); align-items: center; }
    .pick > .hd-select, .pick > .hd-input { flex: 1; min-width: 0; }
    .not { flex: none; }
    .end { width: 3em; color: var(--ink-muted); }
    .days { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .warn { color: var(--danger); margin: 0; font-size: 13px; }
    .remove { align-self: flex-start; }
  `,
})
export class ConditionEditor {
  readonly condition = input.required<Condition>();
  readonly removable = input(true);
  readonly changed = output<Condition>();
  readonly removed = output<void>();

  private readonly catalogue = inject(SignalCatalogue);

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

/** A rule: its conditions, and whether all or any of them must hold. */
@Component({
  selector: 'hd-rule-editor',
  imports: [ConditionEditor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <span class="hd-field__label">Show when</span>
      @if (rule().conditions.length > 1) {
        <select class="hd-select" aria-label="Combine conditions" (change)="setMatch($any($event.target).value)">
          <option value="all" [selected]="rule().match === 'all'">all of these hold</option>
          <option value="any" [selected]="rule().match === 'any'">any of these holds</option>
        </select>
      }
    </div>
    @for (condition of rule().conditions; track $index; let i = $index) {
      <hd-condition-editor
        [condition]="condition"
        [removable]="rule().conditions.length > 1"
        (changed)="setCondition(i, $event)"
        (removed)="removeCondition(i)"
      />
    }
    <button type="button" class="hd-btn add" (click)="addCondition()">Add condition</button>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--space-2); }
    .head { display: flex; align-items: center; gap: var(--space-2); }
    .head .hd-select { flex: 1; }
    .add { align-self: flex-start; }
  `,
})
export class RuleEditor {
  readonly rule = input.required<Rule>();
  readonly changed = output<Rule>();

  protected setMatch(match: Rule['match']) {
    this.changed.emit({ ...this.rule(), match });
  }

  protected setCondition(index: number, condition: Condition) {
    this.changed.emit({ ...this.rule(), conditions: this.rule().conditions.map((c, i) => (i === index ? condition : c)) });
  }

  protected removeCondition(index: number) {
    this.changed.emit({ ...this.rule(), conditions: this.rule().conditions.filter((_, i) => i !== index) });
  }

  // Starts as "the clock is on any day", which always holds, until another signal is picked.
  protected addCondition() {
    this.changed.emit({ ...this.rule(), conditions: [...this.rule().conditions, ...alwaysRule().conditions] });
  }
}
