// Making elements without a framework: h() for HTML, s() for SVG. Attributes that start with "on" are listeners;
// `class` and `style` take strings; a child is a node, a string, or nothing. Words of the page's own (a Msg, from
// i18n.ts's m()), as a child or an attribute's value, are said in the language of the moment and follow it.

import { Msg, onLanguage, setWords, t, textOf } from '../i18n/i18n';

type Child = Node | string | number | Msg | null | undefined | false;
type Attrs = Record<string, string | number | boolean | Msg | EventListener | null | undefined>;

function apply(el: Element, attrs: Attrs | undefined, children: Child[]): void {
  if (attrs) {
    for (const [name, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (name.startsWith('on') && typeof value === 'function') el.addEventListener(name.slice(2), value as EventListener);
      else if (value instanceof Msg) setWords(el, name, value);
      else el.setAttribute(name, value === true ? '' : String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : child instanceof Msg ? textOf(child) : document.createTextNode(String(child)));
  }
}

/** An HTML element. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  apply(el, attrs, children);
  return el;
}

const SVG = 'http://www.w3.org/2000/svg';

/** An SVG element. */
export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs?: Attrs, ...children: Child[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  apply(el, attrs, children);
  return el;
}

/**
 * A sentence with elements in it (a link, a keycap), as `el`'s children: the words of `key` in the language of the
 * moment, each blank of `nodes` the node itself, wherever the language puts it; said again when the language changes.
 */
export function phrase<E extends HTMLElement>(el: E, key: string, nodes: Readonly<Record<string, Node>>): E {
  const say = () => {
    const parts: (Node | string)[] = [];
    let last = 0;
    const text = t(key);
    for (const found of text.matchAll(/\{(\w+)\}/g)) {
      const node = nodes[found[1]];
      if (!node) continue;
      parts.push(text.slice(last, found.index), node);
      last = (found.index ?? 0) + found[0].length;
    }
    parts.push(text.slice(last));
    el.replaceChildren(...parts.filter((p) => p !== ''));
  };
  say();
  onLanguage(say);
  return el;
}

/** The element with `id`, which the page must have. */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`the page has no #${id}`);
  return el as T;
}

/** A file handed to the person to save. */
export function download(bytes: Uint8Array, name: string, type = 'application/octet-stream'): void {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Keeps a pointer's events coming to `el` until it lifts; a pointer that cannot be captured (one already gone) is let be. */
export function capture(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // Not an active pointer: its events still come to the element under it.
  }
}
