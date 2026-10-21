import { zipSync, strToU8 } from 'fflate';
import type { Project } from '../types';
import { asset, get, hash } from '../browser/store';
import type { LocalProject } from '../browser/store';
import { checkAbort } from '../browser/compositor';
import { cleanCutClips, outputBlob } from '../browser/engine';
import { captionWindows, createDraft, srt } from './project';
import type { DraftMedia } from './project';
import { installerHTML } from './installer';
import type { Bundle } from './installer';

export async function exportCapCut(
  snapshot: Project,
  mode: 'desktop' | 'mobile',
  signal: AbortSignal,
  progress: (s: string) => void,
) {
  const work = async () => {
    const p = await get<LocalProject>('projects', snapshot.id);
    if (
      !p ||
      p.busy ||
      !p.terminal ||
      p.generation !== snapshot.generation ||
      p.revision !== snapshot.revision ||
      p.deliverables.length !== p.reels.length
    )
      throw new Error('Review and accept the current renders before exporting for CapCut.');
    const files: Record<string, Uint8Array> = {},
      media: Record<string, DraftMedia> = {},
      manifest: Bundle['files'] = [];
    let total = 0;
    const add = async (path: string, blob: Blob, register = false) => {
      checkAbort(signal);
      total += blob.size;
      if (total > 300 * 1024 ** 2)
        throw new Error('This export exceeds 300 MB. Use a smaller project.');
      files[path] = new Uint8Array(await blob.arrayBuffer());
      if (register)
        manifest.push({ path, sha256: await hash(files[path].buffer), bytes: blob.size });
    };
    const json = (path: string, value: unknown) => {
      files[path] = strToU8(JSON.stringify(value, null, 2));
    };
    const ext = (name: string, fallback: string) =>
      name.match(/\.(mp4|mov|mkv|webm|avi|m4v|wav|mp3|aac|m4a|ogg|flac)$/i)?.[1].toLowerCase() ||
      fallback;
    for (const [key, source] of Object.entries(p.sources)) {
      const a = await asset(source.id);
      if (a.role !== 'source' || (await hash(a.blob)) !== (a.digest || a.id))
        throw new Error('Raw footage changed or has the wrong role. Export blocked.');
      if (mode === 'desktop') {
        const path = `media/source-${key}.${ext(a.name, 'mp4')}`;
        await add(path, a.blob, true);
        media[key] = {
          id: crypto.randomUUID().toUpperCase(),
          path,
          name: a.name,
          duration: a.duration,
          width: a.width,
          height: a.height,
          kind: 'video',
        };
      }
    }
    let music: DraftMedia | undefined;
    if (p.musicId) {
      const a = await asset(p.musicId);
      if (a.role !== 'music' || (await hash(a.blob)) !== (a.digest || a.id))
        throw new Error('Music changed or has the wrong role. Export blocked.');
      const path = `media/music.${ext(a.name, 'mp3')}`;
      await add(path, a.blob, mode === 'desktop');
      music = {
        id: crypto.randomUUID().toUpperCase(),
        path,
        name: a.name,
        duration: a.duration,
        width: 0,
        height: 0,
        kind: 'music',
      };
    }
    const drafts: Bundle['drafts'] = [];
    for (const reel of p.reels) {
      const d = p.deliverables.find((d) => d.name === reel.id + '.mp4');
      if (!d || !reel.render.sha256) throw new Error('An accepted reel is missing.');
      const preview = await outputBlob(d.url);
      if ((await hash(preview)) !== reel.render.sha256)
        throw new Error('An accepted MP4 changed. Export blocked.');
      await add(`${reel.id}/approved-preview.mp4`, preview);
      files[`${reel.id}/captions.srt`] = strToU8(srt(captionWindows(reel)));
      json(`${reel.id}/edit-plan.json`, {
        id: reel.id,
        duration: reel.duration,
        shots: reel.shot_list,
        captions: reel.caption_events,
        hook_and_cta: reel.text_events,
        editing: reel.editing,
        style: reel.effective_style,
      });
      if (mode === 'desktop') {
        const draft = createDraft(`${p.name} · ${reel.id}`, reel, p.sources, media, music);
        drafts.push({ name: `${p.name} · ${reel.id}`, draft });
        json(`${reel.id}/draft_content.json`, draft.content);
        json(`${reel.id}/draft_info.json`, draft.content);
        json(`${reel.id}/draft_meta_info.json`, draft.meta);
      }
    }
    if (mode === 'mobile') {
      const clips = await cleanCutClips(p, signal, progress);
      for (const [path, blob] of Object.entries(clips)) await add(path, blob);
    } else {
      files['Install in CapCut.html'] = strToU8(installerHTML({ drafts, files: manifest }));
      json('bundle.json', { format: 'reel-studio-capcut-desktop-v1', drafts, files: manifest });
    }
    files['READ ME FIRST.txt'] = strToU8(mode === 'desktop' ? DESKTOP_README : MOBILE_README);
    // Recheck after expensive work: deletion or a different project revision invalidates this export.
    const latest = await get<LocalProject>('projects', p.id);
    if (!latest?.terminal || latest.generation !== p.generation || latest.revision !== p.revision)
      throw new Error('The project changed during export. Try again.');
    checkAbort(signal);
    progress('Packaging your CapCut download…');
    const zip = zipSync(files, { level: 0 });
    checkAbort(signal);
    const blob = new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' });
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download =
      (p.name.replace(/[^a-z0-9 -]/gi, '').slice(0, 60) || 'Reel') +
      (mode === 'desktop' ? '-CapCut-desktop.zip' : '-CapCut-mobile-clips.zip');
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  if (navigator.locks)
    await navigator.locks.request(
      'reel-studio-media-engine',
      { ifAvailable: true },
      async (lock) => {
        if (!lock) throw new Error('Another tab is processing video. Wait for it to finish.');
        await navigator.locks.request(
          'reel-studio:' + snapshot.id,
          { ifAvailable: true },
          async (projectLock) => {
            if (!projectLock)
              throw new Error('This project is being changed in another tab. Try again.');
            await work();
          },
        );
      },
    );
  else await work();
}
const DESKTOP_README = `REEL STUDIO → CAPCUT DESKTOP (EXPERIMENTAL)

1. Extract this entire ZIP. Keep the media folder together.
2. Open "Install in CapCut.html" in desktop Chrome or Edge.
3. Create a NEW EMPTY project in CapCut desktop, find its folder using CapCut's project-location settings, then quit CapCut completely.
4. Follow the two folder-selection buttons in the installer. Select which reel to install. Repeat with a new empty project for each other reel.
5. Reopen that same project in CapCut and review the timeline.

Original raw media, cuts, basic text, static framing and music are separate and editable. Original files are packaged once, shared by all reels. Style-reference reels are never included. This is a local draft-folder transfer, not an official .capcut interchange file and not a mobile/web import. Current encrypted or unknown layouts are not supported. CapCut app compatibility has not been verified in this environment.

Fonts/line wrapping and framing can differ. Recreate caption animations, motion, sound effects and automatic music ducking in CapCut. Each reel's approved-preview.mp4 shows the approved look. captions.srt and edit-plan.json preserve text/timings and all original edit settings.

The installer preserves your installed app's version/platform markers and project identity, registers bundled media with absolute paths and backs up the empty draft. It refuses any project that already contains clips. No source media is uploaded or downloaded from a third-party service.

If installation is incompatible, use Reel Studio's CapCut mobile clips pack: import its numbered MP4 clips into a new CapCut project.

Format references:
https://github.com/GuanYixuan/pyCapCut
https://www.capcut.com/help/import-a-previous-project-into-the-current-project
`;
const MOBILE_README = `REEL STUDIO → CAPCUT MOBILE REMASTER PACK

This is a ZIP of editable clip building blocks, NOT a native CapCut mobile project.

1. Extract this ZIP in your phone's Files app.
2. In CapCut, tap New project. Open one reel's clips folder.
3. Select 001.mp4, 002.mp4, etc. IN NUMBER ORDER, then Add. Do not add approved-preview.mp4 to the timeline.
4. Each cut is now a separate clip with the original recording's sound. These clean 540x960, 24fps MP4 clips contain the chosen crop, with NO burned-in captions, hook/CTA, background music, SFX or motion. You can trim, rearrange, add effects and change the colour again. Material outside each cut/crop is not included; use the desktop draft pack for full original footage and trim handles.
5. Use CapCut's text/auto-caption tools to recreate captions and the hook. captions.srt contains the reviewed words/timings for editors that support SRT import; mobile SRT support varies and is not assumed. Add the separate music file from media if wanted and set its level. edit-plan.json records the original settings.
6. Compare against approved-preview.mp4, which is the accepted finished video. Export from CapCut when done.

Clean clips are encoded only when you request this download, cached on this device and reused on repeat downloads. Cancelling keeps your accepted reel. Reference-style videos are excluded. Desktop draft installation is not supported by CapCut mobile/web.
`;
