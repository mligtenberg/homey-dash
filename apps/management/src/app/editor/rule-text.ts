import { Condition, ConditionValue, isGroup, Operator, OPERATORS, Rule, SignalInfo, SpanUnit, Weekday } from '@homey-dash/api-client';

export const WEEKDAYS: readonly { id: Weekday; label: string }[] = [
  { id: 'monday', label: 'Mon' },
  { id: 'tuesday', label: 'Tue' },
  { id: 'wednesday', label: 'Wed' },
  { id: 'thursday', label: 'Thu' },
  { id: 'friday', label: 'Fri' },
  { id: 'saturday', label: 'Sat' },
  { id: 'sunday', label: 'Sun' },
];

export const SPAN_UNITS: readonly SpanUnit[] = ['seconds', 'minutes', 'hours', 'days'];

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The operators a signal offers; for one the catalogue no longer has, its condition's own. */
export function operatorsFor(signal: SignalInfo | undefined, condition: Condition): readonly Operator[] {
  return signal ? OPERATORS[signal.type] : [condition.operator];
}

/** How an operator reads after the signal's name: "is above", "is open". */
export function operatorLabel(operator: Operator, signal?: SignalInfo): string {
  switch (operator) {
    case 'equals':
      return 'is';
    case 'greaterThan':
      return 'is above';
    case 'lessThan':
      return 'is below';
    case 'between':
      return 'is between';
    case 'isTrue':
      return `is ${signal?.trueLabel ?? 'yes'}`;
    case 'isFalse':
      return `is ${signal?.falseLabel ?? 'no'}`;
    case 'contains':
      return 'contains';
    case 'startsWith':
      return 'starts with';
    case 'isEmpty':
      return 'is empty';
    case 'timeOfDayBetween':
      return 'time of day is between';
    case 'onWeekdays':
      return 'is on';
    case 'withinLast':
      return 'is within the last';
    case 'longerAgoThan':
      return 'is longer ago than';
    case 'dateBetween':
      return 'date is between';
    case 'before':
      return 'is before';
    case 'after':
      return 'is after';
  }
}

/** A value that suits an operator, to start a condition with. */
export function defaultValue(operator: Operator, signal?: SignalInfo): ConditionValue {
  switch (operator) {
    case 'equals':
      return signal?.type === 'text' ? (signal.allowedValues?.[0]?.value ?? '') : (signal?.min ?? 0);
    case 'greaterThan':
    case 'lessThan':
      return signal?.min ?? 0;
    case 'between':
      return { min: signal?.min ?? 0, max: signal?.max ?? 100 };
    case 'contains':
    case 'startsWith':
      return '';
    case 'timeOfDayBetween':
      return { from: '08:00', to: '20:00' };
    case 'onWeekdays':
      return WEEKDAYS.map((d) => d.id);
    case 'withinLast':
    case 'longerAgoThan':
      return { amount: 5, unit: 'minutes' };
    case 'dateBetween':
      return { from: '12-01', to: '01-06' };
    case 'before':
    case 'after':
      return new Date().toISOString();
    default:
      return null;
  }
}

/** A condition on a signal, keeping the operator and value when they still suit it. */
export function onSignal(condition: Condition, signal: SignalInfo, previous?: SignalInfo): Condition {
  const keeps = previous?.type === signal.type && (OPERATORS[signal.type] as readonly Operator[]).includes(condition.operator)
    && !(signal.allowedValues && condition.operator === 'equals');
  if (keeps) return { ...condition, signal: signal.id };
  const operator = OPERATORS[signal.type][0];
  return withValue({ signal: signal.id, operator, ...(condition.not ? { not: true } : {}) }, defaultValue(operator, signal));
}

/** A condition with a value; is true, is false and is empty take none. */
export function withValue(condition: Condition, value: ConditionValue): Condition {
  return { ...condition, value: value ?? undefined };
}

/** Whether a text condition compares with a value its signal no longer takes, such as a mode a firmware update removed. */
export function notAllowed(condition: Condition, signal: SignalInfo | undefined): boolean {
  return !!signal?.allowedValues && condition.operator === 'equals' && typeof condition.value === 'string'
    && !signal.allowedValues.some((v) => v.value === condition.value);
}

function valueText(condition: Condition, signal?: SignalInfo): string {
  const value = condition.value;
  if (value == null) return '';
  if (typeof value === 'string') {
    if (condition.operator === 'before' || condition.operator === 'after') return new Date(value).toLocaleString();
    return `"${signal?.allowedValues?.find((v) => v.value === value)?.label ?? value}"`;
  }
  if (typeof value === 'number') return `${value}${signal?.unit ? ` ${signal.unit}` : ''}`;
  if (Array.isArray(value)) return WEEKDAYS.filter((d) => value.includes(d.id)).map((d) => d.label).join(', ');
  if ('min' in value) return `${value.min} and ${value.max}${signal?.unit ? ` ${signal.unit}` : ''}`;
  if ('amount' in value) return `${value.amount} ${value.unit}`;
  return `${value.from} and ${value.to}`;
}

/** "Floor lamp On is on", or "not …" when negated. */
export function describeCondition(condition: Condition, signal?: SignalInfo): string {
  const name = signal ? (signal.group && signal.group !== signal.name ? `${signal.group} ${signal.name}` : signal.name) : 'Missing signal';
  const text = [name, operatorLabel(condition.operator, signal), valueText(condition, signal)].filter(Boolean).join(' ');
  return condition.not ? `not: ${text}` : text;
}

/** A condition, or a group in brackets: "(Floor lamp On is on and Guests is yes)". */
function describeTerm(term: Condition | Rule, signals: ReadonlyMap<string, SignalInfo>): string {
  if (!isGroup(term)) return describeCondition(term, signals.get(term.signal));
  return `(${term.conditions.map((t) => describeTerm(t, signals)).join(term.match === 'all' ? ' and ' : ' or ')})`;
}

/** A rule in a line: its first condition or group, and how many more. */
export function describeRule(rule: Rule, signals: ReadonlyMap<string, SignalInfo>): string {
  const [first, ...rest] = rule.conditions;
  if (!first) return 'No conditions';
  const text = describeTerm(first, signals);
  return rest.length ? `${text} ${rule.match === 'all' ? 'and' : 'or'} ${rest.length} more` : text;
}

/** A rule in full, as one sentence: every condition, with groups in brackets, "A and (B or C)". */
export function describeRuleFull(rule: Rule, signals: ReadonlyMap<string, SignalInfo>): string {
  if (!rule.conditions.length) return 'No conditions';
  return rule.conditions.map((t) => describeTerm(t, signals)).join(rule.match === 'all' ? ' and ' : ' or ');
}
