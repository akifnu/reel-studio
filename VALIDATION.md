# Validation

Validated on 2026-10-21 against the engine revision in `PIPELINE_VERSION`.

- 16 API tests passed against isolated real stores and the engine adapter.
- 7 frontend unit tests passed; TypeScript and the production build passed.
- 3 Chromium browser tests passed against the real API, including local draft
  controls, explicit proposal application, selective GIF regeneration, comments,
  mobile navigation and project creation form validation.
- The engine core suite ran 106 tests: 105 passed, 1 skipped. After the last
  audio override change, all 30 affected engine tests passed again. GitHub engine
  CI passed for the pinned revision.
- Compose configuration and workflow YAML validated. The Docker image build
  was not run locally because access to the Docker daemon was unavailable;
  the repository includes a CI job for this build.

The demo uses labelled illustrative captions without speech inference. These
checks do not establish real-world transcription accuracy. Optional provider
calls and URL downloads were tested with fixtures, without paid model calls or
live platform downloads. Existing engine caption-style analysis failures remain
documented in its README and were not resolved by this interface.

The server edition is a single-owner workspace. It needs the pinned engine, ffmpeg,
and configured speech models. The separate browser edition described below is
a static site that processes media locally. Neither edition includes multi-user
accounts or cloud collaboration. See `README.md` for setup and operational limits.

## Free browser edition

- Four real Chromium integration tests passed: local uploads, trimming and multiple
  cuts, crop/motion, caption rasterization, source audio/music/cut-effect mixing,
  genuine GIFs, explicit approval, dimension/duration checks, acceptance and ZIP export.
- Stale tabs and tampered GIF files could not release a render. Cancellation and
  reload recovery kept the source files and required a fresh explicit approval.
- Seven unit tests passed, including source-qualified caption isolation and cut budgets.
- Optional Whisper tiny English ran on generated speech using actual public model
  weights and recognized the test words. Public model GETs were routed through the
  environment's HTTP proxy; no audio was sent to a transcription service. After
  transcription, a new actual storyboard was generated before approval.
- Native ffprobe confirmed the browser export had H.264 video, AAC audio, a
  540×960 frame and the requested duration. Caption pixels were visually inspected.
- A 390px viewport fit without horizontal overflow. This was desktop Chromium
  emulating a mobile viewport, not a benchmark on physical Android/iOS hardware.
- The browser edition does not run server speech/QC, reference-style analysis,
  face tracking or yt-dlp. See BROWSER.md for explicit budgets and limitations.
