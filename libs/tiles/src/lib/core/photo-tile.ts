import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, linkedSignal, output, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { canRotate, Focus, Photo, PhotoSetsApi, photoUrl, Realtime } from '@homey-dash/api-client';
import { HttpErrorResponse } from '@angular/common/http';
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
import { TileSettings } from '../tile-data';
import { TileDetails } from './tile-details';
import { TILE_FACE_HOST, TileFace, TileView } from './tile-view';

export interface PhotoTileSettings extends TileSettings {
  /** Seconds between photos; 30 when absent. */
  interval?: number;
}

export const PHOTO_INTERVALS: readonly { seconds: number; label: string }[] = [
  { seconds: 10, label: '10 seconds' },
  { seconds: 30, label: '30 seconds' },
  { seconds: 60, label: '1 minute' },
  { seconds: 300, label: '5 minutes' },
  { seconds: 900, label: '15 minutes' },
];

const DEFAULT_INTERVAL = 30;

/** The photos in a random order, so tiles showing the same set do not stay in step. */
export function shuffled<T>(items: readonly T[], random = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Where to crop a photo that covers a box, as its object-position: with its faces in the middle of the box, as far as
 * the photo's edges allow, given the width-to-height ratios of the photo and the box. The middle, as an image crops by
 * default, until its faces are read. Before the photo has loaded, the focus lines up with the same fraction of the box,
 * which keeps it in view however the photo is cropped.
 */
export function cropPosition(focus: Focus | null | undefined, photoRatio?: number, boxRatio?: number): string {
  if (!focus) return '50% 50%';
  let { x, y } = focus;
  if (photoRatio && boxRatio) {
    // How many times the box the covering photo is, along the side it overflows.
    const over = photoRatio / boxRatio;
    const middle = (f: number, k: number) => Math.min(1, Math.max(0, (f * k - 0.5) / (k - 1)));
    if (over > 1) x = middle(x, over);
    else if (over < 1) y = middle(y, 1 / over);
  }
  return `${Math.round(x * 1000) / 10}% ${Math.round(y * 1000) / 10}%`;
}

/** When a photo was taken, as people say it: 12 August 2026. */
export function takenOn(photo: Pick<Photo, 'takenAt'>): string {
  return photo.takenAt ? new Date(photo.takenAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
}

/**
 * The photos of one photo set, one at a time in shuffled order, fading to the next at the tile's interval. Each photo
 * fills the tile, cropped around the faces in it, with when and where it was taken along the bottom. A press opens
 * the detail view with the photo whole, when and where it was taken and who is on it, where a swipe, the arrows or the
 * arrow keys move through the set, a photo can be rotated in Immich (a partner's only with a key of theirs), and a
 * photo can be excluded from the set for good; the tile then moves on to the next. While the connection to HomeyDash
 * is lost it keeps its photo.
 */
@Component({
  selector: 'hd-photo-tile',
  imports: [TileDetails, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    ...TILE_FACE_HOST,
    class: 'hd-tile hd-photo',
    '[class.has-photo]': "face().state === 'ok' && layers().length > 0",
    '(keydown.arrowleft)': 'onArrow($event, -1)',
    '(keydown.arrowright)': 'onArrow($event, 1)',
  },
  template: `
    @if (face().state === 'ok' && layers().length) {
      @for (layer of layers(); track layer.key) {
        <img class="hd-photo__img" [src]="urlOf(layer)" [style.object-position]="cropAt(layer)" alt="" draggable="false"
          (load)="measured(layer.key, $any($event.target))" />
      }
      @if (settings().label || caption() || shownPeople()) {
        <div class="hd-photo__caption">
          <div class="hd-photo__text">
            @if (settings().label) {
              <div class="hd-photo__label">{{ settings().label }}</div>
            }
            @if (caption()) {
              <div class="hd-photo__about">{{ caption() }}</div>
            }
          </div>
          @if (shownPeople()) {
            <div class="hd-photo__people">{{ shownPeople() }}</div>
          }
        </div>
      }
    } @else {
      <svg class="hd-icon" [lucideIcon]="icon" />
      <div>
        <div class="hd-tile__name">{{ face().name }}</div>
        <div class="hd-tile__detail">{{ face().detail }}</div>
      </div>
    }
    <hd-tile-details [name]="face().name" [icon]="icon" [subtitle]="detailSubtitle()" [fill]="true">
      @if (detailPhoto(); as photo) {
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
              <span class="hd-details__label">{{ detailIndex() + 1 }} of {{ order().length }}</span>
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
export class PhotoTile extends TileView<PhotoTileSettings> {
  private readonly realtime = inject(Realtime);
  private readonly photoSetsApi = inject(PhotoSetsApi);

  protected readonly icon = LucideImage;
  protected readonly previousIcon = LucideChevronLeft;
  protected readonly nextIcon = LucideChevronRight;
  protected readonly placeIcon = LucideMapPin;
  protected readonly peopleIcon = LucideUsers;
  protected readonly excludeIcon = LucideImageOff;
  protected readonly rotateLeftIcon = LucideRotateCcw;
  protected readonly rotateRightIcon = LucideRotateCw;

  protected readonly set = computed(() => {
    const target = this.settings().target;
    return target ? this.data.photoSets().get(target) : undefined;
  });

  // Compared as a string, so a push that leaves the set's photos as they are keeps the order and the photo shown.
  private readonly photoIds = computed(() => {
    const set = this.set();
    return set ? `${set.id}:${set.photos.map((p) => p.id).join()}` : '';
  });

  /**
   * The set's photos in this tile's order. A push that only takes photos out, such as one excluded, keeps the order of
   * the rest, so the tile goes on from where it was.
   */
  protected readonly order = linkedSignal<string, ShownPhoto[]>({
    source: this.photoIds,
    computation: (_, previous) => {
      const set = untracked(this.set);
      if (!set) return [];
      const ids = new Set(set.photos.map((p) => p.id));
      const left = previous?.source.startsWith(`${set.id}:`) ? previous.value.filter((p) => ids.has(p.photo.id)) : [];
      return left.length === ids.size ? left : shuffled(set.photos).map((photo) => ({ photo, url: photoUrl(set, photo) }));
    },
  });

  // Read from the set as it is now, since faces are read after its photos arrive and leave the order as it is.
  private readonly photosById = computed(() => new Map(this.set()?.photos.map((p) => [p.id, p])));

  /** When and where the photo shown, or fading in, was taken. */
  protected readonly caption = computed(() => {
    const layers = this.layers();
    const id = layers[layers.length - 1]?.id;
    const photo = id === undefined ? undefined : this.photosById().get(id);
    return photo ? [takenOn(photo), photo.place].filter(Boolean).join(' · ') : '';
  });

  /** Whether to name who is on the photo shown, at the bottom right; the detail view always does. */
  readonly people = input(false);

  /** Who is on the photo shown, or fading in, when the tile names them. */
  protected readonly shownPeople = computed(() => {
    if (!this.people()) return '';
    const layers = this.layers();
    const id = layers[layers.length - 1]?.id;
    return (id === undefined ? undefined : this.photosById().get(id))?.faces?.people.join(', ') ?? '';
  });

  /** The photo shown and, while the next fades in over it, the one before; with their ratios once loaded. */
  protected readonly layers = signal<PhotoLayer[]>([]);
  private position = 0;
  private nextKey = 0;

  readonly face = computed<TileFace>(() => {
    const look = { icon: LucideImage, hue: 'neutral' as const };
    const { target, label } = this.settings();
    const set = this.set();
    if (!target) return { ...look, name: label || 'Photos', detail: 'Pick a photo set', state: 'unset' };
    if (!this.data.photoSetsLoaded()) return { ...look, name: label || 'Photos', detail: '…', state: 'loading' };
    if (!set) return { ...look, name: label || 'Photos', detail: 'Photo set not found', state: 'missing' };
    const name = label || set.name;
    if (!set.photos.length) return { ...look, name, detail: set.selection ? 'No photos match' : 'No photos in the album', state: 'ok' };
    return { ...look, name, detail: '', details: true, state: 'ok' };
  });

  protected readonly detailIndex = signal(0);
  protected readonly detailPhoto = computed(() => {
    const shown = this.order()[this.detailIndex()];
    if (!shown) return undefined;
    const photo = this.photosById().get(shown.photo.id) ?? shown.photo;
    const set = this.set();
    return { photo, url: this.urlOf({ id: photo.id, url: shown.url }), rotatable: !set || canRotate(set, photo) };
  });
  protected readonly detailSubtitle = computed(() => {
    const photo = this.detailPhoto()?.photo;
    return photo ? takenOn(photo) : '';
  });
  protected swipeStart: number | null = null;
  /** Why a partner's photo can't be rotated. */
  protected readonly lockedHint = "A partner's photo: add an API key of theirs under Accounts to rotate it";
  /** What the detail view is waiting on HomeyDash for. */
  protected readonly busy = signal<'rotating' | 'excluding' | null>(null);
  /** Why the last rotation or exclusion failed. */
  protected readonly failure = signal<string | null>(null);

  constructor() {
    super();
    // A new or changed set starts over with its first photo in the new order. When photos only left it, the photo shown
    // stays, or when it left too, the next one fades in.
    let before: ShownPhoto[] = [];
    effect(() => {
      const order = this.order();
      untracked(() => {
        const left = order.length > 0 && order.length < before.length && order.every((p) => before.includes(p));
        before = order;
        if (left) {
          const layers = this.layers();
          const at = order.findIndex((p) => p.photo.id === layers[layers.length - 1]?.id);
          this.position = at >= 0 ? at : this.position % order.length;
          if (at < 0) void this.show(order);
          return;
        }
        this.position = 0;
        this.layers.set(order.length ? [{ key: this.nextKey++, id: order[0].photo.id, url: order[0].url }] : []);
      });
    });

    // Rotates while HomeyDash can be reached; when it cannot, the photo shown stays.
    let timer: ReturnType<typeof setInterval> | undefined;
    effect(() => {
      clearInterval(timer);
      const seconds = this.settings().interval ?? DEFAULT_INTERVAL;
      if (this.order().length < 2 || !this.realtime.connected()) return;
      timer = setInterval(() => this.advance(), seconds * 1000);
    });
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  private advance() {
    const order = this.order();
    if (order.length < 2) return;
    this.position = (this.position + 1) % order.length;
    void this.show(order);
  }

  // Fades in the photo at the position.
  private async show(order: ShownPhoto[]) {
    const { photo } = order[this.position];
    const url = this.urlOf({ id: photo.id, url: order[this.position].url });
    // Only once it has loaded, so the fade never shows half a photo.
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      return;
    }
    if (order !== this.order()) return;
    this.layers.update((layers) => [...layers.slice(-1), { key: this.nextKey++, id: photo.id, url }]);
  }

  /**
   * The photo's URL as the set has it now, so one rotated since it was put in order shows turned; the URL it had, once
   * it has left the set.
   */
  protected urlOf(shown: { id: string; url: string }) {
    const set = this.set();
    const photo = this.photosById().get(shown.id);
    return set && photo ? photoUrl(set, photo) : shown.url;
  }

  protected cropAt(layer: PhotoLayer) {
    return cropPosition(this.photosById().get(layer.id)?.faces?.focus, layer.photoRatio, layer.boxRatio);
  }

  // The tile is the image's box, since the image fills it.
  protected measured(key: number, image: HTMLImageElement) {
    if (!image.naturalHeight || !image.clientHeight) return;
    const ratios = { photoRatio: image.naturalWidth / image.naturalHeight, boxRatio: image.clientWidth / image.clientHeight };
    this.layers.update((layers) => layers.map((l) => (l.key === key ? { ...l, ...ratios } : l)));
  }

  protected override openDetails() {
    this.detailIndex.set(this.position);
    super.openDetails();
  }

  // Closes the detail view once HomeyDash has it; its push then takes the photo out of every tile showing the set.
  protected async exclude() {
    const set = this.set();
    const shown = this.detailPhoto();
    if (!set || !shown) return;
    this.busy.set('excluding');
    this.failure.set(null);
    try {
      await firstValueFrom(this.photoSetsApi.exclude(set, shown.photo));
      this.closeDetails();
    } catch {
      this.failure.set('Could not exclude the photo. Try again.');
    } finally {
      this.busy.set(null);
    }
  }

  // HomeyDash answers once Immich has turned the photo; its push then shows it turned on every tile with it. Immich's
  // reason when it can't, such as for a live photo or a key that may not edit, or HomeyDash's for a partner's photo.
  protected async rotate(clockwise: boolean) {
    const set = this.set();
    const shown = this.detailPhoto();
    if (!set || !shown) return;
    this.busy.set('rotating');
    this.failure.set(null);
    try {
      await firstValueFrom(this.photoSetsApi.rotate(set, shown.photo, clockwise));
    } catch (e) {
      const detail = e instanceof HttpErrorResponse && (e.status === 502 || e.status === 409) ? e.error?.detail : null;
      this.failure.set(typeof detail === 'string' ? detail : 'Could not rotate the photo. Try again.');
    } finally {
      this.busy.set(null);
    }
  }

  protected step(by: number) {
    this.failure.set(null);
    const count = this.order().length;
    if (count) this.detailIndex.update((i) => (i + by + count) % count);
  }

  // Only from inside the detail view, which is in the tile; the tile itself has focus while it is closed.
  protected onArrow(event: Event, by: number) {
    if (event.target === event.currentTarget || !this.detailPhoto()) return;
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

interface ShownPhoto {
  photo: Photo;
  url: string;
}

interface PhotoLayer {
  key: number;
  id: string;
  url: string;
  photoRatio?: number;
  boxRatio?: number;
}

/** Management's choice of how long a photo tile shows each photo. */
@Component({
  selector: 'hd-photo-tile-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hd-field">
      <label class="hd-field__label" for="tile-interval">Next photo every</label>
      <select id="tile-interval" class="hd-select" (change)="changed.emit({ interval: +$any($event.target).value })">
        @for (option of intervals; track option.seconds) {
          <option [value]="option.seconds" [selected]="option.seconds === (settings().interval ?? 30)">{{ option.label }}</option>
        }
      </select>
    </div>
  `,
})
export class PhotoTileSettingsEditor {
  readonly settings = input.required<PhotoTileSettings>();
  readonly changed = output<Partial<PhotoTileSettings>>();

  protected readonly intervals = PHOTO_INTERVALS;
}
