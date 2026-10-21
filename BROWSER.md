# Free browser edition

Open https://reel-studio-try-akifnu.fluffyfrog9.chatgpt.site. Processing uses your device; no Render account or paid API is
required. The server edition remains available in this repository.

## Use ChatGPT/Codex as the editor

The default working surface is **Edit with ChatGPT**. ChatGPT reads the reference and raw footage and chooses the edit; the browser executes media tools. There is no new browser language model, paid model API, or separate agent framework.

1. Install/connect the Reel Studio Site plugin in ChatGPT once. The Site owner’s publication provisions its MCP connection.
2. Create a project with distinct **Reference reel** and **Raw footage** inputs. The first storyboard is a starting draft, not an autonomous editorial decision.
3. Click **Connect this project to ChatGPT**, then **Copy ChatGPT prompt**. Paste it into ChatGPT with the Reel Studio plugin enabled. Keep the editor tab open.
4. ChatGPT can read actual reference/source frames, request different timestamps, measure caption/tone/cut evidence, transcribe selected speech, and apply an explicit timeline and caption recipe. It can inspect the generated storyboard frames as well. Tool measurements are evidence; they are not agents or guarantees of an exact font match.
5. Review the storyboard/GIF, revise through chat, then click **Approve storyboard for ChatGPT**. ChatGPT can now call `ffmpeg_render` once for that exact approved generation. Any edit cancels approval. A queued command is not a completed render.
6. Review the MP4’s picture and audio in the browser, accept it and download it. Ask ChatGPT to `save_style` after accepting a finished video. Its real caption/tone/pacing settings and a visual preview appear in **Saved style menu** across projects in this browser. `list_styles` and `apply_style` reuse these approved recipes independently for captions, tone, pacing, or the whole look. **Download style skill** exports `SKILL.md`, the editing recipe and its preview as a ZIP for later Codex sessions.

The small Worker exposes `reel_read_context`, `reel_read_frames`, and `reel_run_tool` over `/mcp`; it relays commands to the open browser. It does not call a model provider or run FFmpeg on the server. A random project connection key scopes shared frames, transcript and edit metadata; raw video stays in IndexedDB. Disconnect removes that session’s shared packets and jobs. Browser-local project/style storage is not cloud sync. A standalone web page cannot invoke the user’s ChatGPT account without this actual plugin connection.

**Manual editing controls** remain available in a collapsed section. Their local text parser and image statistics are tools, not autonomous agents. The older manual workflow is documented below.

1. Choose **New project**. **Reference reel** is an optional example of the editing
   style you like; **Raw footage** is the required content to edit. They have
   separate uploads and library labels. A reference alone cannot create a reel.
   Reference analysis samples **24 frames from the first five seconds**. Spatial frame changes and colour histograms provide initial evidence of cut boundaries. **Copy cuts & pacing** additionally scans up to 30 seconds at eight samples per second, without repeating OCR. RGB statistics measure
   a bounded colour transfer. It is measured at ingestion and applied only when you
   press **Copy colour tone** in the control room; Source playback, stills, GIF and
   MP4 then share that correction. Scene content/lighting can affect this approximation; it is not the original LUT.
   Cut timing is also on demand. **Copy cuts & pacing** transfers the sampled cut
   rhythm to your current footage selection. **Set pace** uses a chosen 0.35–5 second
   shot length; optional alternating 10% reframes make those cuts visible. Both retain
   the selected footage and audio. It does not invent new camera angles. A pacing
   prompt can prefer transcript sentences and remove their gaps.
   Caption analysis measures coloured backplates, then uses a local English OCR worker
   on up to three high-resolution frames to handle unboxed text, case, size, position,
   colour and an estimated outline. The roughly 8 MB OCR runtime/model stays local
   and the pinned language data is verified during the build. No video is uploaded.
   Caption detection does not depend on a font picker. Font shape is approximated
   from available faces; **Captions → Import original font** accepts TTF/OTF/WOFF/WOFF2
   files up to 5 MB and saves them locally for previews, exports and reloads.
   Reference **caption style** applies automatically. Colour and cut timing remain
   unchanged until explicitly requested. Presets cannot override captions during setup.
   Uncertain captions stay disabled with a visible warning; measured colour and
   pacing remain usable. No preset is silently substituted. Reference caption OCR
   text is evidence only, never raw-footage dialogue. Matching is cached by file
   hash and analyzer version. The comparison above the editor shows observed and
   recreated captions. **Refresh reference analysis & captions** retries it with
   an undo snapshot, rebuilds the storyboard and requires approval again. Existing
   unfinished projects upgrade once, except projects with explicit saved edits.
   Refreshing reference analysis retains existing colour correction and cut timing.
   Previously edited projects retain their current settings until you change them.
   Reference picture, speech and music never enter the output.
2. Optionally enter a caption script (one line per caption). These timings are
   evenly spaced, not speech measurements. Blank input produces no invented speech.
3. Alternatively, press **Auto captions (English)**. A pinned Whisper tiny
   model downloads once (roughly 60 MB including its runtime) and runs locally.
   Review its words and phrase timings. Other languages use manual captions.
4. Edit captions, hooks/CTA, crop, motion, cut ranges/order and background music.
   Use **Update storyboard** to see three stills and up to three seconds of GIF
   samples per reel. Sliders do not start a video encode. Unchanged visual
   previews are reused, including when only music settings change.
5. Press **Approve & render**. The first render loads about 32 MB of FFmpeg
   WebAssembly; its large files are cached locally when browser storage permits.
6. Keep the tab open. Review the encoded picture/audio, accept it, then press
   **Download r01.mp4** for an individual video, or **Export reels** for a ZIP of all accepted outputs. On a phone,
   unzip it in the Files app before sharing the MP4.

## The control room

The browser edition shows **Copy caption style**, **Copy colour tone** (0–100% strength),
and **Copy cuts & pacing** as independent actions. Each uses the selected target:
one reel or all reels. Copying one feature preserves the other features. Caption copy needs a confident detection. Colour and pacing buttons measure on demand whenever a reference exists; a no-cuts report preserves timing rather than substituting a guessed rhythm. Tone shows an original/applied comparison.

A shared prompt box has an **Editing area** selector. For example, choose Colour
tone and type “warmer and less saturated”. **Preview instruction** shows the changes
for each target without saving or encoding. **Apply instruction** saves the edit and
rebuilds the sampled storyboard/GIF. Instructions scoped to one area exclude other
areas even if the text mentions them. Entire reel allows combined commands.

**Reset tone** removes colour correction. **Reset cuts** restores timing saved before
the first control-room pacing edit. For older projects without that saved timing,
it merges contiguous cuts and disables paced reframing, retaining the existing
source selections. **Undo last change** restores the previous saved
project state. Pending inspector edits must be updated/discarded before using these
actions. Stale prompt previews cannot apply after the project changes. Caption details,
framing/motion, audio and the persistent editing chat are linked from the room.
Full MP4 encoding still requires explicit approval of the latest storyboard.

## What runs locally

- Source files, projects, stills, GIFs and MP4s are saved in IndexedDB.
- Caption rasterization and sampled GIFs use Canvas and gifenc. MP4s use
  single-threaded FFmpeg WebAssembly in a worker, without SharedArrayBuffer.
- Output: H.264/AAC MP4, 540 × 960, 24 fps. Captions, manual crops, subtle
  punch/push motion, source audio, music ducking, level/mute and optional cut taps
  are encoded into the output.
- Approval binds the plan and preview file hashes. Source checksums are verified
  before rendering. Edits invalidate approval; render hashes are checked again
  during acceptance and ZIP export. A missing/changed GIF cannot release a render.
- Full jobs are serialized per device origin with Web Locks when available.
  Cancel stops the worker. Reloading recovers an interrupted job without silently
  approving or encoding anything. You can rebuild and approve again.
- Old preview generations are collected while preserving the current board and
  one undo. Delete a project to remove its unused source files and generated media.

## Limits

Use short clips on a modern browser. Desktop is faster; phone memory, codecs and
background suspension vary. H.264/AAC MP4 works best. Limits: 100 MB/file,
200 MB total local inputs (including reference and music), up to five minutes/source, 1–3 reels,
60 seconds/reel, 120 seconds total, and 120 segments/reel. English auto captions
support a selected source span of up to two minutes. Each GIF is capped at 2 MB.

Browser storage is not a backup or cloud sync. Its quota/eviction policy belongs
to the browser; clearing site data removes projects. Keep the processing tab open
and download important outputs. Large captions or many overlays can exceed a
phone's memory; use shorter footage if encoding fails. The image/GIF previews
sample selected moments and are silent. Source playback approximates the draft.

This edition supports measured colour/cut transfer and OCR caption styling, not
complete reference reconstruction, font identification, frame-by-frame caption
animation cloning, face tracking or story understanding. Browser checks verify
encoded dimensions/duration; final visual/audio review is manual.

**Chat** is a persistent local conversation with contextual follow-ups, reference
analysis explanations, and editable proposals. Try “warmer and faster”, “match
reference colour”, “cuts every 1 second”, “yellow captions without a box” or
“trim to 10 seconds”. **Apply & update storyboard** saves a real edit through the
same revision checks and undo mechanism as the controls. Chat never approves or
renders. Unsupported requests and negative instructions leave the edit unchanged.
Chat history is local to this browser/project/reel; clear it in the Chat panel.
It is a free command assistant, not a general LLM; no paid AI is connected.
yt-dlp URL ingestion and the Python pipeline remain server-edition features.

## Build and test

From `frontend/`, use `npm ci` then `npm run build:browser`. The build prepares
small enough static engine parts for hosting limits and produces `dist/`.
Dependency install scripts are disabled in `.npmrc`: this browser frontend needs
no native ONNX/CUDA installer; esbuild uses its platform package.

Serve `frontend/dist` over HTTPS (or localhost for development):

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory frontend/dist
STUDIO_BROWSER_ONLY=1 STUDIO_TEST_URL=http://127.0.0.1:8765 npm --prefix frontend run test:e2e
```

The browser CI job tests real upload, crop/cut/motion/caption/music/effect encoding,
GIF approval, reviewed ZIP output, stale tabs, tampered previews, cancellation,
mobile layout and reload recovery. The normal build/tests exercise server mode.

## Continue editing in CapCut

After accepting your finished reels, choose **Edit in CapCut**:

- **Desktop editable draft ZIP** packages original raw footage, exact cut timings,
  editable basic text/static framing and separate music. It does not encode more
  video. Extract the ZIP and open its offline HTML installer in desktop Chrome or
  Edge. The installer transfers a selected reel into a new, empty CapCut project;
  it preserves native app version markers, registers media and backs up empty draft
  files. This is an **experimental, unofficial desktop draft transfer**, not a
  universal `.capcut` file. CapCut application compatibility cannot be verified in
  this environment; encrypted/unknown layouts are rejected.
- **Mobile clips ZIP** creates separate numbered H.264/AAC clips (540 × 960, 24 fps),
  with the approved cuts/static crop and recording audio. Captions, background
  music, SFX and motion are absent, so those can be remastered in CapCut. Extract,
  select `001.mp4`, `002.mp4`, etc. in order, and add them to a new mobile project.
  Crop edges and trim handles are absent; use the desktop pack for originals.
  Encoding happens only on this explicit request. Clips are cached and verified
  before reuse. Cancel preserves accepted outputs. Max 60 cuts/120 seconds,
  30 MB/clip, 100 MB clean clips, 300 MB total ZIP inputs.

Both include `captions.srt`, `edit-plan.json`, the accepted `approved-preview.mp4`,
separate original music when supplied, and plain-language instructions. SRT mobile
import is not assumed; use CapCut text/auto captions when unavailable. Style
references are excluded. Desktop fonts/line wrapping may differ, and motion,
caption animations, colour grading, pacing reframes, SFX and automatic music ducking must be recreated. The accepted MP4 is the visual reference; the edit plan includes colour/pacing settings.

Desktop draft schema references: [pyCapCut](https://github.com/GuanYixuan/pyCapCut)
and [CapCut's project import limitations](https://www.capcut.com/help/import-a-previous-project-into-the-current-project).
These exports run in the free browser edition; the server edition retains its
existing MP4 export.

Reference caption status and a visual comparison are shown above the editor: the
observed caption crop and a sample rendered through the same caption compositor
used by the GIF and MP4. The sample wording is illustrative and never enters the
reel. This makes copying visible before optional edits. Matching remains a measured
reconstruction of measurable boxed and unboxed captions; exact font identity, font metrics and
frame-by-frame animation cannot be guaranteed from the flattened video.

### Reuse tone and pacing between projects

Open **The control room → Your preset library**. Choose the source project and reel, select **Tone + pacing**, **Tone only**, or **Pacing only**, name it, and click **Save preset**. Three labelled starter presets are available immediately. Preview proposals move into view. Saving without a name uses the source project name. The library captures that reel’s current settings (including an applied reference look), without copying its footage, captions, audio, or source positions. A reference tone that has only been measured must be applied first to become the reel’s current look.

Choose a saved preset in any project. Use **Preview preset**, **Preview tone only**, or **Preview pacing only**, then **Apply preset**. The control room’s **Apply to** selector targets one reel or all reels. Preview does not mutate the project; applying invalidates the old approval and rebuilds only the sampled storyboard/GIF. Full rendering still needs explicit approval. Reset and undo remain available. Pacing repeats the saved rhythm on the destination’s selected footage; shot lengths use the existing 0.35–5 second range and 120-cut limit.

Presets persist independently of projects in IndexedDB. They are local to this browser and site, without account sync. **Download preset** creates a small `.reel-preset.json` file; **Import preset** loads it on another browser or device after validation. Files contain only portable settings and the source project/reel names. Deleting a preset does not change any edits already made with it. The storage upgrade from version 1 preserves existing projects and media.
