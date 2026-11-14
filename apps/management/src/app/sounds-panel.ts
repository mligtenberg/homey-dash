import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnDestroy, signal } from '@angular/core';
import { CustomSoundInfo, apiProblem, Sounds } from '@homey-dash/api-client';
import { t, TranslatePipe } from '@homey-dash/i18n';
import { AccountPanel } from './account-panel';

/**
 * The sounds uploaded for timers to ring with. Once uploaded, a sound is offered next to the built-in ones wherever a
 * timer's sound is chosen: on a screen's timer, and as the sound of the timers started by voice on a display.
 */
@Component({
  selector: 'hd-sounds-panel',
  imports: [AccountPanel, DecimalPipe, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hd-account-panel key="sounds" [title]="'Sounds' | t" [error]="error()">
      <p class="hd-muted">
        {{ 'Upload your own sounds for timers to ring with: MP3, WAV, OGG or M4A, short ones work best. A timer plays it again for as long as it rings.' | t }}
      </p>
      @for (s of sounds.custom(); track s.id) {
        <div class="hd-account__item">
          <div class="hd-account__info">
            <input class="hd-input" [value]="s.name" [attr.aria-label]="'Name' | t" maxlength="60" (change)="rename(s, name.value)" (keydown.enter)="name.blur()" #name />
            <span class="hd-muted">{{ s.bytes / 1024 | number: '1.0-0' }} KB</span>
          </div>
          <div class="hd-actions">
            <button class="hd-btn" type="button" (click)="play(s)">{{ playing() === s.id ? ('Stop' | t) : ('Play' | t) }}</button>
            <button class="hd-btn" type="button" (click)="remove(s)">{{ 'Delete' | t }}</button>
          </div>
        </div>
      }
      <div class="hd-actions">
        <input #file type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a" hidden (change)="upload(file)" />
        <button class="hd-btn hd-btn--primary" type="button" [disabled]="busy()" (click)="file.click()">{{ busy() ? ('Uploading…' | t) : ('Upload a sound' | t) }}</button>
      </div>
    </hd-account-panel>
  `,
})
export class SoundsPanel implements OnDestroy {
  protected readonly sounds = inject(Sounds);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly playing = signal<string | null>(null);
  private audio?: HTMLAudioElement;

  constructor() {
    this.sounds.refresh();
  }

  ngOnDestroy() {
    this.audio?.pause();
  }

  protected upload(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.busy.set(true);
    this.error.set(null);
    this.sounds.upload(file, file.name.replace(/\.[^.]+$/, '')).subscribe({
      next: () => {
        this.busy.set(false);
        this.sounds.refresh();
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(apiProblem(e, t('Could not upload that sound.')));
      },
    });
  }

  protected rename(sound: CustomSoundInfo, name: string) {
    if (!name.trim() || name.trim() === sound.name) return this.sounds.refresh();
    this.sounds.rename(sound, name.trim()).subscribe({ next: () => this.sounds.refresh(), error: () => this.error.set(t('Could not rename that sound.')) });
  }

  protected remove(sound: CustomSoundInfo) {
    if (!confirm(t('Delete this sound? Timers and displays that use it will beep instead.'))) return;
    if (this.playing() === sound.id) this.play(sound);
    this.sounds.remove(sound).subscribe({ next: () => this.sounds.refresh(), error: () => this.error.set(t('Could not delete that sound.')) });
  }

  protected play(sound: CustomSoundInfo) {
    this.audio?.pause();
    if (this.playing() === sound.id) {
      this.playing.set(null);
      return;
    }
    const audio = (this.audio = new Audio(sound.url));
    audio.onended = () => this.playing.set(null);
    this.playing.set(sound.id);
    audio.play().catch(() => this.playing.set(null));
  }
}
