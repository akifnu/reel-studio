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
  Trash2,
} from 'lucide-react';
import { api, upload, waitTask } from './api';
import type { Upload } from './types';
import { bytes } from './utils';
import { browserMode } from './features';
import CaptionStylePreview from './CaptionStylePreview';

type Props = { onClose: () => void; onCreated: (id: string, task: string) => void };

export default function NewProject({ onClose, onCreated }: Props) {
  const [name, setName] = useState('Untitled project'),
    [sources, setSources] = useState<Upload[]>([]),
    [sample, setSample] = useState<Upload | null>(null),
    [music, setMusic] = useState<Upload | null>(null);
  const [preset, setPreset] = useState('clean'),
    [count, setCount] = useState(browserMode ? 1 : 3),
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
  const [captionScript, setCaptionScript] = useState('');
  const [referenceNotes, setReferenceNotes] = useState('');
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
        if (role === 'sample') {
          setSample(record);
        }
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
        reference_notes: sample ? referenceNotes : '',
        music: music?.id,
        preset,
        count,
        duration,
        lang,
        notes,
        ...(browserMode ? { caption_script: captionScript } : {}),
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
        Two different inputs: a reel whose style you like, and your own footage to edit. Review the
        storyboard and GIF before rendering.
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
      <section className="ingestion-section" aria-labelledby="reference-heading">
        <div className="ingestion-heading">
          <span className="ingestion-step">1</span>
          <div>
            <h3 id="reference-heading">
              Reference reel <small>Optional</small>
            </h3>
            <p>
              The editing style you want to recreate — pacing, colour tone, captions and opening
              hook.
            </p>
          </div>
        </div>
        <div
          className="dropzone reference-dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (!busy) void files(Array.from(e.dataTransfer.files).slice(0, 1), 'sample');
          }}
        >
          <Film size={25} />
          <h3>{sample ? sample.name : 'Add an example of the style you like'}</h3>
          <p>Style inspiration only. Its picture, speech and music are never added to your reel.</p>
          <label className="button secondary">
            {sample ? 'Replace reference' : 'Choose reference reel'}
            <input
              aria-label="Reference reel"
              type="file"
              accept="video/*,.mkv"
              disabled={!!busy}
              onChange={(e) => {
                if (e.target.files) void files(e.target.files, 'sample');
                e.target.value = '';
              }}
            />
          </label>
          {sample && (
            <button className="text-button" disabled={!!busy} onClick={() => setSample(null)}>
              Remove reference
            </button>
          )}
        </div>
        {sample?.preview_url && (
          <video
            className="reference-preview"
            aria-label="Reference reel preview"
            src={sample.preview_url}
            controls
            playsInline
            preload="metadata"
          />
        )}
        <p className="field-hint reference-limit">
          {browserMode
            ? 'Reference analysis samples 24 frames from up to 5 seconds, locally. Colour tone and cut timing are measured for on-demand copying. Local English OCR also reads captions without a box; the original font can be imported later. Hook wording stays yours.'
            : 'The server analyzes this reference separately. Review the measured style before it is applied to your raw footage.'}
        </p>
        {browserMode && sample?.caption_analysis && (
          <div className="caption-match-note" role="status">
            {sample.caption_analysis.status === 'detected' ? (
              <>
                <strong>Reference caption style detected — applied automatically</strong>
                <p>
                  Presets cannot replace it during setup. Fine-tune only after seeing your
                  storyboard.
                </p>
                <p>
                  {sample.caption_analysis.matches}/{sample.caption_analysis.frames} frames matched
                  · {sample.caption_analysis.window_seconds?.toFixed(1)}s window ·{' '}
                  {sample.caption_analysis.style?.size}px text ·{' '}
                  {sample.caption_analysis.style?.box?.color
                    ? 'boxed captions'
                    : 'captions without a box'}
                </p>
                <p>{sample.caption_analysis.notes}</p>
                <CaptionStylePreview
                  analysis={sample.caption_analysis}
                  style={sample.caption_analysis.style}
                  label="Automatically copied caption style"
                />
              </>
            ) : (
              <p role="alert">
                {sample.caption_analysis.notes} Colour and pacing remain available in the control
                room. Captions stay off until you choose their style; no preset is substituted.
              </p>
            )}
          </div>
        )}
        {sample?.caption_analysis?.pacing && (
          <p className="field-hint">
            Reference timing: {sample.caption_analysis.pacing.cuts.length} detected cuts ·{' '}
            {sample.caption_analysis.pacing.confidence === 'measured'
              ? `${sample.caption_analysis.pacing.median_shot.toFixed(2)}s median shot. Use Copy cuts & pacing in the control room when you want this rhythm.`
              : 'No clear cuts; source timing will be kept.'}{' '}
            Colour tone:{' '}
            {sample.caption_analysis.look ? 'measured — copy on demand' : 'not measured'}.
          </p>
        )}
        {sample && (
          <label className="field">
            What do you like about this edit?
            <textarea
              aria-label="Reference style notes"
              rows={2}
              maxLength={6000}
              value={referenceNotes}
              disabled={!!busy}
              onChange={(e) => setReferenceNotes(e.target.value)}
              placeholder="e.g. quick cuts, warm colours, bold yellow captions, a question in the first 2 seconds"
            />
            <small>
              {browserMode
                ? 'Saved as your style brief for review; these notes do not automatically change the video.'
                : 'Guidance for planning and reviewing the edit.'}
            </small>
          </label>
        )}
      </section>
      <section className="ingestion-section" aria-labelledby="footage-heading">
        <div className="ingestion-heading">
          <span className="ingestion-step">2</span>
          <div>
            <h3 id="footage-heading">
              Raw footage <small>Required</small>
            </h3>
            <p>
              Your original recordings. Only these clips supply the picture and speech for your
              finished reel.
            </p>
          </div>
        </div>
        <div
          className="dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (!busy) void files(e.dataTransfer.files, 'source');
          }}
        >
          <UploadCloud size={29} />
          <h3>Drop your raw footage here</h3>
          <p>
            {browserMode
              ? 'H.264/AAC MP4 works best · up to 100 MB/file · 200 MB total · 5 minutes/source'
              : 'MP4, MOV, MKV or WebM · up to 4 GB per file'}
          </p>
          <label className="button dark">
            Choose raw footage
            <input
              aria-label="Raw footage"
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
        {!browserMode && (
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
        )}
      </section>
      {library.length > 0 && (
        <details className="import-options">
          <summary>Use a previously uploaded file</summary>
          <div className="library-list">
            {library
              .filter((x) => ['source', 'sample', 'music'].includes(x.role))
              .map((x) => (
                <div className="library-row" key={x.id}>
                  <button
                    disabled={!!busy || (x.role === 'source' && sources.some((s) => s.id === x.id))}
                    onClick={() =>
                      x.role === 'sample'
                        ? setSample(x)
                        : x.role === 'music'
                          ? setMusic(x)
                          : setSources((old) => [...old, x])
                    }
                  >
                    <Film size={14} />
                    <span>
                      {x.name}
                      <small>
                        {x.role === 'sample'
                          ? 'Reference style'
                          : x.role === 'music'
                            ? 'Background music'
                            : 'Raw footage'}
                      </small>
                    </span>
                    <Plus size={13} />
                  </button>
                  {browserMode && (
                    <button
                      className="icon-button"
                      aria-label={`Delete stored ${x.name}`}
                      disabled={!!busy}
                      onClick={async () => {
                        try {
                          await api(`/uploads/${x.id}`, 'DELETE');
                          setLibrary((old) => old.filter((y) => y.id !== x.id));
                          setSources((old) => old.filter((y) => y.id !== x.id));
                          if (music?.id === x.id) setMusic(null);
                          if (sample?.id === x.id) setSample(null);
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
          </div>
        </details>
      )}
      {!sample && (
        <section className="ingestion-section">
          <h4>No reference? Start with a caption preset</h4>
          <div className="preset-grid">
            {[
              ['clean', 'Aa', 'Clean', 'Clear & considered'],
              ['bold', 'AA', 'Bold', 'Make a statement'],
              ['minimal', 'Aa', 'Minimal', 'Less, beautifully'],
            ].map(([id, aa, title, sub]) => (
              <button
                key={id}
                disabled={!!busy}
                className={`preset ${preset === id ? 'selected' : ''} ${id}`}
                onClick={() => setPreset(id)}
              >
                <span>{aa}</span>
                <strong>{title}</strong>
                <small>{sub}</small>
                {preset === id && <Check size={13} />}
              </button>
            ))}
          </div>
        </section>
      )}
      <div className="extra-uploads">
        <label className={music ? 'added' : ''}>
          <Music2 size={17} />
          {music ? music.name : 'Add background music'}
          <input
            aria-label="Background music"
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
            max={browserMode ? 3 : 50}
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
            {(browserMode ? [5, 10, 15, 30, 45, 60] : [15, 30, 45, 60, 90]).map((x) => (
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
      {browserMode && (
        <label className="field">
          Caption script (optional)
          <textarea
            aria-label="Caption script"
            rows={3}
            value={captionScript}
            maxLength={6000}
            onChange={(e) => setCaptionScript(e.target.value)}
            placeholder="One caption per line. Timings are evenly spaced; you can edit them later."
          />
          <small>
            No speech is invented. Leave this blank, enter captions manually later, or optionally
            download an English speech model using Auto captions.
          </small>
        </label>
      )}
      <label className="field">
        Story instructions
        <textarea
          aria-label="Project instructions"
          placeholder="What is your reel about? The audience, story and moments to keep…"
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
          {sources.length
            ? `${sources.length} raw clip${sources.length === 1 ? '' : 's'} · ${sample ? '1 style reference' : 'caption preset'} · storyboard first`
            : 'Add raw footage to continue. A reference alone cannot create a reel.'}
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
