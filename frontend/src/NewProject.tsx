import { useEffect, useRef, useState } from 'react';
import {
  UploadCloud,
  X,
  Film,
  Music2,
  ArrowRight,
  Loader2,
  Link as LinkIcon,
  Check,
  Plus,
} from 'lucide-react';
import { api, upload, waitTask } from './api';
import type { Upload } from './types';
import { bytes } from './utils';

type Props = { onClose: () => void; onCreated: (id: string, task: string) => void };

export default function NewProject({ onClose, onCreated }: Props) {
  const [name, setName] = useState('Untitled project'),
    [sources, setSources] = useState<Upload[]>([]),
    [sample, setSample] = useState<Upload | null>(null),
    [music, setMusic] = useState<Upload | null>(null);
  const [preset, setPreset] = useState('clean'),
    [count, setCount] = useState(3),
    [duration, setDuration] = useState(30),
    [lang, setLang] = useState('en'),
    [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(''),
    [progress, setProgress] = useState(0),
    [error, setError] = useState(''),
    [url, setUrl] = useState(''),
    [library, setLibrary] = useState<Upload[]>([]);
  const abort = useRef<AbortController | null>(null),
    dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    void api<Upload[]>('/uploads')
      .then(setLibrary)
      .catch(() => {});
    return () => abort.current?.abort();
  }, []);
  async function files(list: FileList | File[], role: string) {
    if (!list.length) return;
    setError('');
    abort.current = new AbortController();
    try {
      for (const file of Array.from(list)) {
        setBusy(`Uploading ${file.name}`);
        setProgress(0);
        const record = await upload(file, role, setProgress, abort.current.signal);
        if (role === 'source') {
          setSources((old) => [...old.filter((x) => x.id !== record.id), record]);
          if (name === 'Untitled project') setName(file.name.replace(/\.[^.]+$/, ''));
        }
        if (role === 'sample') setSample(record);
        if (role === 'music') setMusic(record);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function importUrl() {
    setError('');
    setBusy('Importing your video…');
    try {
      const result = await api<{ task_id: string }>('/imports', 'POST', { url, role: 'source' });
      const record = (await waitTask(result.task_id)) as Upload;
      setSources((old) => [...old, record]);
      setUrl('');
      if (name === 'Untitled project') setName(record.name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function create() {
    setBusy('Creating your project…');
    setError('');
    try {
      const result = await api<{ id: string; task_id: string }>('/projects', 'POST', {
        name,
        sources: sources.map((x) => x.id),
        sample: sample?.id,
        music: music?.id,
        preset,
        count,
        duration,
        lang,
        notes,
      });
      onCreated(result.id, result.task_id);
    } catch (e) {
      setError((e as Error).message);
      setBusy('');
    }
  }
  return (
    <dialog
      className="project-dialog"
      ref={dialog}
      onCancel={(e) => {
        if (busy) {
          e.preventDefault();
          return;
        }
        onClose();
      }}
    >
      <div className="modal-head">
        <span className="eyebrow">A NEW STORY STARTS HERE</span>
        <button
          className="icon-button"
          aria-label="Close new project"
          disabled={!!busy}
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      <h2>Let’s make a great reel.</h2>
      <p className="muted">
        Start with your footage. You’ll review the storyboard before anything renders.
      </p>
      <label className="field">
        Project name
        <input
          autoFocus
          aria-label="Project name"
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!!busy}
        />
      </label>
      <div
        className="dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!busy) void files(e.dataTransfer.files, 'source');
        }}
      >
        <UploadCloud size={29} />
        <h3>Drop your footage here</h3>
        <p>MP4, MOV, MKV or WebM · up to 4 GB per file</p>
        <label className="button dark">
          Choose videos
          <input
            type="file"
            accept="video/*,.mkv"
            multiple
            disabled={!!busy}
            onChange={(e) => {
              if (e.target.files) void files(e.target.files, 'source');
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {sources.length > 0 && (
        <div className="upload-list">
          {sources.map((s) => (
            <div key={s.id}>
              <Film size={17} />
              <span>
                {s.name}
                <small>{bytes(s.bytes)}</small>
              </span>
              <button
                aria-label={`Remove ${s.name}`}
                className="icon-button"
                disabled={!!busy}
                onClick={() => setSources(sources.filter((x) => x.id !== s.id))}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      <details className="import-options">
        <summary>
          <LinkIcon size={14} />
          Or import a video link
        </summary>
        <div className="url-row">
          <input
            aria-label="Video URL"
            type="url"
            placeholder="https://youtube.com/watch?v=…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={!!busy}
          />
          <button
            className="button secondary"
            disabled={!!busy || !url}
            onClick={() => void importUrl()}
          >
            Import
          </button>
        </div>
        <p className="field-hint">
          Optional yt-dlp importer. Imports preserve available source quality.
        </p>
      </details>
      {library.length > 0 && (
        <details className="import-options">
          <summary>Use a previously uploaded file</summary>
          <div className="library-list">
            {library
              .filter((x) => x.role === 'source')
              .map((x) => (
                <button
                  key={x.id}
                  disabled={!!busy || sources.some((s) => s.id === x.id)}
                  onClick={() => setSources((old) => [...old, x])}
                >
                  <Film size={14} />
                  {x.name}
                  <Plus size={13} />
                </button>
              ))}
          </div>
        </details>
      )}
      <div className="divider" />
      <h3>Choose your starting style</h3>
      <div className="preset-grid">
        {[
          ['clean', 'Aa', 'Clean', 'Clear & considered'],
          ['bold', 'AA', 'Bold', 'Make a statement'],
          ['minimal', 'Aa', 'Minimal', 'Less, beautifully'],
        ].map(([id, aa, title, sub]) => (
          <button
            key={id}
            disabled={!!busy}
            className={`preset ${preset === id && !sample ? 'selected' : ''} ${id}`}
            onClick={() => {
              setPreset(id);
              setSample(null);
            }}
          >
            <span>{aa}</span>
            <strong>{title}</strong>
            <small>{sub}</small>
            {preset === id && !sample && <Check size={13} />}
          </button>
        ))}
      </div>
      <div className="extra-uploads">
        <label className={sample ? 'added' : ''}>
          <Film size={17} />
          {sample ? sample.name : 'Use a reference reel'}
          <input
            type="file"
            accept="video/*,.mkv"
            disabled={!!busy}
            onChange={(e) => {
              if (e.target.files) void files(e.target.files, 'sample');
            }}
          />
        </label>
        <label className={music ? 'added' : ''}>
          <Music2 size={17} />
          {music ? music.name : 'Add background music'}
          <input
            type="file"
            accept="audio/*"
            disabled={!!busy}
            onChange={(e) => {
              if (e.target.files) void files(e.target.files, 'music');
            }}
          />
        </label>
      </div>
      <div className="field-triple">
        <label className="field">
          Reels
          <input
            aria-label="Number of reels"
            type="number"
            min={1}
            max={50}
            value={count}
            disabled={!!busy}
            onChange={(e) => setCount(+e.target.value)}
          />
        </label>
        <label className="field">
          Target length
          <select
            aria-label="Target duration"
            disabled={!!busy}
            value={duration}
            onChange={(e) => setDuration(+e.target.value)}
          >
            {[15, 30, 45, 60, 90].map((x) => (
              <option key={x} value={x}>
                {x} seconds
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Speech language
          <select
            aria-label="Speech language"
            disabled={!!busy}
            value={lang}
            onChange={(e) => setLang(e.target.value)}
          >
            {[
              ['en', 'English'],
              ['hi', 'Hindi'],
              ['ur', 'Urdu'],
              ['es', 'Spanish'],
              ['fr', 'French'],
              ['de', 'German'],
              ['auto', 'Detect language'],
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        Anything we should know?
        <textarea
          aria-label="Project instructions"
          placeholder="The audience, the story, the moments worth keeping…"
          rows={2}
          value={notes}
          disabled={!!busy}
          maxLength={20000}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {busy && (
        <div className="upload-progress">
          <span>
            <Loader2 size={14} className="spin" />
            {busy}
          </span>
          {busy.startsWith('Uploading') && (
            <>
              <progress value={progress} max={100} />
              <small>{progress}%</small>
              <button className="text-button" onClick={() => abort.current?.abort()}>
                Cancel upload
              </button>
            </>
          )}
        </div>
      )}
      <div className="modal-foot">
        <p>
          <span className="live-dot" />
          Storyboard first. Your approval, always.
        </p>
        <button
          className="button orange"
          disabled={!!busy || !sources.length || !name.trim() || count < 1 || count > 50}
          onClick={() => void create()}
        >
          Create storyboard
          <ArrowRight size={16} />
        </button>
      </div>
    </dialog>
  );
}
