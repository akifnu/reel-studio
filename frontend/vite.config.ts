import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: [{ find: /^onnxruntime-web$/, replacement: 'onnxruntime-web/wasm' }] },
  worker: { format: 'es' },
  server: { proxy: { '/api': 'http://127.0.0.1:8000' } },
});
