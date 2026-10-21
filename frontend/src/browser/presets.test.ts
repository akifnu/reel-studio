import { describe, expect, it } from 'vitest';
import type { Project, Reel } from '../types';
import { capturePreset, validatePreset } from './presets';
import { controlPreview } from './controlRoom';
const grade = { gain: [1.1, 1, 0.9], offset: [5, 0, -5], saturation: 0.9, strength: 0.7 };
const fixture = () =>
  ({
    id: 'other-project',
    name: 'Warm interview',
    generation: 4,
    revision: 2,
    sources: { A: { id: 'other-raw', duration: 12 } },
    transcripts: {},
    reels: [
      {
        id: 'r01',
        title: 'Opening',
        segments: [{ src: 'A', s: 0, e: 4 }],
        shot_list: [0.5, 1.1, 0.5, 1.1, 0.5, 0.3].map((duration) => ({ duration })),
        duration: 4,
        caption_text: { c0: 'Keep these words' },
        editing: {
          colour: structuredClone(grade),
          pacing: { target: 0.8, reframes: false, pattern: [0.5, 1.1] },
          captions: { enabled: true, style: { font: 'Arial', fill: '#ffffff' } },
        },
        effective_style: { captions: { style: { font: 'Arial', fill: '#ffffff' } } },
      },
    ],
  }) as unknown as Project;
describe('portable project presets', () => {
  it('captures independent, immutable tone and timing without media or source positions', () => {
    const p = fixture(),
      r = p.reels[0],
      before = structuredClone(p);
    const preset = capturePreset(p, r, ' Warm & quick ', 'both');
    expect(preset.name).toBe('Warm & quick');
    expect(preset.source).toEqual({ project: p.name, reel: 'Opening' });
    expect(preset.colour).toEqual(grade);
    expect(preset.pacing).toEqual(r.editing!.pacing);
    expect(JSON.stringify(preset)).not.toMatch(/other-raw|segments|caption|source_in/);
    preset.colour!.gain[0] = 2;
    preset.pacing!.pattern[0] = 5;
    expect(p).toEqual(before);
    expect(capturePreset(p, r, 'Tone', 'colour').pacing).toBeUndefined();
    expect(capturePreset(p, r, 'Pace', 'pacing').colour).toBeUndefined();
  });
  it('captures current untouched tone rather than an unapplied reference and infers manual timing', () => {
    const p = fixture(),
      r = p.reels[0];
    p.reference = { matched_colour: grade } as Project['reference'];
    r.editing = {};
    r.shot_list = [{ duration: 0.6 }, { duration: 1.2 }, { duration: 8 }] as Reel['shot_list'];
    const preset = capturePreset(p, r, 'Original', 'both');
    expect(preset.colour!.strength).toBe(0);
    expect(preset.pacing).toEqual({ target: 0.6, reframes: false, pattern: [0.6, 1.2, 5] });
  });
  it('reuses timing on different source ranges and scopes application without changing other areas', () => {
    const from = fixture(),
      preset = capturePreset(from, from.reels[0], 'Reusable', 'both');
    const p = fixture();
    p.reels[0].segments = [{ src: 'A', s: 6, e: 10 }];
    p.reels[0].editing!.colour!.offset = [0, 0, 0];
    p.reels.push({
      ...structuredClone(p.reels[0]),
      id: 'r02',
      segments: [{ src: 'A', s: 10, e: 12 }],
    });
    const before = structuredClone(p);
    const tone = controlPreview(
      p,
      { action: 'preset', area: 'colour', reel_id: 'all', preset_id: preset.id },
      preset,
    );
    expect(tone.reels).toHaveLength(2);
    tone.reels.forEach((r) => expect(r.changes).toEqual({ editing: { colour: grade } }));
    const pace = controlPreview(
      p,
      { action: 'preset', area: 'pacing', reel_id: 'r01', preset_id: preset.id },
      preset,
    );
    expect(pace.reels[0].changes.editing).toEqual({ pacing: preset.pacing });
    expect(pace.reels[0].changes.segments![0]).toEqual({ src: 'A', s: 6, e: 6.5 });
    expect(pace.reels[0].changes.segments!.at(-1)!.e).toBe(10);
    expect(pace.reels[0].after).toBeCloseTo(4);
    const both = controlPreview(
      p,
      { action: 'preset', area: 'all', reel_id: 'r01', preset_id: preset.id },
      preset,
    );
    expect(both.reels[0].changes.editing).toEqual({ colour: grade, pacing: preset.pacing });
    expect(p).toEqual(before);
  });
  it('rejects unavailable components and a deleted preset instead of silently applying defaults', () => {
    const p = fixture(),
      preset = capturePreset(p, p.reels[0], 'Tone only', 'colour');
    expect(() =>
      controlPreview(
        p,
        { action: 'preset', area: 'pacing', reel_id: 'r01', preset_id: preset.id },
        preset,
      ),
    ).toThrow(/not included/);
    expect(() =>
      controlPreview(p, { action: 'preset', area: 'all', reel_id: 'r01', preset_id: preset.id }),
    ).toThrow(/no longer/);
  });
  it('captures actual cut timing when a later edit supersedes an older saved pattern', () => {
    const p = fixture(),
      r = p.reels[0];
    r.shot_list = [
      { duration: 1 },
      { duration: 1 },
      { duration: 1 },
      { duration: 1 },
    ] as Reel['shot_list'];
    const preset = capturePreset(p, r, 'Current timing', 'pacing');
    expect(preset.pacing!.pattern).toEqual([1, 1, 1, 1]);
  });
  it('validates imported files and strips unrelated fields', () => {
    const p = fixture(),
      preset = capturePreset(p, p.reels[0], 'Portable', 'both');
    const imported = validatePreset({
      ...preset,
      segments: [{ src: 'reference' }],
      url: 'https://example.com',
      editing: { captions: {} },
    });
    expect(imported).toEqual(preset);
    for (const invalid of [
      null,
      {},
      { ...preset, version: 2 },
      { ...preset, name: '' },
      { ...preset, colour: { ...grade, strength: NaN } },
      { ...preset, colour: { ...grade, gain: [1, 1] } },
      { ...preset, pacing: { ...preset.pacing, pattern: [] } },
      { ...preset, pacing: { ...preset.pacing, pattern: [Infinity] } },
    ])
      expect(() => validatePreset(invalid)).toThrow();
  });
});
