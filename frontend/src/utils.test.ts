import { describe, it, expect } from 'vitest';
import { merge, shotAt, sourceTime, controlSummary, time } from './utils';

describe('edit state and playback mapping', () => {
  it('preserves unspecified nested controls and never mutates the accepted settings', () => {
    const base = {
      editing: {
        captions: { style: { fill: '#ffffff', size: 56 } },
        music: { muted: true, gain_db: -18 },
      },
    };
    const next = merge(base, {
      editing: { captions: { style: { fill: '#ffe600' } }, music: { gain_db: -25 } },
    });
    expect(next.editing.captions.style).toEqual({ fill: '#ffe600', size: 56 });
    expect(next.editing.music).toEqual({ muted: true, gain_db: -25 });
    expect(base.editing.captions.style.fill).toBe('#ffffff');
  });
  it('maps reel time through cuts to the right source timestamp', () => {
    const shots = [
      { start: 0, duration: 2, source: 'A', source_in: 10, source_out: 12 },
      { start: 2, duration: 3, source: 'B', source_in: 30, source_out: 33 },
    ];
    const shot = shotAt(shots, 2.5)!;
    expect(shot.source).toBe('B');
    expect(sourceTime(shot, 2.5)).toBe(30.5);
  });
  it('shows exact proposed controls before a user applies them', () => {
    expect(controlSummary({ editing: { crop: { zoom: 1.2 } }, title_text: 'The hook' })).toEqual([
      'Hook: The hook',
      'crop · zoom: 1.2',
    ]);
    expect(time(65)).toBe('1:05');
  });
});
