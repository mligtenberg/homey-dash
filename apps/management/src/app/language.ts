import { browserLocale, setLocale } from '@homey-dash/i18n';

const KEY = 'homeydash.language';

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Management speaks the language its user picked, else the browser's. */
export function initManagementLocale(): void {
  setLocale(read() ?? browserLocale());
}

/** Picks Management's language and remembers it in this browser. */
export function chooseManagementLocale(tag: string): void {
  setLocale(tag);
  try {
    localStorage.setItem(KEY, tag);
  } catch {
    /* the choice lasts until the page is closed */
  }
}
