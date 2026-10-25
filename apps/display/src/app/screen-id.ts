const KEY = 'homeydash.screen';

/**
 * The id this screen keeps for life, by which HomeyDash knows which display it is. Made with getRandomValues
 * because randomUUID needs a secure context, and displays are opened over plain http on the home network.
 */
export function screenId(storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()): string {
  const kept = storage?.getItem(KEY);
  if (kept) return kept;
  const id = newUuid();
  storage?.setItem(KEY, id);
  return id;
}

function newUuid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Private browsing or blocked storage: the screen still works, but runs setup again after a reload.
function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
