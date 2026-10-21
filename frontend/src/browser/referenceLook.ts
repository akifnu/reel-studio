import type { ColourGrade, ColourStats, PacingAnalysis, Project, Reel, Segment } from '../types';
import { checkAbort, seek } from './compositor';
export const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
export const median = (xs: number[]) =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] || 0;
// Exclude letterbox extremes and the main caption band. Robust central statistics,
// not a claim to reconstruct the original LUT or camera colour science.
export function colourStats(data: Uint8ClampedArray, w: number, h: number): ColourStats {
  const channels: number[][] = [[], [], []];
  let sat = 0,
    n = 0;
  for (let y = Math.floor(h * 0.08); y < h * 0.92; y += 3)
    for (let x = Math.floor(w * 0.08); x < w * 0.92; x += 3) {
      if (y > h * 0.55 && y < h * 0.82) continue;
      const i = (y * w + x) * 4,
        rgb = [data[i], data[i + 1], data[i + 2]],
        hi = Math.max(...rgb),
        lo = Math.min(...rgb);
      if (hi < 12 || lo > 243) continue;
      rgb.forEach((v, j) => channels[j].push(v));
      sat += (hi - lo) / Math.max(1, hi);
      n++;
    }
  return {
    mean: channels.map((xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 128)),
    deviation: channels.map((xs) => {
      const m = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
      return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, xs.length));
    }),
    saturation: sat / Math.max(1, n),
  };
}
export function averageLooks(looks: ColourStats[]): ColourStats {
  return {
    mean: [0, 1, 2].map((i) => median(looks.map((l) => l.mean[i]))),
    deviation: [0, 1, 2].map((i) => median(looks.map((l) => l.deviation[i]))),
    saturation: median(looks.map((l) => l.saturation)),
  };
}
export function matchColour(source: ColourStats, target: ColourStats): ColourGrade {
  const gain = source.deviation.map((s, i) =>
    clamp(target.deviation[i] / Math.max(18, s), 0.8, 1.2),
  );
  return {
    gain,
    offset: source.mean.map((v, i) => clamp(target.mean[i] - v * gain[i], -64, 64)),
    saturation: clamp(target.saturation / Math.max(0.12, source.saturation), 0.65, 1.4),
    strength: 1,
  };
}
export function gradePixel(rgb: number[], grade: ColourGrade): number[] {
  const strength = clamp(grade.strength, 0, 1),
    sat = 1 + (grade.saturation - 1) * strength;
  const v = rgb.map((x, i) =>
    clamp(x * (1 + (grade.gain[i] - 1) * strength) + grade.offset[i] * strength, 0, 255),
  );
  const l = 0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2];
  return v.map((x) => clamp(l + (x - l) * sat, 0, 255));
}
export function gradeCanvas(canvas: HTMLCanvasElement, grade?: ColourGrade) {
  if (!grade || !grade.strength) return;
  const c = canvas.getContext('2d')!,
    frame = c.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < frame.data.length; i += 4) {
    const v = gradePixel([frame.data[i], frame.data[i + 1], frame.data[i + 2]], grade);
    frame.data[i] = v[0];
    frame.data[i + 1] = v[1];
    frame.data[i + 2] = v[2];
  }
  c.putImageData(frame, 0, 0);
}
export function gradeFilter(grade?: ColourGrade): string {
  if (!grade || !grade.strength) return '';
  const k = clamp(grade.strength, 0, 1),
    names = ['r', 'g', 'b'];
  const lut = names
    .map((n, i) => `${n}='clip(val*${1 + (grade.gain[i] - 1) * k}+${grade.offset[i] * k},0,255)'`)
    .join(':');
  // FFmpeg colorchannelmixer uses the same RGB luma basis as the preview.
  const sat = 1 + (grade.saturation - 1) * k,
    l = [0.299, 0.587, 0.114];
  const mix = names
    .flatMap((a, i) => names.map((b, j) => `${a}${b}=${(1 - sat) * l[j] + (i === j ? sat : 0)}`))
    .join(':');
  return `lutrgb=${lut},colorchannelmixer=${mix}`;
}
export function sceneSignature(data: Uint8ClampedArray, w: number, h: number) {
  // Keep a colour histogram AND spatial cells. A histogram alone misses jump cuts
  // between similarly lit shots. Ignore the main caption band in both measurements.
  const hist = new Array(48).fill(0);
  const cells = new Array(8 * 8 * 3).fill(0),
    counts = new Array(64).fill(0);
  let n = 0;
  for (let y = 0; y < h; y += 4)
    for (let x = 0; x < w; x += 4) {
      if (y < h * 0.08 || (y > h * 0.58 && y < h * 0.88)) continue;
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) hist[c * 16 + Math.min(15, data[i + c] >> 4)]++;
      const cell = Math.min(7, Math.floor((y / h) * 8)) * 8 + Math.min(7, Math.floor((x / w) * 8));
      counts[cell]++;
      for (let c = 0; c < 3; c++) cells[cell * 3 + c] += data[i + c] / 255;
      n++;
    }
  return [
    ...hist.map((v) => v / Math.max(1, n * 3)),
    ...cells.map((v, i) => v / Math.max(1, counts[Math.floor(i / 3)])),
  ];
}
export const PACING_VERSION = 2;
export function sceneDistance(a: number[], b: number[]): number {
  const bins = Math.min(48, a.length, b.length);
  const histogram = a.slice(0, bins).reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / 2;
  if (a.length <= 48 || b.length <= 48) return histogram;
  const spatial = a.slice(48).reduce((s, v, i) => s + Math.abs(v - b[i + 48]), 0) / (a.length - 48);
  return Math.max(histogram, spatial * 3);
}
export function pacingFromFrames(
  times: number[],
  hist: number[][],
  end = times.at(-1) || 5,
): PacingAnalysis {
  const cuts: number[] = [];
  const scores = hist.slice(1).map((h, i) => sceneDistance(h, hist[i]));
  const base = median(scores),
    mad = median(scores.map((v) => Math.abs(v - base)));
  const threshold = clamp(base + 3.5 * mad, 0.055, 0.22);
  for (let i = 1; i < hist.length; i++) {
    const d = scores[i - 1];
    const peak = d >= (scores[i - 2] ?? 0) && d >= (scores[i] ?? 0);
    const at = (times[i] + times[i - 1]) / 2;
    const flash =
      i < hist.length - 1 &&
      sceneDistance(hist[i - 1], hist[i + 1]) < d * 0.18 &&
      times[i + 1] - times[i - 1] < 0.4;
    if (
      !flash &&
      peak &&
      d > threshold &&
      (d > base * 1.6 || d > 0.45) &&
      (!cuts.length || at - cuts.at(-1)! > 0.25)
    )
      cuts.push(at);
  }
  const window = end,
    durations = [...cuts, window].map((t, i) => t - (i ? cuts[i - 1] : 0));
  return {
    version: PACING_VERSION,
    window_seconds: window,
    samples: times.length,
    scores,
    notes: cuts.length
      ? 'Measured visual shot changes; caption changes are excluded where possible.'
      : 'No reliable visual shot changes in this window. Timing is preserved; no invented cut rate.',
    cuts,
    median_shot: cuts.length ? clamp(median(durations), 0.35, 5) : window,
    confidence: cuts.length ? 'measured' : 'no-cuts',
    interval: times.length > 1 ? times[1] - times[0] : 0,
  };
}
export async function analyzePacing(
  video: HTMLVideoElement,
  signal?: AbortSignal,
  progress?: (s: string) => void,
) {
  const window = Math.min(30, video.duration),
    count = Math.max(2, Math.min(240, Math.ceil(window * 8)));
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = Math.max(1, Math.round((128 * video.videoHeight) / video.videoWidth));
  const ctx = c.getContext('2d', { willReadFrequently: true })!,
    times: number[] = [],
    frames: number[][] = [];
  for (let i = 0; i < count; i++) {
    checkAbort(signal);
    const t = Math.min(video.duration - 0.03, ((i + 0.5) * window) / count);
    await seek(video, t, signal);
    ctx.drawImage(video, 0, 0, c.width, c.height);
    times.push(t);
    frames.push(sceneSignature(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height));
    if (i % 8 === 0)
      progress?.(`Measuring reference cuts · ${Math.round(((i + 1) / count) * 100)}%`);
  }
  return pacingFromFrames(times, frames, window);
}
export async function sourceLook(
  video: HTMLVideoElement,
  signal?: AbortSignal,
  ranges?: { s: number; e: number }[],
) {
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = Math.max(1, Math.round((160 * video.videoHeight) / video.videoWidth));
  const ctx = c.getContext('2d', { willReadFrequently: true })!,
    looks: ColourStats[] = [];
  const selections = ranges?.length ? ranges : [{ s: 0, e: Math.min(5, video.duration) }],
    total = selections.reduce((n, r) => n + r.e - r.s, 0);
  for (const fraction of [0.15, 0.5, 0.85]) {
    checkAbort(signal);
    let at = total * fraction,
      t = selections[0].s;
    for (const r of selections) {
      if (at <= r.e - r.s) {
        t = r.s + at;
        break;
      }
      at -= r.e - r.s;
    }
    await seek(video, Math.min(video.duration - 0.03, t), signal);
    ctx.drawImage(video, 0, 0, c.width, c.height);
    looks.push(colourStats(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height));
  }
  return averageLooks(looks);
}
function bounds(p: Project, s: Segment) {
  const tr = p.transcripts[s.src]?.sentences || [];
  return {
    s: s.s ?? tr.find((x) => x.id === s.sentences?.[0])?.s ?? 0,
    e: s.e ?? tr.find((x) => x.id === s.sentences?.at(-1))?.e ?? 0,
  };
}
export function sourceRanges(p: Project, segments: Segment[]): Segment[] {
  const ranges: Segment[] = [];
  for (const s of segments) {
    const b = bounds(p, s),
      last = ranges.at(-1);
    if (last?.src === s.src && Math.abs(last.e! - b.s) < 0.001) last.e = b.e;
    else ranges.push({ src: s.src, s: b.s, e: b.e });
  }
  return ranges;
}
// Keep speech intact. Prefer complete transcript sentences and remove their gaps;
// without a transcript, use contiguous reframe cuts, preserving every source second.
export function paceSegments(p: Project, r: Reel, target: number): Segment[] {
  target = clamp(target, 0.35, 5);
  const result: Segment[] = [];
  for (const seg of sourceRanges(p, r.segments)) {
    const b = bounds(p, seg),
      tr = (p.transcripts[seg.src]?.sentences || []).filter(
        (x) => x.text.trim() && x.s >= b.s - 0.01 && x.e <= b.e + 0.01,
      );
    if (tr.length) {
      let group: typeof tr = [];
      for (const s of tr) {
        group.push(s);
        if (s.e - group[0].s >= target) {
          result.push({ src: seg.src, s: group[0].s, e: s.e });
          group = [];
        }
      }
      if (group.length) result.push({ src: seg.src, s: group[0].s, e: group.at(-1)!.e });
    } else {
      result.push({ src: seg.src, s: b.s, e: b.e });
    }
  }
  const timed = result.flatMap((segment) => {
    const a = segment.s!,
      b = segment.e!,
      n = Math.max(1, Math.ceil((b - a) / target));
    return Array.from({ length: n }, (_, i) => ({
      src: segment.src,
      s: a + ((b - a) * i) / n,
      e: a + ((b - a) * (i + 1)) / n,
    }));
  });
  if (timed.length > 120)
    throw new Error('That pace needs more than 120 cuts. Choose a shorter reel or slower pace.');
  return timed;
}
export function paceReel(p: Project, r: Reel, target: number) {
  r.segments = paceSegments(p, r, target);
  // Reframes make sentence-boundary jump cuts visible even on a static talking head.
  r.editing = { ...r.editing, pacing: { target, reframes: true } };
}

export function shotZoom(r: Reel, index: number) {
  return (r.editing?.crop?.zoom || 1) * (r.editing?.pacing?.reframes && index % 2 === 1 ? 1.1 : 1);
}
