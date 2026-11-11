import { effect, Injector } from '@angular/core';
import { locale } from './locale';
import { tr } from './translate';

const ATTRIBUTES = ['title', 'placeholder', 'aria-label', 'alt', 'label'];
const SKIPPED = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'KBD']);

/**
 * A safety net for texts that reach the page without going through `t`: it translates what is on the page, by
 * exact text or pattern from the catalog, and keeps doing so as the page changes. Text that is not in the catalog
 * stays as it is. A text translated by `t` already is Dutch and passes through unchanged. Put `data-no-translate`
 * on an element whose texts are the household's own, such as a name.
 */
export function translatePage(injector: Injector, root: HTMLElement = document.body): void {
  const originals = new WeakMap<Node, string>();
  const shown = new WeakMap<Node, string>();

  const skipped = (node: Node) => {
    for (let e: Element | null = node instanceof Element ? node : node.parentElement; e; e = e.parentElement) {
      if (SKIPPED.has(e.tagName) || e.hasAttribute('data-no-translate') || (e as HTMLElement).isContentEditable) return true;
    }
    return false;
  };

  const text = (node: Text) => {
    if (skipped(node)) return;
    const now = node.data;
    // What Angular wrote since we last did: a new English text to translate.
    if (shown.get(node) !== now) originals.set(node, now);
    const original = originals.get(node) ?? now;
    const core = original.trim();
    if (!core) return;
    const next = locale() === 'en' ? original : original.replace(core, tr(core));
    if (next !== now) node.data = next;
    shown.set(node, next);
  };

  const attribute = (el: Element, name: string) => {
    const key = `${name}`;
    const store = ((el as unknown as Record<string, Record<string, [string, string]>>)['__i18n'] ??= {});
    const now = el.getAttribute(name);
    if (now === null || skipped(el)) return;
    if (store[key]?.[1] !== now) store[key] = [now, now];
    const original = store[key][0];
    const next = locale() === 'en' ? original : tr(original);
    if (next !== now) el.setAttribute(name, next);
    store[key] = [original, next];
  };

  const walk = (node: Node) => {
    if (node instanceof Text) return text(node);
    if (!(node instanceof Element)) return;
    for (const name of ATTRIBUTES) attribute(node, name);
    node.childNodes.forEach(walk);
  };

  const observer = new MutationObserver((records) => {
    observer.disconnect();
    for (const r of records) {
      if (r.type === 'characterData') text(r.target as Text);
      else if (r.type === 'attributes') attribute(r.target as Element, r.attributeName as string);
      else r.addedNodes.forEach(walk);
    }
    watch();
  });
  const watch = () =>
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES });

  effect(
    () => {
      locale();
      observer.disconnect();
      walk(root);
      watch();
    },
    { injector },
  );
}
