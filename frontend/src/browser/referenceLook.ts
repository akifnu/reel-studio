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
    offset: source.mean.map((v, i) => clamp(target.mean[i] - v * gain[i], -28, 28)),
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
  // Spatial luminance/colour histogram, insensitive to small camera movement.
  const hist = new Array(48).fill(0);
  let n = 0;
  for (let y = 0; y < h; y += 4)
    for (let x = 0; x < w; x += 4) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) hist[c * 16 + Math.min(15, data[i + c] >> 4)]++;
      n++;
    }
  return hist.map((v) => v / Math.max(1, n * 3));
}
export function pacingFromFrames(times: number[], hist: number[][]): PacingAnalysis {
  const cuts: number[] = [];
  for (let i = 1; i < hist.length; i++) {
    const d = hist[i].reduce((sum, v, j) => sum + Math.abs(v - hist[i - 1][j]), 0) / 2;
    if (d > 0.28 && (!cuts.length || times[i] - cuts.at(-1)! > 0.28))
      cuts.push((times[i] + times[i - 1]) / 2);
  }
  const window = times.at(-1) || 5,
    durations = [...cuts, window].map((t, i) => t - (i ? cuts[i - 1] : 0));
  return {
    cuts,
    median_shot: cuts.length ? clamp(median(durations), 0.35, 5) : window,
    confidence: cuts.length ? 'measured' : 'no-cuts',
    interval: times.length > 1 ? times[1] - times[0] : 0,
  };
}
export async function sourceLook(video: HTMLVideoElement, signal?: AbortSignal) {
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = Math.max(1, Math.round((160 * video.videoHeight) / video.videoWidth));
  const ctx = c.getContext('2d', { willReadFrequently: true })!,
    looks: ColourStats[] = [];
  for (const fraction of [0.15, 0.5, 0.85]) {
    checkAbort(signal);
    await seek(video, Math.min(5, video.duration) * fraction, signal);
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
// Keep speech intact. Prefer complete transcript sentences and remove their gaps;
// without a transcript, use contiguous reframe cuts, preserving every source second.
export function paceSegments(p: Project, r: Reel, target: number): Segment[] {
  target = clamp(target, 0.35, 5);
  const result: Segment[] = [];
  for (const seg of r.segments) {
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
