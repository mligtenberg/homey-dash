/** What the backend says went wrong (a hub error carries its message after the method), else a fallback. */
export function reason(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.replace(/^.*HubException:\s*/, '') : '';
  return message && !message.startsWith('An unexpected error') ? message : fallback;
}
