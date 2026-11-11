import type { LucideIconData } from '@lucide/angular';
import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { LucideArrowRight, LucideCornerDownLeft, LucideSearch } from '@homey-dash/design-system';
import { LucideDynamicIcon } from '@lucide/angular';
import { DashboardsStore } from './dashboards-store';
import { DisplaysStore } from './displays/displays-store';
import { section, SECTIONS, SectionId, TASKS } from './sections';

interface Hit {
  label: string;
  /** What it is, or where it goes. */
  sub: string;
  section: SectionId;
  icon: LucideIconData;
  link: unknown[];
  query?: Record<string, string>;
  /** Extra words it is found by. */
  words?: string;
}

/**
 * Go to: one search for everything in Management. Type part of a name (a dashboard, a display, a photo set) or a task
 * ("idle", "lock screen", "publish") and press Enter. Opens from the sidebar and with ⌘K or Ctrl+K anywhere.
 */
@Component({
  selector: 'hd-go-to',
  imports: [LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKey($event)', style: 'display: contents' },
  template: `
    <button type="button" class="trigger" (click)="open()" aria-haspopup="dialog">
      <svg [lucideIcon]="icons.search" aria-hidden="true" />
      <span>Go to…</span>
      <kbd>{{ mac ? '⌘K' : 'Ctrl K' }}</kbd>
    </button>

    <dialog #dialog class="hd-panel goto" aria-label="Go to" closedby="any" (close)="query.set('')">
      <div class="head">
        <svg [lucideIcon]="icons.search" aria-hidden="true" />
        <input
          #search
          type="search"
          role="combobox"
          aria-expanded="true"
          aria-controls="goto-list"
          aria-autocomplete="list"
          [attr.aria-activedescendant]="hits().length ? 'goto-' + active() : null"
          placeholder="A dashboard, a display, or what you want to do"
          aria-label="Search Management"
          [value]="query()"
          (input)="query.set($any($event.target).value); active.set(0)"
          (keydown)="onSearchKey($event)"
        />
        <kbd>Esc</kbd>
      </div>
      <ul id="goto-list" class="list" role="listbox" aria-label="Results">
        @for (hit of hits(); track $index; let i = $index) {
          @if (i === 0 || hit.group !== hits()[i - 1].group) {
            <li class="group" role="presentation">{{ hit.group }}</li>
          }
          <li
            [id]="'goto-' + i"
            role="option"
            class="hit sec-{{ hit.section }}"
            [attr.aria-selected]="i === active()"
            tabindex="-1"
            (click)="go(hit)"
            (keydown.enter)="go(hit)"
            (pointermove)="active.set(i)"
          >
            <span class="hd-mark"><svg [lucideIcon]="hit.icon" /></span>
            <span class="text"><span class="label">{{ hit.label }}</span><span class="sub">{{ hit.sub }}</span></span>
            <svg class="enter" [lucideIcon]="i === active() ? icons.enter : icons.arrow" aria-hidden="true" />
          </li>
        } @empty {
          <li class="none" role="presentation">Nothing called “{{ query() }}”. Try a part of a name, or a word such as idle, lock or photos.</li>
        }
      </ul>
    </dialog>
  `,
  styles: `
    .trigger {
      display: flex; align-items: center; gap: 8px; width: 100%;
      padding: 8px 10px; border: 1px solid var(--line-strong); border-radius: var(--radius-control);
      background: var(--panel); color: var(--ink-muted); font: 500 14px/1.3 var(--font-sans); cursor: pointer;
      transition: border-color .15s;
    }
    .trigger:hover { border-color: var(--ink-muted); color: var(--ink-soft); }
    .trigger:focus-visible { outline: 3px solid var(--brand); outline-offset: 2px; }
    .trigger svg { width: 16px; height: 16px; }
    .trigger span { flex: 1; text-align: left; }
    kbd { font: 600 11px/1 var(--font-sans); padding: 4px 6px; border: 1px solid var(--line); border-radius: 4px; color: var(--ink-muted); background: var(--sidebar); }
    .goto {
      width: min(620px, calc(100vw - 32px)); max-height: min(560px, calc(100dvh - 120px));
      margin: 12vh auto auto; padding: 0; color: var(--ink);
      flex-direction: column; overflow: hidden;
      box-shadow: 0 24px 60px -16px color-mix(in oklab, black 40%, transparent);
    }
    .goto[open] { display: flex; animation: goto-in .18s cubic-bezier(.2, 0, 0, 1); }
    @keyframes goto-in { from { opacity: 0; translate: 0 -6px; } }
    .goto::backdrop { background: color-mix(in oklab, #1d2430 38%, transparent); }
    .head { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--line); color: var(--ink-muted); }
    .head svg { width: 18px; height: 18px; flex: none; }
    .head input { flex: 1; min-width: 0; border: 0; outline: 0; background: none; color: var(--ink); font: 500 16px/1.3 var(--font-sans); }
    .head input::placeholder { color: var(--ink-muted); }
    .head input::-webkit-search-cancel-button { display: none; }
    .list { margin: 0; padding: 6px; list-style: none; overflow-y: auto; }
    .group { padding: 10px 10px 4px; font: 600 11px/1.3 var(--font-sans); letter-spacing: .1em; text-transform: uppercase; color: var(--ink-muted); }
    .hit { display: flex; align-items: center; gap: 12px; padding: 8px 10px; border-radius: 6px; cursor: pointer; }
    .hit[aria-selected='true'] { background: color-mix(in oklab, var(--sec) 10%, transparent); }
    .text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .label { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sub { font-size: 13px; color: var(--ink-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .enter { width: 16px; height: 16px; color: var(--ink-muted); flex: none; opacity: 0; }
    .hit[aria-selected='true'] .enter { opacity: 1; color: var(--sec); }
    .none { padding: 24px 16px; color: var(--ink-muted); text-wrap: pretty; }
    @media (prefers-reduced-motion: reduce) { .goto[open] { animation: none; } }
  `,
})
export class GoTo {
  private readonly router = inject(Router);
  private readonly dashboards = inject(DashboardsStore);
  private readonly displays = inject(DisplaysStore);

  protected readonly icons = { search: LucideSearch, enter: LucideCornerDownLeft, arrow: LucideArrowRight };
  protected readonly mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  protected readonly query = signal('');
  protected readonly active = signal(0);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly search = viewChild.required<ElementRef<HTMLInputElement>>('search');

  private readonly all = computed(() => {
    const icon = (id: SectionId) => section(id).icon;
    const places: Hit[] = SECTIONS.map((s) => ({ label: s.label, sub: s.purpose, section: s.id, icon: s.icon, link: [s.path] }));
    const tasks: Hit[] = TASKS.map((t) => ({
      label: t.question,
      sub: t.route.join(' › '),
      section: t.section,
      icon: icon(t.section),
      link: [t.path ?? section(t.section).path],
      query: t.tab ? { then: t.tab } : undefined,
      words: t.tab === 'idle' ? 'idle screen off photo frame rules' : t.tab === 'lock' ? 'lock widgets clock' : t.section === 'dashboards' ? 'tiles edit publish' : '',
    }));
    const dashboards: Hit[] = this.dashboards.list().map((d) => ({
      label: d.name,
      sub: d.hasUnpublishedChanges ? 'Dashboard · Unpublished changes' : 'Dashboard',
      section: 'dashboards',
      icon: icon('dashboards'),
      link: ['/dashboards', d.id],
    }));
    const displays: Hit[] = this.displays.list().flatMap((d) => [
      { label: d.name, sub: 'Display', section: 'displays' as const, icon: icon('displays'), link: ['/displays', d.id] },
      { label: `${d.name} · When idle`, sub: 'Display', section: 'displays' as const, icon: icon('displays'), link: ['/displays', d.id, 'idle'], words: 'idle' },
      { label: `${d.name} · Lock screen`, sub: 'Display', section: 'displays' as const, icon: icon('displays'), link: ['/displays', d.id, 'lock'], words: 'lock' },
    ]);
    const photos: Hit[] = this.displays.photoSets().map((p) => ({
      label: p.name,
      sub: 'Photo set',
      section: 'photos',
      icon: icon('photos'),
      link: ['/photo-sets', p.id],
    }));
    return [
      { group: 'Places', hits: places },
      { group: 'Tasks', hits: tasks },
      { group: 'Dashboards', hits: dashboards },
      { group: 'Displays', hits: displays },
      { group: 'Photo sets', hits: photos },
    ];
  });

  protected readonly hits = computed(() => {
    const words = this.query().toLowerCase().split(/\s+/).filter(Boolean);
    // Searching, tasks come first: they are how people remember what they came for.
    const groups = words.length ? [this.all()[1], this.all()[0], ...this.all().slice(2)] : this.all();
    return groups.flatMap(({ group, hits }) => {
      // Without a search, a display's own pages stay out of the way.
      const shown = words.length
        ? hits.filter((h) => words.every((w) => `${h.label} ${h.sub} ${h.words ?? ''}`.toLowerCase().includes(w)))
        : hits.filter((h) => !h.label.includes(' · '));
      return shown.map((hit) => ({ ...hit, group }));
    });
  });

  open() {
    this.active.set(0);
    this.dialog().nativeElement.showModal();
    this.search().nativeElement.focus();
  }

  protected onKey(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (this.dialog().nativeElement.open) this.dialog().nativeElement.close();
      else this.open();
    }
  }

  protected onSearchKey(event: KeyboardEvent) {
    const count = this.hits().length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!count) return;
      this.active.update((i) => (i + (event.key === 'ArrowDown' ? 1 : count - 1)) % count);
      this.dialog().nativeElement.querySelector(`#goto-${this.active()}`)?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const hit = this.hits()[this.active()];
      if (hit) this.go(hit);
    }
  }

  protected go(hit: Hit) {
    this.dialog().nativeElement.close();
    this.router.navigate(hit.link, { queryParams: hit.query });
  }
}
