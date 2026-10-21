import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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
