import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';

/** A sound uploaded in Management for timers to ring with. Mirrors apps/api/Timers/CustomSounds.cs. */
export interface CustomSoundInfo {
  /** What a timer or display names it as: `custom:` and its id. */
  id: string;
  name: string;
  url: string;
  bytes: number;
}

export const CUSTOM_SOUND_PREFIX = 'custom:';

/** Whether a timer sound is an uploaded one rather than one HomeyDash ships with. */
export function isCustomSound(sound: string): boolean {
  return sound.startsWith(CUSTOM_SOUND_PREFIX);
}

/** Where HomeyDash serves an uploaded sound, from its id. */
export function customSoundUrl(sound: string): string {
  return `/api/sounds/${sound.slice(CUSTOM_SOUND_PREFIX.length)}/audio`;
}

/** The uploaded sounds, shared by whatever lists them: Management's settings, its display details and a timer's sound picker. */
@Injectable({ providedIn: 'root' })
export class Sounds {
  private readonly http = inject(HttpClient);
  /** The uploaded sounds, oldest first; empty until the first look. */
  readonly custom = signal<CustomSoundInfo[]>([]);

  /** Looks again; a failure keeps what was known. */
  refresh() {
    this.http.get<CustomSoundInfo[]>('/api/sounds').subscribe({ next: (sounds) => this.custom.set(sounds), error: () => undefined });
  }

  upload(file: File, name: string) {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<CustomSoundInfo>(`/api/sounds?name=${encodeURIComponent(name)}`, form);
  }

  rename(sound: CustomSoundInfo, name: string) {
    return this.http.patch<CustomSoundInfo>(`/api/sounds/${sound.id.slice(CUSTOM_SOUND_PREFIX.length)}`, { name });
  }

  remove(sound: CustomSoundInfo) {
    return this.http.delete<void>(`/api/sounds/${sound.id.slice(CUSTOM_SOUND_PREFIX.length)}`);
  }
}
