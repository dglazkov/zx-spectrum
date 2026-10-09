// Inside the machine: the Z80's registers and a window on memory, read through the emulator's peek and registers,
// kept up to date while it is open, and a POKE, as the magazines printed them for infinite lives.

import type { Emulator } from '../emulator/emulator';
import { h } from './dom';

export interface Inspector {
  readonly el: HTMLElement;
  /** Reads the machine again (on each display refresh while it is shown). */
  update(): void;
}

const hex = (v: number, digits: number) => v.toString(16).toUpperCase().padStart(digits, '0');

export function createInspector(emulator: () => Emulator): Inspector {
  const regs = h('dl', { class: 'regs' });
  const dump = h('pre', { class: 'dump', 'aria-label': 'Memory' });
  const at = h('input', { class: 'hex-input', value: '5C00', maxlength: 4, spellcheck: 'false', 'aria-label': 'Address, in hex' });
  const pokeAt = h('input', { class: 'hex-input', placeholder: '23560', 'aria-label': 'POKE address' });
  const pokeValue = h('input', { class: 'hex-input', placeholder: '0', 'aria-label': 'POKE value' });
  const poke = h('button', { type: 'button', class: 'btn' }, 'POKE');
  const said = h('span', { class: 'poke-said' });
  poke.addEventListener('click', () => {
    // As the magazines printed them: decimal, or hex with a # or $.
    const num = (s: string) => (/^[#$]/.test(s.trim()) ? parseInt(s.trim().slice(1), 16) : Number(s.trim()));
    const a = num(pokeAt.value);
    const v = num(pokeValue.value);
    if (!Number.isInteger(a) || a < 0 || a > 0xffff || !Number.isInteger(v) || v < 0 || v > 255) {
      said.textContent = 'An address 0–65535 and a value 0–255';
      return;
    }
    emulator().poke(a, v);
    said.textContent = `POKE ${a},${v}`;
  });

  const el = h(
    'div',
    { class: 'inspector' },
    regs,
    h('div', { class: 'dump-head' }, h('label', {}, 'Memory at ', at)),
    dump,
    h('div', { class: 'poke' }, pokeAt, pokeValue, poke, said),
  );

  return {
    el,
    update() {
      const e = emulator();
      const r = e.registers();
      const pairs: [string, string][] = [
        ['PC', hex(r.pc, 4)], ['SP', hex(r.sp, 4)], ['AF', hex(r.af, 4)], ['BC', hex(r.bc, 4)], ['DE', hex(r.de, 4)], ['HL', hex(r.hl, 4)],
        ['IX', hex(r.ix, 4)], ['IY', hex(r.iy, 4)], ["AF'", hex(r.af_, 4)], ["BC'", hex(r.bc_, 4)], ["DE'", hex(r.de_, 4)], ["HL'", hex(r.hl_, 4)],
        ['I', hex(r.i, 2)], ['R', hex(r.r, 2)], ['IM', String(r.im)], ['IFF', `${+r.iff1}${+r.iff2}`], ['T', String(r.t)], ['', r.halted ? 'HALT' : ''],
      ];
      regs.replaceChildren(...pairs.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
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
