import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, output, signal, untracked } from '@angular/core';
import { Focus, Photo, photoUrl, Realtime } from '@homey-dash/api-client';
import { LucideChevronLeft, LucideChevronRight, LucideDynamicIcon, LucideImage } from '@lucide/angular';
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
 * fills the tile and is cropped to it around the faces in it. A press opens the detail view with the photo whole and the date it was taken,
 * where a swipe or the arrows move through the set. While the connection to HomeyDash is lost it keeps its photo.
 */
@Component({
  selector: 'hd-photo-tile',
  imports: [TileDetails, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { ...TILE_FACE_HOST, class: 'hd-tile hd-photo', '[class.has-photo]': "face().state === 'ok' && layers().length > 0" },
  template: `
    @if (face().state === 'ok' && layers().length) {
      @for (layer of layers(); track layer.key) {
        <img class="hd-photo__img" [src]="layer.url" [style.object-position]="cropAt(layer)" alt="" draggable="false"
          (load)="measured(layer.key, $any($event.target))" />
      }
      @if (settings().label) {
        <div class="hd-photo__label">{{ settings().label }}</div>
      }
    } @else {
      <svg class="hd-icon" [lucideIcon]="icon" />
      <div>
        <div class="hd-tile__name">{{ face().name }}</div>
        <div class="hd-tile__detail">{{ face().detail }}</div>
      </div>
    }
    <hd-tile-details [name]="face().name" [icon]="icon" [subtitle]="detailSubtitle()">
      @if (detailPhoto(); as photo) {
        <div
          class="hd-photo-details"
          (pointerdown)="swipeStart = $event.clientX"
          (pointerup)="swipeEnd($event.clientX)"
        >
          <img class="hd-photo-details__img" [src]="photo.url" alt="" draggable="false" />
        </div>
        <div class="hd-details__row">
          <button type="button" class="hd-round-btn" aria-label="Previous photo" (click)="step(-1)">
            <svg [lucideIcon]="previousIcon" />
          </button>
          <span class="hd-details__label">{{ detailIndex() + 1 }} of {{ order().length }}</span>
          <button type="button" class="hd-round-btn" aria-label="Next photo" (click)="step(1)">
            <svg [lucideIcon]="nextIcon" />
          </button>
        </div>
      }
    </hd-tile-details>
  `,
})
export class PhotoTile extends TileView<PhotoTileSettings> {
  private readonly realtime = inject(Realtime);

  protected readonly icon = LucideImage;
  protected readonly previousIcon = LucideChevronLeft;
  protected readonly nextIcon = LucideChevronRight;

  protected readonly set = computed(() => {
    const target = this.settings().target;
    return target ? this.data.photoSets().get(target) : undefined;
  });

  // Compared as a string, so a push that leaves the set's photos as they are keeps the order and the photo shown.
  private readonly photoIds = computed(() => this.set()?.photos.map((p) => p.id).join() ?? '');

  /** The set's photos in this tile's order. */
  protected readonly order = computed(() => {
    this.photoIds();
    const set = untracked(this.set);
    return set ? shuffled(set.photos).map((photo) => ({ photo, url: photoUrl(set, photo) })) : [];
  });

  // Read from the set as it is now, since faces are read after its photos arrive and leave the order as it is.
  private readonly photosById = computed(() => new Map(this.set()?.photos.map((p) => [p.id, p])));

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
  protected readonly detailPhoto = computed(() => this.order()[this.detailIndex()]);
  protected readonly detailSubtitle = computed(() => {
    const photo = this.detailPhoto()?.photo;
    return photo ? takenOn(photo) : '';
  });
  protected swipeStart: number | null = null;

  constructor() {
    super();
    // A new or changed set starts over with its first photo in the new order.
    effect(() => {
      const order = this.order();
      untracked(() => {
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

  private async advance() {
    const order = this.order();
    if (order.length < 2) return;
    this.position = (this.position + 1) % order.length;
    const { photo, url } = order[this.position];
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

  protected cropAt(layer: PhotoLayer) {
    return cropPosition(this.photosById().get(layer.id)?.focus, layer.photoRatio, layer.boxRatio);
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

  protected step(by: number) {
    const count = this.order().length;
    if (count) this.detailIndex.update((i) => (i + by + count) % count);
  }

  protected swipeEnd(x: number) {
    if (this.swipeStart === null) return;
    const dx = x - this.swipeStart;
    this.swipeStart = null;
    if (Math.abs(dx) > 40) this.step(dx < 0 ? 1 : -1);
  }
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
