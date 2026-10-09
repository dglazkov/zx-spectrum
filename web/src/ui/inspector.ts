// Inside the machine: the Z80's registers, the code at PC as the machine disassembles it, a window on memory, read
// through the emulator and kept up to date while it is open; breakpoints, a step and a POKE, as the magazines printed
// them for infinite lives.

import type { Emulator } from '../emulator/emulator';
import { h } from './dom';

export interface Inspector {
  readonly el: HTMLElement;
  /** Reads the machine again (on each display refresh while it is shown). */
  update(): void;
}

export interface InspectorHooks {
  emulator(): Emulator;
  /** Whether the machine is paused; pausing it, and letting it go on. */
  paused(): boolean;
  pause(): void;
  resume(): void;
  /** One instruction, the machine paused (the page shows a frame it ends, and stops at a breakpoint it reaches). */
  step(): void;
}

const hex = (v: number, digits: number) => v.toString(16).toUpperCase().padStart(digits, '0');

/** A number as the magazines printed them: decimal, or hex with # or $ (or 0x). */
export function parseNumber(s: string, hexByDefault = false): number {
  const t = s.trim();
  if (/^(#|\$|0x)/i.test(t)) return parseInt(t.replace(/^(#|\$|0x)/i, ''), 16);
  if (hexByDefault) return /^[0-9a-f]+$/i.test(t) ? parseInt(t, 16) : Number.NaN;
  return /^[0-9]+$/.test(t) ? Number(t) : Number.NaN;
}

export function createInspector(hooks: InspectorHooks): Inspector {
  const regs = h('dl', { class: 'regs' });
  const code = h('pre', { class: 'dump code', 'aria-label': 'The code at PC' });
  const dump = h('pre', { class: 'dump', 'aria-label': 'Memory' });
  const at = h('input', { class: 'hex-input', value: '5C00', maxlength: 4, spellcheck: 'false', 'aria-label': 'Address, in hex' });

  // Running and stopping.
  const pauseButton = h('button', { type: 'button', class: 'btn' }, 'Pause');
  const stepButton = h('button', { type: 'button', class: 'btn', title: 'Run one instruction' }, 'Step');
  pauseButton.addEventListener('click', () => (hooks.paused() ? hooks.resume() : hooks.pause()));
  stepButton.addEventListener('click', () => hooks.step());
  const bpAt = h('input', { class: 'hex-input', placeholder: '8000', maxlength: 5, spellcheck: 'false', 'aria-label': 'Breakpoint address, in hex' });
  const bpAdd = h('button', { type: 'button', class: 'btn' }, 'Break at');
  const bpList = h('div', { class: 'bp-list' });
  const drawBreakpoints = () => {
    const e = hooks.emulator();
    bpList.replaceChildren(
      ...e.breakpoints().map((a) => {
        const b = h('button', { type: 'button', class: 'chip bp', title: 'Remove this breakpoint' }, `${hex(a, 4)} ×`);
        b.addEventListener('click', () => {
          e.setBreakpoints(e.breakpoints().filter((x) => x !== a));
          drawBreakpoints();
        });
        return b;
      }),
    );
  };
  bpAdd.addEventListener('click', () => {
    const a = parseNumber(bpAt.value, true);
    if (!Number.isInteger(a) || a < 0 || a > 0xffff) return;
    const e = hooks.emulator();
    e.setBreakpoints([...e.breakpoints(), a]);
    bpAt.value = '';
    drawBreakpoints();
  });

  const pokeAt = h('input', { class: 'hex-input', placeholder: '23560', 'aria-label': 'POKE address' });
  const pokeValue = h('input', { class: 'hex-input', placeholder: '0', 'aria-label': 'POKE value' });
  const poke = h('button', { type: 'button', class: 'btn' }, 'POKE');
  const said = h('span', { class: 'poke-said' });
  poke.addEventListener('click', () => {
    const a = parseNumber(pokeAt.value);
    const v = parseNumber(pokeValue.value);
    if (!Number.isInteger(a) || a < 0 || a > 0xffff || !Number.isInteger(v) || v < 0 || v > 255) {
      said.textContent = 'An address 0–65535 and a value 0–255';
      return;
    }
    hooks.emulator().poke(a, v);
    said.textContent = `POKE ${a},${v}`;
  });

  const el = h(
    'div',
    { class: 'inspector' },
    h('div', { class: 'poke run' }, pauseButton, stepButton, bpAt, bpAdd, bpList),
    regs,
    code,
    h('div', { class: 'dump-head' }, h('label', {}, 'Memory at ', at)),
    dump,
    h('div', { class: 'poke' }, pokeAt, pokeValue, poke, said),
  );

  let shownBreakpoints = '';
  return {
    el,
    update() {
      const e = hooks.emulator();
      const r = e.registers();
      pauseButton.textContent = hooks.paused() ? 'Run' : 'Pause';
      const bps = e.breakpoints().join();
      if (bps !== shownBreakpoints) {
        shownBreakpoints = bps;
        drawBreakpoints();
      }
      const pairs: [string, string][] = [
        ['PC', hex(r.pc, 4)], ['SP', hex(r.sp, 4)], ['AF', hex(r.af, 4)], ['BC', hex(r.bc, 4)], ['DE', hex(r.de, 4)], ['HL', hex(r.hl, 4)],
        ['IX', hex(r.ix, 4)], ['IY', hex(r.iy, 4)], ["AF'", hex(r.af_, 4)], ["BC'", hex(r.bc_, 4)], ["DE'", hex(r.de_, 4)], ["HL'", hex(r.hl_, 4)],
        ['I', hex(r.i, 2)], ['R', hex(r.r, 2)], ['IM', String(r.im)], ['IFF', `${+r.iff1}${+r.iff2}`], ['T', String(r.t)], ['', r.halted ? 'HALT' : e.breakpoint !== null ? 'BREAK' : ''],
      ];
      regs.replaceChildren(...pairs.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
      // The code from PC: each instruction's address, its bytes, and the machine's own disassembly.
      const marks = new Set(e.breakpoints());
      code.textContent = e
        .disassemble(r.pc, 8)
        .map((i) => {
          const bytes = Array.from({ length: i.len }, (_, k) => hex(e.peek((i.addr + k) & 0xffff), 2)).join(' ');
          return `${i.addr === r.pc ? '▶' : marks.has(i.addr) ? '●' : ' '} ${hex(i.addr, 4)}  ${bytes.padEnd(12)} ${i.text}`;
        })
        .join('\n');
      const base = (parseInt(at.value, 16) || 0) & 0xfff0;
      const lines: string[] = [];
      for (let row = 0; row < 8; row++) {
        const a = (base + row * 16) & 0xffff;
        const bytes = Array.from({ length: 16 }, (_, i) => e.peek((a + i) & 0xffff));
        const text = bytes.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '·')).join('');
        lines.push(`${hex(a, 4)}  ${bytes.map((b) => hex(b, 2)).join(' ')}  ${text}`);
      }
      dump.textContent = lines.join('\n');
    },
  };
}
