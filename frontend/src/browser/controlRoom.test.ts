import { describe, it, expect } from 'vitest';
import type { Project, Reel } from '../types';
import { controlPreview, rhythmCuts } from './controlRoom';
const fixture = () =>
  ({
    generation: 3,
    revision: 8,
    sources: { A: { id: 'raw', duration: 8, width: 720, height: 1280 } },
    transcripts: {
      A: { sentences: [{ id: 0, s: 0, e: 4, text: 'My original caption', w0: 0, w1: 3 }] },
    },
    reference: {
      matched_colour: { gain: [1, 1, 1], offset: [10, 0, -10], saturation: 1.1, strength: 1 },
      caption_analysis: {
        status: 'detected',
        frames: 24,
        matches: 3,
        window_seconds: 5,
        pacing: { cuts: [0.6, 1.4, 2], confidence: 'measured', median_shot: 0.8, interval: 0.2 },
        style: { font: 'Arial', size: 48, fill: '#ffffff' },
      },
    },
    reels: [
      {
        id: 'r01',
        duration: 4,
        segments: [{ src: 'A', s: 0, e: 4 }],
        caption_text: {},
        editing: { captions: { enabled: true, style: { font: 'Arial', fill: '#ffffff' } } },
        effective_style: { captions: { style: { font: 'Arial', fill: '#ffffff' } } },
      },
      {
        id: 'r02',
        duration: 4,
        segments: [{ src: 'A', s: 4, e: 8 }],
        editing: { captions: { style: { fill: '#ffff00' } } },
        effective_style: { captions: { style: { fill: '#ffff00' } } },
      },
    ],
  }) as unknown as Project;
describe('independent control room actions', () => {
  it('copies only colour, with bounded strength, without mutating the project', () => {
    const p = fixture(),
      before = structuredClone(p),
      v = controlPreview(p, { area: 'colour', action: 'copy', reel_id: 'r01', strength: 0.5 });
    expect(v.reels).toHaveLength(1);
    expect(v.reels[0].changes).toEqual({
      editing: { colour: { ...p.reference!.matched_colour, strength: 0.5 } },
    });
    expect(p).toEqual(before);
  });
  it('copies sampled rhythm, retaining source duration, captions and colour', () => {
    const p = fixture(),
      v = controlPreview(p, { area: 'pacing', action: 'copy', reel_id: 'r01', reframes: false }),
      c = v.reels[0].changes;
    expect(c.segments!.slice(0, 3).map((s) => +(s.e! - s.s!).toFixed(2))).toEqual([0.6, 0.8, 0.6]);
    expect(v.reels[0].after).toBeCloseTo(4);
    expect(c.editing?.colour).toBeUndefined();
    expect(c.editing?.captions).toBeUndefined();
    expect(c.editing?.pacing?.reframes).toBe(false);
  });
  it('repeated pacing is idempotent and can make existing cuts slower', () => {
    const p = fixture(),
      r = p.reels[0],
      first = rhythmCuts(p, r, [0.5]);
    const slower = rhythmCuts(p, { ...r, segments: first }, [2]);
    expect(slower).toEqual([
      { src: 'A', s: 0, e: 2 },
      { src: 'A', s: 2, e: 4 },
    ]);
    expect(rhythmCuts(p, { ...r, segments: first }, [0.5])).toEqual(first);
  });
  it('scopes mixed prompts to the selected editing area', () => {
    const p = fixture(),
      v = controlPreview(p, {
        area: 'colour',
        action: 'prompt',
        reel_id: 'all',
        text: 'Warmer and faster, yellow captions',
      });
    expect(v.reels).toHaveLength(2);
    for (const r of v.reels) {
      expect(r.changes.editing?.colour).toBeDefined();
      expect(r.changes.segments).toBeUndefined();
      expect(r.changes.editing?.captions).toBeUndefined();
    }
  });
  it('does not substitute a preset or a guessed pace when a reference feature is missing', () => {
    const p = fixture();
    p.reference!.caption_analysis!.status = 'unsupported';
    delete p.reference!.caption_analysis!.style;
    p.reference!.caption_analysis!.pacing!.confidence = 'no-cuts';
    expect(() => controlPreview(p, { area: 'captions', action: 'copy', reel_id: 'r01' })).toThrow(
      'No confident',
    );
    expect(() => controlPreview(p, { area: 'pacing', action: 'copy', reel_id: 'r01' })).toThrow(
      'No clear',
    );
  });
  it('can reset an older paced project without deleting its source selection', () => {
    const p = fixture(),
      r = p.reels[0];
    r.segments = [
      { src: 'A', s: 1, e: 2 },
      { src: 'A', s: 2, e: 3 },
      { src: 'A', s: 5, e: 6 },
    ];
    r.editing = { pacing: { target: 1, reframes: true } };
    const reset = controlPreview(p, { area: 'pacing', action: 'reset', reel_id: 'r01' }).reels[0]
      .changes;
    expect(reset.segments).toEqual([
      { src: 'A', s: 1, e: 3 },
      { src: 'A', s: 5, e: 6 },
    ]);
    expect(reset.editing?.pacing?.reframes).toBe(false);
  });
  it('restores saved cut timing and rejects missing targets and invalid controls', () => {
    const p = fixture(),
      r = p.reels[0];
    r.control_baseline_segments = structuredClone(r.segments);
    expect(
      controlPreview(p, { area: 'pacing', action: 'reset', reel_id: 'r01' }).reels[0].changes
        .segments,
    ).toEqual(r.segments);
    expect(() => controlPreview(p, { area: 'colour', action: 'copy', reel_id: 'missing' })).toThrow(
      'target reel',
    );
    expect(() =>
      controlPreview(p, { area: 'colour', action: 'copy', reel_id: 'r01', strength: 2 }),
    ).toThrow('strength');
  });
});
