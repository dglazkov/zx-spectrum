import { afterEach, describe, expect, it } from 'vitest';
import '../i18n/ru';
import { setLanguage } from '../i18n/i18n';
import { blockLabel } from './deck';

describe('a tape’s blocks, as the deck names them', () => {
  afterEach(() => setLanguage('en'));

  it('are the core’s names in English', () => {
    for (const label of ['Program: SABOTEUR LINE 1', 'Data: 313 bytes', 'Turbo: Data: 6912 bytes', 'Pause: 1 s', 'Text: Created with Ramsoft MakeTZX'])
      expect(blockLabel(label)).toBe(label);
  });

  it('say the core’s own words in Russian, and keep the tape’s and the ROM’s', () => {
    setLanguage('ru');
    expect(blockLabel('Data: 313 bytes')).toBe('Данные: 313 байт');
    expect(blockLabel('Data: 2 bytes')).toBe('Данные: 2 байта');
    expect(blockLabel('Turbo: Data: 6912 bytes')).toBe('Турбо: Данные: 6912 байт');
    expect(blockLabel('Turbo: Bytes: CODE 40000,6912')).toBe('Турбо: Bytes: CODE 40000,6912');
    expect(blockLabel('Pause: 0.872 s')).toBe('Пауза: 0.872 с');
    expect(blockLabel('Pure tone: 21 pulses of 2168 T')).toBe('Чистый тон: 21 импульс по 2168 T');
    expect(blockLabel('Text: Created with Ramsoft MakeTZX')).toBe('Текст: Created with Ramsoft MakeTZX');
    expect(blockLabel('Program: SABOTEUR LINE 1')).toBe('Program: SABOTEUR LINE 1');
    expect(blockLabel('Jump to block +2')).toBe('Jump to block +2');
  });
});
