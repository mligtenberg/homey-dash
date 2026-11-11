import { setLocale, pickLocale } from './locale';
import { t, tr } from './translate';
import { formatNumber } from './format';
import { NL } from './catalogs/nl';

describe('t', () => {
  afterEach(() => setLocale('en'));

  it('gives the English text itself, filling in parameters', () => {
    expect(t('Hello {name}', { name: 'Ann' })).toBe('Hello Ann');
  });

  it('picks the plural form by the count', () => {
    expect(t('{count} tile|{count} tiles', { count: 1 })).toBe('1 tile');
    expect(t('{count} tile|{count} tiles', { count: 3 })).toBe('3 tiles');
  });

  it('falls back to English for a text not translated yet', () => {
    setLocale('nl');
    expect(t('Not in the catalog')).toBe('Not in the catalog');
  });

  it('uses the catalog of the language in use', () => {
    NL['Save'] = 'Opslaan';
    setLocale('nl');
    expect(t('Save')).toBe('Opslaan');
    delete NL['Save'];
  });

  it('translates a finished text by the pattern it matches', () => {
    NL['Photo set {set} not found.'] = 'Fotoset {set} niet gevonden.';
    setLocale('nl');
    expect(tr('Photo set Holiday (2024) not found.')).toBe('Fotoset Holiday (2024) niet gevonden.');
    expect(tr('Something else.')).toBe('Something else.');
    delete NL['Photo set {set} not found.'];
  });

  it('formats numbers in the language in use', () => {
    setLocale('nl');
    expect(formatNumber(1.5)).toBe('1,5');
  });

  it('chooses the first supported browser language', () => {
    expect(pickLocale(['de-DE', 'nl-BE', 'en'])).toBe('nl');
    expect(pickLocale(['de'])).toBe('en');
  });
});
