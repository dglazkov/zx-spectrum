import { describe, expect, it } from 'vitest';
import { DEFAULTS, loadSettings, saveSettings, type Store } from './settings';

const memory = (initial: Record<string, string> = {}): Store & { data: Record<string, string> } => {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
};

describe('remembered settings', () => {
  it('are the defaults with nothing saved, or no storage at all', () => {
    expect(loadSettings(memory())).toEqual(DEFAULTS);
    expect(loadSettings(null)).toEqual(DEFAULTS);
  });

  it('come back as they were saved', () => {
    const store = memory();
    saveSettings({ ...DEFAULTS, display: 'sharp', model: '128k', volume: 0.3 }, store);
    expect(loadSettings(store)).toMatchObject({ display: 'sharp', model: '128k', volume: 0.3 });
  });

  it('take the default for anything missing, mistyped or unreadable', () => {
    expect(loadSettings(memory({ 'zx-spectrum.settings': '{"display":"sharp","volume":"loud","nonsense":1}' }))).toMatchObject({ display: 'sharp', volume: DEFAULTS.volume });
    expect(loadSettings(memory({ 'zx-spectrum.settings': 'not json' }))).toEqual(DEFAULTS);
  });

  it('survive storage that refuses', () => {
    const refusing: Store = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(loadSettings(refusing)).toEqual(DEFAULTS);
    expect(() => saveSettings(DEFAULTS, refusing)).not.toThrow();
  });
});
