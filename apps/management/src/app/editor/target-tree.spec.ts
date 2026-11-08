import { LucideBox } from '@homey-dash/design-system';
import { allOptions, buildTree, entries, filterTree, findGroup, TargetGroup, TargetOption } from './target-tree';

const zones: TargetGroup[] = [
  { id: 'home', name: 'Home', parentId: null },
  { id: 'upstairs', name: 'Upstairs', parentId: 'home' },
  { id: 'living', name: 'Living room', parentId: 'home' },
  { id: 'bedroom', name: 'Bedroom', parentId: 'upstairs' },
  { id: 'attic', name: 'Attic', parentId: 'upstairs' },
];

const option = (id: string, label: string, groupId: string | null): TargetOption => ({
  id,
  label,
  groupId,
  type: 'Light',
  icon: LucideBox,
  hue: 'light',
});

const devices = [
  option('lamp', 'Reading lamp', 'living'),
  option('tv', 'Television', 'living'),
  option('bed-lamp', 'Bedside lamp', 'bedroom'),
  option('meter', 'Energy meter', 'home'),
  option('stray', 'Unknown zone', 'gone'),
];

describe('buildTree', () => {
  const tree = buildTree(zones, devices);

  it('nests options in their zones and sorts each level', () => {
    const [home] = tree.groups;
    expect(home.name).toBe('Home');
    expect(home.options.map((o) => o.id)).toEqual(['meter']);
    expect(home.groups.map((g) => g.name)).toEqual(['Living room', 'Upstairs']);
    expect(home.groups[0].options.map((o) => o.label)).toEqual(['Reading lamp', 'Television']);
  });

  it('leaves out zones without options anywhere below', () => {
    const upstairs = tree.groups[0].groups[1];
    expect(upstairs.groups.map((g) => g.name)).toEqual(['Bedroom']);
  });

  it('puts options of an unknown zone at the top', () => {
    expect(tree.options.map((o) => o.id)).toEqual(['stray']);
  });

  it('lists every option in tree order', () => {
    expect(allOptions(tree).map((o) => o.id)).toEqual(['stray', 'meter', 'lamp', 'tv', 'bed-lamp']);
  });

  it('finds a group and lists what is in it and below, with the group each sits in', () => {
    const upstairs = findGroup(tree, 'upstairs');
    expect(upstairs && entries(upstairs).map((e) => [e.option.id, e.group.name])).toEqual([['bed-lamp', 'Bedroom']]);
    expect(findGroup(tree, 'gone')).toBeUndefined();
  });
});

describe('filterTree', () => {
  const tree = buildTree(zones, devices);
  const ids = (query: string) => allOptions(filterTree(tree, query)).map((o) => o.id);

  it('matches labels, ignoring case', () => {
    expect(ids('LAMP')).toEqual(['lamp', 'bed-lamp']);
  });

  it('matches types', () => {
    expect(ids('light living')).toEqual(['lamp', 'tv']);
  });

  it('matches the names of the zones an option sits in', () => {
    expect(ids('upstairs')).toEqual(['bed-lamp']);
    expect(ids('living lamp')).toEqual(['lamp']);
  });

  it('keeps only the zones on the way to a match', () => {
    const filtered = filterTree(tree, 'tele');
    expect(filtered.groups[0].groups.map((g) => g.name)).toEqual(['Living room']);
  });

  it('is empty without a match and whole without a query', () => {
    expect(ids('sofa')).toEqual([]);
    expect(filterTree(tree, '  ')).toBe(tree);
  });
});
