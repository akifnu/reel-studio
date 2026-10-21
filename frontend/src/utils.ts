import type { Changes, Reel, Shot } from './types';

export const time = (seconds: number) => {
  const n = Math.max(0, seconds || 0);
  return `${Math.floor(n / 60)}:${Math.floor(n % 60)
    .toString()
    .padStart(2, '0')}`;
};
export const bytes = (n: number) =>
  n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${(n / 1024 ** 2).toFixed(1)} MB`;
export function merge<T extends Record<string, unknown>>(
  base: T,
  patch: Record<string, unknown>,
): T {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch))
    (out as Record<string, unknown>)[k] =
      v && typeof v === 'object' && !Array.isArray(v)
        ? merge((base[k] || {}) as Record<string, unknown>, v as Record<string, unknown>)
        : v;
  return out;
}
export function shotAt(shots: Shot[], t: number) {
  return shots.find((s) => t >= s.start && t < s.start + s.duration) || shots.at(-1);
}
export function sourceTime(shot: Shot, t: number) {
  return shot.source_in + Math.max(0, t - shot.start);
}
export function controlSummary(patch: Changes): string[] {
  const rows: string[] = [];
  if (patch.title_text !== undefined) rows.push(`Hook: ${patch.title_text || 'removed'}`);
  if (patch.cta !== undefined) rows.push(`Call to action: ${patch.cta || 'removed'}`);
  if (patch.emphasis) rows.push(`Emphasize: ${patch.emphasis.join(', ')}`);
  if (patch.segments) rows.push(`${patch.segments.length} selected segment(s)`);
  if (patch.caption_text)
    rows.push(`${Object.keys(patch.caption_text).length} caption correction(s)`);
  if (patch.editing)
    for (const [section, values] of Object.entries(patch.editing))
      for (const [key, value] of Object.entries(values))
        rows.push(
          `${section} · ${key}: ${
            typeof value === 'object'
              ? Object.entries(value)
                  .map(([k, v]) => `${k} ${typeof v === 'object' ? JSON.stringify(v) : v}`)
                  .join(', ')
              : value
          }`,
        );
  return rows;
}
export function effective(reel: Reel, patch: Changes): Reel {
  return merge(
    reel as unknown as Record<string, unknown>,
    patch as Record<string, unknown>,
  ) as unknown as Reel;
}
export function phase(status: string) {
  if (status === 'needs:approve_storyboard') return 'Ready for your review';
  if (status === 'needs:review') return 'Review rendered reels';
  if (status === 'needs:verify_style') return 'Check your reference style';
  if (status === 'needs:plan') return 'Choose your moments';
  if (status === 'succeeded') return 'Ready to share';
  if (status === 'partial') return 'Some reels are ready';
  if (status === 'failed') return 'Needs a little attention';
  if (status === 'cancelled') return 'Paused';
  if (status === 'needs_attention') return 'Review required';
  if (status.includes('storyboard')) return 'Building your storyboard';
  if (status.includes('render') || status.includes('prepare')) return 'Rendering approved reels';
  if (status.includes('transcribe')) return 'Finding the words';
  if (status.includes('analyze')) return 'Reading your reference';
  return 'Preparing your project';
}
