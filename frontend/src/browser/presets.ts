import type { EditPreset, Project, Reel } from '../types';
import { clamp } from './referenceLook';
export type PresetParts = 'both' | 'colour' | 'pacing';
export const BUILTIN_PRESETS: EditPreset[] = [
  {
    id: 'builtin-warm-punchy',
    version: 1,
    builtin: true,
    name: 'Warm & punchy',
    created: 0,
    source: { project: 'Reel Studio starter presets', reel: 'Warm tone · fast rhythm' },
    colour: { gain: [1.04, 1, 0.97], offset: [10, 1, -8], saturation: 1.12, strength: 0.85 },
    pacing: { target: 0.8, reframes: true, pattern: [0.6, 0.8, 1] },
  },
  {
    id: 'builtin-clean-calm',
    version: 1,
    builtin: true,
    name: 'Clean & calm',
    created: 0,
    source: { project: 'Reel Studio starter presets', reel: 'Neutral tone · slower rhythm' },
    colour: { gain: [1.02, 1.02, 1.02], offset: [2, 2, 2], saturation: 0.95, strength: 0.8 },
    pacing: { target: 2.5, reframes: false, pattern: [2, 3] },
  },
  {
    id: 'builtin-cool-crisp',
    version: 1,
    builtin: true,
    name: 'Cool & crisp',
    created: 0,
    source: { project: 'Reel Studio starter presets', reel: 'Cool tone · snappy rhythm' },
    colour: { gain: [0.98, 1, 1.05], offset: [-5, 1, 7], saturation: 1.05, strength: 0.8 },
    pacing: { target: 1, reframes: true, pattern: [1, 0.7, 1.3] },
  },
];
const number = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const vector = (v: unknown, min: number, max: number) =>
  Array.isArray(v) && v.length === 3 && v.every((x) => number(x, min, max));
export function validatePreset(value: unknown): EditPreset {
  const p = value as EditPreset;
  if (!p || p.version !== 1 || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 80)
    throw new Error('Use a version 1 Reel Studio preset with a name under 80 characters.');
  if (!p.colour && !p.pacing) throw new Error('This preset has no tone or pacing settings.');
  const c = p.colour,
    t = p.pacing;
  if (
    c &&
    (!vector(c.gain, 0.5, 2) ||
      !vector(c.offset, -80, 80) ||
      !number(c.saturation, 0, 2) ||
      !number(c.strength, 0, 1))
  )
    throw new Error('The preset contains an invalid colour correction.');
  if (
    t &&
    (!number(t.target, 0.35, 5) ||
      typeof t.reframes !== 'boolean' ||
      !Array.isArray(t.pattern) ||
      !t.pattern.length ||
      t.pattern.length > 120 ||
      !t.pattern.every((v) => number(v, 0.35, 5)))
  )
    throw new Error('The preset contains an invalid cut rhythm.');
  // Only portable style settings cross projects; never media, captions or source ranges.
  return {
    id: typeof p.id === 'string' && /^[\w-]{1,80}$/.test(p.id) ? p.id : crypto.randomUUID(),
    version: 1,
    name: p.name.trim(),
    created: number(p.created, 0, Number.MAX_SAFE_INTEGER) ? p.created : Date.now(),
    source: {
      project: String(p.source?.project || 'Imported preset').slice(0, 120),
      reel: String(p.source?.reel || '').slice(0, 80),
    },
    ...(c
      ? {
          colour: {
            gain: [...c.gain],
            offset: [...c.offset],
            saturation: c.saturation,
            strength: c.strength,
          },
        }
      : {}),
    ...(t ? { pacing: { target: t.target, reframes: t.reframes, pattern: [...t.pattern] } } : {}),
  };
}
export function capturePreset(p: Project, r: Reel, name: string, parts: PresetParts): EditPreset {
  if (!['both', 'colour', 'pacing'].includes(parts))
    throw new Error('Choose tone, pacing, or both.');
  const timing = r.editing?.pacing;
  const nominal = timing?.pattern?.length ? timing.pattern : timing ? [timing.target] : [];
  const observed = r.shot_list.map((s) => s.duration);
  const followsNominal =
    nominal.length &&
    observed.every(
      (v, i) =>
        Math.abs(v - nominal[i % nominal.length]) < 0.002 ||
        (i === observed.length - 1 && v <= nominal[i % nominal.length] + 0.002),
    );
  const pattern = followsNominal ? nominal : observed.map((v) => clamp(v, 0.35, 5));
  return validatePreset({
    id: crypto.randomUUID(),
    version: 1,
    name,
    created: Date.now(),
    source: { project: p.name, reel: r.title || r.id },
    ...(parts !== 'pacing'
      ? {
          colour: structuredClone(
            r.editing?.colour || { gain: [1, 1, 1], offset: [0, 0, 0], saturation: 1, strength: 0 },
          ),
        }
      : {}),
    ...(parts !== 'colour'
      ? {
          pacing: {
            target: clamp(timing?.target || pattern[0] || 5, 0.35, 5),
            reframes: timing?.reframes ?? false,
            pattern: pattern.length ? pattern : [5],
          },
        }
      : {}),
  });
}
