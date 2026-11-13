import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DisplayInfo, DisplaysApi } from '@homey-dash/api-client';
import { TranslatePipe } from '@homey-dash/i18n';

/** Downloads the voice memos a display's screen keeps: the screen is asked, sends them, and they arrive here as a zip. */
@Component({
  selector: 'hd-display-memos',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    <div class="bar">
      <button type="button" class="hd-btn hd-btn--primary" [disabled]="fetching() || !display().status.connected" (click)="download()">
        {{ (fetching() ? 'Fetching…' : 'Download voice memos') | t }}
      </button>
      @if (!display().status.connected) {
        <span class="hd-hint">{{ 'The display must be connected.' | t }}</span>
      }
    </div>
    @if (error(); as message) {
      <p class="hd-error" role="alert">{{ message | t }}</p>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--space-3); }
    .bar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
  `,
})
export class DisplayMemos {
  private readonly api = inject(DisplaysApi);
  readonly display = input.required<DisplayInfo>();

  protected readonly fetching = signal(false);
  protected readonly error = signal<string | null>(null);

  protected download() {
    this.fetching.set(true);
    this.error.set(null);
    const display = this.display();
    this.api.memos(display.id).subscribe({
      next: (zip) => {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(zip);
        link.download = `${display.name} voice memos.zip`;
        link.click();
        URL.revokeObjectURL(link.href);
        this.fetching.set(false);
      },
      error: (e: HttpErrorResponse) => {
        this.fetching.set(false);
        this.error.set(
          e.status === 409
            ? 'The display is not connected.'
            : e.status === 504
              ? 'The display did not answer. Reload its page and try again.'
              : 'Could not fetch the voice memos. Try again.',
        );
      },
    });
  }
}
