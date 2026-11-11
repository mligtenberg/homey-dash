import { signal } from '@angular/core';

/** The languages HomeyDash speaks. English is the source language every text is written in. */
export const LOCALES = ['en', 'nl'] as const;
export type Locale = (typeof LOCALES)[number];

/** What a language calls itself, for pickers. */
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', nl: 'Nederlands' };

/** The tag `Intl` and `toLocale…String` format dates, times and numbers with. */
const FORMAT_TAGS: Record<Locale, string> = { en: 'en-GB', nl: 'nl-NL' };

const current = signal<Locale>('en');

/** The language in use. Reading it in a template or `computed` makes that follow a change of language. */
export const locale = current.asReadonly();

/** The `Intl` tag of the language in use. */
export const formatTag = (): string => FORMAT_TAGS[current()];

/** The supported language a browser language tag such as `nl-BE` stands for, if any. */
export function matchLocale(tag: string | null | undefined): Locale | null {
  const language = tag?.toLowerCase().split(/[-_]/)[0];
  return LOCALES.find((l) => l === language) ?? null;
}

/** The first supported language of a list of tags, such as the browser's, else English. */
export function pickLocale(tags: readonly (string | null | undefined)[]): Locale {
  for (const tag of tags) {
    const found = matchLocale(tag);
    if (found) return found;
  }
  return 'en';
}

/** Switches the language, in texts, formats and the page's `lang`. An unknown tag is ignored. */
export function setLocale(tag: string | null | undefined): void {
  const next = matchLocale(tag);
  if (!next) return;
  current.set(next);
  if (typeof document !== 'undefined') document.documentElement.lang = next;
}

/** The browser's preferred language, else English. */
export function browserLocale(): Locale {
  return pickLocale(typeof navigator === 'undefined' ? [] : [...(navigator.languages ?? []), navigator.language]);
}
