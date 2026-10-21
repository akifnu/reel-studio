/// <reference lib="webworker" />
import { env, pipeline } from '@huggingface/transformers';
env.allowLocalModels = false;
env.backends.onnx.wasm!.numThreads = 1;
env.backends.onnx.wasm!.proxy = false;
env.backends.onnx.wasm!.wasmPaths = new URL('/speech-engine/', self.location.origin).href;
self.onmessage = async (event: MessageEvent<{ audio: Float32Array }>) => {
  try {
    self.postMessage({
      status: 'progress',
      message: 'Loading optional English speech model (first download can take a few minutes)…',
    });
    const model = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny.en', {
      revision: '2575352d61be1bf7225cf8f8b268a4678025fc58',
      device: 'wasm',
      dtype: 'q8',
      progress_callback: (p: any) => {
        if (p.status === 'progress')
          self.postMessage({
            status: 'progress',
            message: `Speech model · ${p.file?.split('/').at(-1) || 'downloading'} · ${Math.round(p.progress || 0)}%`,
          });
      },
    });
    self.postMessage({
      status: 'progress',
      message: 'Transcribing on your device. No audio is uploaded…',
    });
    const result = await model(event.data.audio, {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    self.postMessage({ status: 'done', result });
  } catch (error) {
    self.postMessage({ status: 'error', error: (error as Error).message });
  }
};
