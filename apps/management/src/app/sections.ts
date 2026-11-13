import type { LucideIconData } from '@lucide/angular';
import {
  LucideHouse,
  LucideImages,
  LucideLayoutDashboard,
  LucideMonitor,
  LucideSettings,
} from '@homey-dash/design-system';

export type SectionId = 'overview' | 'dashboards' | 'displays' | 'photos' | 'settings';

/** One of the five places in Management, always listed in the same order with the same colour. Settings is the odd one out: the sidebar pins it to the bottom. */
export interface Section {
  id: SectionId;
  label: string;
  path: string;
  icon: LucideIconData;
  /** What lives here, in a sentence: shown under the page title and in Go to. */
  purpose: string;
}

export const SECTIONS: readonly Section[] = [
  {
    id: 'overview',
    label: 'Overview',
    path: '/',
    icon: LucideHouse,
    purpose: 'What needs your attention, what each display shows, and what is waiting to be published.',
  },
  {
    id: 'dashboards',
    label: 'Dashboards',
    path: '/dashboards',
    icon: LucideLayoutDashboard,
    purpose: 'Layouts of tiles. Edit one here, then publish it to the displays that show it.',
  },
  {
    id: 'displays',
    label: 'Displays',
    path: '/displays',
    icon: LucideMonitor,
    purpose: 'The screens in the home: which dashboards each offers, what it does when idle, and its lock screen.',
  },
  {
    id: 'photos',
    label: 'Photo sets',
    path: '/photo-sets',
    icon: LucideImages,
    purpose: 'Photos from Immich that photo tiles and idle displays show.',
  },
  {
    id: 'settings',
    label: 'Settings',
    path: '/settings',
    icon: LucideSettings,
    purpose: 'The accounts HomeyDash talks to, the speech model, and the language Management speaks.',
  },
];

export function section(id: SectionId): Section {
  return SECTIONS.find((s) => s.id === id) ?? SECTIONS[0];
}

/** The part of Management a URL belongs to. */
export function sectionOf(url: string): SectionId {
  const path = url.split(/[?#]/)[0];
  if (path.startsWith('/dashboards')) return 'dashboards';
  if (path.startsWith('/displays')) return 'displays';
  if (path.startsWith('/photo-sets')) return 'photos';
  if (path.startsWith('/settings') || path.startsWith('/accounts')) return 'settings';
  return 'overview';
}

/**
 * Tasks people come to Management for, phrased the way they think of them, and where each one lives. A task that needs
 * a display first (`pick: 'display'`) lists the displays to choose from in Go to.
 */
export interface Task {
  question: string;
  section: SectionId;
  /** Where it lives, as the steps to get there. */
  route: string[];
  path?: string;
  pick?: 'display' | 'dashboard';
  /** For a display task: the page of the display it opens. */
  tab?: 'dashboards' | 'idle' | 'lock';
}

export const TASKS: readonly Task[] = [
  { question: "Change a dashboard's tiles", section: 'dashboards', route: ['Dashboards', 'pick one'], pick: 'dashboard' },
  { question: 'Choose what a display shows', section: 'displays', route: ['Displays', 'pick one', 'Dashboards'], pick: 'display', tab: 'dashboards' },
  { question: 'Set what a display does when idle', section: 'displays', route: ['Displays', 'pick one', 'When idle'], pick: 'display', tab: 'idle' },
  { question: 'Change a lock screen', section: 'displays', route: ['Displays', 'pick one', 'Lock screen'], pick: 'display', tab: 'lock' },
  { question: 'Add or change a photo set', section: 'photos', route: ['Photo sets'], path: '/photo-sets' },
  { question: 'Connect an account', section: 'settings', route: ['Settings', 'Accounts'], path: '/settings/accounts' },
  { question: 'Change the language of Management', section: 'settings', route: ['Settings', 'Language'], path: '/settings/language' },
];
