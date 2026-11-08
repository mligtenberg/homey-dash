import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LucidePause, LucidePlay, LucideSkipBack, LucideSkipForward } from '@homey-dash/design-system';
import { LucideDynamicIcon } from '@lucide/angular';

/** The names of the transport's buttons, for assistive technology. */
export interface TransportLabels {
  previous: string;
  next: string;
  play: string;
  pause: string;
}

const LABELS: TransportLabels = { previous: 'Previous', next: 'Next', play: 'Play', pause: 'Pause' };

/**
 * Previous, play or pause, and next. The host is the row they sit in, so give it the class of the strip (such as
 * `hd-round-btns`); `previous` and `next` say whether those two buttons are offered at all, and `playClass` styles
 * the middle one.
 */
@Component({
  selector: 'hd-transport',
  imports: [LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (previous()) {
      <button type="button" class="hd-round-btn" [attr.aria-label]="labels().previous" [disabled]="disabled()" (click)="skippedBack.emit()">
        <svg [lucideIcon]="backIcon" />
      </button>
    }
    <button
      type="button"
      class="hd-round-btn"
      [class]="playClass()"
      [attr.aria-label]="playing() ? labels().pause : labels().play"
      [disabled]="disabled()"
      (click)="toggled.emit()"
    >
      <svg [lucideIcon]="playing() ? pauseIcon : playIcon" />
    </button>
    @if (next()) {
      <button type="button" class="hd-round-btn" [attr.aria-label]="labels().next" [disabled]="disabled()" (click)="skippedForward.emit()">
        <svg [lucideIcon]="forwardIcon" />
      </button>
    }
  `,
})
export class Transport {
  readonly playing = input.required<boolean>();
  readonly previous = input(true);
  readonly next = input(true);
  readonly disabled = input(false);
  readonly labels = input<TransportLabels>(LABELS);
  readonly playClass = input('');
  readonly toggled = output<void>();
  readonly skippedBack = output<void>();
  readonly skippedForward = output<void>();

  protected readonly backIcon = LucideSkipBack;
  protected readonly forwardIcon = LucideSkipForward;
  protected readonly playIcon = LucidePlay;
  protected readonly pauseIcon = LucidePause;
}
