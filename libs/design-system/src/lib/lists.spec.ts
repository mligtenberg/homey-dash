import { changedAt, chunk, moved, removedAt } from './lists';

describe('lists', () => {
  it('moves an item one place, and leaves the list as it is at either end', () => {
    expect(moved(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moved(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(moved(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moved(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });

  it('removes and changes an item without touching the original', () => {
    const list = [1, 2, 3];
    expect(removedAt(list, 1)).toEqual([1, 3]);
    expect(changedAt(list, 2, (n) => n * 10)).toEqual([1, 2, 30]);
    expect(list).toEqual([1, 2, 3]);
  });

  it('cuts a list into pieces', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});
