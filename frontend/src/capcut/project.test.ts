import { describe, expect, it } from 'vitest';
import seed from '../../public/demo/project.json';
import type { Project, Reel } from '../types';
import { captionWindows, createDraft, srt } from './project';
import type { DraftMedia } from './project';
import { installerHTML, prepareInstallation } from './installer';
const fixture = () => {
  const p = structuredClone(seed) as unknown as Project,
    r = p.reels[0];
  r.duration = 3;
  r.shot_list = [
    { start: 0, duration: 1, source: 'A', source_in: 0.5, source_out: 1.5 },
    { start: 1, duration: 2, source: 'A', source_in: 2, source_out: 4 },
  ];
  r.editing = { crop: { x: 0.5, y: 0.5, zoom: 1 }, music: { gain_db: -6 } };
  r.caption_events = [
    { s: 0, e: 2.5, text: 'Violin 🎻 practice' },
    { s: 2.5, e: 3, text: 'Keep going!' },
  ];
  r.text_events = [{ s: 0, e: 1, text: 'A question?', role: 'hook' }];
  const media: Record<string, DraftMedia> = {
    A: {
      id: 'raw-A',
      path: 'media/source-A.mp4',
      name: 'Raw footage.mp4',
      duration: 8,
      width: 320,
      height: 568,
      kind: 'video',
    },
  };
  const music: DraftMedia = {
    id: 'music',
    path: 'media/music.wav',
    name: 'Music.wav',
    duration: 2,
    width: 0,
    height: 0,
    kind: 'music',
  };
  return { p, r, media, music, draft: createDraft('A reel', r, p.sources, media, music) };
};
describe('editable CapCut project export', () => {
  it('retains source trim handles, exact cut timing, editable text and separately registered music', () => {
    const { draft } = fixture();
    const [video, text, audio] = draft.content.tracks;
    expect(
      video.segments.map((s) => [
        s.source_timerange?.start,
        s.source_timerange?.duration,
        s.target_timerange.start,
      ]),
    ).toEqual([
      [500000, 1000000, 0],
      [2000000, 2000000, 1000000],
    ]);
    expect(video.segments.every((s) => s.material_id === 'raw-A')).toBe(true);
    expect(text.segments).toHaveLength(3);
    expect(JSON.parse(String(draft.content.materials.texts[1].content)).text).toBe(
      'Violin 🎻 practice',
    );
    expect(
      audio.segments.map((s) => [s.target_timerange.start, s.target_timerange.duration]),
    ).toEqual([
      [0, 2000000],
      [2000000, 1000000],
    ]);
    expect(audio.segments[0].clip).toBeNull();
    expect(audio.segments[0].volume).toBeCloseTo(0.501187);
    const registration = draft.meta.draft_materials[0].value;
    for (const material of [...draft.content.materials.videos, ...draft.content.materials.audios])
      expect(
        registration.some(
          (m) => m.id === material.local_material_id && m.file_Path === material.path,
        ),
      ).toBe(true);
  });
  it('uses hook precedence without duplicate subtitle layers and writes valid SRT', () => {
    const { r } = fixture();
    expect(captionWindows(r).map((c) => [c.s, c.e, c.text])).toEqual([
      [0, 1, 'A question?'],
      [1, 2.5, 'Violin 🎻 practice'],
      [2.5, 3, 'Keep going!'],
    ]);
    expect(srt(captionWindows(r))).toContain('00:00:01,000 --> 00:00:02,500\nViolin 🎻 practice');
    r.editing!.captions = { enabled: false };
    expect(captionWindows(r)).toEqual([]);
  });
  it('installs into an empty app-authored draft while preserving version markers and rebinding both media manifests', () => {
    const { draft } = fixture();
    const template = {
      id: 'native-project',
      platform: { app_version: '9.3.0', os: 'mac' },
      version: 999999,
      new_version: 'app-native',
      materials: { videos: [], audios: [], texts: [], filters: [] },
      tracks: [],
      custom_app_setting: { preserved: true },
    };
    const meta = {
      draft_id: 'native-project',
      draft_fold_path: '/Movies/CapCut/native-project',
      registration: 'preserve',
    };
    const paths = {
      'media/source-A.mp4': '/Movies/CapCut/native-project/ReelStudio-media/raw.mp4',
      'media/music.wav': '/Movies/CapCut/native-project/ReelStudio-media/music.wav',
    };
    const result = prepareInstallation(draft, template, meta, 'native-project', paths);
    expect(result.content.id).toBe('native-project');
    expect(result.content.version).toBe(999999);
    expect(result.content.platform.os).toBe('mac');
    expect(result.content.custom_app_setting.preserved).toBe(true);
    expect(result.meta.registration).toBe('preserve');
    expect(result.content.materials.videos[0].path).toBe(paths['media/source-A.mp4']);
    expect(result.meta.draft_materials[0].value[0].file_Path).toBe(paths['media/source-A.mp4']);
    expect(template.tracks).toEqual([]);
    expect(() =>
      prepareInstallation(
        draft,
        { ...template, tracks: [{ segments: [{}] }] },
        meta,
        'native-project',
        paths,
      ),
    ).toThrow(/empty/);
    expect(() => prepareInstallation(draft, template, meta, 'different-folder', paths)).toThrow(
      /location/,
    );
    expect(() =>
      prepareInstallation(
        draft,
        template,
        { ...meta, draft_fold_path: '' },
        'native-project',
        paths,
      ),
    ).toThrow(/location/);
  });
  it('generates a self-contained, parseable installer without allowing caption text to inject HTML', () => {
    const { draft } = fixture();
    draft.content.name = '</script><script>bad()</script>';
    const html = installerHTML({ drafts: [{ name: draft.content.name, draft }], files: [] });
    expect(html.match(/<script>/g)).toHaveLength(1);
    const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
    expect(() => new Function(js)).not.toThrow();
    expect(js).not.toContain('</script>');
    expect(js).toContain('showDirectoryPicker');
  });
  it('refuses missing raw footage and unsafe cut bounds', () => {
    const { p, r, media } = fixture();
    r.shot_list[0].source = 'REFERENCE';
    expect(() => createDraft('bad', r, p.sources, media)).toThrow(/raw footage/);
    r.shot_list[0].source = 'A';
    r.shot_list[0].source_out = 99;
    expect(() => createDraft('bad', r, p.sources, media)).toThrow(/raw footage/);
  });
});
