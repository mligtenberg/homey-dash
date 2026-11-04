import { SignalInfo } from '@homey-dash/api-client';
import { describeRule, notAllowed, onSignal } from './rule-text';

const thermostat: SignalInfo = {
  id: 'homey:1:capability:t:target_temperature',
  source: 'homey',
  type: 'number',
  name: 'Target temperature',
  group: 'Thermostat',
  unit: '°C',
  min: 5,
};
const heating: SignalInfo = { ...thermostat, id: 'homey:1:capability:t:measure_temperature', name: 'Temperature' };
const mode: SignalInfo = {
  id: 'homey:1:capability:t:thermostat_mode',
  source: 'homey',
  type: 'text',
  name: 'Mode',
  group: 'Thermostat',
  allowedValues: [
    { value: 'heat', label: 'Heat' },
    { value: 'off', label: 'Off' },
  ],
};
const door: SignalInfo = { id: 'homey:1:capability:d:alarm_contact', source: 'homey', type: 'yesNo', name: 'Contact', group: 'Front door', trueLabel: 'open' };

describe('rule text', () => {
  it('keeps the operator and value when picking another signal of the same type', () => {
    const condition = { signal: thermostat.id, operator: 'greaterThan' as const, value: 21 };

    expect(onSignal(condition, heating, thermostat)).toEqual({ ...condition, signal: heating.id });
  });

  it('starts over with an operator and value that suit a signal of another type, keeping "not"', () => {
    const condition = { signal: thermostat.id, operator: 'greaterThan' as const, value: 21, not: true };

    expect(onSignal(condition, mode, thermostat)).toEqual({ signal: mode.id, operator: 'equals', value: 'heat', not: true });
    expect(onSignal(condition, door, thermostat)).toEqual({ signal: door.id, operator: 'isTrue', value: undefined, not: true });
  });

  it('notices a value its signal no longer offers', () => {
    expect(notAllowed({ signal: mode.id, operator: 'equals', value: 'eco' }, mode)).toBe(true);
    expect(notAllowed({ signal: mode.id, operator: 'equals', value: 'heat' }, mode)).toBe(false);
  });

  it('sums a rule up in a line, in its signals own words', () => {
    const signals = new Map([door, thermostat].map((s) => [s.id, s]));

    expect(
      describeRule(
        {
          match: 'any',
          conditions: [
            { signal: door.id, operator: 'isTrue' },
            { signal: thermostat.id, operator: 'lessThan', value: 18 },
          ],
        },
        signals,
      ),
    ).toBe('Front door Contact is open or 1 more');
    expect(describeRule({ match: 'all', conditions: [{ signal: thermostat.id, operator: 'lessThan', value: 18, not: true }] }, signals)).toBe(
      'not: Thermostat Target temperature is below 18 °C',
    );
  });

  it('sums up a group in brackets', () => {
    const signals = new Map([door, thermostat].map((s) => [s.id, s]));
    const group = {
      match: 'all' as const,
      conditions: [
        { signal: door.id, operator: 'isTrue' as const },
        { signal: thermostat.id, operator: 'lessThan' as const, value: 18 },
      ],
    };

    expect(describeRule({ match: 'any', conditions: [group, { signal: door.id, operator: 'isFalse' }] }, signals)).toBe(
      '(Front door Contact is open and Thermostat Target temperature is below 18 °C) or 1 more',
    );
  });
});
