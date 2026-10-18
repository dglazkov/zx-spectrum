// The line an event is sent as (telemetry.ts): its name and what it says, each only where it says something, as nerd
// keeps them (nerd guide telemetry).
import { describe, expect, it } from 'vitest';
import { eventBody } from './telemetry';

describe('an event’s body', () => {
  it('is its name, with its kind, count and time where it has them', () => {
    expect(JSON.parse(eventBody('rewind.used'))).toEqual({ nerd: 'event', name: 'rewind.used' });
    expect(JSON.parse(eventBody('game.loaded', { kind: 'shelf', ms: 1830.6 }))).toEqual({ nerd: 'event', name: 'game.loaded', kind: 'shelf', ms: 1831 });
    expect(JSON.parse(eventBody('game.played', { n: 2.4, ms: -3 }))).toEqual({ nerd: 'event', name: 'game.played', n: 2, ms: 0 });
  });

  it('leaves out what is not a number, and an empty kind', () => {
    expect(JSON.parse(eventBody('game.failed', { kind: '', ms: Number.NaN, n: Infinity }))).toEqual({ nerd: 'event', name: 'game.failed' });
  });
});
