import { ChangeDetectionStrategy, Component, computed, inject, input, viewChild } from '@angular/core';
import { LucideMic, LucideSquare, LucideX } from '@homey-dash/design-system';
import { TileSize } from '@homey-dash/layout';
import { t, TranslatePipe } from '@homey-dash/i18n';
import { LucideDynamicIcon } from '@lucide/angular';
import { TileDetails } from '../core/tile-details';
import { VoiceMemos, VoiceMemoTileSettings } from './memo-data';
import { MEMO_ERRORS, VoiceMemoPanel } from './voice-memo-panel';

/** How many memos besides the newest a size lists. */
const OLDER: Partial<Record<TileSize, number>> = { large: 1, 'full-large': 3 };

/**
 * Voice memos. Press the corner button, speak, press it again; any other press opens the applet with every memo: the voice service writes the speech down in Dutch, and the newest
 * memos stay on the tile. The memos belong to the screen, so every memo tile on it shows the same ones.
 */
@Component({
  selector: 'hd-voice-memo-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, LucideDynamicIcon, TileDetails, VoiceMemoPanel],
  host: {
    class: 'hd-tile hd-memo',
    'data-kind': 'appliance',
    'data-tap': '',
    role: 'button',
    tabindex: '0',
    '[attr.data-size]': 'size()',
    '[attr.aria-busy]': 'memos.state() === "working"',
    '[class.is-active]': 'recording()',
    '(click)': 'onPress($event)',
    '(keydown.enter)': 'onKey($event)',
    '(keydown.space)': 'onKey($event)',
  },
  template: `
    <div class="hd-row hd-row--top">
      <svg class="hd-icon" [lucideIcon]="mic" />
      <button
        type="button"
        class="hd-round-btn hd-tile__action"
        [class.hd-tile__action--run]="!recording()"
        [disabled]="memos.state() === 'working'"
        [attr.aria-label]="(recording() ? 'Stop recording' : 'Record a memo') | t"
        (click)="recording() ? memos.stop() : memos.start()"
      >
        <svg [lucideIcon]="recording() ? stop : mic" />
      </button>
    </div>
    @if (newest(); as memo) {
      @if (older().length || size() === 'large' || size() === 'full-large') {
        <p class="hd-memo__text">{{ memo.text || ('Not written down' | t) }}</p>
      }
    }
    @if (older().length) {
      <ul class="hd-memo__older">
        @for (memo of older(); track memo.id) {
          <li>
            <span class="hd-tile__detail">{{ memo.text || ('Not written down' | t) }}</span>
            <button type="button" class="hd-round-btn" [attr.aria-label]="'Delete' | t" (click)="memos.remove(memo.id)">
              <svg class="hd-memo__x" [lucideIcon]="x" />
            </button>
          </li>
        }
      </ul>
    }
    <div>
      <div class="hd-tile__name">{{ 'Voice memo' | t }}</div>
      <div class="hd-tile__detail">{{ detail() }}</div>
    </div>
    <hd-tile-details [screen]="true" [name]="'Voice memos'" [icon]="mic" [subtitle]="subtitle()">
      <hd-voice-memo-panel />
    </hd-tile-details>
  `,
})
export class VoiceMemoTile {
  readonly settings = input.required<VoiceMemoTileSettings>();
  readonly size = input.required<TileSize>();

  protected readonly memos = inject(VoiceMemos);
  private readonly details = viewChild.required(TileDetails);
  protected readonly mic = LucideMic;
  protected readonly stop = LucideSquare;
  protected readonly x = LucideX;

  protected readonly newest = computed(() => this.memos.memos()[0]);
  protected readonly older = computed(() => this.memos.memos().slice(1, 1 + (OLDER[this.size()] ?? 0)));

  protected readonly subtitle = computed(() => {
    const n = this.memos.memos().length;
    return n === 0 ? t('No voice memos') : t('{count} voice memos', { count: n });
  });

  protected readonly recording = computed(() => this.memos.state() === 'recording');

  /** The detail line: what is happening, else the newest memo (the tile's name is already "Voice memo"). */
  protected readonly detail = computed(() => {
    const error = this.memos.error();
    if (error) return t(MEMO_ERRORS[error]);
    switch (this.memos.state()) {
      case 'recording': {
        const s = Math.floor(this.memos.elapsed() / 1000);
        return `${t('Recording')} ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      }
      case 'working':
        return t('Writing it down');
      default:
        return this.newest()?.text || t('Press to speak, in Dutch');
    }
  });

  protected onPress(event: Event) {
    // The record and delete buttons act for themselves; any other press opens the applet.
    if (!(event.target as Element).closest('button, dialog')) this.details().open();
  }

  protected onKey(event: Event) {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    this.onPress(event);
  }
}
