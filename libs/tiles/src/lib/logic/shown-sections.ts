import { computed, Signal } from '@angular/core';
import { Rule, Section } from '@homey-dash/api-client';
import { ruleAnswersOf } from './rule-answers';

/**
 * The ids of the sections displays show now: not the hidden ones, and those with a rule only while it holds, as
 * HomeyDash answers it (ADR-0010). One whose rule has not answered yet, or was refused, is left out.
 * Call it in an injection context; it subscribes for as long as that lives.
 */
export function shownSections(sections: () => Section[]): Signal<ReadonlySet<string>> {
  const ruled = computed(() => sections().filter((s) => !s.hidden && s.rule));
  const heard = ruleAnswersOf(() => ruled().map((s) => s.rule as Rule));
  return computed(() => {
    const holding = new Set(ruled().filter((_, i) => heard()[i] === true).map((s) => s.id));
    return new Set(sections().filter((s) => !s.hidden && (!s.rule || holding.has(s.id))).map((s) => s.id));
  });
}
