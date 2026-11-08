/** Sorts anything with a name by it, for the groups and places of the pickers' trees. */
export const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name);

/** The words of a search query, lower case. */
export const searchWords = (query: string) =>
  query.toLowerCase().split(/\s+/).filter(Boolean);

/** Whether the text has every one of the words. */
export const matchesWords = (text: string, words: readonly string[]) => {
  const lower = text.toLowerCase();
  return words.every((word) => lower.includes(word));
};

/** The node with this id anywhere among the nodes, looking through the children `childrenOf` gives. */
export function findNode<T extends { id: string }>(
  nodes: readonly T[],
  id: string | null,
  childrenOf: (node: T) => readonly T[],
): T | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(childrenOf(node), id, childrenOf);
    if (found) return found;
  }
  return undefined;
}
