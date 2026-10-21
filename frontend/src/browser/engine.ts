import { FFmpeg } from '@ffmpeg/ffmpeg';
import workerURL from '@ffmpeg/ffmpeg/worker?worker&url';
import type { Reel } from '../types';
import type { LocalProject } from './store';
import { asset, get, hash, put } from './store';
import { captionCanvas, captionStyle, canvasBlob, checkAbort, textAt, OUTPUT } from './compositor';
import { gradeFilter, shotZoom } from './referenceLook';
let current: FFmpeg | null = null;
export function stopEngine() {
  current?.terminate();
  current = null;
}
async function cachedEngineFile(path: string, signal: AbortSignal) {
  let cache: Cache | undefined;
  try {
    cache = await caches.open('reel-studio-engine-0.12.10');
  } catch {}
  const stored = await cache?.match(path);
  if (stored) return stored;
  const response = await fetch(path, { signal });
  if (response.ok && cache) await cache.put(path, response.clone()).catch(() => {});
  return response;
}
async function load(progress: (s: string) => void, signal: AbortSignal) {
  checkAbort(signal);
  progress('Loading the local video engine (about 32 MB on first use)…');
  const manifest = (await (await fetch('/engine/manifest.json')).json()) as { parts: string[] };
  const chunks: Blob[] = [];
  for (const [i, name] of manifest.parts.entries()) {
    checkAbort(signal);
    const response = await cachedEngineFile('/engine/' + name, signal);
    if (!response.ok) throw new Error('The browser video engine could not download. Please retry.');
    chunks.push(await response.blob());
    progress(`Loading video engine · ${i + 1}/${manifest.parts.length} parts`);
  }
  const wasmURL = URL.createObjectURL(new Blob(chunks, { type: 'application/wasm' }));
  const engine = new FFmpeg();
  current = engine;
  const abort = () => engine.terminate();
  signal.addEventListener('abort', abort, { once: true });
  try {
    await engine.load({
      classWorkerURL: workerURL,
      coreURL: new URL('/engine/ffmpeg-core.js', location.href).href,
      wasmURL,
    });
  } catch (e) {
    signal.removeEventListener('abort', abort);
    engine.terminate();
    current = null;
    throw e;
  } finally {
    URL.revokeObjectURL(wasmURL);
  }
  return {
    engine,
    close: () => {
      signal.removeEventListener('abort', abort);
      engine.terminate();
      if (current === engine) current = null;
    },
  };
}
const encoder = [
  '-c:v',
  'libx264',
  '-preset',
  'ultrafast',
  '-crf',
  '23',
  '-pix_fmt',
  'yuv420p',
  '-threads',
  '1',
];
async function exec(e: FFmpeg, args: string[], signal: AbortSignal) {
  checkAbort(signal);
  let tail: string[] = [];
  const log = ({ message }: { message: string }) => {
    tail.push(message);
    if (tail.length > 5) tail.shift();
  };
  e.on('log', log);
  try {
    const code = await e.exec(['-hide_banner', '-loglevel', 'error', '-y', ...args], 180000);
    checkAbort(signal);
    if (code !== 0) throw new Error('Video processing failed: ' + tail.join(' ').slice(-450));
  } finally {
    e.off('log', log);
  }
}
async function bytes(e: FFmpeg, name: string) {
  const data = await e.readFile(name);
  if (typeof data === 'string') throw new Error('Expected a media file.');
  return Uint8Array.from(data);
}
async function probe(e: FFmpeg, name: string) {
  const messages: string[] = [];
  const listener = ({ message }: { message: string }) => messages.push(message);
  e.on('log', listener);
  const code = await e.ffprobe([
    '-v',
    'error',
    '-show_streams',
    '-show_format',
    '-of',
    'json',
    name,
    '-o',
    'probe.json',
  ]);
  e.off('log', listener);
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(await bytes(e, 'probe.json')));
  } catch {
    throw new Error(
      'The video file could not be inspected (' + code + '): ' + messages.join(' ').slice(-500),
    );
  }
  if (!Array.isArray(data.streams) || !data.format) throw new Error('Invalid video metadata.');
  await e.deleteFile('probe.json');
  return data as {
    streams: { codec_type: string; width?: number; height?: number }[];
    format: { duration: string };
  };
}
function windows(r: Reel) {
  const bounds = Array.from(
    new Set([
      0,
      r.duration!,
      ...r.caption_events.flatMap((c) => [c.s, c.e]),
      ...r.text_events.flatMap((c) => [c.s, c.e]),
    ]),
  ).sort((a, b) => a - b);
  const out: { s: number; e: number; text: string }[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const s = bounds[i],
      e = bounds[i + 1],
      text = textAt(r, (s + e) / 2);
    if (!text) continue;
    const last = out.at(-1);
    if (last?.text === text && Math.abs(last.e - s) < 0.001) last.e = e;
    else out.push({ s, e, text });
  }
  if (out.length > 60) throw new Error('Use at most 60 caption/title changes per reel.');
  return out;
}
function soundEffects(r: Reel) {
  const rate = 24000,
    length = Math.ceil(r.duration! * rate),
    buffer = new ArrayBuffer(44 + length * 2),
    v = new DataView(buffer);
  function str(offset: number, s: string) {
    for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i));
  }
  str(0, 'RIFF');
  v.setUint32(4, 36 + length * 2, true);
  str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, length * 2, true);
  for (const shot of r.shot_list.slice(1)) {
    for (let n = 0; n < rate * 0.1; n++) {
      const i = Math.round(shot.start * rate) + n;
      if (i >= length) break;
      const t = n / rate,
        x = Math.sin(2 * Math.PI * (650 * t + 240 * t * t)) * Math.exp(-45 * t) * 0.25;
      v.setInt16(44 + i * 2, Math.round(x * 32767), true);
    }
  }
  return new Uint8Array(buffer);
}
export async function render(p: LocalProject, signal: AbortSignal, progress: (s: string) => void) {
  const { engine: e, close } = await load(progress, signal);
  const loaded = new Map<string, { name: string; audio: boolean }>();
  try {
    for (const [key, s] of Object.entries(p.sources)) {
      const a = await asset(s.id),
        name = 'input-' + key;
      const buffer = await a.blob.arrayBuffer();
      if ((await hash(buffer)) !== (a.digest || a.id))
        throw new Error(
          'A source file changed after upload. Upload it again and rebuild the storyboard.',
        );
      await e.writeFile(name, new Uint8Array(buffer));
      const info = await probe(e, name);
      loaded.set(key, { name, audio: info.streams.some((s) => s.codec_type === 'audio') });
    }
    if (p.musicId) {
      const music = await asset(p.musicId);
      const buffer = await music.blob.arrayBuffer();
      if ((await hash(buffer)) !== (music.digest || music.id))
        throw new Error('The music file changed after upload. Replace it and approve again.');
      await e.writeFile('music', new Uint8Array(buffer));
    }
    for (const r of p.reels) {
      progress(`Rendering ${r.id} · assembling your approved cuts`);
      const files: string[] = [];
      let index = 0;
      for (const shot of r.shot_list) {
        checkAbort(signal);
        const source = p.sources[shot.source],
          input = loaded.get(shot.source)!,
          crop = { x: 0.5, y: 0.5, ...r.editing?.crop, zoom: shotZoom(r, index) };
        const aspect = OUTPUT.w / OUTPUT.h;
        let cw = Math.min(source.width, source.height * aspect) / crop.zoom,
          ch = cw / aspect;
        cw = Math.max(2, Math.floor(cw / 2) * 2);
        ch = Math.max(2, Math.floor(ch / 2) * 2);
        const x = Math.max(0, Math.min(source.width - cw, crop.x * source.width - cw / 2)),
          y = Math.max(0, Math.min(source.height - ch, crop.y * source.height - ch / 2));
        const motion = r.editing?.motion,
          zoom = (motion?.punch_rate || 0) * 0.08,
          push = (motion?.push_rate || 0) * 0.06;
        let filter = `crop=${cw}:${ch}:${Math.floor(x)}:${Math.floor(y)},scale=${OUTPUT.w}:${OUTPUT.h},setsar=1,fps=${OUTPUT.fps}`;
        const colour = gradeFilter(r.editing?.colour);
        if (colour) filter += ',' + colour;
        if (zoom || push)
          filter += `,zoompan=z='1+${zoom}*sin(on/12)*sin(on/12)+${push}*on/${Math.max(1, Math.ceil(shot.duration * OUTPUT.fps))}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${OUTPUT.w}x${OUTPUT.h}:fps=${OUTPUT.fps}`;
        const name = `part-${index++}.mp4`;
        const args = ['-ss', String(shot.source_in), '-i', input.name];
        if (!input.audio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
        args.push(
          '-t',
          String(shot.duration),
          '-map',
          '0:v:0',
          '-map',
          input.audio ? '0:a:0' : '1:a:0',
          '-vf',
          filter,
          ...encoder,
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-ar',
          '48000',
          '-ac',
          '2',
          '-af',
          `apad,atrim=duration=${shot.duration}`,
          '-video_track_timescale',
          '24000',
          name,
        );
        await exec(e, args, signal);
        files.push(name);
      }
      await e.writeFile(
        'parts.txt',
        new TextEncoder().encode(files.map((name) => `file '${name}'`).join('\n')),
      );
      await exec(
        e,
        ['-f', 'concat', '-safe', '0', '-i', 'parts.txt', '-c', 'copy', 'base.mp4'],
        signal,
      );
      for (const name of files) await e.deleteFile(name);
      const args = ['-i', 'base.mp4'];
      const overlays: { input: number; s: number; e: number }[] = [];
      const images: string[] = [];
      if (r.editing?.captions?.enabled !== false) {
        for (const event of windows(r)) {
          const anim = captionStyle(r).anim?.in;
          const duration = Math.min(0.125, event.e - event.s);
          const phases =
            anim === 'pop' || anim === 'fade'
              ? [
                  {
                    s: event.s,
                    e: event.s + duration / 2,
                    a: anim === 'fade' ? 0.35 : 1,
                    z: anim === 'pop' ? 0.88 : 1,
                  },
                  {
                    s: event.s + duration / 2,
                    e: event.s + duration,
                    a: anim === 'fade' ? 0.75 : 1,
                    z: anim === 'pop' ? 1.04 : 1,
                  },
                  { s: event.s + duration, e: event.e, a: 1, z: 1 },
                ]
              : [{ s: event.s, e: event.e, a: 1, z: 1 }];
          for (const phase of phases) {
            if (phase.e - phase.s < 0.002) continue;
            const name = `caption-${images.length}.png`;
            const png = await canvasBlob(
              captionCanvas(r, event.text, OUTPUT.w, OUTPUT.h, phase.a, phase.z),
            );
            await e.writeFile(name, new Uint8Array(await png.arrayBuffer()));
            images.push(name);
            args.push('-i', name);
            overlays.push({ input: images.length, s: phase.s, e: phase.e });
          }
        }
      }
      let next = 1 + images.length;
      const music = r.editing?.music;
      let musicInput: number | undefined;
      if (p.musicId && !music?.muted) {
        musicInput = next++;
        args.push('-stream_loop', '-1', '-i', 'music');
      }
      const sfx = r.editing?.sfx;
      let fxInput: number | undefined;
      if (sfx?.muted === false && r.shot_list.length > 1) {
        fxInput = next++;
        await e.writeFile('effects.wav', soundEffects(r));
        args.push('-i', 'effects.wav');
      }
      const filters: string[] = [];
      let video = '0:v';
      for (let i = 0; i < overlays.length; i++) {
        const overlay = overlays[i];
        const name = 'v' + i;
        filters.push(
          `[${video}][${overlay.input}:v]overlay=enable='gte(t,${overlay.s})*lt(t,${overlay.e})':eof_action=repeat[${name}]`,
        );
        video = name;
      }
      const inputs = ['[voice]'];
      if (musicInput !== undefined) {
        filters.push('[0:a]asplit=2[voice][duck]');
        filters.push(
          `[${musicInput}:a]volume=${10 ** ((music?.gain_db ?? -18) / 20)},aresample=48000[music]`,
        );
        filters.push(
          '[music][duck]sidechaincompress=threshold=0.035:ratio=6:attack=20:release=250[bed]',
        );
        inputs.push('[bed]');
      } else filters.push('[0:a]anull[voice]');
      if (fxInput !== undefined) {
        filters.push(`[${fxInput}:a]volume=${10 ** ((sfx?.gain_db ?? -10) / 20)}[fx]`);
        inputs.push('[fx]');
      }
      filters.push(
        `${inputs.join('')}amix=inputs=${inputs.length}:normalize=0:duration=first,alimiter=limit=0.95[audio]`,
      );
      args.push(
        '-filter_complex',
        filters.join(';'),
        '-map',
        video === '0:v' ? '0:v' : `[${video}]`,
        '-map',
        '[audio]',
        '-t',
        String(r.duration),
        ...encoder,
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        'output.mp4',
      );
      progress(`Rendering ${r.id} · captions and final audio mix`);
      const listener = ({ progress: n }: { progress: number }) =>
        progress(`Rendering ${r.id} · ${Math.max(0, Math.min(99, Math.round(n * 100)))}%`);
      e.on('progress', listener);
      try {
        await exec(e, args, signal);
      } finally {
        e.off('progress', listener);
      }
      const info = await probe(e, 'output.mp4'),
        videoInfo = info.streams.find((s) => s.codec_type === 'video'),
        actual = Number(info.format.duration);
      if (
        videoInfo?.width !== OUTPUT.w ||
        videoInfo.height !== OUTPUT.h ||
        !Number.isFinite(actual) ||
        Math.abs(actual - r.duration!) > 0.35
      )
        throw new Error(
          'The encoded video failed the dimension/duration check. It has not been accepted for export.',
        );
      const data = await bytes(e, 'output.mp4');
      const blob = new Blob([data.buffer], { type: 'video/mp4' }),
        id = `${p.id}-${r.id}-render-${crypto.randomUUID()}`;
      await put('media', id, blob);
      r.render = {
        url: 'local:' + id,
        status: 'rendered',
        qc_verdict: 'warn',
        issues: [
          'Browser checks passed: MP4 dimensions and duration. Review captions and sound yourself; server speech/tracking QC is not run.',
        ],
        error: null,
        sha256: await hash(blob),
      };
      for (const name of [
        'parts.txt',
        'base.mp4',
        'output.mp4',
        ...images,
        ...(fxInput !== undefined ? ['effects.wav'] : []),
      ])
        await e.deleteFile(name);
    }
  } finally {
    close();
  }
}
export async function outputBlob(url: string) {
  if (!url.startsWith('local:')) throw new Error('The accepted output is missing.');
  const blob = await get<Blob>('media', url.slice(6));
  if (!blob) throw new Error('This output was removed from browser storage.');
  return blob;
}

// A separate, explicit export. It never changes the accepted reel or its approval.
export async function cleanCutClips(
  p: LocalProject,
  signal: AbortSignal,
  progress: (s: string) => void,
) {
  const jobs: { name: string; key: string; shot: Reel['shot_list'][number]; reel: Reel }[] = [];
  for (const reel of p.reels)
    for (const [i, shot] of reel.shot_list.entries()) {
      if (!p.sources[shot.source] || shot.duration <= 0) throw new Error('A raw cut is missing.');
      const key =
        p.id +
        '-capcut-' +
        (await hash({
          version: 1,
          source: p.sources[shot.source].id,
          shot,
          crop: reel.editing?.crop,
          output: OUTPUT,
        }));
      jobs.push({
        name: `${reel.id}/clips/${String(i + 1).padStart(3, '0')}.mp4`,
        key,
        shot,
        reel,
      });
    }
  if (!jobs.length || jobs.length > 60 || jobs.reduce((n, j) => n + j.shot.duration, 0) > 120.01)
    throw new Error('Mobile packs support at most 60 cuts and 120 seconds.');
  const files: Record<string, Blob> = {},
    pending = [] as typeof jobs;
  for (const job of jobs) {
    checkAbort(signal);
    const blob = await get<Blob>('media', job.key),
      sha = await get<string>('media', job.key + '-sha');
    if (blob && sha && (await hash(blob)) === sha) {
      files[job.name] = blob;
      progress('Reusing cached clean clips…');
    } else pending.push(job);
  }
  if (Object.values(files).reduce((n, b) => n + b.size, 0) > 100 * 1024 ** 2)
    throw new Error('The mobile clip pack exceeds 100 MB. Export shorter reels.');
  if (!pending.length) return files;
  const { engine: e, close } = await load(progress, signal);
  const loaded = new Map<string, { name: string; audio: boolean }>();
  try {
    for (const [index, job] of pending.entries()) {
      checkAbort(signal);
      progress(
        `Preparing mobile clip ${index + 1}/${pending.length} · no captions or background music`,
      );
      const source = p.sources[job.shot.source];
      let input = loaded.get(job.shot.source);
      if (!input) {
        const a = await asset(source.id),
          buffer = await a.blob.arrayBuffer();
        if ((await hash(buffer)) !== (a.digest || a.id))
          throw new Error('Raw footage changed. Export blocked.');
        const name = 'source-' + loaded.size;
        await e.writeFile(name, new Uint8Array(buffer));
        const info = await probe(e, name);
        input = { name, audio: info.streams.some((s) => s.codec_type === 'audio') };
        loaded.set(job.shot.source, input);
      }
      const crop = { x: 0.5, y: 0.5, zoom: 1, ...job.reel.editing?.crop },
        aspect = OUTPUT.w / OUTPUT.h;
      const cw = Math.max(
          2,
          Math.floor(Math.min(source.width, source.height * aspect) / crop.zoom / 2) * 2,
        ),
        ch = Math.max(2, Math.floor(cw / aspect / 2) * 2);
      const x = Math.max(0, Math.min(source.width - cw, crop.x * source.width - cw / 2)),
        y = Math.max(0, Math.min(source.height - ch, crop.y * source.height - ch / 2));
      const args = ['-ss', String(job.shot.source_in), '-i', input.name];
      if (!input.audio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
      args.push(
        '-t',
        String(job.shot.duration),
        '-map',
        '0:v:0',
        '-map',
        input.audio ? '0:a:0' : '1:a:0',
        '-vf',
        `crop=${cw}:${ch}:${Math.floor(x)}:${Math.floor(y)},scale=${OUTPUT.w}:${OUTPUT.h},setsar=1,fps=${OUTPUT.fps}`,
        ...encoder,
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-ar',
        '48000',
        '-ac',
        '2',
        '-af',
        `apad,atrim=duration=${job.shot.duration}`,
        '-movflags',
        '+faststart',
        'clean.mp4',
      );
      await exec(e, args, signal);
      const info = await probe(e, 'clean.mp4'),
        v = info.streams.find((s) => s.codec_type === 'video');
      if (
        v?.width !== OUTPUT.w ||
        v.height !== OUTPUT.h ||
        Math.abs(Number(info.format.duration) - job.shot.duration) > 0.2
      )
        throw new Error('A mobile clip failed its duration or picture-size check.');
      const blob = new Blob([await bytes(e, 'clean.mp4')], { type: 'video/mp4' });
      if (blob.size > 30 * 1024 ** 2)
        throw new Error('A mobile clip exceeds the 30 MB budget. Use shorter cuts.');
      await put('media', job.key, blob);
      await put('media', job.key + '-sha', await hash(blob));
      files[job.name] = blob;
      await e.deleteFile('clean.mp4');
      if (Object.values(files).reduce((n, b) => n + b.size, 0) > 100 * 1024 ** 2)
        throw new Error('The mobile clip pack exceeds 100 MB. Export shorter reels.');
    }
    return files;
  } finally {
    close();
  }
}
