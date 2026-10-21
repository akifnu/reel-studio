import type { CaptionAnalysis, Changes, EditPreset, Project, Proposal, Upload } from '../types';
import { merge } from '../utils';
import {
  all,
  asset,
  blobURL,
  get,
  hash,
  hydrate,
  put,
  remove,
  signature,
  boardSignature,
  collectMedia,
  keys,
  revoke,
} from './store';
import type { LocalAsset, LocalProject } from './store';
import { board, checkAbort, compile, loadVideo, releaseVideo } from './compositor';
import { outputBlob, render, stopEngine } from './engine';
import { REFERENCE_VERSION } from './referenceStyle';
import { analyzePacing, averageLooks, matchColour, sourceLook } from './referenceLook';
import { editingReply } from './editingAssistant';
import { loadCustomFonts, fontFamilies } from './fonts';
import { controlPreview } from './controlRoom';
import { BUILTIN_PRESETS, capturePreset, validatePreset } from './presets';
const MAX_FILE = 100 * 1024 ** 2,
  MAX_TOTAL = 200 * 1024 ** 2;
const tasks = new Map<string, { status: string; error?: string; result?: unknown }>();
const running = new Map<string, AbortController>();
let queue: Promise<unknown> = Promise.resolve();
const ready = (async () => {
  await loadCustomFonts();
  const projects = await all<LocalProject>('projects');
  const locks = navigator.locks ? await navigator.locks.query() : null;
  const activeElsewhere = locks?.held?.some((l) => l.name === 'reel-studio-media-engine');
  for (const p of projects) {
    if (p.busy && !activeElsewhere) {
      p.busy = false;
      p.status = 'failed';
      p.browserProgress = '';
      p.error = {
        cause:
          'Processing stopped when this tab closed. Rebuild the storyboard and approve again to continue.',
      };
      p.approvedKey = undefined;
      await put('projects', p.id, p);
    }
  }
  if (!projects.length) {
    const response = await fetch('/demo/project.json');
    if (!response.ok) throw new Error('Sample project is unavailable.');
    const p = (await response.json()) as LocalProject;
    p.browserReady = false;
    p.previewKey = undefined;
    p.needs = null;
    p.status = 'new';
    for (const r of p.reels)
      r.editing = {
        ...r.editing,
        motion: { punch_rate: 0, push_rate: 0, ...r.editing?.motion },
        sfx: { muted: true, ...r.editing?.sfx },
      };
    await put('projects', p.id, p);
    setTimeout(() => void launch(p.id, 'storyboard').catch(console.error), 0);
  }
})();
async function project(id: string) {
  const p = await get<LocalProject>('projects', id);
  if (!p) throw new Error('This project no longer exists in this browser. Choose another project.');
  return p;
}
function current(p: LocalProject, data: Record<string, any>) {
  if (p.busy) throw new Error('Wait for processing to finish, or cancel it before editing.');
  if (p.terminal) throw new Error('Duplicate this finished project to make a new edit.');
  if (p.generation !== data.generation || p.revision !== data.revision)
    throw new Error('This project changed in another tab. Refresh before applying your edit.');
}
async function locked<T>(id: string, fn: () => Promise<T>) {
  if (navigator.locks)
    return navigator.locks.request('reel-studio:' + id, { ifAvailable: true }, (lock) => {
      if (!lock) throw new Error('This project is being changed in another tab. Try again.');
      return fn();
    });
  return fn();
}
function history(p: LocalProject, text: string) {
  p.history.push({
    id: crypto.randomUUID(),
    at: Date.now() / 1000,
    description: text,
    generation: p.generation,
  });
  p.history = p.history.slice(-30);
}
function invalidate(p: LocalProject) {
  p.browserReady = false;
  p.previewKey = undefined;
  p.approvedKey = undefined;
  p.needs = null;
  p.deliverables = [];
  p.error = null;
  p.terminal = false;
  for (const r of p.reels)
    r.render = { url: null, status: null, qc_verdict: null, issues: [], error: null, sha256: null };
}
async function launch(
  id: string,
  operation: 'storyboard' | 'render' | 'transcribe' | 'reference' | 'pacing' | 'colour',
  options: Record<string, any> = {},
) {
  const p = await project(id);
  if (p.busy) throw new Error('This project is already processing.');
  if (running.size)
    throw new Error(
      'Another local job is running. Wait for it to finish before starting this one.',
    );
  const initial = structuredClone(p);
  if (operation === 'reference') invalidate(p);
  const task = crypto.randomUUID(),
    controller = new AbortController();
  running.set(id, controller);
  tasks.set(task, { status: 'running' });
  p.busy = true;
  p.browserProgress =
    operation === 'storyboard'
      ? 'Preparing sampled storyboard…'
      : operation === 'render'
        ? 'Preparing your approved render…'
        : operation === 'reference'
          ? 'Detecting and copying reference captions…'
          : operation === 'colour'
            ? 'Measuring selected footage against the reference colour…'
            : operation === 'pacing'
              ? 'Measuring reference shot changes…'
              : 'Preparing optional English transcription…';
  p.status = 'running:' + operation;
  p.error = null;
  await put('projects', id, p);
  const execute = async () => {
    const started = performance.now();
    let lastProgress = 0;
    const progress = (message: string) => {
      if (controller.signal.aborted) return;
      p.browserProgress = message;
      if (performance.now() - lastProgress > 200) {
        lastProgress = performance.now();
        void put('projects', id, p);
      }
    };
    try {
      if (operation === 'colour') {
        if (!p.reference?.caption_analysis) throw new Error('Choose a reference reel first.');
        let target = p.reference.caption_analysis.look;
        if (!target) {
          const a = await asset(p.reference.id),
            v = await loadVideo(await blobURL(a.id, a.blob), controller.signal);
          try {
            target = await sourceLook(v, controller.signal);
            p.reference.caption_analysis.look = target;
          } finally {
            releaseVideo(v);
          }
        }
        const reels =
          options.reel_id === 'all'
            ? p.reels
            : p.reels.filter((r) => r.id === (options.reel_id || p.reels[0].id));
        p.reference.source_looks ||= {};
        for (const r of reels) {
          compile(p, r);
          const looks = [];
          for (const src of new Set(r.shot_list.map((s) => s.source))) {
            const a = await asset(p.sources[src].id),
              v = await loadVideo(await blobURL(a.id, a.blob), controller.signal);
            try {
              const look = await sourceLook(
                v,
                controller.signal,
                r.shot_list
                  .filter((s) => s.source === src)
                  .map((s) => ({ s: s.source_in, e: s.source_out })),
              );
              looks.push(look);
              p.reference.source_looks[src] = look;
            } finally {
              releaseVideo(v);
            }
          }
          r.editing = {
            ...r.editing,
            colour: {
              ...matchColour(averageLooks(looks), target),
              strength: options.strength ?? 1,
            },
          };
        }
        p.reference.matched_colour = matchColour(
          averageLooks(Object.values(p.reference.source_looks)),
          target,
        );
        p.reference.colour_report = `Reference tone applied at ${Math.round((options.strength ?? 1) * 100)}% to ${reels.map((r) => r.id.toUpperCase()).join(', ')}. Compare Original and Applied tone below.`;
        await put('undo', id, initial);
        p.generation++;
        p.revision++;
        invalidate(p);
        history(p, p.reference.colour_report);
        operation = 'storyboard';
      }
      if (operation === 'pacing') {
        if (!p.reference?.caption_analysis) throw new Error('Choose a reference reel first.');
        const a = await asset(p.reference.id),
          video = await loadVideo(await blobURL(a.id, a.blob), controller.signal);
        try {
          const pacing = await analyzePacing(video, controller.signal, progress);
          p.reference.caption_analysis.pacing = pacing;
          if (a.caption_analysis) {
            a.caption_analysis.pacing = pacing;
            await put('assets', a.id, a);
          }
          if (pacing.confidence === 'measured') {
            const plan = controlPreview(p, {
              action: 'copy',
              area: 'pacing',
              reel_id: options.reel_id || 'all',
              reframes: options.reframes ?? true,
            });
            for (const item of plan.reels) {
              const r = p.reels.find((r) => r.id === item.id)!;
              r.control_baseline_segments ||= structuredClone(r.segments);
              r.segments = item.changes.segments!;
              r.editing = { ...r.editing, pacing: item.changes.editing!.pacing };
              compile(p, r);
            }
            p.reference.pacing_report = `Copied ${pacing.cuts.length} measured reference cuts across ${pacing.window_seconds!.toFixed(1)}s. Review the new storyboard.`;
          } else
            p.reference.pacing_report = `No reliable shot changes in the ${pacing.window_seconds!.toFixed(1)}s reference scan. Your cut timing is unchanged. Use Set pace for a deliberate manual rhythm.`;
        } finally {
          releaseVideo(video);
        }
        await put('undo', id, initial);
        p.generation++;
        p.revision++;
        invalidate(p);
        history(p, p.reference.pacing_report!);
        operation = 'storyboard';
      }
      if (operation === 'reference') {
        if (!p.reference) throw new Error('A reference reel is required.');
        const a = await asset(p.reference.id);
        let analysis = a.caption_analysis;
        if (analysis?.version !== REFERENCE_VERSION) {
          const video = await loadVideo(await blobURL(a.id, a.blob), controller.signal);
          try {
            const { analyzeBoxedReference } = await import('./referenceStyle');
            analysis = await analyzeBoxedReference(video, controller.signal, (n) =>
              progress(`Detecting reference captions · ${n}%`),
            );
          } finally {
            releaseVideo(video);
          }
          a.caption_analysis = analysis;
          await put('assets', a.id, a);
        }
        p.reference.caption_analysis = analysis;
        checkAbort(controller.signal);
        if (initial.reference) {
          initial.reference.autoMatchAttempted = true;
          initial.reference.autoMatchVersion = REFERENCE_VERSION;
        }
        await put('undo', id, initial);
        await applyReference(p, analysis, controller.signal);
        p.generation++;
        p.revision++;
        invalidate(p);
        history(
          p,
          'Reference captions copied. Colour tone and cut timing are available on demand in the control room.',
        );
        operation = 'storyboard';
      }
      if (operation === 'storyboard') {
        let hits = 0,
          frames = 0;
        const before =
          (await get<Record<string, { key: string; reel: Project['reels'][number] }>>(
            'undo',
            id + ':previews',
          )) || {};
        const cached: typeof before = {};
        for (const r of p.reels) {
          checkAbort(controller.signal);
          compile(p, r);
          const key = await hash({
            source: Object.values(p.sources).map((s) => s.id),
            style: r.effective_style,
            segments: r.segments,
            caption: r.caption_events,
            text: r.text_events,
            editing: {
              captions: r.editing?.captions,
              crop: r.editing?.crop,
              motion: r.editing?.motion,
              colour: r.editing?.colour,
              pacing: r.editing?.pacing,
            },
          });
          if (before[r.id]?.key === key) {
            r.frames = before[r.id].reel.frames;
            r.gif = before[r.id].reel.gif;
            r.tone_preview = before[r.id].reel.tone_preview;
            hits++;
            frames += Math.round((r.gif.duration || 0) / 0.2);
          } else frames += await board(p, r, controller.signal, progress);
          cached[r.id] = { key, reel: structuredClone(r) };
        }
        p.previewKey = await signature(p);
        p.browserReady = true;
        p.needs = {
          step: 'approve_storyboard',
          need_id: crypto.randomUUID(),
          revision: p.revision,
          storyboard_sha256: await boardSignature(p),
        };
        p.status = 'needs:approve_storyboard';
        p.storyboard = {
          ...p.storyboard,
          frames: p.reels.length * 3,
          gif_frames: frames,
          elapsed_s: (performance.now() - started) / 1000,
          cache_hits: hits,
          estimated_render_frames: p.reels.reduce((n, r) => n + Math.round(r.duration! * 24), 0),
          limitations: 'Sampled local previews. Review final motion and audio after rendering.',
        };
        await put('undo', id + ':previews', cached);
        history(p, 'Storyboard ready. Full encoding awaits your approval.');
      } else if (operation === 'render') {
        if (p.reference && !referenceReady(p))
          throw new Error('Reference caption matching is required before rendering.');
        if (
          p.approvedKey !== (await signature(p)) ||
          p.previewKey !== p.approvedKey ||
          p.needs?.storyboard_sha256 !== (await boardSignature(p))
        )
          throw new Error(
            'The approved storyboard changed. Rebuild and approve the current version.',
          );
        await render(p, controller.signal, progress);
        checkAbort(controller.signal);
        p.status = 'needs:review';
        p.needs = {
          step: 'review',
          need_id: crypto.randomUUID(),
          revision: p.revision,
          assigned: p.reels.map((r) => ({
            id: r.id,
            render_sha256: r.render.sha256!,
            qc_verdict: r.render.qc_verdict!,
            issues: r.render.issues,
          })),
        };
        history(p, 'MP4s encoded locally. Review picture and sound before accepting.');
      } else if (operation === 'transcribe') {
        const { transcribe } = await import('./transcribe');
        const candidate = structuredClone(p);
        await transcribe(candidate, controller.signal, progress);
        Object.assign(p, candidate);
        p.generation++;
        p.revision++;
        invalidate(p);
        let frames = 0;
        for (const r of p.reels) frames += await board(p, r, controller.signal, progress);
        p.previewKey = await signature(p);
        p.browserReady = true;
        p.status = 'needs:approve_storyboard';
        p.needs = {
          step: 'approve_storyboard',
          need_id: crypto.randomUUID(),
          revision: p.revision,
          storyboard_sha256: await boardSignature(p),
        };
        p.storyboard = {
          ...p.storyboard,
          frames: p.reels.length * 3,
          gif_frames: frames,
          cache_hits: 0,
          elapsed_s: (performance.now() - started) / 1000,
        };
        history(
          p,
          'English captions and a fresh storyboard created on this device. Review accuracy before approving.',
        );
      }
      checkAbort(controller.signal);
      p.busy = false;
      p.browserProgress = '';
      await put('projects', id, p);
      await collectMedia(p);
      tasks.set(task, { status: 'succeeded', result: { id } });
    } catch (error) {
      const cancelled = controller.signal.aborted;
      if (operation === 'reference' && p.reference)
        p.reference.matchError = cancelled
          ? 'Reference matching was cancelled.'
          : (error as Error).message;
      p.busy = false;
      p.browserProgress = '';
      p.approvedKey = undefined;
      p.status = cancelled ? 'cancelled' : 'failed';
      p.error = cancelled
        ? null
        : {
            cause:
              (error as Error).message || 'Your browser ran out of resources. Try a smaller clip.',
          };
      await put('projects', id, p);
      tasks.set(task, {
        status: 'failed',
        error: cancelled ? 'Processing cancelled. Your source files are safe.' : p.error!.cause,
      });
    } finally {
      running.delete(id);
    }
  };
  const serial = async (): Promise<void> => {
    if (navigator.locks)
      await navigator.locks.request(
        'reel-studio-media-engine',
        { signal: controller.signal },
        async () => {
          await execute();
        },
      );
    else await execute();
  };
  queue = queue
    .catch(() => {})
    .then(serial)
    .catch(async (error) => {
      p.busy = false;
      p.status = 'cancelled';
      p.browserProgress = '';
      await put('projects', id, p);
      tasks.set(task, { status: 'failed', error: (error as Error).message });
      running.delete(id);
    });
  return { task_id: task };
}
function validateChanges(changes: Changes) {
  if (!changes || typeof changes !== 'object') throw new Error('No changes were provided.');
  for (const text of [
    changes.title,
    changes.title_text,
    changes.cta,
    ...Object.values(changes.caption_text || {}),
  ])
    if (text !== undefined && (typeof text !== 'string' || text.length > 1000))
      throw new Error('Caption text must be under 1,000 characters.');
  const cfg = changes.editing;
  const bounds: [unknown, number, number][] = [
    [cfg?.pacing?.target, 0.35, 5],
    [cfg?.colour?.strength, 0, 1],
    [cfg?.colour?.saturation, 0, 2],
    [cfg?.crop?.x, 0, 1],
    [cfg?.crop?.y, 0, 1],
    [cfg?.crop?.zoom, 1, 3],
    [cfg?.captions?.style?.size, 12, 160],
    [cfg?.captions?.style?.y, -640, 640],
    [cfg?.captions?.style?.x, -640, 640],
    [cfg?.captions?.style?.line_height, 0.8, 2],
    [cfg?.captions?.style?.max_width, 0.2, 0.98],
    [cfg?.captions?.style?.words_per_caption, 1, 30],
    [cfg?.captions?.style?.box?.radius, 0, 128],
    [cfg?.captions?.style?.box?.pad_x, 0, 128],
    [cfg?.captions?.style?.box?.pad_y, 0, 128],
    [cfg?.music?.gain_db, -60, 6],
    [cfg?.sfx?.gain_db, -60, 6],
    [cfg?.motion?.punch_rate, 0, 1],
    [cfg?.motion?.push_rate, 0, 1],
  ];
  for (const [value, min, max] of bounds)
    if (
      value !== undefined &&
      (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    )
      throw new Error('An editing control is outside its supported range.');
  if (
    cfg?.colour &&
    (!Array.isArray(cfg.colour.gain) ||
      cfg.colour.gain.length !== 3 ||
      !Array.isArray(cfg.colour.offset) ||
      cfg.colour.offset.length !== 3 ||
      cfg.colour.gain.some((v) => !Number.isFinite(v) || v < 0.5 || v > 2) ||
      cfg.colour.offset.some((v) => !Number.isFinite(v) || Math.abs(v) > 80))
  )
    throw new Error('Invalid colour correction.');
  if (changes.segments && (!changes.segments.length || changes.segments.length > 120))
    throw new Error('Use 1–120 segments per reel.');
}
function referenceReady(p: LocalProject) {
  return (
    p.reference && (p.reference.mode === 'caption-measured' || p.reference.mode === 'analyzed')
  );
}
function wantsReferenceUpgrade(p: LocalProject) {
  const r = p.reference;
  if (!r || r.autoMatchVersion === REFERENCE_VERSION) return false;
  if (r.mode === 'manual') return !r.autoMatchAttempted;
  return (
    (r.baselineVersion || 0) < REFERENCE_VERSION &&
    !p.history.some((h) => h.description.startsWith('Edit saved'))
  );
}
async function applyReference(p: LocalProject, analysis: CaptionAnalysis, signal?: AbortSignal) {
  if (!p.reference) return;
  const looks = [];
  p.reference.source_looks = {};
  for (const [src, source] of Object.entries(p.sources)) {
    const a = await asset(source.id),
      video = await loadVideo(await blobURL(a.id, a.blob), signal);
    try {
      const look = await sourceLook(video, signal);
      looks.push(look);
      p.reference.source_looks[src] = look;
    } finally {
      releaseVideo(video);
    }
  }
  const source = averageLooks(looks),
    grade = analysis.look ? matchColour(source, analysis.look) : undefined;
  p.reference.source_look = source;
  p.reference.matched_colour = grade;
  p.reference.mode = analysis.status === 'detected' ? 'caption-measured' : 'analyzed';
  p.reference.baselineVersion = REFERENCE_VERSION;
  p.reference.autoMatchVersion = REFERENCE_VERSION;
  p.reference.autoMatchAttempted = true;
  p.reference.matchError = undefined;
  p.style.captions = {
    present: analysis.status === 'detected',
    style: structuredClone(analysis.style || {}),
  };
  for (const r of p.reels) {
    r.editing = {
      ...r.editing,
      captions: {
        enabled: analysis.status === 'detected',
        style: structuredClone(analysis.style || {}),
      },
    };
    r.effective_style = { ...r.effective_style, captions: structuredClone(p.style.captions) };
    compile(p, r);
  }
}
async function create(data: Record<string, any>) {
  if (running.size)
    throw new Error('Wait for the current local job to finish before creating another project.');
  const count = Number(data.count),
    duration = Number(data.duration);
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 3 ||
    !Number.isFinite(duration) ||
    duration < 1 ||
    duration > 60 ||
    count * duration > 120
  )
    throw new Error('Choose 1–3 reels, at most 60 seconds each and 120 seconds in total.');
  if (!data.name?.trim()) throw new Error('Give your project a name.');
  if (!data.sources?.length || data.sources.length > 3)
    throw new Error('Choose 1–3 source videos.');
  const files: LocalAsset[] = await Promise.all(data.sources.map((id: string) => asset(id)));
  if (files.some((f) => f.role !== 'source' || !f.width || !f.height))
    throw new Error(
      'Choose raw footage for the source input; references and music cannot be used as raw clips.',
    );
  const reference = data.sample ? await asset(data.sample) : undefined;
  if (reference && (reference.role !== 'sample' || !reference.width || !reference.height))
    throw new Error('Choose a video uploaded as a reference reel.');
  if (reference && reference.caption_analysis?.version !== REFERENCE_VERSION) {
    const url = await blobURL(reference.id, reference.blob),
      video = await loadVideo(url);
    try {
      const { analyzeBoxedReference } = await import('./referenceStyle');
      reference.caption_analysis = await analyzeBoxedReference(video);
    } finally {
      releaseVideo(video);
    }
    await put('assets', reference.id, reference);
  }
  if (data.music && (await asset(data.music)).role !== 'music')
    throw new Error('Choose an audio file uploaded as background music.');
  const total = files.reduce((n, f) => n + f.duration, 0),
    target = Math.min(duration, total / count);
  if (target < 0.1) throw new Error('The selected clips are too short.');
  const seed = (await (await fetch('/demo/project.json')).json()) as LocalProject;
  const p: LocalProject = {
    ...seed,
    id: 'local-' + crypto.randomUUID(),
    name: data.name.trim().slice(0, 120),
    demo: false,
    busy: false,
    terminal: false,
    needs: null,
    status: 'new',
    generation: 1,
    revision: 1,
    sources: {},
    transcripts: {},
    reels: [],
    comments: [],
    history: [],
    activity: [],
    deliverables: [],
    music_url: null,
    musicId: data.music || undefined,
    sample_url: null,
    reference: reference
      ? {
          id: reference.id,
          name: reference.name,
          notes: String(data.reference_notes || '').slice(0, 6000),
          mode: reference.caption_analysis?.status === 'detected' ? 'caption-measured' : 'manual',
          caption_analysis: reference.caption_analysis,
          baselineVersion: REFERENCE_VERSION,
        }
      : undefined,
    error: null,
    browserReady: false,
    story_notes: String(data.notes || '').slice(0, 20000),
  };
  p.style = structuredClone(seed.style);
  p.style.captions!.style = {
    ...p.style.captions!.style,
    font: data.preset === 'bold' ? 'Arial' : 'Manrope',
    size: data.preset === 'minimal' ? 44 : 56,
    fill: data.preset === 'bold' ? '#ffe600' : '#ffffff',
    case: data.preset === 'bold' ? 'upper' : 'normal',
    anim: { in: 'none' },
  };
  if (reference?.caption_analysis?.status === 'detected' && reference.caption_analysis.style)
    p.style.captions!.style = structuredClone(reference.caption_analysis.style);
  const script = String(data.caption_script || '')
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
  let scriptIndex = 0;
  for (let i = 0; i < files.length; i++) {
    const a = files[i],
      key = String.fromCharCode(65 + i);
    p.sources[key] = {
      id: a.id,
      name: a.name,
      url: '',
      width: a.width,
      height: a.height,
      duration: a.duration,
    };
    const n = script.length
      ? Math.max(1, Math.ceil(script.length / files.length))
      : Math.max(1, Math.ceil(Math.min(a.duration, target * count) / 4));
    p.transcripts[key] = {
      lang: data.lang || 'en',
      timing: 'Manual captions; timings evenly spaced. Not automatically transcribed.',
      sentences: Array.from({ length: n }, (_, j) => ({
        id: j,
        s: (j * Math.min(a.duration, target * count)) / n,
        e: ((j + 1) * Math.min(a.duration, target * count)) / n,
        text: script[scriptIndex++] || '',
        w0: 0,
        w1: 0,
      })),
    };
  }
  let global = 0;
  const starts = files.map((a) => {
    const s = global;
    global += a.duration;
    return s;
  });
  for (let i = 0; i < count; i++) {
    const segments = [];
    let at = i * target,
      left = target;
    for (let j = 0; j < files.length && left > 0.001; j++) {
      const end = starts[j] + files[j].duration;
      if (at >= end) continue;
      const start = Math.max(0, at - starts[j]),
        take = Math.min(left, files[j].duration - start);
      segments.push({ src: String.fromCharCode(65 + j), s: start, e: start + take });
      left -= take;
      at += take;
    }
    const r = structuredClone(seed.reels[0]);
    r.id = `r0${i + 1}`;
    r.title = `Reel ${i + 1}`;
    r.segments = segments;
    r.title_text = '';
    r.cta = '';
    r.caption_text = {};
    r.editing = {
      motion: { punch_rate: 0, push_rate: 0 },
      sfx: { muted: true },
      captions: { enabled: true, style: p.style.captions?.style },
    };
    r.frames = [];
    r.gif = { url: null };
    r.effective_style = p.style;
    compile(p, r);
    p.reels.push(r);
  }
  if (reference?.caption_analysis) await applyReference(p, reference.caption_analysis);
  await put('projects', p.id, p);
  return {
    id: p.id,
    ...(await launch(p.id, 'storyboard')),
  };
}
function sourceIDs(p: LocalProject) {
  return [
    ...Object.values(p.sources).map((s) => s.id),
    ...(p.musicId ? [p.musicId] : []),
    ...(p.reference ? [p.reference.id] : []),
  ];
}
async function referencedAssets() {
  const used = new Set<string>();
  const fonts = (await all<LocalAsset>('assets')).filter((a) => a.role === 'font');
  for (const p of await all<LocalProject>('projects')) {
    sourceIDs(p).forEach((id) => used.add(id));
    const styleNames = JSON.stringify([p.style, ...p.reels.map((r) => r.editing)]);
    for (const font of fonts)
      if (styleNames.includes('Uploaded-' + font.digest!.slice(0, 16))) used.add(font.id);
    const previous = await get<LocalProject>('undo', p.id);
    if (previous) sourceIDs(previous).forEach((id) => used.add(id));
  }
  return used;
}
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  await ready;
  const data = (body || {}) as Record<string, any>,
    parts = path.split('/').filter(Boolean);
  let result: unknown;
  if (path === '/health') result = { pipeline: true, setup_error: null, authentication: false };
  else if (path === '/config')
    result = {
      ai_enabled: false,
      fonts: [...fontFamilies],
      max_upload_bytes: MAX_FILE,
      presets: ['clean', 'bold', 'minimal'],
      storyboard_limits: { stills_per_reel: 3, gif_seconds: 3 },
    };
  else if (path === '/session') result = { ok: true };
  else if (parts[0] === 'edit-presets') {
    if (method === 'GET' && parts[1] === 'source' && parts[2]) result = await project(parts[2]);
    else if (method === 'GET')
      result = [
        ...(await all<EditPreset>('presets')).sort((a, b) => b.created - a.created),
        ...structuredClone(BUILTIN_PRESETS),
      ];
    else if (method === 'POST') {
      let preset: EditPreset;
      if (data.preset) {
        preset = validatePreset(data.preset);
        preset.id = crypto.randomUUID();
        preset.created = Date.now();
      } else {
        const source = await project(String(data.project_id));
        if (source.busy)
          throw new Error(
            'Wait for the source project to finish processing before saving its preset.',
          );
        const reel = source.reels.find((r) => r.id === data.reel_id);
        if (!reel) throw new Error('Choose a source reel.');
        compile(source, reel);
        preset = capturePreset(source, reel, data.name, data.parts);
      }
      await put('presets', preset.id, preset);
      result = preset;
    } else if (method === 'DELETE' && parts[1]) {
      if (BUILTIN_PRESETS.some((p) => p.id === parts[1]))
        throw new Error('Starter presets are always available. Save your own variation instead.');
      await remove('presets', parts[1]);
      result = { ok: true };
    } else throw new Error('Unsupported preset action.');
  } else if (parts[0] === 'tasks')
    result = tasks.get(parts[1]) || {
      status: 'failed',
      error: 'The tab restarted. Rebuild this storyboard to continue.',
    };
  else if (parts[0] === 'uploads' && parts[1] && method === 'DELETE') {
    const id = parts[1];
    if ((await referencedAssets()).has(id))
      throw new Error(
        'This file is still used by a project or its undo. Delete that project first to remove it.',
      );
    await remove('assets', id);
    revoke(id);
    result = { ok: true };
  } else if (path === '/uploads')
    result = await Promise.all(
      (await all<LocalAsset>('assets'))
        .filter((a) => a.role !== 'font')
        .map(async ({ blob, ...a }) => ({
          ...a,
          ...(a.role === 'sample' ? { preview_url: await blobURL(a.id, blob) } : {}),
        })),
    );
  else if (path === '/projects' && method === 'GET')
    result = (await all<LocalProject>('projects')).reverse().map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      terminal: p.terminal,
      demo: p.demo,
      created: 'On this device',
    }));
  else if (path === '/projects' && method === 'POST')
    result = await locked('new-project', () => create(data));
  else if (parts[0] === 'projects' && parts[1]) {
    const id = parts[1];
    if (parts.length === 2 && method === 'GET') {
      const existing = await project(id);
      if (
        existing.reference &&
        wantsReferenceUpgrade(existing) &&
        !existing.terminal &&
        !existing.busy &&
        !running.size
      ) {
        const repair = async () => {
          const latest = await project(id);
          if (
            !latest.reference ||
            !wantsReferenceUpgrade(latest) ||
            latest.busy ||
            latest.terminal ||
            running.size
          )
            return;
          latest.reference.autoMatchAttempted = true;
          latest.reference.autoMatchVersion = REFERENCE_VERSION;
          await put('projects', id, latest);
          try {
            await launch(id, 'reference');
          } catch (error) {
            if ((error as Error).message.startsWith('Another local job is running')) {
              latest.reference.autoMatchAttempted = false;
              await put('projects', id, latest);
            } else throw error;
          }
        };
        if (navigator.locks)
          await navigator.locks.request(
            'reel-studio:' + id,
            { ifAvailable: true },
            async (lock) => {
              if (lock) await repair();
            },
          );
        else await repair();
      }
      result = await hydrate(await project(id));
    } else
      result = await locked(id, async () => {
        const p = await project(id),
          action = parts[2];
        if (action === 'cancel') {
          const controller = running.get(id);
          if (controller) {
            controller.abort();
            stopEngine();
          } else if (p.busy) {
            p.busy = false;
            p.status = 'cancelled';
            p.approvedKey = undefined;
            await put('projects', id, p);
          }
          return { ok: true };
        }
        if (action === 'delete') {
          if (p.busy || running.size)
            throw new Error('Wait for local processing to finish before deleting a project.');
          const previous = await get<LocalProject>('undo', id);
          const files = [...sourceIDs(p), ...(previous ? sourceIDs(previous) : [])];
          await remove('projects', id);
          await remove('undo', id);
          const used = await referencedAssets();
          for (const file of files)
            if (!used.has(file)) {
              await remove('assets', file);
              revoke(file);
            }
          for (const r of p.reels)
            for (const url of [...r.frames.map((f) => f.url), r.gif.url, r.render.url])
              if (url?.startsWith('local:')) await remove('media', url.slice(6));
          await remove('undo', id);
          await remove('undo', id + ':previews');
          for (const key of await keys('media'))
            if (key.startsWith(id + '-')) {
              await remove('media', key);
              revoke(key);
            }
          return { ok: true };
        }
        if (action === 'approve') {
          if (p.reference && !referenceReady(p))
            throw new Error(
              'Reference captions have not been copied. Match the reference before approving; a default preset cannot replace it.',
            );
          if (
            p.busy ||
            !p.browserReady ||
            p.needs?.step !== 'approve_storyboard' ||
            data.need_id !== p.needs.need_id ||
            data.revision !== p.revision ||
            data.sha256 !== p.needs.storyboard_sha256 ||
            data.sha256 !== (await boardSignature(p)) ||
            p.previewKey !== (await signature(p))
          )
            throw new Error('Approval is stale. Rebuild and approve the current storyboard.');
          p.approvedKey = p.previewKey;
          await put('projects', id, p);
          return launch(id, 'render');
        }
        if (action === 'review') {
          if (
            p.busy ||
            p.needs?.step !== 'review' ||
            data.need_id !== p.needs.need_id ||
            data.revision !== p.revision
          )
            throw new Error('This render review changed. Refresh first.');
          const requests = data.results as {
            reel_id: string;
            render_sha256: string;
            decision: string;
          }[];
          if (!requests?.length) throw new Error('Choose a render to review.');
          if (requests.some((x) => x.decision === 'fix_required')) {
            invalidate(p);
            p.status = 'new';
            history(p, 'Render changes requested. Edit and rebuild before approving again.');
            await put('projects', id, p);
            return { ok: true };
          }
          for (const request of requests) {
            const r = p.reels.find((r) => r.id === request.reel_id);
            if (
              !r ||
              request.decision !== 'accept' ||
              request.render_sha256 !== r.render.sha256 ||
              !r.render.url ||
              (await hash(await outputBlob(r.render.url))) !== r.render.sha256
            )
              throw new Error('An output changed or is missing. It cannot be accepted.');
            if (!p.deliverables.some((d) => d.name === r.id + '.mp4'))
              p.deliverables.push({ name: r.id + '.mp4', url: r.render.url });
          }
          if (p.deliverables.length === p.reels.length) {
            p.terminal = true;
            p.status = 'succeeded';
            p.needs = null;
          }
          history(p, 'Reviewed outputs accepted for download.');
          await put('projects', id, p);
          return { ok: true };
        }
        if (action === 'comments') {
          if (p.generation !== data.generation && method === 'POST')
            throw new Error('This storyboard changed. Refresh before commenting.');
          if (method === 'POST') {
            const c = {
              id: crypto.randomUUID(),
              job_id: id,
              reel_id: String(data.reel_id),
              generation: p.generation,
              time: Number(data.time) || 0,
              text: String(data.text || '').slice(0, 2000),
              resolved: false,
              at: Date.now() / 1000,
            };
            if (!c.text.trim()) throw new Error('Write a comment first.');
            p.comments.push(c);
            await put('projects', id, p);
            return c;
          }
          const c = p.comments.find((c) => c.id === parts[3]);
          if (!c) throw new Error('Comment not found.');
          c.resolved = !!data.resolved;
          await put('projects', id, p);
          return c;
        }
        if (action === 'duplicate') {
          if (p.busy) throw new Error('Wait before duplicating this project.');
          const copy = structuredClone(p);
          copy.id = 'local-' + crypto.randomUUID();
          copy.name += ' — copy';
          copy.terminal = false;
          copy.history = [];
          copy.comments = [];
          copy.generation = 1;
          copy.revision = 1;
          invalidate(copy);
          await put('projects', copy.id, copy);
          return { id: copy.id, ...(await launch(copy.id, 'storyboard')) };
        }
        if (action === 'reels') {
          current(p, data);
          validateChanges(data.changes);
          const index = p.reels.findIndex((r) => r.id === parts[3]);
          if (index < 0) throw new Error('Reel not found.');
          const previous = structuredClone(p);
          p.reels[index] = merge(
            p.reels[index] as unknown as Record<string, unknown>,
            data.changes,
          ) as unknown as (typeof p.reels)[number];
          compile(p, p.reels[index]);
          await put('undo', id, previous);
          p.generation++;
          p.revision++;
          invalidate(p);
          history(p, 'Edit saved; rebuilding only changed reel previews.');
          await put('projects', id, p);
          return launch(id, 'storyboard');
        }
        if (action === 'reference-pacing' || action === 'reference-colour') {
          current(p, data);
          if (!p.reference) throw new Error('Choose a reference reel first.');
          if (data.reel_id && data.reel_id !== 'all' && !p.reels.some((r) => r.id === data.reel_id))
            throw new Error('Choose an existing reel.');
          if (
            action === 'reference-colour' &&
            data.strength !== undefined &&
            (!Number.isFinite(data.strength) || data.strength < 0 || data.strength > 1)
          )
            throw new Error('Choose a colour strength between 0 and 100%.');
          return launch(id, action === 'reference-pacing' ? 'pacing' : 'colour', data);
        }
        if (action === 'control-preview' || action === 'control-apply') {
          current(p, data);
          const preset =
            data.request?.action === 'preset'
              ? BUILTIN_PRESETS.find((p) => p.id === data.request.preset_id) ||
                (await get<EditPreset>('presets', String(data.request.preset_id)))
              : undefined;
          const preview = controlPreview(p, data.request, preset);
          for (const plan of preview.reels) validateChanges(plan.changes);
          if (action === 'control-preview') return preview;
          if (!preview.reels.some((r) => Object.keys(r.changes).length))
            throw new Error('That instruction contains no supported change. Nothing was applied.');
          const previous = structuredClone(p);
          for (const plan of preview.reels) {
            const index = p.reels.findIndex((r) => r.id === plan.id),
              r = p.reels[index];
            if (plan.changes.segments && !r.control_baseline_segments)
              r.control_baseline_segments = structuredClone(r.segments);
            const updated = merge(
              r as unknown as Record<string, unknown>,
              plan.changes,
            ) as unknown as typeof r;
            if (preview.request.action === 'copy' && preview.request.area === 'captions') {
              updated.editing = {
                ...updated.editing,
                captions: structuredClone(plan.changes.editing!.captions),
              };
              updated.effective_style = {
                ...updated.effective_style,
                captions: {
                  present: true,
                  style: structuredClone(plan.changes.editing!.captions!.style),
                },
              };
            }
            compile(p, updated);
            p.reels[index] = updated;
          }
          if (p.reference) {
            if (preview.reels.some((r) => r.changes.editing?.colour))
              p.reference.colour_report = undefined;
            if (preview.reels.some((r) => r.changes.editing?.pacing))
              p.reference.pacing_report = undefined;
          }
          await put('undo', id, previous);
          p.generation++;
          p.revision++;
          invalidate(p);
          history(
            p,
            `Control room: ${preview.request.action} ${preview.request.area} on ${preview.reels.map((r) => r.id).join(', ')}.`,
          );
          await put('projects', id, p);
          return launch(id, 'storyboard');
        }
        if (action === 'reference-captions') {
          current(p, data);
          if (!p.reference) throw new Error('Choose a reference reel first.');
          const referenceAsset = await asset(p.reference.id);
          referenceAsset.caption_analysis = undefined;
          await put('assets', referenceAsset.id, referenceAsset);
          p.reference.autoMatchAttempted = true;
          await put('projects', id, p);
          return launch(id, 'reference');
        }
        if (action === 'music') {
          current(p, data);
          if ((await asset(data.upload_id)).role !== 'music')
            throw new Error(
              'Choose a background-music upload. Reference audio cannot be used as music.',
            );
          await put('undo', id, p);
          p.musicId = data.upload_id;
          p.generation++;
          p.revision++;
          invalidate(p);
          await put('projects', id, p);
          return launch(id, 'storyboard');
        }
        if (action === 'undo') {
          current(p, data);
          const previous = await get<LocalProject>('undo', id);
          if (!previous) throw new Error('No edit is available to undo.');
          previous.generation = p.generation + 1;
          previous.revision = p.revision + 1;
          invalidate(previous);
          await put('projects', id, previous);
          return launch(id, 'storyboard');
        }
        if (action === 'start' || action === 'retry') {
          if (p.terminal) throw new Error('Duplicate this completed project first.');
          invalidate(p);
          await put('projects', id, p);
          return launch(id, p.reference && !referenceReady(p) ? 'reference' : 'storyboard');
        }
        if (action === 'transcribe') {
          current(p, data);
          return launch(id, 'transcribe');
        }
        if (action === 'revise') {
          if (
            data.need_id !== p.needs?.need_id ||
            data.revision !== p.revision ||
            data.sha256 !== p.needs?.storyboard_sha256
          )
            throw new Error('This storyboard changed. Refresh first.');
          invalidate(p);
          p.status = 'new';
          history(p, 'Changes requested: ' + String(data.notes || '').slice(0, 1000));
          await put('projects', id, p);
          return { ok: true };
        }
        if (action === 'propose') return proposal(p, data);
        throw new Error('This browser action is not supported.');
      });
  } else if (path === '/imports')
    throw new Error(
      'Video-link downloads need a server. Download the video legally to your device, then choose the local file here.',
    );
  else throw new Error('This browser action is not available.');
  return structuredClone(result) as T;
}
function proposal(p: LocalProject, data: Record<string, any>): Proposal {
  if (data.generation !== p.generation) throw new Error('Refresh before asking for changes.');
  const r = p.reels.find((r) => r.id === data.reel_id) || p.reels[0];
  const effective = merge(
    r as unknown as Record<string, unknown>,
    data.draft || {},
  ) as unknown as typeof r;
  const result = editingReply(p, effective, String(data.text || ''), data.context || []);
  validateChanges(result.changes);
  return { ...result, generation: p.generation, provider: 'Local editing assistant' };
}

export async function upload(
  file: File,
  role: string,
  progress: (n: number) => void,
  signal?: AbortSignal,
): Promise<Upload> {
  await ready;
  checkAbort(signal);
  if (!['source', 'sample', 'music'].includes(role))
    throw new Error('Choose raw footage, a reference reel or background music.');
  if (!file.size || file.size > MAX_FILE)
    throw new Error('Use a file between 1 byte and 100 MB. Short H.264/AAC MP4 clips work best.');
  if ((await all<LocalAsset>('assets')).reduce((n, a) => n + a.bytes, 0) + file.size > MAX_TOTAL)
    throw new Error(
      'Local source storage is limited to 200 MB. Delete an old project before adding more footage.',
    );
  progress(10);
  const url = URL.createObjectURL(file);
  let video: HTMLVideoElement | undefined;
  try {
    video = await loadVideo(url, signal);
    if (!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > 300)
      throw new Error('Use source clips up to five minutes long.');
    if (role !== 'music' && (!video.videoWidth || !video.videoHeight))
      throw new Error('This source must contain a video track.');
    progress(40);
    const digest = await hash(file),
      id = role + '-' + digest;
    checkAbort(signal);
    const record: LocalAsset = {
      id,
      digest,
      name: file.name.slice(0, 160),
      role,
      bytes: file.size,
      blob: file,
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
    };
    if (role === 'sample') {
      const { analyzeBoxedReference } = await import('./referenceStyle');
      const cached = await get<LocalAsset>('assets', id);
      record.caption_analysis =
        cached?.caption_analysis?.version === REFERENCE_VERSION
          ? cached.caption_analysis
          : await analyzeBoxedReference(video, signal, progress);
    }
    checkAbort(signal);
    await put('assets', id, record);
    progress(100);
    const { blob: _, ...result } = record;
    return { ...result, ...(role === 'sample' ? { preview_url: await blobURL(id, file) } : {}) };
  } finally {
    if (video) releaseVideo(video);
    URL.revokeObjectURL(url);
  }
}
export async function downloadProject(p: Project) {
  const current = await project(p.id);
  if (!current.terminal || !current.deliverables.length)
    throw new Error('Review and accept your renders before downloading.');
  const { zipSync } = await import('fflate');
  const files: Record<string, Uint8Array> = {};
  for (const d of current.deliverables) {
    const r = current.reels.find((r) => r.id + '.mp4' === d.name);
    const blob = await outputBlob(d.url);
    if (!r || (await hash(blob)) !== r.render.sha256)
      throw new Error('An accepted output changed. Download blocked.');
    files[d.name] = new Uint8Array(await blob.arrayBuffer());
  }
  const data = zipSync(files, { level: 0 });
  const url = URL.createObjectURL(
    new Blob([data.buffer as ArrayBuffer], { type: 'application/zip' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = (p.name.replace(/[^a-z0-9 -]/gi, '').slice(0, 80) || 'reels') + '.zip';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
