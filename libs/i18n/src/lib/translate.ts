import { Pipe, PipeTransform } from '@angular/core';
import { formatTag, Locale, locale } from './locale';
import { NL } from './catalogs/nl';

/**
 * Texts are written in English and that text is the key: `t('Save')`. A language other than English looks the text
 * up in its catalog and falls back to the English text, so a text that is not translated yet still reads.
 *
 * `{name}` in a text is replaced by the same-named parameter. A text with a count has one form per plural category
 * of the language, in order and joined by `|`: `t('{count} tile|{count} tiles', { count })`. English and Dutch have
 * two, "one" and "other"; the count is the parameter named `count`.
 */
export type Params = Record<string, string | number>;

const CATALOGS: Record<Locale, Record<string, string>> = { en: {}, nl: NL };

function plural(text: string, count: number): string {
  const forms = text.split('|');
  if (forms.length < 2) return text;
  const category = new Intl.PluralRules(formatTag()).select(count);
  return forms[category === 'one' ? 0 : 1];
}

/** The text in the language in use. Reads the language, so a template or `computed` using it follows a change. */
export function t(text: string, params?: Params): string {
  const translated = CATALOGS[locale()][text] ?? text;
  const form = typeof params?.['count'] === 'number' ? plural(translated, params['count']) : translated.split('|')[0];
  return params ? form.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole)) : form;
}

const patterns = new Map<Record<string, string>, [RegExp, string, string[]][]>();

/** The catalog's texts that have `{name}` in them, as patterns to match a finished text against. */
function patternsOf(catalog: Record<string, string>): [RegExp, string, string[]][] {
  let found = patterns.get(catalog);
  if (!found || found.length !== Object.keys(catalog).filter((k) => k.includes('{')).length) {
    found = Object.keys(catalog)
      .filter((k) => k.includes('{'))
      .map((key) => {
        const names: string[] = [];
        const source = key
          .split(/\{(\w+)\}/)
          .map((part, i) => (i % 2 ? (names.push(part), '(.+?)') : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
          .join('');
        return [new RegExp(`^${source}$`), catalog[key], names] as [RegExp, string, string[]];
      });
    patterns.set(catalog, found);
  }
  return found;
}

/**
 * A text that was already put together, such as one the API wrote in English: the catalog's translation of it as it
 * is, else of a text with `{name}` in it that it matches, with the values filled in; else the text itself.
 */
export function tr(text: string): string {
  const catalog = CATALOGS[locale()];
  if (catalog[text]) return catalog[text].split('|')[0];
  for (const [pattern, translated, names] of patternsOf(catalog)) {
    const match = pattern.exec(text);
    if (match) return t(translated, Object.fromEntries(names.map((n, i) => [n, match[i + 1]])));
  }
  return text;
}

/** `{{ 'Save' | t }}`, `{{ 'Hello {name}' | t: { name } }}`. Without parameters it also translates a finished text, like `tr`. Impure so it follows a change of language. */
@Pipe({ name: 't', pure: false })
export class TranslatePipe implements PipeTransform {
  transform(text: string, params?: Params): string {
    return params ? t(text, params) : tr(text);
  }
}
