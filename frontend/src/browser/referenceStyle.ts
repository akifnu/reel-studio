import type { CaptionAnalysis, TextStyle } from '../types';
import { checkAbort, seek } from './compositor';
import { averageLooks, colourStats, pacingFromFrames, sceneSignature } from './referenceLook';
export const REFERENCE_VERSION = 3;
type Match = {
  bounds: { x: number; y: number; w: number; h: number };
  colour: number[];
  fill: number[];
  x: number;
  y: number;
  size: number;
  paddingX: number;
  paddingY: number;
  width: number;
  lines: number;
  lineHeight: number;
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const hex = (rgb: number[]) =>
  '#' +
  rgb
    .map((x) =>
      Math.max(0, Math.min(255, Math.round(x)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');

// Detect flat caption backplates with bright glyphs. No OCR, model download or network request.
export function boxedCaptionPixels(data: Uint8ClampedArray, w: number, h: number): Match | null {
  const bins = new Map<number, { n: number; rgb: number[] }>();
  for (let y = Math.floor(h * 0.22); y < h * 0.88; y++)
    for (let x = Math.floor(w * 0.04); x < w * 0.96; x++) {
      const i = (y * w + x) * 4,
        r = data[i],
        g = data[i + 1],
        b = data[i + 2],
        max = Math.max(r, g, b),
        min = Math.min(r, g, b);
      if (max > 210 || (max - min < 30 && max > 80) || max < 12) continue;
      const key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4),
        bin = bins.get(key) || { n: 0, rgb: [0, 0, 0] };
      bin.n++;
      bin.rgb[0] += r;
      bin.rgb[1] += g;
      bin.rgb[2] += b;
      bins.set(key, bin);
    }
  const candidates = [...bins.values()]
    .filter((b) => b.n > w * h * 0.0008)
    .sort((a, b) => b.n - a.n)
    .slice(0, 10);
  const matches: { match: Match; score: number }[] = [];
  const mask = new Uint8Array(w * h),
    seen = new Uint8Array(w * h),
    queue = new Int32Array(w * h);
  for (const bin of candidates) {
    const colour = bin.rgb.map((v) => v / bin.n);
    mask.fill(0);
    seen.fill(0);
    for (let y = Math.floor(h * 0.2); y < h * 0.9; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = (y * w + x) * 4;
        if (
          Math.abs(colour[0] - data[i]) < 27 &&
          Math.abs(colour[1] - data[i + 1]) < 27 &&
          Math.abs(colour[2] - data[i + 2]) < 27
        )
          mask[y * w + x] = 1;
      }
    for (let origin = 0; origin < mask.length; origin++) {
      if (!mask[origin] || seen[origin]) continue;
      let head = 0,
        tail = 1,
        minX = w,
        minY = h,
        maxX = 0,
        maxY = 0;
      queue[0] = origin;
      seen[origin] = 1;
      while (head < tail) {
        const n = queue[head++],
          x = n % w,
          y = Math.floor(n / w);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        for (const next of [n - 1, n + 1, n - w, n + w])
          if (
            next >= 0 &&
            next < mask.length &&
            !seen[next] &&
            mask[next] &&
            Math.abs((next % w) - x) <= 1
          ) {
            seen[next] = 1;
            queue[tail++] = next;
          }
      }
      const bw = maxX - minX + 1,
        bh = maxY - minY + 1;
      if (
        bw < w * 0.1 ||
        bw > w * 0.96 ||
        bh < h * 0.012 ||
        bh > h * 0.16 ||
        bw / bh < 1.7 ||
        tail / (bw * bh) < 0.32 ||
        tail < 60
      )
        continue;
      const rows: { y: number; xs: number[] }[] = [],
        fg = [0, 0, 0];
      let pixels = 0;
      for (let y = minY + 1; y < maxY; y++) {
        const xs: number[] = [];
        for (let x = minX + 1; x < maxX; x++) {
          const n = y * w + x,
            i = n * 4;
          if (Math.min(data[i], data[i + 1], data[i + 2]) < 185) continue;
          let enclosed = false;
          for (const d of [2, 3, 4, 5])
            if (
              x > d &&
              x < w - d &&
              y > d &&
              y < h - d &&
              ((mask[n - d] && mask[n + d]) || (mask[n - d * w] && mask[n + d * w]))
            ) {
              enclosed = true;
              break;
            }
          if (enclosed) {
            xs.push(x);
            pixels++;
            fg[0] += data[i];
            fg[1] += data[i + 1];
            fg[2] += data[i + 2];
          }
        }
        if (xs.length >= 3) rows.push({ y, xs });
      }
      if (pixels < 20 || pixels / (bw * bh) < 0.012 || pixels / (bw * bh) > 0.48 || !rows.length)
        continue;
      const groups: (typeof rows)[] = [];
      for (const row of rows) {
        const last = groups.at(-1);
        if (last && row.y - last.at(-1)!.y <= 2) last.push(row);
        else groups.push([row]);
      }
      const valid = groups.filter((g) => g.length >= 4 && g.at(-1)!.y - g[0].y + 1 >= h * 0.008);
      if (!valid.length || valid.length > 3) continue;
      const inkHeight = median(valid.map((g) => g.at(-1)!.y - g[0].y + 1)),
        centres = valid.map((g) => (g[0].y + g.at(-1)!.y) / 2),
        font = inkHeight / 0.73;
      if (font < h * 0.014 || font > h * 0.09) continue;
      const widths = valid.map(
        (g) => Math.max(...g.flatMap((r) => r.xs)) - Math.min(...g.flatMap((r) => r.xs)) + 1,
      );
      const outerTop = valid[0][0].y - minY,
        outerBottom = maxY - valid.at(-1)!.at(-1)!.y;
      const paddingY = Math.max(2, Math.min(font * 0.55, (outerTop + outerBottom) / 2));
      const coreBins = new Map<number, { n: number; rgb: number[] }>();
      for (let j = 0; j < tail; j++) {
        const i = queue[j] * 4,
          key = (data[i] >> 3) * 1024 + (data[i + 1] >> 3) * 32 + (data[i + 2] >> 3);
        const b = coreBins.get(key) || { n: 0, rgb: [0, 0, 0] };
        b.n++;
        for (let channel = 0; channel < 3; channel++) b.rgb[channel] += data[i + channel];
        coreBins.set(key, b);
      }
      const core = [...coreBins.values()].sort((a, b) => b.n - a.n)[0];
      const coreColour = core.rgb.map((v) => v / core.n);
      // Reject a near-neutral computer panel reached by the colour tolerance.
      if (Math.max(...coreColour) - Math.min(...coreColour) < 30)
        continue;
      const match: Match = {
        bounds: { x: minX, y: minY, w: bw, h: bh },
        colour: coreColour,
        fill: fg.map((v) => v / pixels),
        x: (minX + maxX) / 2 / w,
        y: (centres[0] + centres.at(-1)!) / 2 / h,
        size: (font * 1280) / h,
        paddingX: Math.max(2, Math.min(font * 0.5, (bw - Math.max(...widths)) / 2)),
        paddingY: (paddingY * 1280) / h,
        width: bw / w,
        lines: valid.length,
        lineHeight:
          valid.length > 1 ? (centres.at(-1)! - centres[0]) / (valid.length - 1) / font : 1,
      };
      match.paddingX *= 1280 / h;
      // Prefer a centrally aligned caption band; reject scene objects without text-shaped holes.
      matches.push({ match, score: pixels * (1 - Math.min(0.7, Math.abs(match.x - 0.5))) });
    }
  }
  matches.sort((a, b) => b.score - a.score);
  return matches[0]?.match || null;
}
export async function analyzeBoxedReference(
  video: HTMLVideoElement,
  signal?: AbortSignal,
  progress?: (n: number) => void,
): Promise<CaptionAnalysis> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(360, video.videoWidth);
  canvas.height = Math.round((canvas.width * video.videoHeight) / video.videoWidth);
  const c = canvas.getContext('2d', { willReadFrequently: true })!;
  const matches: Match[] = [];
  const looks: ReturnType<typeof colourStats>[] = [],
    hist: number[][] = [];
  let preview: CaptionAnalysis['preview'];
  let best = 0;
  const window = Math.min(5, video.duration);
  // Stratified jitter: cover a short window, never scan the full reference.
  const times = Array.from({ length: 24 }, (_, i) =>
    Math.max(0, Math.min(video.duration - 0.03, (window * (i + 0.5)) / 24)),
  );
  for (const [i, t] of times.entries()) {
    checkAbort(signal);
    await seek(video, t, signal);
    c.drawImage(video, 0, 0, canvas.width, canvas.height);
    const pixels = c.getImageData(0, 0, canvas.width, canvas.height).data;
    looks.push(colourStats(pixels, canvas.width, canvas.height));
    hist.push(sceneSignature(pixels, canvas.width, canvas.height));
    const m = boxedCaptionPixels(pixels, canvas.width, canvas.height);
    if (m) {
      matches.push(m);
      if (m.width * m.lines > best) {
        best = m.width * m.lines;
        const margin = 4,
          x = Math.max(0, m.bounds.x - margin),
          y = Math.max(0, m.bounds.y - margin);
        const crop = document.createElement('canvas');
        crop.width = Math.min(canvas.width - x, m.bounds.w + margin * 2);
        crop.height = Math.min(canvas.height - y, m.bounds.h + margin * 2);
        crop
          .getContext('2d')!
          .drawImage(canvas, x, y, crop.width, crop.height, 0, 0, crop.width, crop.height);
        preview = { image: crop.toDataURL('image/png'), t };
      }
    }
    progress?.(50 + Math.round(((i + 1) / times.length) * 40));
    await new Promise((r) => setTimeout(r, 0));
  }
  const measured = measureBoxes(matches, preview, window, times);
  measured.look = averageLooks(looks);
  measured.pacing = pacingFromFrames(times, hist, window);
  checkAbort(signal);
  try {
    const { detectCaptionOCR } = await import('./captionOCR');
    const ocr = await detectCaptionOCR(
      video,
      times,
      signal,
      progress,
      measured.style,
      measured.preview?.t,
    );
    if (ocr.status === 'detected') {
      return {
        ...measured,
        ...ocr,
        preview: ocr.preview || measured.preview,
        frames: times.length,
        version: REFERENCE_VERSION,
        matches: measured.status === 'detected' ? measured.matches : ocr.matches!,
      };
    }
    measured.notes += ' ' + (ocr.notes || '');
  } catch (error) {
    checkAbort(signal);
    measured.notes += ' Local OCR could not finish: ' + (error as Error).message;
  }
  return measured;
}
function measureBoxes(
  matches: Match[],
  preview: CaptionAnalysis['preview'],
  window: number,
  times: number[],
): CaptionAnalysis {
  const unsupported: CaptionAnalysis = {
    status: 'unsupported',
    version: REFERENCE_VERSION,
    window_seconds: window,
    times,
    frames: times.length,
    matches: matches.length,
    notes:
      'No confident caption style was found. Colour and pacing can still be matched; caption styling needs your review. No caption preset has been substituted.',
  };
  if (matches.length < 3) return unsupported;
  const group = matches.filter((m) => Math.abs(m.y - median(matches.map((x) => x.y))) < 0.08);
  if (group.length < 3) return unsupported;
  const colours = group[0].colour,
    consistent = group.filter(
      (m) => Math.max(...m.colour.map((v, i) => Math.abs(v - colours[i]))) < 35,
    );
  if (consistent.length < 3) return unsupported;
  const val = (key: 'x' | 'y' | 'size' | 'paddingX' | 'paddingY' | 'lineHeight') =>
    median(consistent.map((m) => m[key]));
  const style: TextStyle = {
    font: 'Arial',
    weight: 400,
    size: Math.round(val('size')),
    fill: '#ffffff',
    stroke: { color: '#000000', width: 0 },
    box: {
      color: hex([0, 1, 2].map((i) => median(consistent.map((m) => m.colour[i])))),
      opacity: 1,
      per_line: true,
      radius: Math.round(val('size') * 0.2),
      pad_x: Math.round(val('paddingX')),
      pad_y: Math.round(val('paddingY')),
    },
    x: Math.round((val('x') - 0.5) * 720),
    y: Math.round((val('y') - 0.5) * 1280),
    case: 'none',
    anim: { in: 'none' },
    line_height: Math.max(0.9, Math.min(1.3, val('lineHeight'))),
    max_width: Math.max(0.3, Math.min(0.92, Math.max(...consistent.map((m) => m.width)))),
    words_per_caption: 20,
  };
  return {
    status: 'detected',
    method: 'boxed',
    preview,
    version: REFERENCE_VERSION,
    window_seconds: window,
    times,
    frames: times.length,
    matches: consistent.length,
    style,
    notes:
      'Measured box colour, white text, size and position from sampled frames. Rounded per-line boxes are recreated. Font uses Arial as an approximation; exact font identity and animation are not recovered.',
  };
}
