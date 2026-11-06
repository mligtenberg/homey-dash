import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, input, linkedSignal, output, signal, untracked, viewChild } from '@angular/core';
import { Photo, photoUrl, Realtime } from '@homey-dash/api-client';
import { LucideDynamicIcon, LucideImage } from '@lucide/angular';
import { TileSettings } from '../tile-data';
import { PhotoViewer, takenOn } from './photo-viewer';
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

export { takenOn };

/**
 * The photos of one photo set, one at a time in shuffled order, fading to the next at the tile's interval. Each photo
 * fills the tile, cropped around the faces in it by HomeyDash, which sends it at the tile's size, with when and where it was taken along the bottom. A press opens
 * the detail view with the photo whole, when and where it was taken and who is on it, where a swipe, the arrows or the
 * arrow keys move through the set, a photo can be rotated in Immich (a partner's only with a key of theirs), and a
 * photo can be excluded from the set for good; the tile then moves on to the next. While the connection to HomeyDash
 * is lost it keeps its photo.
 */
@Component({
  selector: 'hd-photo-tile',
  imports: [PhotoViewer, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    ...TILE_FACE_HOST,
    class: 'hd-tile hd-photo',
    '[class.has-photo]': "face().state === 'ok' && layers().length > 0",
  },
  template: `
    @if (face().state === 'ok' && layers().length) {
      @if (sized()) {
        @for (layer of layers(); track layer.key) {
          <img class="hd-photo__img" [src]="urlOf(layer, true)" alt="" draggable="false" />
        }
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
    @if (set(); as set) {
      <hd-photo-viewer #viewer [set]="set" [photos]="orderedPhotos()" [name]="face().name" />
    }
  `,
})
export class PhotoTile extends TileView<PhotoTileSettings> {
  private readonly realtime = inject(Realtime);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * The tile's size in CSS pixels, which HomeyDash crops each photo to. Null until it is measured; where a browser
   * can't observe sizes (as in tests), photos come whole.
   */
  private readonly box = signal<{ width: number; height: number } | null>(null);
  protected readonly sized = computed(() => this.box() !== null || typeof ResizeObserver === 'undefined');

  protected readonly icon = LucideImage;

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

  /** The photos in this tile's order, for the viewer to step through. */
  protected readonly orderedPhotos = computed(() => this.order().map((p) => p.photo));
  private readonly viewer = viewChild<PhotoViewer>('viewer');

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

    // The photo after the one shown is fetched ahead, so the fade to it starts at once.
    effect(() => {
      const order = this.order();
      const layers = this.layers();
      const shown = layers[layers.length - 1]?.id;
      // Not before the tile is measured: without a size the URL is the whole photo, which nothing would ask for.
      const sized = this.sized();
      this.box();
      if (!sized || order.length < 2 || shown === undefined) return;
      untracked(() => {
        const at = order.findIndex((p) => p.photo.id === shown);
        if (at >= 0) this.preload(order[(at + 1) % order.length]);
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

    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (typeof ResizeObserver === 'undefined') return;
      const element = this.host.nativeElement;
      const observer = new ResizeObserver(() => {
        const [width, height] = [element.clientWidth, element.clientHeight];
        const box = this.box();
        if (width > 0 && height > 0 && (box?.width !== width || box?.height !== height)) this.box.set({ width, height });
      });
      observer.observe(element);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  // Into the browser's cache, which keeps a photo a day, at the size the tile asks for.
  private preload(shown: ShownPhoto) {
    const image = new Image();
    image.src = this.urlOf({ id: shown.photo.id, url: shown.url }, true);
  }

  private advance() {
    const order = this.order();
    // Not before the tile is measured: its photo is then fetched whole, not at the size it shows.
    if (order.length < 2 || !this.sized()) return;
    this.position = (this.position + 1) % order.length;
    void this.show(order);
  }

  // Fades in the photo at the position.
  private async show(order: ShownPhoto[]) {
    const { photo } = order[this.position];
    const url = this.urlOf({ id: photo.id, url: order[this.position].url }, true);
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
  protected urlOf(shown: { id: string; url: string }, fit = false) {
    const set = this.set();
    const photo = this.photosById().get(shown.id);
    return set && photo ? photoUrl(set, photo, fit ? (this.box() ?? undefined) : undefined) : shown.url;
  }

  protected override openDetails() {
    this.viewer()?.open(this.position);
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
