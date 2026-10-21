import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import type { CaptionEvent, Reel, TextStyle } from '../types';
import type { LocalProject } from './store';
import { asset, blobURL, put } from './store';
export const OUTPUT = { w: 540, h: 960, fps: 24 };
export function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
}
export function compile(p: LocalProject, r: Reel) {
  let offset = 0;
  const captions: CaptionEvent[] = [];
  const shots = r.segments.map((segment) => {
    const source = p.sources[segment.src];
    if (!source) throw new Error('A selected source is missing.');
    const sentences = p.transcripts[segment.src]?.sentences || [];
    const selected = segment.sentences
      ? sentences.filter((s) => s.id >= segment.sentences![0] && s.id <= segment.sentences![1])
      : [];
    const start = segment.s ?? selected[0]?.s,
      end = segment.e ?? selected.at(-1)?.e;
    if (
      start === undefined ||
      end === undefined ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start ||
      end > source.duration + 0.05
    )
      throw new Error('Choose valid segment bounds inside the source video.');
    for (const s of sentences.filter((s) => s.s < end && s.e > start)) {
      const text =
        r.caption_text?.[`${segment.src}:${s.id}`] ?? r.caption_text?.[String(s.id)] ?? s.text;
      if (text.trim()) {
        const words = text.trim().split(/\s+/),
          groups = Array.from({ length: Math.ceil(words.length / 5) }, (_, i) =>
            words.slice(i * 5, i * 5 + 5).join(' '),
          ),
          a = offset + Math.max(start, s.s) - start,
          b = offset + Math.min(end, s.e) - start;
        groups.forEach((text, i) =>
          captions.push({
            s: a + ((b - a) * i) / groups.length,
            e: a + ((b - a) * (i + 1)) / groups.length,
            text,
          }),
        );
      }
    }
    const duration = end - start,
      shot = { start: offset, duration, source: segment.src, source_in: start, source_out: end };
    offset += duration;
    return shot;
  });
  if (!shots.length || offset > 60.001 || offset < 0.1)
    throw new Error('Each reel must contain 0.1–60 seconds of footage.');
  r.duration = offset;
  r.shot_list = shots;
  r.caption_events = captions;
  r.speech = captions.map((c) => c.text).join(' ');
  r.text_events = [
    ...(r.title_text ? [{ s: 0, e: Math.min(2, offset), text: r.title_text, role: 'hook' }] : []),
    ...(r.cta ? [{ s: Math.max(0, offset - 2), e: offset, text: r.cta, role: 'cta' }] : []),
  ];
}
export function captionStyle(r: Reel): TextStyle {
  return { ...r.effective_style.captions?.style, ...r.editing?.captions?.style };
}
export function textAt(r: Reel, t: number) {
  if (r.editing?.captions?.enabled === false) return '';
  return (
    r.text_events.find((c) => c.s <= t && t < c.e)?.text ||
    r.caption_events.find((c) => c.s <= t && t < c.e)?.text ||
    ''
  );
}
export function captionCanvas(r: Reel, text: string, w: number, h: number, alpha = 1, pop = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d')!;
  const style = captionStyle(r);
  const size = Math.max(9, ((style.size || 56) * h) / 1280),
    font = style.font || 'Manrope';
  c.font = `${style.weight || 700} ${size}px "${font}",Arial,sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineJoin = 'round';
  text =
    style.case === 'upper'
      ? text.toUpperCase()
      : style.case === 'lower'
        ? text.toLowerCase()
        : text;
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? line + ' ' + word : word;
    if (c.measureText(candidate).width > w * 0.88 && line) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  const cx = Math.min(w * 0.9, Math.max(w * 0.1, w / 2 + ((style.x || 0) * h) / 1280));
  const total = lines.length * size * 1.25,
    cy = Math.min(
      h - total / 2 - 12,
      Math.max(total / 2 + 12, h / 2 + ((style.y || 0) * h) / 1280),
    );
  c.globalAlpha = alpha;
  c.translate(cx, cy);
  c.scale(pop, pop);
  if (style.box?.color) {
    c.fillStyle = style.box.color;
    c.globalAlpha = alpha * (style.box.opacity ?? 0.7);
    const width = Math.min(w * 0.95, Math.max(...lines.map((l) => c.measureText(l).width)) + 20);
    c.fillRect(-width / 2, -total / 2 - 6, width, total + 12);
    c.globalAlpha = alpha;
  }
  lines.forEach((line, index) => {
    const y = (index - (lines.length - 1) / 2) * size * 1.25;
    c.strokeStyle = style.stroke?.color || '#000000';
    c.lineWidth = ((style.stroke?.width ?? 3) * h) / 1280;
    if (c.lineWidth) c.strokeText(line, 0, y, w * 0.88);
    c.fillStyle = style.fill || '#ffffff';
    c.fillText(line, 0, y, w * 0.88);
  });
  return canvas;
}
export async function canvasBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Image encoding failed.'))),
      type,
      quality,
    ),
  );
}
export async function loadVideo(url: string, signal?: AbortSignal) {
  checkAbort(signal);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  await new Promise<void>((resolve, reject) => {
    let done = false;
    const end = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.onloadeddata = null;
      video.onerror = null;
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve();
    };
    const abort = () => end(new DOMException('Cancelled', 'AbortError'));
    const timer = setTimeout(
      () => end(new Error('Video decoding timed out. Use an H.264/AAC MP4 clip.')),
      15000,
    );
    video.onloadeddata = () => end();
    video.onerror = () =>
      end(
        new Error(
          'This browser cannot decode the video. Use H.264/AAC MP4 or a supported WebM file.',
        ),
      );
    signal?.addEventListener('abort', abort, { once: true });
    video.load();
  });
  return video;
}
export function releaseVideo(video: HTMLVideoElement) {
  video.pause();
  video.removeAttribute('src');
  video.load();
}
export async function seek(video: HTMLVideoElement, t: number, signal?: AbortSignal) {
  checkAbort(signal);
  t = Math.max(0, Math.min(t, video.duration - 0.02));
  if (Math.abs(video.currentTime - t) < 0.002 && video.readyState >= 2) return;
  await new Promise<void>((resolve, reject) => {
    let done = false;
    const end = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.onseeked = null;
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve();
    };
    const abort = () => end(new DOMException('Cancelled', 'AbortError'));
    const timer = setTimeout(() => end(new Error('Seeking the video timed out.')), 10000);
    video.onseeked = () => end();
    signal?.addEventListener('abort', abort, { once: true });
    video.currentTime = t;
  });
}
export function cropSize(
  r: Reel,
  width: number,
  height: number,
  w: number,
  h: number,
  t = 0,
  duration = 1,
) {
  const cfg = { x: 0.5, y: 0.5, zoom: 1, ...r.editing?.crop };
  const motion = r.editing?.motion,
    punch = (motion?.punch_rate || 0) * 0.08,
    push = (motion?.push_rate || 0) * 0.06,
    z = 1 + punch * Math.sin(t * 2) ** 2 + (push * t) / Math.max(0.001, duration);
  const scale = Math.max(w / width, h / height) * cfg.zoom * z;
  const sw = width * scale,
    sh = height * scale;
  const x = Math.max(w - sw, Math.min(0, w / 2 - cfg.x * sw)),
    y = Math.max(h - sh, Math.min(0, h / 2 - cfg.y * sh));
  return { sw, sh, x, y };
}
export async function board(
  p: LocalProject,
  r: Reel,
  signal: AbortSignal,
  progress: (s: string) => void,
) {
  compile(p, r);
  await document.fonts.ready;
  const videos = new Map<string, HTMLVideoElement>();
  const width = 240,
    height = 426;
  try {
    for (const shot of r.shot_list) {
      if (!videos.has(shot.source)) {
        const a = await asset(p.sources[shot.source].id);
        videos.set(shot.source, await loadVideo(await blobURL(a.id, a.blob), signal));
      }
    }
    async function image(t: number) {
      checkAbort(signal);
      const shot =
        r.shot_list.find((s) => s.start <= t && t < s.start + s.duration) || r.shot_list.at(-1)!;
      const video = videos.get(shot.source)!;
      await seek(video, shot.source_in + t - shot.start, signal);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const c = canvas.getContext('2d')!;
      const crop = cropSize(
        r,
        video.videoWidth,
        video.videoHeight,
        width,
        height,
        t - shot.start,
        shot.duration,
      );
      c.drawImage(video, crop.x, crop.y, crop.sw, crop.sh);
      const text = textAt(r, t);
      if (text) {
        const active =
          r.text_events.find((e) => e.s <= t && t < e.e) ||
          r.caption_events.find((e) => e.s <= t && t < e.e);
        const delta = t - (active?.s || 0),
          anim = captionStyle(r).anim?.in,
          alpha = anim === 'fade' && delta < 0.125 ? (delta < 0.0625 ? 0.35 : 0.75) : 1,
          pop = anim === 'pop' && delta < 0.125 ? (delta < 0.0625 ? 0.88 : 1.04) : 1;
        c.drawImage(captionCanvas(r, text, width, height, alpha, pop), 0, 0);
      }
      return canvas;
    }
    const frames = [];
    const prefix = `${p.id}-${r.id}-${p.generation}-${crypto.randomUUID()}`;
    for (let i = 0; i < 3; i++) {
      const t = Math.min(r.duration! - 0.03, ((i + 0.5) * r.duration!) / 3);
      const id = prefix + `-still${i}`;
      await put('media', id, await canvasBlob(await image(t), 'image/jpeg', 0.87));
      frames.push({ t, url: 'local:' + id });
    }
    const ranges =
      r.duration! <= 3
        ? [{ s: 0, e: r.duration! }]
        : [0, 0.5, 1].map((q) => ({ s: q * (r.duration! - 1), e: q * (r.duration! - 1) + 1 }));
    const gif = GIFEncoder();
    let count = 0;
    for (const range of ranges) {
      for (let t = range.s; t < range.e - 0.001; t += 0.2) {
        const canvas = await image(t),
          rgba = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
        const palette = quantize(rgba, 96);
        gif.writeFrame(applyPalette(rgba, palette), width, height, {
          palette,
          delay: 200,
          repeat: 0,
        });
        count++;
        progress(`Creating ${r.id} storyboard · ${count} sampled GIF frames`);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    gif.finish();
    const blob = new Blob([Uint8Array.from(gif.bytes()).buffer], { type: 'image/gif' });
    if (blob.size > 2 * 1024 * 1024)
      throw new Error('The sampled GIF exceeds its 2 MB budget. Use a simpler or shorter clip.');
    const id = prefix + '-gif';
    await put('media', id, blob);
    r.frames = frames;
    r.gif = { url: 'local:' + id, duration: count * 0.2, sampled_ranges: ranges };
    r.render = { url: null, status: null, qc_verdict: null, issues: [], error: null, sha256: null };
    return count;
  } finally {
    for (const video of videos.values()) releaseVideo(video);
  }
}
