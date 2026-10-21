import type { LocalProject } from './store';
import { asset } from './store';
import { checkAbort, compile } from './compositor';
export async function transcribe(
  p: LocalProject,
  signal: AbortSignal,
  progress: (s: string) => void,
) {
  for (const r of p.reels) compile(p, r);
  const decoded = new Map<string, { samples: Float32Array; start: number }>();
  for (const [source, info] of Object.entries(p.sources)) {
    const shots = p.reels.flatMap((r) => r.shot_list).filter((s) => s.source === source);
    if (!shots.length) continue;
    const start = Math.min(...shots.map((s) => s.source_in)),
      end = Math.max(...shots.map((s) => s.source_out));
    if (end - start > 120)
      throw new Error(
        'Auto captions support up to two minutes of selected footage per source. Trim the selected ranges first.',
      );
    if (!['en', 'auto'].includes(p.transcripts[source]?.lang || 'en'))
      throw new Error(
        'The free on-device speech model supports English. Other languages can use manually entered captions.',
      );
    checkAbort(signal);
    progress('Decoding selected audio on your device…');
    const a = await asset(info.id),
      context = new AudioContext({ sampleRate: 16000 });
    try {
      const audio = await context.decodeAudioData(await a.blob.arrayBuffer());
      const from = Math.floor(start * audio.sampleRate),
        to = Math.min(audio.length, Math.ceil(end * audio.sampleRate));
      const samples = new Float32Array(Math.max(0, to - from));
      for (let c = 0; c < audio.numberOfChannels; c++) {
        const channel = audio.getChannelData(c);
        for (let i = 0; i < samples.length; i++)
          samples[i] += channel[from + i] / audio.numberOfChannels;
      }
      let energy = 0;
      for (const value of samples) energy += value * value;
      if (!samples.length || Math.sqrt(energy / samples.length) < 0.0001)
        throw new Error(
          'No audible speech track was found. Enter caption text manually for this silent clip.',
        );
      decoded.set(source, { samples, start });
    } catch (error) {
      throw new Error(
        'Audio could not be decoded for auto captions. Use an H.264/AAC MP4 with audible English speech. ' +
          (error as Error).message,
      );
    } finally {
      await context.close();
    }
  }
  for (const [source, { samples, start }] of decoded) {
    checkAbort(signal);
    const worker = new Worker(new URL('./asr.worker.ts', import.meta.url), { type: 'module' });
    try {
      const result = await new Promise<{
        text: string;
        chunks?: { text: string; timestamp: [number | null, number | null] }[];
      }>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            end(
              new Error(
                'Speech recognition exceeded its 8-minute limit. Try a shorter clip or enter captions manually.',
              ),
            ),
          8 * 60 * 1000,
        );
        const abort = () => end(new DOMException('Cancelled', 'AbortError'));
        function end(error?: Error, result?: any) {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          error ? reject(error) : resolve(result);
        }
        signal.addEventListener('abort', abort, { once: true });
        worker.onerror = (event) =>
          end(new Error(event.message || 'The speech model could not run in this browser.'));
        worker.onmessage = (event) => {
          const data = event.data;
          if (data.status === 'progress') progress(data.message);
          if (data.status === 'error')
            end(new Error('On-device speech recognition failed: ' + data.error));
          if (data.status === 'done') end(undefined, data.result);
        };
        worker.postMessage({ audio: samples }, [samples.buffer]);
      });
      const chunks = result.chunks?.filter((c) => c.text.trim()) || [];
      if (!chunks.length)
        throw new Error('The model found no speech. You can enter captions manually.');
      // Keep existing cuts stable when replacing sentence IDs with newly measured phrases.
      for (const r of p.reels) {
        r.segments = r.segments.map((segment, i) =>
          segment.src === source
            ? { src: source, s: r.shot_list[i].source_in, e: r.shot_list[i].source_out }
            : segment,
        );
        for (const key of Object.keys(r.caption_text || {}))
          if (key.startsWith(source + ':')) delete r.caption_text![key];
      }
      p.transcripts[source] = {
        lang: 'en',
        timing:
          'On-device Whisper tiny English; phrase timestamps. Review accuracy before rendering.',
        sentences: chunks.map((c, i) => ({
          id: i,
          s: start + (c.timestamp[0] ?? 0),
          e: Math.min(infoDuration(p, source), start + (c.timestamp[1] ?? 120)),
          text: c.text.trim(),
          w0: 0,
          w1: 0,
        })),
      };
    } finally {
      worker.terminate();
    }
  }
}
function infoDuration(p: LocalProject, source: string) {
  return p.sources[source].duration;
}
