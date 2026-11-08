import { LucideActivity, LucideClapperboard, LucideGamepad2, LucideHouse, LucideImages, LucideMic, LucideMonitor, LucideMusic, LucidePodcast, LucideSearch, LucideSettings, LucideStore, LucideTv, LucideVideo } from '@homey-dash/design-system';
import { LucideIconInput } from '@lucide/angular';
import { DeviceApp } from '@homey-dash/api-client';

/**
 * Icons for the apps that come with an Apple TV, which the App Store does not know, by bundle id. Other apps have
 * their own icon from the store, or their first letter.
 */
const APP_ICONS: Readonly<Record<string, LucideIconInput>> = {
  'com.apple.TVAppStore': LucideStore,
  'com.apple.Arcade': LucideGamepad2,
  'com.apple.TVHomeSharing': LucideMonitor,
  'com.apple.Fitness': LucideActivity,
  'com.apple.facetime': LucideVideo,
  'com.apple.TVPhotos': LucideImages,
  'com.apple.TVSettings': LucideSettings,
  'com.apple.TVMusic': LucideMusic,
  'com.apple.podcasts': LucidePodcast,
  'com.apple.TVWatchList': LucideTv,
  'com.apple.TVMovies': LucideClapperboard,
  'com.apple.Home': LucideHouse,
  'com.apple.Sing': LucideMic,
  'com.apple.TVSearch': LucideSearch,
};

/** The icon kept for an app by its bundle id, when it has one. */
export function appIcon(app: DeviceApp): LucideIconInput | undefined {
  const id = (app.item as { id?: unknown } | null)?.id;
  return typeof id === 'string' ? APP_ICONS[id] : undefined;
}
