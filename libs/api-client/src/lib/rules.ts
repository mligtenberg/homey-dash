import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

// Mirrors apps/api/Rules (ADR-0010).

/** There is no enum type: a text signal with `allowedValues` is one. */
export type SignalType = 'text' | 'yesNo' | 'number' | 'dateTime';

/** One of the values a text signal takes, such as a thermostat mode or a display, with what people call it. */
export interface AllowedValue {
  value: string;
  label: string;
}

/**
 * A live value HomeyDash knows, as the signal catalogue lists it. `source` is homey, clock, display or plex (or a
 * module's own); `group` is what it belongs to within it, such as its device. The rest only helps write conditions.
 */
export interface SignalInfo {
  id: string;
  source: string;
  type: SignalType;
  name: string;
  group: string;
  /** The account of a Homey or Plex signal. */
  account?: number | null;
  accountName?: string | null;
  allowedValues?: AllowedValue[] | null;
  unit?: string | null;
  min?: number | null;
  max?: number | null;
  step?: number | null;
  trueLabel?: string | null;
  falseLabel?: string | null;
}

export type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
export type SpanUnit = 'seconds' | 'minutes' | 'hours' | 'days';

/** The operators each signal type offers, in the order Management offers them. */
export const OPERATORS = {
  number: ['equals', 'greaterThan', 'lessThan', 'between'],
  yesNo: ['isTrue', 'isFalse'],
  text: ['equals', 'contains', 'startsWith', 'isEmpty'],
  dateTime: ['timeOfDayBetween', 'onWeekdays', 'withinLast', 'longerAgoThan', 'dateBetween', 'before', 'after'],
} as const satisfies Record<SignalType, readonly string[]>;

export type Operator = (typeof OPERATORS)[SignalType][number];

/**
 * A condition's value, by operator: a number (equals, greaterThan, lessThan), `{ min, max }` (between), a string
 * (text equals, contains, startsWith), none (isTrue, isFalse, isEmpty), `{ from, to }` as "HH:mm[:ss]"
 * (timeOfDayBetween, may wrap midnight) or "MM-DD" (dateBetween), weekdays (onWeekdays), `{ amount, unit }` (withinLast,
 * longerAgoThan) or an ISO 8601 moment (before, after).
 */
export type ConditionValue =
  | number
  | string
  | { min: number; max: number }
  | { from: string; to: string }
  | Weekday[]
  | { amount: number; unit: SpanUnit }
  | null;

/** One signal compared with a fixed value, optionally negated. */
export interface Condition {
  signal: string;
  operator: Operator;
  value?: ConditionValue;
  not?: boolean;
}

/**
 * One or more conditions or groups, of which all, or any, must hold. A group is a rule of its own, so a rule can say
 * "A and B, or C": `{ match: 'any', conditions: [{ match: 'all', conditions: [a, b] }, c] }`.
 */
export interface Rule {
  match: 'all' | 'any';
  conditions: (Condition | Rule)[];
}

/** Whether one of a rule's conditions is a group of its own. */
export function isGroup(term: Condition | Rule): term is Rule {
  return 'conditions' in term;
}

/** An answer to a subscription; `seq` orders every answer HomeyDash sends, so the latest wins. */
export interface RuleAnswer {
  holds: boolean;
  seq: number;
}

/** The answers that one change altered, by subscription id, sent together. */
export interface RuleAnswers {
  seq: number;
  answers: Record<string, boolean>;
}

/** The signal catalogue, and rules evaluated once; displays subscribe over the realtime connection instead. */
@Injectable({ providedIn: 'root' })
export class RulesApi {
  private readonly http = inject(HttpClient);

  signals() {
    return this.http.get<SignalInfo[]>('/api/rules/signals');
  }

  /** Whether each rule holds now, as if on `display` (or none), by the ids given. Invalid rules answer 400. */
  evaluate(rules: Record<string, Rule>, display: string | null = null) {
    return this.http.post<Record<string, boolean>>('/api/rules/evaluate', { rules, display });
  }
}
