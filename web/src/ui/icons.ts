// The page's icons, drawn on a 24-unit grid with round 1.75-unit strokes, so that they sit together.

import { s } from './dom';

const PATHS: Readonly<Record<string, string>> = {
  pause: 'M8 5v14M16 5v14',
  play: 'M7 4.5v15l12-7.5z',
  stop: 'M6.5 6.5h11v11h-11z',
  rewind: 'M11 6 4 12l7 6zM20 6l-7 6 7 6z',
  forward: 'M13 6l7 6-7 6zM4 6l7 6-7 6z',
  eject: 'M12 5 5 13h14zM5 18h14',
  sound: 'M4 9.5h3.5L12 5.5v13L7.5 14.5H4zM15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11',
  mute: 'M4 9.5h3.5L12 5.5v13L7.5 14.5H4zM16 9.5l5 5M21 9.5l-5 5',
  open: 'M3.5 7.5V18a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5V9.5A1.5 1.5 0 0 0 19 8h-7l-2-2.5H5A1.5 1.5 0 0 0 3.5 7z',
  save: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14',
  settings:
    'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.4-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  power: 'M12 3.5v8M7 6.3a7.5 7.5 0 1 0 10 0',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5 20 20',
  keyboard: 'M3.5 7h17v10h-17zM7 10.5h.01M10 10.5h.01M13 10.5h.01M16 10.5h.01M8 14h8',
  history: 'M4 12a8 8 0 1 0 2.4-5.7M4 4.5v3.8h3.8M12 8v4.5l3 2',
  close: 'M6 6l12 12M18 6 6 18',
  chevron: 'M7 10l5 5 5-5',
  tape: 'M3.5 6.5h17v11h-17zM8.5 12.5a2 2 0 1 0 0-.01M15.5 12.5a2 2 0 1 0 0-.01M10.5 12.5h3M7 17.5l1.5-2.5h7l1.5 2.5',
  screen: 'M4 5.5h16v11H4zM9 19.5h6M12 16.5v3',
  joystick: 'M12 10a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM12 10v6M6 16.5h12v3H6z',
  bolt: 'M13 3 5 14h6l-1 7 8-11h-6z',
  share: 'M12 3.5v11M7.5 8 12 3.5 16.5 8M5 12.5v6a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-6',
  step: 'M6 5v14M10 5l9 7-9 7z',
  fullscreen: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.6 2.6 0 1 1 3.6 2.4c-.7.3-1.1.9-1.1 1.6v.5M12 17h.01',
  shelf: 'M4 4.5h6v6H4zM14 4.5h6v6h-6zM4 13.5h6v6H4zM14 13.5h6v6h-6z',
  reader: 'M4 6h16M4 10h16M4 14h10M4 18h7',
};

/** An icon, sized by CSS (1em by default). */
export function icon(name: keyof typeof PATHS | string, label?: string): SVGSVGElement {
  const el = s('svg', { class: `icon icon-${name}`, viewBox: '0 0 24 24', 'aria-hidden': label ? undefined : 'true', role: label ? 'img' : undefined, 'aria-label': label });
  const filled = name === 'play' || name === 'stop' || name === 'rewind' || name === 'forward' || name === 'bolt';
  el.append(s('path', { d: PATHS[name] ?? '', fill: filled ? 'currentColor' : 'none', stroke: 'currentColor', 'stroke-width': filled ? 1 : 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  return el;
}
