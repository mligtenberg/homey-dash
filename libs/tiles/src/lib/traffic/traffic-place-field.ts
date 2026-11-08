import { ChangeDetectionStrategy, Component, DestroyRef, effect, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { PlaceMatch, TrafficApi, TrafficPlace } from '@homey-dash/api-client';
import { firstValueFrom } from 'rxjs';

/** How long typing rests before it searches. */
const SEARCH_AFTER_MS = 300;

/** Whether a popover is showing; false where there are no popovers. */
function popoverOpen(element: HTMLElement): boolean {
  try {
    return element.matches(':popover-open');
  } catch {
    return false;
  }
}

/** Region and country, to tell namesakes apart: `Utrecht, Netherlands`. */
export function matchDetail(match: PlaceMatch): string {
  return [match.region, match.country].filter(Boolean).join(', ');
}

/**
 * Finds a place by name with TomTom's search, in a popover of matches with their region and country; the chosen place is kept as
 * its name and coordinates (ADR-0015). `account` is the TomTom account that searches (the oldest without one).
 */
@Component({
  selector: 'hd-traffic-place-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hd-field">
      <label class="hd-field__label" [for]="id()">{{ label() }}</label>
      <p class="current">
        <span [class.muted]="!place()">{{ place()?.name ?? 'Not chosen yet' }}</span>
      </p>
      <input
        #input
        [id]="id()"
        class="hd-input"
        type="search"
        autocomplete="off"
        [placeholder]="place() ? 'Search another place' : 'Search a place or address'"
        [value]="query()"
        (input)="search($any($event.target).value)"
        (keydown.escape)="search('')"
        (focus)="open.set(true)"
        (blur)="closeUnlessInList($event)"
      />
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      } @else if (query().trim().length >= 2 && searched() && !matches().length) {
        <p class="muted">No place found</p>
      }
      <!-- A popover, so it floats over the settings under it instead of pushing them down; the press stays on the input. -->
      <ul #list class="matches" popover="manual" [attr.aria-label]="label() + ' matches'" (pointerdown)="$event.preventDefault()">
        @for (match of matches(); track $index) {
          <li>
            <button type="button" class="match" (click)="choose(match)">
              <span class="match__name">{{ match.name }}</span>
              <span class="match__detail">{{ detail(match) }}</span>
            </button>
          </li>
        }
      </ul>
    </div>
  `,
  styles: `
    .current { margin: 0 0 var(--space-2); }
    .current span { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .muted { color: var(--ink-muted); margin: var(--space-1) 0 0; }
    .current .muted { margin: 0; }
    .error { color: var(--danger); margin: var(--space-1) 0 0; }
    .matches { position: fixed; inset: auto; margin: 0; padding: 0; list-style: none; background: var(--panel); color: var(--ink); border: 1px solid var(--line); border-radius: var(--radius-control); box-shadow: 0 8px 24px rgb(0 0 0 / .18); overflow: hidden auto; }
    .matches li + li { border-top: 1px solid var(--line); }
    .match { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; padding: var(--space-2) var(--space-3); border: 0; background: none; color: inherit; font: inherit; text-align: start; cursor: pointer; }
    .match:hover, .match:focus-visible { background: color-mix(in oklab, var(--brand) 12%, transparent); outline: none; }
    .match__name { font-weight: 600; }
    .match__detail { font-size: 12px; color: var(--ink-muted); }
  `,
})
export class TrafficPlaceField {
  /** Starts the id of the search, such as `route-origin`; one per place on a page. */
  readonly id = input.required<string>();
  readonly label = input.required<string>();
  readonly place = input<TrafficPlace | null>(null);
  readonly account = input<number | null | undefined>(null);
  readonly picked = output<TrafficPlace>();

  private readonly api = inject(TrafficApi);

  protected readonly query = signal('');
  protected readonly matches = signal<PlaceMatch[]>([]);
  protected readonly searched = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly detail = matchDetail;
  /** Whether the matches are shown: while the search has the focus, or something in them does. */
  protected readonly open = signal(true);
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');
  private readonly input = viewChild<ElementRef<HTMLElement>>('input');

  private timer?: ReturnType<typeof setTimeout>;
  private seq = 0;

  constructor() {
    const reposition = () => this.position();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.timer);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    });
    effect(() => {
      const list = this.list()?.nativeElement;
      if (!list) return;
      const show = this.matches().length > 0 && this.open();
      const shown = popoverOpen(list);
      if (show) {
        this.position();
        if (!shown) list.showPopover?.();
      } else if (shown) list.hidePopover?.();
    });
  }

  /** Puts the matches under the search, as wide as it. */
  private position() {
    const list = this.list()?.nativeElement;
    const box = this.input()?.nativeElement.getBoundingClientRect();
    if (!list || !box) return;
    const top = box.bottom + 4;
    list.style.top = `${top}px`;
    list.style.left = `${box.left}px`;
    list.style.width = `${box.width}px`;
    list.style.maxHeight = `${Math.max(120, window.innerHeight - top - 12)}px`;
  }

  protected closeUnlessInList(event: FocusEvent) {
    if (!this.list()?.nativeElement.contains(event.relatedTarget as Node | null)) this.open.set(false);
  }

  protected search(query: string) {
    this.query.set(query);
    this.searched.set(false);
    this.error.set(null);
    clearTimeout(this.timer);
    if (query.trim().length < 2) {
      this.seq++;
      this.matches.set([]);
      return;
    }
    this.timer = setTimeout(() => this.find(query.trim()), SEARCH_AFTER_MS);
  }

  // Only the answer to the latest search counts.
  private async find(query: string) {
    const seq = ++this.seq;
    const language = (navigator.language || 'en').slice(0, 2).toLowerCase();
    try {
      const matches = await firstValueFrom(this.api.places(query, language, this.account()));
      if (seq !== this.seq) return;
      this.matches.set(matches);
      this.searched.set(true);
    } catch (e) {
      if (seq !== this.seq) return;
      this.matches.set([]);
      this.error.set(
        (e as { status?: number }).status === 409
          ? 'Set up a TomTom account under Accounts first.'
          : "Couldn't search: TomTom can't be reached.",
      );
    }
  }

  protected choose(match: PlaceMatch) {
    this.picked.emit({ name: match.name, latitude: match.latitude, longitude: match.longitude });
    this.search('');
  }
}
