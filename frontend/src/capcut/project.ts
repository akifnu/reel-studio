import type { Reel, Source, CaptionEvent } from '../types';

export type DraftMedia = {
  id: string;
  path: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  kind: 'video' | 'music';
};
export type Draft = ReturnType<typeof createDraft>;
const uid = () => crypto.randomUUID().toUpperCase();
const us = (s: number) => Math.round(s * 1e6);
const rgb = (hex = '#ffffff') =>
  /^#[0-9a-f]{6}$/i.test(hex)
    ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    : [1, 1, 1];

// Use the same hook/CTA precedence as the browser compositor, without overlapping text layers.
export function captionWindows(r: Reel): CaptionEvent[] {
  if (r.editing?.captions?.enabled === false) return [];
  const bounds = [
    ...new Set([
      0,
      r.duration || 0,
      ...[...r.caption_events, ...r.text_events].flatMap((c) => [c.s, c.e]),
    ]),
  ].sort((a, b) => a - b);
  const out: CaptionEvent[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const s = bounds[i],
      e = bounds[i + 1],
      mid = (s + e) / 2;
    if (s < 0 || e > (r.duration || 0) || e <= s) continue;
    const event =
      r.text_events.find((c) => c.s <= mid && mid < c.e) ||
      r.caption_events.find((c) => c.s <= mid && mid < c.e);
    if (!event?.text.trim()) continue;
    const last = out.at(-1);
    if (last?.text === event.text && Math.abs(last.e - s) < 0.001) last.e = e;
    else out.push({ s, e, text: event.text, role: event.role });
  }
  return out;
}
export function srt(events: CaptionEvent[]) {
  const stamp = (s: number) => {
    const ms = Math.max(0, Math.round(s * 1000));
    return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  };
  return events
    .map(
      (c, i) =>
        `${i + 1}\n${stamp(c.s)} --> ${stamp(c.e)}\n${c.text.replace(/\r/g, '').replace(/\n\n+/g, '\n')}\n`,
    )
    .join('\n');
}
function clip() {
  return {
    alpha: 1,
    flip: { horizontal: false, vertical: false },
    rotation: 0,
    scale: { x: 1, y: 1 },
    transform: { x: 0, y: 0 },
  };
}
function segment(
  material: string,
  start: number,
  duration: number,
  source: number | null,
  index: number,
) {
  return {
    id: uid(),
    material_id: material,
    target_timerange: { start: us(start), duration: us(duration) },
    source_timerange: source === null ? null : { start: us(source), duration: us(duration) },
    speed: 1,
    volume: 1,
    last_nonzero_volume: 1,
    visible: true,
    reverse: false,
    track_attribute: 0,
    track_render_index: index,
    render_index: index,
    enable_adjust: true,
    enable_lut: true,
    enable_color_curves: true,
    enable_color_wheels: true,
    clip: clip() as ReturnType<typeof clip> | null,
    uniform_scale: { on: true, value: 1 },
    extra_material_refs: [] as string[],
    common_keyframes: [],
    keyframe_refs: [],
  };
}
function framing(s: Source, r: Reel) {
  const w = 1080,
    h = 1920,
    cfg = { x: 0.5, y: 0.5, zoom: 1, ...r.editing?.crop };
  const fit = Math.min(w / s.width, h / s.height),
    cover = Math.max(w / s.width, h / s.height) * cfg.zoom;
  const sw = s.width * cover,
    sh = s.height * cover;
  const x = Math.max(w - sw, Math.min(0, w / 2 - cfg.x * sw)),
    y = Math.max(h - sh, Math.min(0, h / 2 - cfg.y * sh));
  return {
    ...clip(),
    scale: { x: cover / fit, y: cover / fit },
    transform: { x: (x + sw / 2 - w / 2) / (w / 2), y: -(y + sh / 2 - h / 2) / (h / 2) },
  };
}
export function createDraft(
  name: string,
  r: Reel,
  sources: Record<string, Source>,
  media: Record<string, DraftMedia>,
  music?: DraftMedia,
) {
  const materials = {
    videos: [] as Record<string, unknown>[],
    audios: [] as Record<string, unknown>[],
    texts: [] as Record<string, unknown>[],
    speeds: [] as Record<string, unknown>[],
  };
  const registration: Record<string, unknown>[] = [];
  for (const m of [...Object.values(media), ...(music ? [music] : [])]) {
    registration.push({
      id: m.id,
      file_Path: m.path,
      extra_info: m.name,
      duration: us(m.duration),
      width: m.width,
      height: m.height,
      metetype: m.kind,
      type: 0,
      item_source: 1,
      create_time: -1,
      import_time: -1,
      import_time_ms: -1,
      enter_from: 0,
      md5: '',
      ai_group_type: '',
      material_color_tag: '',
      roughcut_time_range: { start: -1, duration: -1 },
      sub_time_range: { start: -1, duration: -1 },
    });
    const common = {
      id: m.id,
      local_material_id: m.id,
      path: m.path,
      duration: us(m.duration),
      check_flag: m.kind === 'video' ? 63487 : 3,
    };
    if (m.kind === 'video')
      materials.videos.push({
        ...common,
        material_id: m.id,
        type: 'video',
        material_name: m.name,
        width: m.width,
        height: m.height,
        media_path: '',
        category_id: '',
        category_name: 'local',
        crop_ratio: 'free',
        crop_scale: 1,
        audio_fade: null,
        crop: {
          upper_left_x: 0,
          upper_left_y: 0,
          upper_right_x: 1,
          upper_right_y: 0,
          lower_left_x: 0,
          lower_left_y: 1,
          lower_right_x: 1,
          lower_right_y: 1,
        },
      });
    else
      materials.audios.push({
        ...common,
        type: 'extract_music',
        name: m.name,
        music_id: m.id,
        app_id: 0,
        source_platform: 0,
        category_id: '',
        category_name: 'local',
        copyright_limit_type: 'none',
        effect_id: '',
        formula_id: '',
        wave_points: [],
      });
  }
  const track = (type: string, index: number) => ({
    id: uid(),
    type,
    attribute: 0,
    flag: 0,
    is_default_name: true,
    name: '',
    render_index: index,
    segments: [] as ReturnType<typeof segment>[],
  });
  const video = track('video', 0),
    text = track('text', 1),
    audio = track('audio', 2);
  for (const shot of r.shot_list) {
    const m = media[shot.source],
      source = sources[shot.source];
    if (
      !m ||
      !source ||
      shot.source_in < 0 ||
      shot.source_out > source.duration + 0.05 ||
      shot.duration <= 0
    )
      throw new Error('A cut references missing or invalid raw footage.');
    const seg = segment(m.id, shot.start, shot.duration, shot.source_in, 0);
    seg.clip = framing(source, r);
    const speed = uid();
    materials.speeds.push({ id: speed, type: 'speed', mode: 0, speed: 1, curve_speed: null });
    seg.extra_material_refs.push(speed);
    video.segments.push(seg);
  }
  const style = { ...r.effective_style.captions?.style, ...r.editing?.captions?.style };
  for (const event of captionWindows(r)) {
    const id = uid(),
      value =
        style.case === 'upper'
          ? event.text.toUpperCase()
          : style.case === 'lower'
            ? event.text.toLowerCase()
            : event.text;
    materials.texts.push({
      id,
      type: 'text',
      content: JSON.stringify({
        text: value,
        styles: [
          {
            range: [0, value.length],
            size: (style.size || 56) / 4,
            bold: (style.weight || 700) >= 600,
            italic: false,
            underline: false,
            fill: {
              alpha: 1,
              content: { render_type: 'solid', solid: { alpha: 1, color: rgb(style.fill) } },
            },
            strokes: [],
          },
        ],
      }),
      alignment: 1,
      typesetting: 0,
      letter_spacing: 0,
      line_spacing: 0.02,
      line_feed: 1,
      line_max_width: 0.88,
      force_apply_line_max_width: false,
      check_flag: 7,
      global_alpha: 1,
      ...(style.box?.color
        ? {
            background_style: 1,
            background_color: style.box.color,
            background_alpha: style.box.opacity ?? 1,
            background_round_radius: (style.box.radius || 0) / 100,
            background_height: 0.14,
            background_width: 0.14,
            background_horizontal_offset: 0,
            background_vertical_offset: 0,
          }
        : {}),
    });
    const seg = segment(id, event.s, event.e - event.s, null, 1);
    seg.clip!.transform = { x: (style.x || 0) / 360, y: -(style.y || 0) / 640 };
    text.segments.push(seg);
  }
  if (music && !r.editing?.music?.muted) {
    if (!Number.isFinite(music.duration) || music.duration <= 0)
      throw new Error('Background music has an invalid duration.');
    for (let at = 0; at < (r.duration || 0) - 0.001; at += music.duration) {
      if (audio.segments.length >= 500)
        throw new Error('This music clip is too short to repeat safely.');
      const seg = segment(music.id, at, Math.min(music.duration, r.duration! - at), 0, 2);
      seg.clip = null;
      seg.volume = 10 ** ((r.editing?.music?.gain_db ?? -18) / 20);
      audio.segments.push(seg);
    }
  }
  const id = uid(),
    now = Date.now() * 1000;
  return {
    content: {
      id,
      name,
      duration: us(r.duration || 0),
      fps: 24,
      canvas_config: { width: 1080, height: 1920, ratio: '9:16', background: null },
      version: 360000,
      new_version: '140.0.0',
      color_space: 0,
      source: 'default',
      render_index_track_mode_on: false,
      free_render_index_mode_on: false,
      create_time: now,
      update_time: now,
      platform: { app_id: 359289, app_source: 'cc', app_version: '6.7.0', os: 'windows' },
      last_modified_platform: {
        app_id: 359289,
        app_source: 'cc',
        app_version: '6.7.0',
        os: 'windows',
      },
      config: { maintrack_adsorb: true, video_mute: false, material_save_mode: 0 },
      materials,
      tracks: [video, text, audio].filter((t) => t.segments.length),
      keyframes: {
        adjusts: [],
        audios: [],
        effects: [],
        filters: [],
        handwrites: [],
        stickers: [],
        texts: [],
        videos: [],
      },
      keyframe_graph_list: [],
      relationships: [],
    },
    meta: {
      draft_id: id,
      draft_name: name,
      draft_fold_path: '',
      draft_root_path: '',
      draft_json_file: 'draft_content.json',
      tm_duration: us(r.duration || 0),
      tm_draft_create: now,
      tm_draft_modified: now,
      draft_materials: [{ type: 0, value: registration }],
    },
  };
}
