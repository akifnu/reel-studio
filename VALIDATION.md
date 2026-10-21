# Validation

Validated on 2026-10-21 against the engine revision in `PIPELINE_VERSION`.

- 16 API tests passed against isolated real stores and the engine adapter.
- 3 frontend unit tests passed; TypeScript and the production build passed.
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

The interface is a single-owner workspace. It needs the pinned engine, ffmpeg,
and configured speech models for ordinary projects; it is not a static-only
site or a multi-user service. See `README.md` for setup and operational limits.
