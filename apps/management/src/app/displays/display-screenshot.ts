import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DisplayInfo, DisplaysApi } from '@homey-dash/api-client';

/** A picture of what a display's screen shows right now, asked of the screen and shown here. */
@Component({
  selector: 'hd-display-screenshot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bar">
      <button type="button" class="hd-btn hd-btn--primary" [disabled]="taking() || !display().status.connected" (click)="take()">
        {{ taking() ? 'Taking…' : picture() ? 'Take another' : 'Take screenshot' }}
      </button>
      @if (picture(); as shot) {
        <a class="hd-btn" [href]="shot.url" [download]="shot.name">Download</a>
        <span class="hd-hint">Taken {{ shot.at }}</span>
      }
      @if (!display().status.connected) {
        <span class="hd-hint">The display must be connected.</span>
      }
    </div>
    @if (error(); as message) {
      <p class="hd-error" role="alert">{{ message }}</p>
    }
    @if (picture(); as shot) {
      <img class="shot" [src]="shot.url" alt="What the display shows" />
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--space-3); }
    .bar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
    .shot { max-width: 100%; max-height: 70vh; align-self: flex-start; border: 1px solid var(--line); border-radius: 10px; }
  `,
})
export class DisplayScreenshot {
  private readonly api = inject(DisplaysApi);
  readonly display = input.required<DisplayInfo>();

  protected readonly taking = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly picture = signal<{ url: string; name: string; at: string } | null>(null);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.forget());
  }

  protected take() {
    this.taking.set(true);
    this.error.set(null);
    const display = this.display();
    this.api.screenshot(display.id).subscribe({
      next: (blob) => {
        this.forget();
        const now = new Date();
        this.picture.set({
          url: URL.createObjectURL(blob),
          name: `${display.name} ${now.toISOString().slice(0, 19).replace(/[T:]/g, '-')}.jpg`,
          at: now.toLocaleTimeString(),
        });
        this.taking.set(false);
      },
      error: (e: HttpErrorResponse) => {
        this.taking.set(false);
        this.error.set(
          e.status === 409
            ? 'The display is not connected.'
            : e.status === 504
              ? 'The display did not answer. Reload its page and try again.'
              : 'Could not take a screenshot. Try again.',
        );
      },
    });
  }

  private forget() {
    const shot = this.picture();
    if (shot) URL.revokeObjectURL(shot.url);
  }
}
