import { Rule } from '@homey-dash/api-client';

/** A rule that always holds, for a new entry or condition: the clock is on any day. */
export function alwaysRule(): Rule {
  return {
    match: 'all',
    conditions: [
      {
        signal: 'clock:now',
        operator: 'onWeekdays',
        value: [
          'monday',
          'tuesday',
          'wednesday',
          'thursday',
          'friday',
          'saturday',
          'sunday',
        ],
      },
    ],
  };
}
