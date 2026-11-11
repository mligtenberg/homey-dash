import { formatTag } from './locale';

type Input = Date | string | number;
const date = (v: Input) => (v instanceof Date ? v : new Date(v));

/** A date or time in the language in use; reading it makes a `computed` follow a change of language. */
export const formatDate = (v: Input, options: Intl.DateTimeFormatOptions): string =>
  date(v).toLocaleDateString(formatTag(), options);

export const formatTime = (v: Input, options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }): string =>
  date(v).toLocaleTimeString(formatTag(), options);

export const formatDateTime = (v: Input, options?: Intl.DateTimeFormatOptions): string =>
  date(v).toLocaleString(formatTag(), options);

/** A number in the language in use: its decimal and thousands separators. */
export const formatNumber = (n: number, options?: Intl.NumberFormatOptions): string => n.toLocaleString(formatTag(), options);
