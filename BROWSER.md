# Free browser edition

Open https://reel-studio-try-akifnu.fluffyfrog9.chatgpt.site. Processing uses your device; no Render account or paid API is
required. The server edition remains available in this repository.

1. Choose **New project**. **Reference reel** is an optional example of the editing
   style you like; **Raw footage** is the required content to edit. They have
   separate uploads and library labels. A reference alone cannot create a reel.
   Reference analysis samples **24 frames from the first five seconds**. Scene
   histograms measure cut boundaries and median shot length. RGB statistics measure
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
one reel or all reels. Copying one feature preserves the other features. Missing
measurements disable their copy button; no guessed preset or cut rhythm is applied.

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
