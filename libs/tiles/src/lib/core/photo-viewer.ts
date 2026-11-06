import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { canRotate, Photo, PhotoSet, PhotoSetsApi, photoUrl } from '@homey-dash/api-client';
import {
  LucideChevronLeft,
  LucideChevronRight,
  LucideDynamicIcon,
  LucideImage,
  LucideImageOff,
  LucideMapPin,
  LucideRotateCcw,
  LucideRotateCw,
  LucideUsers,
} from '@lucide/angular';
import { firstValueFrom } from 'rxjs';
import { TileDetails } from './tile-details';

/** When a photo was taken, as people say it: 12 August 2026. */
export function takenOn(photo: Pick<Photo, 'takenAt'>): string {
  return photo.takenAt ? new Date(photo.takenAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
}

/**
 * A photo whole, taking the whole screen, with when and where it was taken and who is on it. A swipe, the arrows or the
 * arrow keys move through the photos it is given, a photo can be rotated in Immich (a partner's only with a key of
 * theirs), and a photo can be excluded from the set for good. Opened by its owner, a photo tile or Management's photo
 * set page, with `open`.
 */
@Component({
  selector: 'hd-photo-viewer',
  imports: [TileDetails, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown.arrowleft)': 'onArrow($event, -1)',
    '(keydown.arrowright)': 'onArrow($event, 1)',
  },
  template: `
    <hd-tile-details [name]="name() || set().name" [icon]="icon" [subtitle]="subtitle()" [fill]="true">
      <!-- Only while open: projected content exists even when the dialog doesn't show it, and its <img> would fetch the whole photo. -->
      @if (details().isOpen() && shown(); as photo) {
        <!-- The photo takes the whole screen; the head, the arrows and the bar float over its edges. -->
        <div
          class="hd-photo-details"
          (pointerdown)="swipeStart = $event.clientX"
          (pointerup)="swipeEnd($event.clientX)"
        >
          <img class="hd-photo-details__img" [src]="photo.url" alt="" draggable="false" />
        </div>
        <button type="button" class="hd-round-btn hd-photo-details__step hd-photo-details__step--previous" aria-label="Previous photo" (click)="step(-1)">
          <svg [lucideIcon]="previousIcon" />
        </button>
        <button type="button" class="hd-round-btn hd-photo-details__step hd-photo-details__step--next" aria-label="Next photo" (click)="step(1)">
          <svg [lucideIcon]="nextIcon" />
        </button>
        <div class="hd-photo-details__bar">
          @if (photo.photo.place || photo.photo.faces?.people?.length) {
            <div class="hd-photo-details__meta">
              @if (photo.photo.place; as place) {
                <span><svg [lucideIcon]="placeIcon" aria-label="Where" />{{ place }}</span>
              }
              @if (photo.photo.faces?.people?.length) {
                <span><svg [lucideIcon]="peopleIcon" aria-label="Who" />{{ photo.photo.faces!.people.join(', ') }}</span>
              }
            </div>
          }
          <div class="hd-photo-details__middle">
            @if (failure(); as failure) {
              <span class="hd-details__label" role="alert">{{ failure }}</span>
            } @else if (busy() === 'rotating') {
              <span class="hd-details__label" role="status">Rotating…</span>
            } @else {
              <span class="hd-details__label">{{ index() + 1 }} of {{ list().length }}</span>
            }
            <button type="button" class="hd-btn" aria-label="Rotate left" [disabled]="busy() || !photo.rotatable" [attr.title]="photo.rotatable ? null : lockedHint"
              (click)="rotate(false)">
              <svg [lucideIcon]="rotateLeftIcon" />
            </button>
            <button type="button" class="hd-btn" aria-label="Rotate right" [disabled]="busy() || !photo.rotatable" [attr.title]="photo.rotatable ? null : lockedHint"
              (click)="rotate(true)">
              <svg [lucideIcon]="rotateRightIcon" />
            </button>
            <button type="button" class="hd-btn hd-btn--danger" [disabled]="busy()" (click)="exclude()">
              <svg [lucideIcon]="excludeIcon" />Exclude photo
            </button>
          </div>
        </div>
      }
    </hd-tile-details>
  `,
})
export class PhotoViewer {
  private readonly api = inject(PhotoSetsApi);

  /** The photo set the photos are of. */
  readonly set = input.required<PhotoSet>();
  /** The photos to step through, in order. */
  readonly photos = input.required<readonly Photo[]>();
  /** The title over the photo; the set's name when absent. */
  readonly name = input<string>();

  private readonly details = viewChild.required(TileDetails);

  protected readonly icon = LucideImage;
  protected readonly previousIcon = LucideChevronLeft;
  protected readonly nextIcon = LucideChevronRight;
  protected readonly placeIcon = LucideMapPin;
  protected readonly peopleIcon = LucideUsers;
  protected readonly excludeIcon = LucideImageOff;
  protected readonly rotateLeftIcon = LucideRotateCcw;
  protected readonly rotateRightIcon = LucideRotateCw;

  /** The position of the photo shown, among `photos`. */
  protected readonly index = signal(0);
  protected swipeStart: number | null = null;
  /** Why a partner's photo can't be rotated. */
  protected readonly lockedHint = "A partner's photo: add an API key of theirs under Accounts to rotate it";
  /** What the viewer is waiting on HomeyDash for. */
  protected readonly busy = signal<'rotating' | 'excluding' | null>(null);
  /** Why the last rotation or exclusion failed. */
  protected readonly failure = signal<string | null>(null);

  // Photos excluded from here, which stay out of the list even before HomeyDash's push takes them out of the set.
  private readonly excluded = signal<ReadonlySet<string>>(new Set());
  /** The photos to step through: those given, less the ones excluded here. */
  private readonly list = computed(() => this.photos().filter((p) => !this.excluded().has(p.id)));

  // Read from the set as it is now, so a photo rotated since the order was made shows turned.
  private readonly photosById = computed(() => new Map(this.set().photos.map((p) => [p.id, p])));

  protected readonly shown = computed(() => {
    const listed = this.list()[this.index()];
    if (!listed) return undefined;
    const photo = this.photosById().get(listed.id) ?? listed;
    return { photo, url: photoUrl(this.set(), photo), rotatable: canRotate(this.set(), photo) };
  });
  protected readonly subtitle = computed(() => {
    const photo = this.shown()?.photo;
    return photo ? takenOn(photo) : '';
  });

  constructor() {
    // An excluded photo leaves its place to the next, wrapping at the end; the last one out closes the viewer.
    effect(() => {
      const count = this.list().length;
      untracked(() => {
        if (!this.details().isOpen()) return;
        if (count === 0) this.close();
        else if (this.index() >= count) this.index.set(0);
      });
    });
    // The photos on either side of the one shown, into the browser's cache.
    effect(() => {
      const photos = this.list();
      const at = this.index();
      if (photos.length < 2 || !this.details().isOpen()) return;
      untracked(() => {
        for (const by of [1, -1]) {
          const photo = photos[(at + by + photos.length) % photos.length];
          new Image().src = photoUrl(this.set(), this.photosById().get(photo.id) ?? photo);
        }
      });
    });
  }

  /** Opens the photo at the position among `photos`. */
  open(index: number) {
    this.excluded.set(new Set());
    this.index.set(index);
    this.failure.set(null);
    this.details().open();
  }

  close() {
    this.details().close();
  }

  // Moves on to the next photo once HomeyDash has it; its push takes the photo out of the set, and so out of every tile showing it.
  protected async exclude() {
    const photo = this.shown()?.photo;
    if (!photo) return;
    this.busy.set('excluding');
    this.failure.set(null);
    try {
      await firstValueFrom(this.api.exclude(this.set(), photo));
      this.excluded.update((ids) => new Set(ids).add(photo.id));
    } catch {
      this.failure.set('Could not exclude the photo. Try again.');
    } finally {
      this.busy.set(null);
    }
  }

  // HomeyDash answers once Immich has turned the photo; its push then shows it turned on every tile with it. Immich's
  // reason when it can't, such as for a live photo or a key that may not edit, or HomeyDash's for a partner's photo.
  protected async rotate(clockwise: boolean) {
    const photo = this.shown()?.photo;
    if (!photo) return;
    this.busy.set('rotating');
    this.failure.set(null);
    try {
      await firstValueFrom(this.api.rotate(this.set(), photo, clockwise));
    } catch (e) {
      const detail = e instanceof HttpErrorResponse && (e.status === 502 || e.status === 409) ? e.error?.detail : null;
      this.failure.set(typeof detail === 'string' ? detail : 'Could not rotate the photo. Try again.');
    } finally {
      this.busy.set(null);
    }
  }

  protected step(by: number) {
    this.failure.set(null);
    const count = this.list().length;
    if (count) this.index.update((i) => (i + by + count) % count);
  }

  // Only from inside the viewer; a tile has focus itself while the viewer is closed.
  protected onArrow(event: Event, by: number) {
    if (event.target === event.currentTarget || !this.shown()) return;
    event.preventDefault();
    this.step(by);
  }

  protected swipeEnd(x: number) {
    if (this.swipeStart === null) return;
    const dx = x - this.swipeStart;
    this.swipeStart = null;
    if (Math.abs(dx) > 40) this.step(dx < 0 ? 1 : -1);
  }
}
