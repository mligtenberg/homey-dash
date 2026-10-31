import { LucideIconInput } from '@lucide/angular';
import { KindHue } from '@homey-dash/tiles';

/** Something a tile can target, in the group (zone or flow folder) Homey keeps it in. */
export interface TargetOption {
  id: string;
  label: string;
  /** What kind of target it is: `Light`, `Advanced flow`. */
  type: string;
  icon: LucideIconInput;
  hue: KindHue;
  /** What the picker shows once this is picked; the label when absent. */
  summary?: string;
  /** Null, or a group that is not known, puts the option at the top of the tree. */
  groupId: string | null;
}

/** A zone or flow folder; groups nest. */
export interface TargetGroup {
  id: string;
  name: string;
  parentId: string | null;
}

/** One level of the tree: its own options, then its groups, each sorted by name. */
export interface TargetNode {
  id: string;
  name: string;
  groups: TargetNode[];
  options: TargetOption[];
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
const byLabel = (a: TargetOption, b: TargetOption) => a.label.localeCompare(b.label);

/** Puts the options in their groups, as Homey nests them; groups without options anywhere below are left out. */
export function buildTree(groupList: Iterable<TargetGroup>, options: Iterable<TargetOption>): TargetNode {
  const groups = [...groupList];
  const root: TargetNode = { id: '', name: '', groups: [], options: [] };
  const nodes = new Map(groups.map((g): [string, TargetNode] => [g.id, { id: g.id, name: g.name, groups: [], options: [] }]));
  for (const [id, node] of nodes) {
    const parentId = groups.find((g) => g.id === id)?.parentId;
    ((parentId && nodes.get(parentId)) || root).groups.push(node);
  }
  for (const option of options) ((option.groupId && nodes.get(option.groupId)) || root).options.push(option);
  return prune(root) ?? root;
}

/**
 * The part of the tree that matches every word of the query, in an option's label, its type or the name of any
 * group it sits in, so "living light" finds the lights in the living room.
 */
export function filterTree(node: TargetNode, query: string): TargetNode {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return node;
  const filter = (node: TargetNode, path: string): TargetNode | null =>
    prune({
      ...node,
      groups: node.groups.map((group) => filter(group, `${path} ${group.name}`)).filter((g) => g !== null),
      options: node.options.filter((o) => {
        const text = `${path} ${o.label} ${o.type}`.toLowerCase();
        return words.every((word) => text.includes(word));
      }),
    });
  return filter(node, '') ?? { ...node, groups: [], options: [] };
}

/** Every option in the tree with the group it sits in, in the order the picker lists them. */
export function entries(node: TargetNode): { option: TargetOption; group: TargetNode }[] {
  return [...node.options.map((option) => ({ option, group: node })), ...node.groups.flatMap(entries)];
}

export function allOptions(node: TargetNode): TargetOption[] {
  return entries(node).map((e) => e.option);
}

/** The group with this id anywhere in the tree. */
export function findGroup(node: TargetNode, id: string | null): TargetNode | undefined {
  if (node.id === id) return node;
  for (const group of node.groups) {
    const found = findGroup(group, id);
    if (found) return found;
  }
  return undefined;
}

function prune(node: TargetNode): TargetNode | null {
  const groups = node.groups.map(prune).filter((g) => g !== null).sort(byName);
  const sorted = [...node.options].sort(byLabel);
  return groups.length || sorted.length ? { ...node, groups, options: sorted } : null;
}
