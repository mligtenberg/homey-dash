import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { LucideMic, LucidePause, LucidePlay, LucideSquare, LucideTrash } from '@homey-dash/design-system';
import { TranslatePipe, t, formatTag } from '@homey-dash/i18n';
import { LucideDynamicIcon } from '@lucide/angular';
import { MemoError, VoiceMemos } from './memo-data';

export const MEMO_ERRORS: Record<MemoError, string> = {
  'no-microphone': 'The microphone is not available',
  'no-service': 'Voice is not set up',
  failed: 'The memo could not be written down',
  'nothing-heard': 'Nothing was heard',
};

/** The voice memo applet, in the tile's detail view: record, and every kept memo with its text, to play back or delete. */
@Component({
  selector: 'hd-voice-memo-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, LucideDynamicIcon],
  template: `
    <section class="hd-dev__hero hd-memo-panel__rec" [attr.aria-label]="'Voice memo' | t">
      <span class="hd-dev__big" [class.is-recording]="recording()" role="status">{{ reading() }}</span>
      <button
        type="button"
        class="hd-round-btn hd-memo-panel__btn"
        [class.is-recording]="recording()"
        [disabled]="memos.state() === 'working'"
        [attr.aria-label]="(recording() ? 'Stop recording' : 'Record a memo') | t"
        (click)="recording() ? memos.stop() : memos.start()"
      >
        <svg [lucideIcon]="recording() ? stop : mic" />
      </button>
      <span class="hd-details__label">{{ status() }}</span>
    </section>

    <section class="hd-dev__controls" [attr.aria-label]="'Voice memos' | t">
      @for (memo of memos.memos(); track memo.id) {
        <div class="hd-memo-panel__row">
          <div class="hd-memo-panel__what">
            <span class="hd-details__label">{{ time(memo.at) }}</span>
            <p class="hd-memo-panel__text">{{ memo.text || ('Not written down' | t) }}</p>
          </div>
          <div class="hd-memo-panel__actions">
            <button type="button" class="hd-round-btn" [attr.aria-label]="(playing() === memo.id ? 'Pause' : 'Play') | t" (click)="toggle(memo.id)">
              <svg [lucideIcon]="playing() === memo.id ? pause : play" />
            </button>
            <button type="button" class="hd-round-btn" [attr.aria-label]="'Delete' | t" (click)="remove(memo.id)"><svg [lucideIcon]="trash" /></button>
          </div>
        </div>
      } @empty {
        <div class="hd-note">{{ 'No voice memos' | t }}</div>
      }
    </section>
  `,
})
export class VoiceMemoPanel {
  protected readonly memos = inject(VoiceMemos);
  protected readonly mic = LucideMic;
  protected readonly stop = LucideSquare;
  protected readonly play = LucidePlay;
  protected readonly pause = LucidePause;
  protected readonly trash = LucideTrash;

  protected readonly playing = signal<string | null>(null);
  protected readonly recording = computed(() => this.memos.state() === 'recording');
  private audio?: HTMLAudioElement;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.halt());
  }

  /** The big reading: the length of the running recording, else a rest value. */
  protected readonly reading = computed(() => {
    const s = Math.floor(this.memos.elapsed() / 1000);
    return this.memos.state() === 'idle' ? '0:00' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  });

  protected readonly status = computed(() => {
    const error = this.memos.error();
    if (error) return t(MEMO_ERRORS[error]);
    switch (this.memos.state()) {
      case 'recording':
        return t('Recording');
      case 'working':
        return t('Writing it down');
      default:
        return t('Press to speak, in Dutch');
    }
  });

  protected time(at: number) {
    return new Date(at).toLocaleString(formatTag(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  protected async toggle(id: string) {
    const was = this.playing();
    this.halt();
    if (was === id) return;
    const blob = await this.memos.audio(id);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => this.halt();
    this.audio = audio;
    this.playing.set(id);
    audio.play().catch(() => this.halt());
  }

  protected remove(id: string) {
    if (this.playing() === id) this.halt();
    this.memos.remove(id);
  }

  private halt() {
    if (this.audio) {
      this.audio.pause();
      URL.revokeObjectURL(this.audio.src);
      this.audio = undefined;
    }
    this.playing.set(null);
  }
}
