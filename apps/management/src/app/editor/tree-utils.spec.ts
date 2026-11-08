import { byName, findNode, matchesWords, searchWords } from './tree-utils';

describe('tree-utils', () => {
  it('sorts by name', () => {
    expect(
      [{ name: 'b' }, { name: 'a' }].sort(byName).map((n) => n.name),
    ).toEqual(['a', 'b']);
  });
  it('matches every word, in any case and order', () => {
    expect(
      matchesWords('Kitchen Temperature', searchWords('  temp KIT ')),
    ).toBe(true);
    expect(matchesWords('Kitchen Temperature', searchWords('temp bath'))).toBe(
      false,
    );
  });
  it('finds a nested node', () => {
    const tree = [{ id: 'a', kids: [{ id: 'b', kids: [] }] }];
    expect(findNode(tree, 'b', (n) => n.kids)?.id).toBe('b');
    expect(findNode(tree, 'x', (n) => n.kids)).toBeUndefined();
  });
});
