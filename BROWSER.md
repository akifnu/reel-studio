# Free browser edition

Open https://reel-studio-try-akifnu.fluffyfrog9.chatgpt.site with the owner's
ChatGPT account. Processing uses your device; no Render account or paid API is
required. The server edition remains available in this repository.

1. Choose **New project**. **Reference reel** is an optional example of the editing
   style you like; **Raw footage** is the required content to edit. They have
   separate uploads and library labels. A reference alone cannot create a reel.
   Caption matching samples **12 frames from the first five seconds**, at a maximum
   analysis width of 360 pixels. For solid-colour boxes with white text it measures
   the box colour, text size, placement and line layout, then applies rounded
   per-line boxes to the raw footage's captions. The result is cached by file hash.
   Review the detected style in the form; choosing a preset overrides it without
   removing the reference. Unsupported styles are reported instead of guessed.
   Exact font identity/weight and animation cannot be inferred reliably here;
   Arial Regular is an approximation. Pacing, hook wording and video colour grading
   remain manual. **Project inputs → Match reference captions on all reels** can
   measure older references and rebuild the storyboard, requiring approval again.
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
60 seconds/reel, 120 seconds total, and 20 segments/reel. English auto captions
support a selected source span of up to two minutes. Each GIF is capped at 2 MB.

Browser storage is not a backup or cloud sync. Its quota/eviction policy belongs
to the browser; clearing site data removes projects. Keep the processing tab open
and download important outputs. Large captions or many overlays can exceed a
phone's memory; use shorter footage if encoding fails. The image/GIF previews
sample selected moments and are silent. Source playback approximates the draft.

This edition supports bounded boxed-caption measurement and explicit cuts, not
complete reference-style transfer, face tracking, highlight understanding or server speech/QC evaluation. Browser
checks verify encoded dimensions/duration; final visual/audio review is manual.
Quick text instructions are local rules, not a general AI editing agent. yt-dlp
URL ingestion and the complete Python pipeline remain server-edition features.

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
caption animations, SFX and automatic music ducking must be recreated.

Desktop draft schema references: [pyCapCut](https://github.com/GuanYixuan/pyCapCut)
and [CapCut's project import limitations](https://www.capcut.com/help/import-a-previous-project-into-the-current-project).
These exports run in the free browser edition; the server edition retains its
existing MP4 export.
