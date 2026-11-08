import { HttpErrorResponse } from '@angular/common/http';

type Errors = Record<string, string[]>;

/** The validation errors of a refused request, by field, as the API's problem details give them. */
function errorsOf(e: unknown): Errors | undefined {
  return e instanceof HttpErrorResponse ? (e.error?.errors as Errors | undefined) : undefined;
}

/** Whether a request failed with one of these statuses. */
export function isStatus(e: unknown, ...statuses: number[]): e is HttpErrorResponse {
  return e instanceof HttpErrorResponse && statuses.includes(e.status);
}

/**
 * The API's own explanation where it gave one, else the fallback: the first validation error, else the problem's
 * detail. `statuses` limits the detail to failures with those statuses, such as 502 for what a service answered.
 */
export function apiProblem(e: unknown, fallback: string, ...statuses: number[]): string {
  if (!(e instanceof HttpErrorResponse) || (statuses.length && !statuses.includes(e.status))) return fallback;
  const errors = errorsOf(e);
  return (errors && Object.values(errors)[0]?.[0]) ?? (typeof e.error?.detail === 'string' ? e.error.detail : fallback);
}

/** Every validation error of a refused request, joined; null when it gave none. */
export function apiProblems(e: unknown): string | null {
  const errors = errorsOf(e);
  return errors ? Object.values(errors).flat().join(' ') : null;
}

/** The first validation error of each field of a request refused as invalid (400); null when it was refused otherwise. */
export function fieldErrors(e: unknown): Record<string, string> | null {
  const errors = isStatus(e, 400) ? errorsOf(e) : undefined;
  return errors ? Object.fromEntries(Object.entries(errors).map(([field, messages]) => [field, messages[0]])) : null;
}
