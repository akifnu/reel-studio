// Files, previews and projects never leave this browser.
import type { Project, Upload, CaptionAnalysis } from '../types';
export type LocalAsset = Upload & {
  blob: Blob;
  width: number;
  height: number;
  duration: number;
  digest?: string;
  caption_analysis?: CaptionAnalysis;
};
export type LocalProject = Project & {
  musicId?: string;
  previewKey?: string;
  approvedKey?: string;
  browserProgress?: string;
  browserReady?: boolean;
};
let dbPromise: Promise<IDBDatabase> | undefined;
const database = () =>
  (dbPromise ||= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('reel-studio-local-v1', 1);
    request.onupgradeneeded = () => {
      for (const name of ['projects', 'assets', 'media', 'undo'])
        request.result.createObjectStore(name);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new Error('Local storage is unavailable. Use a normal browser tab with storage enabled.'),
      );
  }));
export async function get<T>(store: string, id: string): Promise<T | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const r = db.transaction(store).objectStore(store).get(id);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function all<T>(store: string): Promise<T[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const r = db.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function put(store: string, id: string, value: unknown) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(
        new Error(
          'Browser storage is full. Free space or delete a local project before trying again.',
        ),
      );
    tx.onabort = () => reject(new Error('The browser could not save this file.'));
  });
}
export async function remove(store: string, id: string) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
const urls = new Map<string, string>();
const verifiedOutputs = new Set<string>();
export async function mediaURL(id: string) {
  if (!id.startsWith('local:')) return id;
  const key = id.slice(6);
  if (!urls.has(key)) {
    const blob = await get<Blob>('media', key);
    if (!blob) throw new Error('A local preview is missing. Rebuild this storyboard.');
    urls.set(key, URL.createObjectURL(blob));
  }
  return urls.get(key)!;
}
export async function blobURL(id: string, blob: Blob) {
  if (!urls.has(id)) urls.set(id, URL.createObjectURL(blob));
  return urls.get(id)!;
}
export function revoke(id: string) {
  const url = urls.get(id);
  if (url) URL.revokeObjectURL(url);
  urls.delete(id);
}
export async function keys(store: string): Promise<string[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const r = db.transaction(store).objectStore(store).getAllKeys();
    r.onsuccess = () => resolve(r.result.map(String));
    r.onerror = () => reject(r.error);
  });
}
export async function collectMedia(p: LocalProject) {
  const previous = await get<LocalProject>('undo', p.id);
  const keep = new Set<string>();
  for (const state of [p, previous])
    if (state)
      for (const r of state.reels)
        for (const url of [...r.frames.map((f) => f.url), r.gif.url, r.render.url])
          if (url?.startsWith('local:')) keep.add(url.slice(6));
  for (const key of await keys('media'))
    if (key.startsWith(p.id + '-') && !keep.has(key)) {
      await remove('media', key);
      revoke(key);
    }
}
export async function asset(id: string): Promise<LocalAsset> {
  const a = await get<LocalAsset>('assets', id);
  if (a) return a;
  if (id === 'generated-sample') {
    const r = await fetch('/demo/sample.mp4');
    if (!r.ok) throw new Error('Sample video is unavailable.');
    const blob = await r.blob();
    const seed = {
      id,
      name: 'Generated sample.mp4',
      role: 'source',
      bytes: blob.size,
      width: 320,
      height: 568,
      duration: 8,
      blob,
      digest: await hash(blob),
    };
    await put('assets', id, seed);
    return seed;
  }
  throw new Error('Your source file is missing from this browser. Please upload it again.');
}
export async function hydrate(project: LocalProject): Promise<LocalProject> {
  const p = structuredClone(project);
  for (const source of Object.values(p.sources)) {
    const a = await asset(source.id);
    source.url = await blobURL(a.id, a.blob);
  }
  if (p.reference) {
    const a = await asset(p.reference.id);
    p.sample_url = await blobURL(a.id, a.blob);
  }
  if (p.musicId) {
    const a = await asset(p.musicId);
    p.music_url = await blobURL(a.id, a.blob);
  }
  for (const reel of p.reels) {
    for (const f of reel.frames) f.url = await mediaURL(f.url);
    if (reel.gif.url) reel.gif.url = await mediaURL(reel.gif.url);
    if (reel.render.url) reel.render.url = await mediaURL(reel.render.url);
  }
  for (const d of p.deliverables) {
    const reel = project.reels.find((r) => r.id + '.mp4' === d.name),
      key = d.url + ':' + reel?.render.sha256;
    if (!reel?.render.sha256 || !d.url.startsWith('local:'))
      throw new Error('The accepted output is missing.');
    if (!verifiedOutputs.has(key)) {
      const blob = await get<Blob>('media', d.url.slice(6));
      if (!blob || (await hash(blob)) !== reel.render.sha256)
        throw new Error('An accepted file changed. Download blocked.');
      verifiedOutputs.add(key);
    }
    d.url = await mediaURL(d.url);
  }
  return p;
}
export async function hash(value: Blob | unknown) {
  const bytes =
    value instanceof Blob
      ? await value.arrayBuffer()
      : value instanceof ArrayBuffer
        ? value
        : new TextEncoder().encode(JSON.stringify(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}
export async function signature(p: LocalProject) {
  return hash({
    sources: Object.fromEntries(Object.entries(p.sources).map(([k, v]) => [k, v.id])),
    music: p.musicId,
    reference: p.reference,
    style: p.style,
    transcripts: p.transcripts,
    reels: p.reels.map((r) => ({
      id: r.id,
      segments: r.segments,
      title_text: r.title_text,
      cta: r.cta,
      caption_text: r.caption_text,
      editing: r.editing,
    })),
  });
}
export async function boardSignature(p: LocalProject) {
  const files: Record<string, string> = {};
  for (const r of p.reels)
    for (const url of [...r.frames.map((f) => f.url), r.gif.url]) {
      if (!url?.startsWith('local:'))
        throw new Error('Rebuild this storyboard before approving it.');
      const blob = await get<Blob>('media', url.slice(6));
      if (!blob) throw new Error('A storyboard image is missing. Rebuild before approving.');
      files[url] = await hash(blob);
    }
  return hash({ plan: await signature(p), files });
}
