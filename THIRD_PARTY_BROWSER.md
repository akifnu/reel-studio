# Browser dependencies and model attribution

The browser edition uses these upstream projects. Retain their licenses when
redistributing their code or binaries; package lock records exact installed builds.

- FFmpeg.wasm wrapper 0.12.15: MIT, https://github.com/ffmpegwasm/ffmpeg.wasm
- FFmpeg.wasm core 0.12.10: GPL-2.0-or-later, including FFmpeg/libx264 and other
  enabled codecs. Corresponding build/source information:
  https://github.com/ffmpegwasm/ffmpeg.wasm/tree/main/packages/core
  and https://github.com/ffmpegwasm/ffmpeg.wasm/tree/main/build
  Release: https://github.com/ffmpegwasm/ffmpeg.wasm/releases/tag/v0.12.10
  FFmpeg source: https://ffmpeg.org/download.html
  GPL text: https://www.gnu.org/licenses/old-licenses/gpl-2.0.html
- gifenc 1.0.3: MIT, https://github.com/mattdesl/gifenc
- fflate 0.8.2: MIT, https://github.com/101arrowz/fflate
- Transformers.js 3.8.1: Apache-2.0,
  https://github.com/huggingface/transformers.js
- ONNX Runtime Web: MIT, https://github.com/microsoft/onnxruntime
- Optional Whisper tiny English ONNX weights:
  https://huggingface.co/onnx-community/whisper-tiny.en
  pinned revision 2575352d61be1bf7225cf8f8b268a4678025fc58.
  Original Whisper model/code: MIT, https://github.com/openai/whisper
- DM Sans and Manrope font families: SIL Open Font License 1.1, distributed
  through Fontsource. https://fontsource.org/ and https://openfontlicense.org/

Generated landscape sample media contains no uploaded personal footage. The
browser's optional model requests download public model assets; audio stays local.
