import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
mkdirSync('public/caption-engine', { recursive: true });
copyFileSync('node_modules/tesseract.js/dist/worker.min.js', 'public/caption-engine/worker.min.js');
copyFileSync(
  'node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt',
  'public/caption-engine/worker.min.js.LICENSE.txt',
);
copyFileSync('node_modules/tesseract.js/LICENSE.md', 'public/caption-engine/tesseract-LICENSE.txt');
copyFileSync(
  'node_modules/tesseract.js-core/LICENSE',
  'public/caption-engine/tesseract-core-LICENSE.txt',
);
for (const name of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'])
  copyFileSync('node_modules/tesseract.js-core/' + name, 'public/caption-engine/' + name);
const language = 'public/caption-engine/eng.traineddata';
let trained;
try {
  trained = readFileSync(language);
} catch {
  const response = await fetch(
    'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/eng.traineddata',
  );
  if (!response.ok) throw new Error('Could not download the pinned OCR language model.');
  trained = Buffer.from(await response.arrayBuffer());
}
if (
  createHash('sha256').update(trained).digest('hex') !==
  '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2'
)
  throw new Error('OCR language model checksum does not match.');
writeFileSync(language, trained);
const out = 'public/engine';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
copyFileSync('node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js', out + '/ffmpeg-core.js');
const bytes = readFileSync('node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm');
const size = 16 * 1024 * 1024;
const parts = [];
for (let i = 0; i < bytes.length; i += size) {
  const name = `core-${parts.length}.part`;
  writeFileSync(out + '/' + name, bytes.subarray(i, i + size));
  parts.push(name);
}
writeFileSync(out + '/manifest.json', JSON.stringify({ parts, bytes: bytes.length }));
mkdirSync('public/speech-engine', { recursive: true });
for (const name of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs'])
  copyFileSync('node_modules/onnxruntime-web/dist/' + name, 'public/speech-engine/' + name);
const r = spawnSync('npm', ['run', 'build'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, VITE_STUDIO_MODE: 'browser' },
});
process.exit(r.status ?? 1);
