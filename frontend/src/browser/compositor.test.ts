import { describe, it, expect } from 'vitest';
import seed from '../../public/demo/project.json';
import { compile, cropSize } from './compositor';
import type { LocalProject } from './store';
const fixture = () => structuredClone(seed) as unknown as LocalProject;
describe('browser composition contracts', () => {
  it('keeps equal sentence IDs separate across sources', () => {
    const p = fixture();
    p.sources.B = { ...p.sources.A, id: 'other' };
    p.transcripts.B = structuredClone(p.transcripts.A);
    const r = p.reels[0];
    r.segments = [{ src: 'B', sentences: [0, 0] }];
    r.caption_text = { 'A:0': 'Wrong source', 'B:0': 'The right source' };
    compile(p, r);
    expect(r.speech).toBe('The right source');
    expect(r.shot_list[0].source).toBe('B');
  });
  it('rejects invalid cuts and the one-minute reel budget', () => {
    const p = fixture(),
      r = p.reels[0];
    for (const segment of [
      { src: 'A', s: 3, e: 2 },
      { src: 'A', s: -1, e: 2 },
      { src: 'A', s: 0, e: 99 },
      { src: 'missing', s: 0, e: 1 },
    ]) {
      r.segments = [segment];
      expect(() => compile(p, r)).toThrow();
    }
    p.sources.A.duration = 120;
    r.segments = [{ src: 'A', s: 0, e: 61 }];
    expect(() => compile(p, r)).toThrow(/60 seconds/);
  });
  it('keeps blank manual captions blank', () => {
    const p = fixture(),
      r = p.reels[0];
    p.transcripts.A.sentences.forEach((s) => (s.text = ''));
    r.caption_text = {};
    compile(p, r);
    expect(r.caption_events).toEqual([]);
    expect(r.speech).toBe('');
  });
  it('keeps caption timing continuous across fast reframe cuts instead of repeating the sentence', () => {
    const p = fixture(),
      r = p.reels[0];
    p.sources.A.duration = 4;
    p.transcripts.A.sentences = [{ id: 0, s: 0, e: 4, text: 'one two three four', w0: 0, w1: 4 }];
    r.caption_text = {};
    r.editing = { captions: { style: { words_per_caption: 2 } } };
    r.segments = Array.from({ length: 8 }, (_, i) => ({ src: 'A', s: i / 2, e: (i + 1) / 2 }));
    compile(p, r);
    expect(r.caption_events).toEqual([
      { s: 0, e: 2, text: 'one two' },
      { s: 2, e: 4, text: 'three four' },
    ]);
    expect(r.duration).toBe(4);
    expect(r.speech).toBe('one two three four');
  });
  it('fills the output at crop extremes without exposing empty borders', () => {
    const p = fixture(),
      r = p.reels[0];
    for (const [width, height] of [
      [1920, 1080],
      [720, 1280],
    ])
      for (const x of [0, 1])
        for (const y of [0, 1]) {
          r.editing = { crop: { x, y, zoom: 3 } };
          const crop = cropSize(r, width, height, 540, 960);
          expect(crop.x).toBeLessThanOrEqual(0);
          expect(crop.y).toBeLessThanOrEqual(0);
          expect(crop.x + crop.sw).toBeGreaterThanOrEqual(539.99);
          expect(crop.y + crop.sh).toBeGreaterThanOrEqual(959.99);
        }
  });
});
