import { computed, effect, inject, signal, Signal, untracked } from '@angular/core';
import { Section } from '@homey-dash/api-client';
import { RuleAnswers } from './rule-answers';

/**
 * The ids of the sections displays show now: not the hidden ones, and those with a rule only while it holds, as
 * HomeyDash answers it (ADR-0010). One whose rule has not answered yet, or was refused, is left out.
 * Call it in an injection context; it subscribes for as long as that lives.
 */
export function shownSections(sections: () => Section[]): Signal<ReadonlySet<string>> {
  const answers = inject(RuleAnswers);
  const heard = signal<ReadonlyMap<string, boolean>>(new Map());
  // Compared by value, so moving tiles around doesn't subscribe again.
  const rules = computed(
    () => sections().flatMap((s) => (!s.hidden && s.rule ? [{ id: s.id, rule: s.rule }] : [])),
    { equal: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
  );

  effect((onCleanup) => {
    const watched = rules();
    untracked(() => {
      heard.set(new Map());
      const stops = watched.map(({ id, rule }) =>
        answers.subscribe(rule, (holds) => heard.update((h) => new Map(h).set(id, holds === true))),
      );
      onCleanup(() => stops.forEach((stop) => stop()));
    });
  });

  return computed(() => new Set(sections().filter((s) => !s.hidden && (!s.rule || heard().get(s.id))).map((s) => s.id)));
}
