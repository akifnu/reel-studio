import { describe, it, expect } from 'vitest';
import {
  gradePixel,
  matchColour,
  pacingFromFrames,
  paceSegments,
  sceneSignature,
} from './referenceLook';
import { editingReply } from './editingAssistant';
import type { Project, Reel } from '../types';
const project = {
  reference: {
    matched_colour: { gain: [1, 1, 1], offset: [8, 0, -8], saturation: 1, strength: 1 },
  },
  transcripts: {
    A: {
      sentences: [
        { id: 0, s: 0, e: 1.2, text: 'First sentence' },
        { id: 1, s: 1.5, e: 2.5, text: 'Second sentence' },
      ],
    },
  },
} as unknown as Project;
const reel = {
  duration: 4,
  segments: [{ src: 'A', s: 0, e: 4 }],
  shot_list: [{ source: 'A', source_in: 0, source_out: 4, start: 0, duration: 4 }],
  effective_style: { captions: { style: { size: 56, box: { color: '#004b06' } } } },
} as Reel;
describe('measured look and cut transfer', () => {
  it('bounds exposure transfer and applies a warm shift to pixels', () => {
    const grade = matchColour(
      { mean: [100, 100, 100], deviation: [40, 40, 40], saturation: 0.3 },
      { mean: [130, 110, 75], deviation: [40, 40, 40], saturation: 0.3 },
    );
    expect(grade.offset).toEqual([30, 10, -25]);
    expect(gradePixel([100, 100, 100], grade)).toEqual([130, 110, 75]);
    expect(gradePixel([100, 100, 100], { ...grade, strength: 0 })).toEqual([100, 100, 100]);
  });
  it('detects actual histogram scene changes and leaves static footage alone', () => {
    const a = [1, 0, 0],
      b = [0, 1, 0],
      times = [0, 0.5, 1, 1.5, 2];
    expect(pacingFromFrames(times, [a, a, b, b, a]).cuts).toEqual([0.75, 1.75]);
    expect(pacingFromFrames(times, [a, a, a, a, a]).confidence).toBe('no-cuts');
  });
  it('preserves whole transcript sentences and removes only their gaps', () => {
    const segments = paceSegments(project, reel, 0.8);
    expect(segments.reduce((n, s) => n + s.e! - s.s!, 0)).toBeCloseTo(2.2);
    expect(segments.every((s) => s.e! <= 1.2 || s.s! >= 1.5)).toBe(true);
  });
  it('detects same-palette spatial jump cuts that a global colour histogram misses', () => {
    const make = (reverse: boolean, caption = false) => {
      const pixels = new Uint8ClampedArray(64 * 96 * 4);
      for (let y = 0; y < 96; y++)
        for (let x = 0; x < 64; x++) {
          const value = x < 32 !== reverse ? 75 : 150,
            k = (y * 64 + x) * 4;
          pixels[k] = pixels[k + 1] = pixels[k + 2] = caption && y > 60 && y < 80 ? 240 : value;
          pixels[k + 3] = 255;
        }
      return sceneSignature(pixels, 64, 96);
    };
    const a = make(false),
      b = make(true);
    expect(a.slice(0, 48)).toEqual(b.slice(0, 48));
    const found = pacingFromFrames([0, 0.125, 0.25, 0.375, 0.5, 0.625], [a, a, a, b, b, b], 0.75);
    expect(found.cuts).toHaveLength(1);
    expect(found.cuts[0]).toBeCloseTo(0.3125);
    expect(
      pacingFromFrames([0, 0.125, 0.25, 0.375], [a, make(false, true), a, a], 0.5).confidence,
    ).toBe('no-cuts');
  });
});
describe('editing conversation', () => {
  it('proposes real colour and caption changes in one message, with a contextual follow-up', () => {
    const first = editingReply(project, reel, 'Yellow captions without a box and warmer');
    expect(first.changes.editing?.captions?.style?.box?.color).toBe('');
    expect(first.changes.editing?.captions?.style?.fill).toBe('#ffe600');
    expect(first.changes.editing?.colour?.offset).toEqual([6, 0, -6]);
    const next = editingReply(project, reel, 'make them bigger', [
      { role: 'assistant', text: first.explanation, changes: first.changes },
    ]);
    expect(next.changes.editing?.captions?.style?.size).toBe(62);
  });
  it('answers questions without silently editing and honours a negative request', () => {
    expect(editingReply(project, reel, 'Why do captions look different?').changes).toEqual({});
    expect(editingReply(project, reel, "don't make it warmer").changes).toEqual({});
    expect(editingReply(project, reel, 'what is the weather?').explanation).toContain(
      'not a general AI model',
    );
  });
  it('changes montage timing and caps invalid trim requests', () => {
    expect(editingReply(project, reel, 'cuts every 1 second').changes.segments).toHaveLength(3);
    expect(editingReply(project, reel, 'trim to 2 seconds').changes.segments).toEqual([
      { src: 'A', s: 0, e: 2 },
    ]);
  });
});
