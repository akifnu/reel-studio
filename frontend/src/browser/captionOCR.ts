import type { CaptionAnalysis, TextStyle } from '../types';
import { checkAbort, seek } from './compositor';
import { fontFamilies } from './fonts';
import { clamp, median } from './referenceLook';
type Box = { x0: number; y0: number; x1: number; y1: number };
type Line = {
  cleaned?: boolean;
  text: string;
  confidence: number;
  bbox: Box;
  words: { text: string; confidence: number; bbox: Box }[];
};
const rgbHex = (rgb: number[]) =>
  '#' +
  rgb
    .map((v) =>
      Math.round(clamp(v, 0, 255))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
export function foreground(data: Uint8ClampedArray, w: number, h: number, box: Box) {
  const bins = new Map<number, { n: number; rgb: number[] }>();
  const ring: number[][] = [[], [], []];
  for (let x = Math.max(0, Math.floor(box.x0)); x < Math.min(w, box.x1); x += 3)
    for (const y of [Math.max(0, Math.floor(box.y0) - 5), Math.min(h - 1, Math.ceil(box.y1) + 5)]) {
      const i = (y * w + x) * 4;
      [0, 1, 2].forEach((c) => ring[c].push(data[i + c]));
    }
  const background = ring.map((xs) => median(xs));
  const x0 = Math.max(2, Math.floor(box.x0)),
    x1 = Math.min(w - 2, Math.ceil(box.x1)),
    y0 = Math.max(2, Math.floor(box.y0)),
    y1 = Math.min(h - 2, Math.ceil(box.y1));
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4,
        rgb = [data[i], data[i + 1], data[i + 2]],
        hi = Math.max(...rgb),
        lo = Math.min(...rgb);
      // Only near-solid ink with an edge; discard antialiasing and scene gradients.
      if (Math.max(...rgb.map((v, c) => Math.abs(v - background[c]))) < 55) continue;
      if (!(lo > 210 || hi < 48 || (hi - lo > 90 && hi > 150))) continue;
      let edge = false;
      for (const n of [i - 8, i + 8, i - w * 8, i + w * 8])
        if (Math.max(...rgb.map((v, c) => Math.abs(v - data[n + c]))) > 65) {
          edge = true;
          break;
        }
      if (!edge) continue;
      const key = (rgb[0] >> 5) * 64 + (rgb[1] >> 5) * 8 + (rgb[2] >> 5),
        b = bins.get(key) || { n: 0, rgb: [0, 0, 0] };
      b.n++;
      rgb.forEach((v, c) => (b.rgb[c] += v));
      bins.set(key, b);
    }
  const candidates = [...bins.values()].sort((a, b) => b.n - a.n);
  const light = candidates.find(
    (b) => Math.max(...b.rgb.map((v) => v / b.n)) > 180 && b.n >= (candidates[0]?.n || 1) * 0.2,
  );
  const b = light || candidates[0];
  return b
    ? b.rgb.map((v) => v / b.n).map((v) => (v > 246 ? 255 : v < 10 ? 0 : v))
    : [255, 255, 255];
}
function ocrBackplate(canvas: HTMLCanvasElement, b: Box): TextStyle['box'] | undefined {
  const c = canvas.getContext('2d', { willReadFrequently: true })!,
    w = canvas.width,
    h = canvas.height,
    data = c.getImageData(0, 0, w, h).data;
  const x = Math.round((b.x0 + b.x1) / 2),
    y = Math.max(0, b.y0 - 6),
    i = (y * w + x) * 4,
    colour = [data[i], data[i + 1], data[i + 2]];
  const same = (x: number, y: number) => {
    const j = (y * w + x) * 4;
    return Math.max(...colour.map((v, k) => Math.abs(v - data[j + k]))) < 24;
  };
  let left = x,
    right = x;
  while (left > 0 && same(left - 1, y)) left--;
  while (right < w - 1 && same(right + 1, y)) right++;
  const width = right - left + 1;
  if (width < b.x1 - b.x0 + 6 || width > w * 0.95) return;
  const edge = Math.min(right - 2, left + Math.max(3, Math.floor((b.x0 - left) / 2)));
  let top = y,
    bottom = y;
  while (top > 0 && same(edge, top - 1)) top--;
  while (bottom < h - 1 && same(edge, bottom + 1)) bottom++;
  const height = bottom - top + 1,
    ink = b.y1 - b.y0;
  if (top > b.y0 || bottom < b.y1 || height < ink + 4 || height > ink * 3 || height > h * 0.18)
    return;
  return {
    color: rgbHex(colour),
    opacity: 1,
    per_line: true,
    radius: Math.round((height * 0.12 * 1280) / h),
    pad_x: Math.round((((width - (b.x1 - b.x0)) / 2) * 1280) / h),
    pad_y: Math.round((((height - ink) / 2) * 1280) / h),
  };
}
function fontFit(canvas: HTMLCanvasElement, line: Line, fill: number[]) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!,
    box = line.bbox,
    height = box.y1 - box.y0,
    width = box.x1 - box.x0;
  const actual = ctx.getImageData(box.x0, box.y0, Math.max(1, width), Math.max(1, height));
  const letters = line.text.replace(/[^\p{L}]/gu, '');
  const fitText =
    letters.length &&
    letters.split('').filter((c) => c === c.toUpperCase()).length / letters.length > 0.8
      ? line.text.trim().toUpperCase()
      : line.text.trim();
  const fonts = fontFamilies.filter((font) => {
    ctx.font = `30px "${font}",monospace`;
    const a = ctx.measureText('mmmWWW111iii').width;
    ctx.font = `30px "${font}",serif`;
    return Math.abs(a - ctx.measureText('mmmWWW111iii').width) < 0.01;
  });
  let best = { score: Infinity, font: 'Arial', weight: 400, size: height / 0.73 };
  for (const font of fonts)
    for (const weight of [400, 700, 900]) {
      const probe = document.createElement('canvas');
      probe.width = Math.ceil(width + height * 3);
      probe.height = Math.ceil(height * 2);
      const c = probe.getContext('2d', { willReadFrequently: true })!;
      c.font = `${weight} 100px "${font}"`;
      const m = c.measureText(fitText);
      const size =
        (height / Math.max(1, m.actualBoundingBoxAscent + m.actualBoundingBoxDescent)) * 100;
      c.font = `${weight} ${size}px "${font}"`;
      const metrics = c.measureText(fitText);
      c.fillStyle = 'white';
      c.textBaseline = 'alphabetic';
      c.fillText(fitText, metrics.actualBoundingBoxLeft, metrics.actualBoundingBoxAscent);
      const raster = c.getImageData(0, 0, probe.width, probe.height);
      let union = 0,
        diff = 0;
      for (let y = 0; y < height; y += 2)
        for (let x = 0; x < width; x += 2) {
          const i = (y * actual.width + x) * 4,
            j = (y * raster.width + x) * 4;
          const a = Math.max(...fill.map((v, k) => Math.abs(v - actual.data[i + k]))) < 60,
            b = raster.data[j + 3] > 128;
          if (a || b) union++;
          if (a !== b) diff++;
        }
      const score =
        (Math.abs(metrics.width - width) / Math.max(1, width)) * 0.8 + diff / Math.max(1, union);
      if (score < best.score) best = { score, font, weight, size };
    }
  return best;
}
export async function detectCaptionOCR(
  video: HTMLVideoElement,
  times: number[],
  signal?: AbortSignal,
  progress?: (n: number) => void,
  seed?: TextStyle,
  seedTime?: number,
): Promise<Partial<CaptionAnalysis>> {
  const { createWorker, PSM } = await import('tesseract.js');
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  const abort = () => {
    void worker?.terminate();
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    checkAbort(signal);
    worker = await createWorker('eng', 1, {
      workerPath: '/caption-engine/worker.min.js',
      corePath: '/caption-engine',
      langPath: '/caption-engine',
      gzip: false,
      workerBlobURL: false,
      cacheMethod: 'write',
    });
    checkAbort(signal);
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      preserve_interword_spaces: '1',
    });
    const observations: {
      line: Line;
      band: Box;
      lines: Line[];
      text: string;
      canvas: HTMLCanvasElement;
      t: number;
      fill: number[];
    }[] = [];
    const samples = seed
      ? [seedTime ?? times[Math.floor(times.length / 2)]]
      : [times[3], times[12], times[21]];
    for (const [j, t] of samples.entries()) {
      checkAbort(signal);
      await seek(video, t, signal);
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(720, video.videoWidth);
      canvas.height = Math.round((canvas.width * video.videoHeight) / video.videoWidth);
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const result = await worker.recognize(canvas, {}, { blocks: true, text: true });
      checkAbort(signal);
      let lines = (result.data.blocks || []).flatMap((b) =>
        b.paragraphs.flatMap((p) => p.lines),
      ) as Line[];
      if (!seed) {
        // Strip outlines and screen detail before a second, small OCR pass. This
        // keeps white/coloured glyphs on busy video distinct from keyboard keys.
        const ox = Math.floor(canvas.width * 0.03),
          oy = Math.floor(canvas.height * 0.4),
          binary = document.createElement('canvas');
        binary.width = canvas.width - ox * 2;
        binary.height = Math.floor(canvas.height * 0.5);
        const bc = binary.getContext('2d', { willReadFrequently: true })!;
        bc.drawImage(
          canvas,
          ox,
          oy,
          binary.width,
          binary.height,
          0,
          0,
          binary.width,
          binary.height,
        );
        const pixels = bc.getImageData(0, 0, binary.width, binary.height);
        for (let i = 0; i < pixels.data.length; i += 4) {
          const rgb = [pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]],
            sorted = [...rgb].sort((a, b) => a - b),
            ink =
              sorted[0] > 185 || (sorted[2] > 220 && sorted[1] > 185 && sorted[2] - sorted[0] > 80);
          pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = ink ? 0 : 255;
        }
        bc.putImageData(pixels, 0, 0);
        const cleaned = await worker.recognize(binary, {}, { blocks: true, text: true });
        checkAbort(signal);
        const shift = (b: Box): Box => ({
          x0: b.x0 + ox,
          x1: b.x1 + ox,
          y0: b.y0 + oy,
          y1: b.y1 + oy,
        });
        const extra = (cleaned.data.blocks || [])
          .flatMap((b) => b.paragraphs.flatMap((p) => p.lines))
          .map((l) => ({
            ...l,
            cleaned: true,
            bbox: shift(l.bbox),
            words: l.words.map((w) => ({ ...w, bbox: shift(w.bbox) })),
          }));
        lines = [...extra, ...lines];
      }
      lines = lines.map((l) => {
        const words = l.words.filter((w) => /[\p{L}]{2}/u.test(w.text) && w.confidence >= 15);
        if (!words.length) return l;
        return {
          ...l,
          text: words.map((w) => w.text).join(' '),
          confidence: words.reduce((s, w) => s + w.confidence, 0) / words.length,
          bbox: {
            x0: Math.min(...words.map((w) => w.bbox.x0)),
            x1: Math.max(...words.map((w) => w.bbox.x1)),
            y0: Math.min(...words.map((w) => w.bbox.y0)),
            y1: Math.max(...words.map((w) => w.bbox.y1)),
          },
          words,
        };
      });
      const target = seed?.y !== undefined ? 0.5 + seed.y / 1280 : 0.68;
      let choices = lines
        .filter(
          (l) =>
            l.confidence >= 48 &&
            /[\p{L}]{2}/u.test(l.text) &&
            l.bbox.y0 > canvas.height * 0.12 &&
            l.bbox.y1 < canvas.height * 0.93 &&
            l.bbox.y1 - l.bbox.y0 > canvas.height * 0.012 &&
            l.bbox.y1 - l.bbox.y0 < canvas.height * 0.12 &&
            l.bbox.x1 - l.bbox.x0 > canvas.width * 0.08,
        )
        .filter(
          (l) => !seed || Math.abs((l.bbox.y0 + l.bbox.y1) / 2 / canvas.height - target) < 0.065,
        );
      if (
        !seed &&
        choices.some(
          (l) => l.cleaned && l.confidence >= 65 && l.bbox.x1 - l.bbox.x0 > canvas.width * 0.25,
        )
      )
        choices = choices.filter((l) => l.cleaned);
      choices.sort((a, b) => {
        const score = (l: Line) =>
          l.confidence +
          Math.min(55, ((l.bbox.y1 - l.bbox.y0) / canvas.height) * 1500) +
          Math.min(40, ((l.bbox.x1 - l.bbox.x0) / canvas.width) * 70) -
          Math.abs((l.bbox.y0 + l.bbox.y1) / 2 / canvas.height - target) * 85 -
          Math.abs((l.bbox.x0 + l.bbox.x1) / 2 / canvas.width - 0.5) * 50;
        return score(b) - score(a);
      });
      const chosen = choices[0];
      if (chosen) {
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const height = chosen.bbox.y1 - chosen.bbox.y0,
          centre = (chosen.bbox.x0 + chosen.bbox.x1) / 2;
        const neighbours = [
          chosen,
          ...lines.filter((l) => l.cleaned && l.confidence >= 25 && /[\p{L}]{2}/u.test(l.text)),
          ...choices,
        ].filter(
          (l) =>
            l === chosen ||
            (Math.abs((l.bbox.x0 + l.bbox.x1) / 2 - centre) < canvas.width * 0.15 &&
              Math.abs(l.bbox.y0 - chosen.bbox.y0) < height * 2 &&
              Math.min(l.bbox.y1, chosen.bbox.y1) - Math.max(l.bbox.y0, chosen.bbox.y0) <
                height * 0.3 &&
              l.bbox.y1 - l.bbox.y0 > height * 0.65 &&
              l.bbox.y1 - l.bbox.y0 < height * 1.5 &&
              l.bbox.x1 - l.bbox.x0 > canvas.width * 0.2),
        );
        const selected: Line[] = [];
        for (const l of neighbours.sort((a, b) => a.bbox.y0 - b.bbox.y0))
          if (!selected.some((s) => Math.abs(s.bbox.y0 - l.bbox.y0) < height * 0.5))
            selected.push(l);
        if (!seed && selected.length === 1 && chosen.confidence >= 60) {
          const top = Math.max(0, Math.floor(chosen.bbox.y0 - height * 2)),
            bottom = Math.min(canvas.height, Math.ceil(chosen.bbox.y1 + height * 2)),
            tight = document.createElement('canvas');
          tight.width = canvas.width;
          tight.height = bottom - top;
          const tc = tight.getContext('2d', { willReadFrequently: true })!;
          tc.drawImage(canvas, 0, top, tight.width, tight.height, 0, 0, tight.width, tight.height);
          const ink = tc.getImageData(0, 0, tight.width, tight.height);
          for (let k = 0; k < ink.data.length; k += 4) {
            const rgb = [ink.data[k], ink.data[k + 1], ink.data[k + 2]].sort((a, b) => a - b),
              v = rgb[0] > 185 || (rgb[2] > 220 && rgb[1] > 185 && rgb[2] - rgb[0] > 80) ? 0 : 255;
            ink.data[k] = ink.data[k + 1] = ink.data[k + 2] = v;
          }
          tc.putImageData(ink, 0, 0);
          await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
          const retry = await worker.recognize(tight, {}, { blocks: true, text: true });
          checkAbort(signal);
          await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
          for (const l of (retry.data.blocks || []).flatMap((b) =>
            b.paragraphs.flatMap((p) => p.lines),
          )) {
            const words = l.words.filter((w) => /[\p{L}]{2}/u.test(w.text));
            if (!words.length) continue;
            const b = {
              x0: Math.min(...words.map((w) => w.bbox.x0)),
              x1: Math.max(...words.map((w) => w.bbox.x1)),
              y0: Math.min(...words.map((w) => w.bbox.y0)) + top,
              y1: Math.max(...words.map((w) => w.bbox.y1)) + top,
            };
            if (
              l.confidence < 35 ||
              Math.abs((b.x0 + b.x1) / 2 - centre) > canvas.width * 0.15 ||
              Math.abs(b.y0 - chosen.bbox.y0) > height * 2 ||
              b.y1 - b.y0 < height * 0.65 ||
              b.y1 - b.y0 > height * 1.5 ||
              b.x1 - b.x0 < canvas.width * 0.2
            )
              continue;
            if (!selected.some((s) => Math.abs(s.bbox.y0 - b.y0) < height * 0.5))
              selected.push({ ...l, text: words.map((w) => w.text).join(' '), bbox: b });
          }
          selected.sort((a, b) => a.bbox.y0 - b.bbox.y0);
        }
        const band = {
          x0: Math.min(...selected.map((l) => l.bbox.x0)),
          x1: Math.max(...selected.map((l) => l.bbox.x1)),
          y0: Math.min(...selected.map((l) => l.bbox.y0)),
          y1: Math.max(...selected.map((l) => l.bbox.y1)),
        };
        observations.push({
          line: chosen,
          band,
          lines: selected,
          text: selected.map((l) => l.text.trim()).join(' '),
          canvas,
          t,
          fill: foreground(data, canvas.width, canvas.height, chosen.bbox),
        });
      }
      progress?.(84 + Math.round(((j + 1) / samples.length) * 12));
    }
    if (!observations.length)
      return {
        notes: 'OCR did not find a confident caption line. No caption preset was substituted.',
      };
    const ys = observations.map((o) => (o.band.y0 + o.band.y1) / 2 / o.canvas.height),
      mid = median(ys);
    const stable = observations.filter((_, i) => Math.abs(ys[i] - mid) < 0.13);
    if (!seed && stable.length < 2)
      return {
        notes:
          'Text was found in only one sampled frame; caption placement could not be confirmed.',
      };
    const o = stable.sort(
        (a, b) =>
          b.lines.length * 20 + b.line.confidence - (a.lines.length * 20 + a.line.confidence),
      )[0],
      bbox = o.band;
    const fit = fontFit(o.canvas, o.line, o.fill);
    const fill = rgbHex(o.fill),
      ratio = 1280 / o.canvas.height;
    const c = o.canvas.getContext('2d')!,
      x = Math.max(0, bbox.x0 - 8),
      y = Math.max(0, bbox.y0 - 8),
      crop = document.createElement('canvas');
    crop.width = Math.min(o.canvas.width - x, bbox.x1 - x + 8);
    crop.height = Math.min(o.canvas.height - y, bbox.y1 - y + 8);
    crop
      .getContext('2d')!
      .drawImage(o.canvas, x, y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    // Estimate a contrasting outline from pixels immediately outside the OCR glyph bounds.
    const region = c.getImageData(x, y, crop.width, crop.height);
    let dark = 0,
      light = 0;
    for (let i = 0; i < region.data.length; i += 4) {
      const max = Math.max(region.data[i], region.data[i + 1], region.data[i + 2]);
      if (max < 65) dark++;
      if (Math.min(region.data[i], region.data[i + 1], region.data[i + 2]) > 205) light++;
    }
    const bright = Math.max(...o.fill) > 180,
      stroke =
        !seed && bright && dark > light * 0.12
          ? Math.max(1, Math.round(fit.size * ratio * 0.055))
          : 0;
    const upper = o.text.replace(/[^\p{L}]/gu, '');
    const plate = seed?.box || ocrBackplate(o.canvas, o.line.bbox);
    const style: TextStyle = {
      ...seed,
      font: fit.font,
      weight: fit.weight,
      size: seed?.size ?? Math.round(clamp(fit.size * ratio, 12, 160)),
      fill: seed?.fill || fill,
      stroke: seed?.stroke || { color: bright ? '#000000' : '#ffffff', width: plate ? 0 : stroke },
      box: plate || { color: '', opacity: 0 },
      x:
        seed?.x ??
        (Math.abs((bbox.x0 + bbox.x1) / 2 / o.canvas.width - 0.5) < 0.12
          ? 0
          : Math.round(((bbox.x0 + bbox.x1) / 2 / o.canvas.width - 0.5) * 720)),
      y: seed?.y ?? Math.round((mid - 0.5) * 1280),
      case:
        upper.length > 2 &&
        upper.split('').filter((c) => c === c.toUpperCase()).length / upper.length > 0.85
          ? 'upper'
          : 'none',
      line_height:
        seed?.line_height ||
        (o.lines.length > 1
          ? clamp((o.lines[1].bbox.y0 - o.lines[0].bbox.y0) / fit.size, 0.9, 1.5)
          : 1.15),
      max_width: seed?.max_width || clamp((bbox.x1 - bbox.x0) / o.canvas.width + 0.08, 0.3, 0.9),
      words_per_caption:
        seed?.words_per_caption ||
        clamp(Math.round(median(stable.map((o) => o.text.trim().split(/\s+/).length))), 1, 20),
      anim: { in: 'none' },
    };
    return {
      status: 'detected',
      method: seed ? 'boxed' : 'ocr',
      style,
      matches: stable.length,
      preview: seed ? undefined : { image: crop.toDataURL('image/png'), t: o.t },
      ocr_text: o.text.trim(),
      font_match: `Closest available face: ${fit.font} ${fit.weight}. Upload the original font for an exact face.`,
      notes: `${seed ? 'Box measurements plus OCR' : 'Local OCR'} measured text size, colour, position and case. Font shape is approximated from installed faces; original fonts and animation cannot be recovered exactly. OCR wording is evidence only and is never copied to your raw footage.`,
    };
  } finally {
    signal?.removeEventListener('abort', abort);
    await worker?.terminate();
  }
}
