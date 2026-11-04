import { ApplicationRef, Injector, runInInjectionContext, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Rule, Section } from '@homey-dash/api-client';
import { RuleAnswers } from './rule-answers';
import { shownSections } from './shown-sections';

class FakeAnswers extends RuleAnswers {
  readonly listeners = new Map<Rule, (holds: boolean | null) => void>();
  subscribe(rule: Rule, listener: (holds: boolean | null) => void) {
    this.listeners.set(rule, listener);
    return () => this.listeners.delete(rule);
  }
}

describe('shownSections', () => {
  const rule: Rule = { match: 'all', conditions: [{ signal: 'clock:now', operator: 'onWeekdays', value: ['monday'] }] };
  const section = (id: string, more: Partial<Section> = {}): Section => ({ id, title: id, tiles: [], ...more });

  it('leaves out hidden sections, and those with a rule until it holds', async () => {
    const answers = new FakeAnswers();
    TestBed.configureTestingModule({ providers: [{ provide: RuleAnswers, useValue: answers }] });
    const sections = signal([section('a'), section('b', { hidden: true }), section('c', { rule })]);
    const shown = runInInjectionContext(TestBed.inject(Injector), () => shownSections(sections));
    await TestBed.inject(ApplicationRef).whenStable();

    expect([...shown()]).toEqual(['a']);

    answers.listeners.get(rule)?.(true);
    expect([...shown()]).toEqual(['a', 'c']);

    answers.listeners.get(rule)?.(false);
    expect([...shown()]).toEqual(['a']);
  });
});
