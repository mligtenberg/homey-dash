import { Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { setLocale } from './locale';
import { translatePage } from './dom-translate';
import { NL } from './catalogs/nl';

const tick = () => new Promise((resolve) => setTimeout(resolve));

describe('translatePage', () => {
  afterEach(() => {
    setLocale('en');
    document.body.innerHTML = '';
    delete NL['Zzz save'];
    delete NL['Zzz play {name}.'];
  });

  it('translates texts and attributes on the page, as they change, and back', async () => {
    NL['Zzz save'] = 'Opslaan';
    NL['Zzz play {name}.'] = '{name} afspelen.';
    document.body.innerHTML = '<button title="Zzz save">Zzz save</button><p data-no-translate>Zzz save</p><span>Zzz play Tv.</span>';
    translatePage(TestBed.inject(Injector));
    setLocale('nl');
    TestBed.tick();
    await tick();
    const [button, kept, span] = ['button', 'p', 'span'].map((s) => document.querySelector(s) as HTMLElement);
    expect(button.textContent).toBe('Opslaan');
    expect(button.title).toBe('Opslaan');
    expect(kept.textContent).toBe('Zzz save');
    expect(span.textContent).toBe('Tv afspelen.');

    button.firstChild!.nodeValue = 'Zzz save';
    await tick();
    expect(button.textContent).toBe('Opslaan');

    setLocale('en');
    TestBed.tick();
    await tick();
    expect(button.textContent).toBe('Zzz save');
    expect(button.title).toBe('Zzz save');
  });
});
