# Reel Studio

[**Open Reel Studio →**](https://reel-studio-try-akifnu.fluffyfrog9.chatgpt.site)

The private **free browser edition** now handles local videos, real storyboard
stills/GIFs, captions/crops/cuts/audio, explicit approval, MP4 rendering and ZIP
downloads on your device. No installation, Render account or paid API is required.
English auto captions are optional. Keep the tab open while processing.
See [browser usage, reference-caption matching, CapCut remaster downloads, budgets and limits](BROWSER.md).

The sections below describe the separate **server edition**, which uses the full
Python pipeline and requires installation or a media-capable server.

A storyboard-first video workspace for **reel-pipeline**. Upload footage, refine
the edit, review stills and GIFs, then explicitly approve the exact storyboard
before full video rendering starts.

This repository contains a React/TypeScript/Vite frontend and a FastAPI backend.
The rendering engine stays in `DSprojects/reel-pipeline`; it is not copied or
forked here. The tested engine revision is recorded in `PIPELINE_VERSION`.

## Features

- Multiple source uploads, optional reference reel, caption presets and music.
- Optional yt-dlp URL imports from supported services, with a download size cap.
- Initial local reel suggestions from complete transcript sentences. These are
  suggestions, not a claim to understand the best story; review and edit them.
- Per-reel stills, looping GIFs, planned words, source ranges and resource use.
- Source playback through the planned cuts, seeking and final-render playback.
- Caption font, weight, size, colour, case, position and entrance animation;
  source-qualified spoken-text corrections, hook/CTA text.
- Drag to reframe, zoom, trim/reorder segments and pick transcript sentences.
- Music upload/replacement, track audition, per-reel music/effect level and mute,
  punch-in/push rates. Final audio ducking/loudness stay in the engine.
- Timestamped/resolvable comments, revision requests, history, undo and duplication.
- Text-driven edit proposals: local quick instructions or an optional
  OpenAI-compatible provider. Suggestions never auto-apply or approve a render.
- Explicit storyboard approval, final render/QC review and accepted-file ZIP export.

Draft controls stay in the browser until **Update storyboard**. Unchanged reels
reuse cached previews; every accepted plan revision invalidates the old approval.
The engine compiles the controls into the final timeline and uses the effective
per-reel style for QC, rather than comparing a user override to the old reference.

## Install and run

Requirements: Python 3.12, Node 22.12+ (or 24), ffmpeg and the engine's speech models.
Keep both checkouts side by side:

```text
work/
  DSprojects/reel-pipeline/
  reel-studio/
```

```bash
cd reel-studio
cp .env.example .env
./setup.sh
./run.sh
```

Open **http://127.0.0.1:8000**. Existing pipeline jobs appear when both apps use the
same `REELKIT_DATA`. `.env` is loaded by `run.sh` and ignored by Git. `setup.sh`
uses an exported `REEL_PIPELINE_PATH` or the default sibling checkout.

If the engine is not installed yet:

```bash
source .venv/bin/activate
bash ../DSprojects/reel-pipeline/setup.sh
../DSprojects/reel-pipeline/reel check
```

Engine setup downloads tools/models and can be substantial. A working pipeline
needs no second model installation. Sample analysis and transcription still run
before planning; the storyboard gate does not make those steps free.

## Workflow and limits

```text
Upload → reference check → transcribe → suggest/edit plan → stills + GIFs
       → USER APPROVES → full render + QC → USER REVIEWS → accepted downloads
```

Choosing a preset is an explicit style choice and skips reference analysis.
A supplied reference waits for the user's style check. The coordinator supplies
only the initially requested local plan; it never answers style, storyboard or
final-render review needs. Feedback/repair rounds require explicit plan changes;
they are not silently rewritten by the local suggestion algorithm.

Approval quotes the current need ID, revision and storyboard SHA. The engine
rechecks the plan, inputs and artifact hashes before full preparation/rendering.
Stale tabs, changed GIFs or revised plans cannot release an old approval.

Default previews: three stills and up to three seconds of silent GIF per reel,
240px/6fps GIFs, at most 240 stills/job, 1,440 GIF frames/job, 2MiB/GIF and 120s per
board build. Frame counts are not time/cost estimates. Previews skip full audio
mixing, full tracking, whole-source grading and full video encoding.

Source playback approximates the layout. GIFs are the composed preview; the
encoded render verifies full motion, tracking, colour, ducking and loudness.
H.264/AAC MP4 works best in browsers. Other codecs can still work in the engine
and GIFs when the browser cannot play the original. Studio does not silently
transcode an entire source to make playback work.

Caption corrections do not waive speech-matching QC. Known sample caption-style
analysis failures remain documented in the engine README; Studio does not hide
or fix them. Fonts use the engine cache/resolver and may fall back when missing.

## Edit with words

Local examples: “yellow captions”, “font size 64”, “zoom to 1.2”, “mute music”,
“white captions at the bottom”, or `title: "A better hook"`.

For broader requests, configure `OPENAI_API_KEY`, `STUDIO_AI_URL` and
`STUDIO_AI_MODEL`. Such requests can incur provider costs and run only when the
user presses **Suggest changes**. Proposals are validated against the plan and
transcript, shown for review, and applied only by the user. Unsupported local
requests return a useful error rather than pretending to have changed the edit.

## Isolated demo

The demo uses illustrative captions and cached timing data, without speech-model
inference. It is visibly labelled **DEMO**, including copies or projects that
reuse its demo transcript. Keep it in an isolated data store:

```bash
export REELKIT_DATA="$PWD/.studio/demo-data"
export PYTHONPATH="$PWD/backend"
.venv/bin/python -m studio.demo
./run.sh
```

`studio.demo --source /path/to/example.mp4` uses a local example instead of a test
pattern. Captions are not a transcription of that file; the command refuses to
overwrite a real transcript. Normal final speech QC remains enforced if a demo
is rendered. No media or demo databases are committed.

## Access and hosting

Studio is a **single-owner** local app bound to loopback. For a reverse proxy, set
a long random `STUDIO_TOKEN`, list the exact `STUDIO_ALLOWED_HOSTS`, and run
`./run.sh --host 0.0.0.0`. Use HTTPS at the proxy. A key grants access to the entire
configured workspace; multi-user accounts/billing/collaborative editing are not
included.

Browser sessions use HttpOnly, SameSite=Strict cookies; native video seeking uses
authenticated Range requests. Writes reject foreign origins; opaque media IDs
are confined to the data directory. Secrets stay server-side. The frontend fonts
are bundled locally. There is no GitHub credential in the browser.

Host this on a machine/container with Python, ffmpeg, data and models. Sites/
Cloudflare Workers cannot run this media backend. With Compose 2.17+ and BuildKit:

```bash
# Install engine .tools/.models on the host; set STUDIO_TOKEN in .env.
docker compose up --build
```

The image uses the named local pipeline build context. Models/tools mount
read-only; the `studio-data` volume persists runtime data. The image does not
download models. Workers survive a web-server restart on the same host and are
rediscovered from their persisted attempts. Interrupted UI tasks are marked
failed rather than silently replayed. Cancel active jobs in Studio before
replacing/stopping a container if you want them recorded as cancelled.

## Development and tests

```bash
# API, from the repo root with configured environment:
PYTHONPATH=backend .venv/bin/python -m studio
# Separate terminal: /api proxies to port 8000.
npm --prefix frontend run dev

PYTHONPATH=backend .venv/bin/python -m unittest discover -s backend/tests -v
npm --prefix frontend test
npm --prefix frontend run build
```

API tests use isolated real stores, generated media and the actual engine state
machine/compiler. Coverage includes consent/stale tabs, validation, authenticated
Range media, path confinement, comments, proposals, uploads, music, undo and cache
reuse. They do not call a paid model or download live internet videos. The engine's
core suite covers composition, audio, QC, worker recovery and delivery.

For browser tests, run the demo and built app in the isolated store above, then:

```bash
cd frontend
npx playwright install chromium
npm run test:e2e
```

`STUDIO_TEST_URL` selects another base URL; `STUDIO_CHROMIUM_PATH` uses an installed
Chromium. Tests exercise real API calls and preview generation, local-only slider
changes, selective regeneration, comments, proposals, mobile layout and forms.
For a server with an access key, supply `STUDIO_TEST_TOKEN` in the test process's
environment so the browser suite can sign in. Do not commit that key.

The adapter is isolated in `backend/studio/bridge.py` because the pinned engine
currently exposes some internal Python interfaces. Upgrade the engine with this
app's API/browser tests, not by assuming arbitrary versions are compatible.
Launch from the repo root or use `run.sh`; relative paths resolve from that root.
Credentials, media, caches, SQLite, node_modules and builds are Git-ignored.
