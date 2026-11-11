import type { LucideIconData } from '@lucide/angular';
import {
  LucideHouse,
  LucideImages,
  LucideKeyRound,
  LucideLayoutDashboard,
  LucideMonitor,
} from '@homey-dash/design-system';

export type SectionId = 'overview' | 'dashboards' | 'displays' | 'photos' | 'accounts';

/** One of the five places in Management, always listed in the same order with the same colour. */
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
    id: 'accounts',
    label: 'Accounts',
    path: '/accounts',
    icon: LucideKeyRound,
    purpose: 'Homey, Immich, Plex, TomTom and AirPlay: the services HomeyDash talks to.',
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
  if (path.startsWith('/accounts')) return 'accounts';
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
  { question: 'Connect an account', section: 'accounts', route: ['Accounts'], path: '/accounts' },
];
