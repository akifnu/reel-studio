import { useEffect, useState } from 'react';
import { BookmarkPlus, Download, Upload } from 'lucide-react';
import { api } from './api';
import type { ControlArea, EditPreset, Project, ProjectSummary } from './types';
type Props = {
  project: Project;
  reelId: string;
  disabled: boolean;
  dirty: boolean;
  onPreview: (id: string, area: ControlArea) => Promise<void>;
};
export default function PresetLibrary({ project, reelId, disabled, dirty, onPreview }: Props) {
  const [presets, setPresets] = useState<EditPreset[]>([]),
    [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [sourceId, setSourceId] = useState(project.id),
    [source, setSource] = useState<Project | null>(project);
  const [sourceReel, setSourceReel] = useState(reelId),
    [name, setName] = useState('');
  const [parts, setParts] = useState('both'),
    [selected, setSelected] = useState('');
  const [working, setWorking] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  async function refresh() {
    const [items, list] = await Promise.all([
      api<EditPreset[]>('/edit-presets'),
      api<ProjectSummary[]>('/projects'),
    ]);
    setPresets(items);
    setSelected((current) => (items.some((p) => p.id === current) ? current : items[0]?.id || ''));
    setProjects(list);
    return items;
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    const update = () => {
      void refresh().catch((e) => setError(e.message));
    };
    window.addEventListener('focus', update);
    return () => window.removeEventListener('focus', update);
  }, [project.id]);
  useEffect(() => {
    let cancelled = false;
    if (sourceId === project.id) {
      setSource(project);
      return;
    }
    setSource(null);
    void api<Project>(`/edit-presets/source/${sourceId}`)
      .then((p) => {
        if (!cancelled) {
          setSource(p);
          setSourceReel(p.reels[0]?.id || '');
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceId, project.id]);
  async function task(fn: () => Promise<void>) {
    setWorking(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  const preset = presets.find((p) => p.id === selected);
  const chosenSource = sourceId === project.id ? project : source;
  const saving =
    working ||
    !chosenSource ||
    chosenSource.busy ||
    !chosenSource.reels.some((r) => r.id === sourceReel) ||
    (sourceId === project.id && dirty);
  async function save() {
    await task(async () => {
      const saved = await api<EditPreset>('/edit-presets', 'POST', {
        project_id: sourceId,
        reel_id: sourceReel,
        name:
          name.trim() ||
          `${chosenSource?.name || 'My reel'} · ${parts === 'colour' ? 'tone' : parts === 'pacing' ? 'pacing' : 'tone & pacing'}`.slice(
            0,
            80,
          ),
        parts,
      });
      await refresh();
      setSelected(saved.id);
      setName('');
      setNotice(`“${saved.name}” saved. Available in every project in this browser.`);
    });
  }
  function download() {
    if (!preset) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = preset.name.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 70) + '.reel-preset.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="preset-library" aria-label="Saved tone and pacing presets">
      <div className="preset-heading">
        <div>
          <h3>
            <BookmarkPlus size={18} /> Your preset library
          </h3>
          <p>
            Reuse tone and cut rhythm across projects. Saved on this browser; download a preset to
            move it to another device.
          </p>
        </div>
        <label className="button secondary preset-import">
          <Upload size={14} /> Import preset
          <input
            type="file"
            accept=".json,application/json"
            aria-label="Import editing preset"
            disabled={working}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              void task(async () => {
                if (file.size > 65536) throw new Error('Choose a preset file smaller than 64 KB.');
                let value;
                try {
                  value = JSON.parse(await file.text());
                } catch {
                  throw new Error('That file is not a valid JSON preset.');
                }
                const saved = await api<EditPreset>('/edit-presets', 'POST', { preset: value });
                await refresh();
                setSelected(saved.id);
                setNotice(`“${saved.name}” imported. Preview it before applying.`);
              });
            }}
          />
        </label>
      </div>
      <form
        className="preset-save"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="field">
          Save from project
          <select
            aria-label="Preset source project"
            value={sourceId}
            disabled={working}
            onChange={(e) => {
              setSourceId(e.target.value);
              setSourceReel(e.target.value === project.id ? reelId : '');
              setError('');
            }}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.id === project.id ? ' (current)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Source reel
          <select
            aria-label="Preset source reel"
            value={sourceReel}
            disabled={working || !source}
            onChange={(e) => setSourceReel(e.target.value)}
          >
            {chosenSource?.reels.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title || r.id} · {r.id.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Include
          <select
            aria-label="Preset contents"
            value={parts}
            disabled={working}
            onChange={(e) => setParts(e.target.value)}
          >
            <option value="both">Tone + pacing</option>
            <option value="colour">Tone only</option>
            <option value="pacing">Pacing only</option>
          </select>
        </label>
        <label className="field">
          Preset name (optional)
          <input
            aria-label="Preset name"
            placeholder="Uses the source project name"
            maxLength={80}
            value={name}
            disabled={working}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button className="button dark" disabled={saving}>
          <BookmarkPlus size={14} /> Save preset
        </button>
      </form>
      <p className="field-hint">
        Saves the source reel’s current tone and pacing, including any applied reference look.
        Footage, captions and audio are excluded. Shot lengths use the supported 0.35–5s range.
      </p>
      <div className="preset-apply">
        <label className="field">
          Saved preset
          <select
            aria-label="Saved editing preset"
            value={selected}
            disabled={working}
            onChange={(e) => {
              setSelected(e.target.value);
              setNotice('');
            }}
          >
            <option value="">{presets.length ? 'Choose a preset…' : 'No saved presets yet'}</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.builtin ? 'starter · ' : ''}
                {p.colour && p.pacing ? 'tone + pacing' : p.colour ? 'tone' : 'pacing'}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button orange"
          disabled={disabled || working || !preset}
          onClick={() => void task(() => onPreview(selected, 'all'))}
        >
          Preview preset
        </button>
        <button
          className="button secondary"
          disabled={disabled || working || !preset?.colour}
          onClick={() => void task(() => onPreview(selected, 'colour'))}
        >
          Preview tone only
        </button>
        <button
          className="button secondary"
          disabled={disabled || working || !preset?.pacing}
          onClick={() => void task(() => onPreview(selected, 'pacing'))}
        >
          Preview pacing only
        </button>
        <button className="text-button" disabled={!preset || working} onClick={download}>
          <Download size={13} /> Download preset
        </button>
        <button
          className="text-button"
          disabled={!preset || working || preset.builtin}
          onClick={() =>
            void task(async () => {
              await api(`/edit-presets/${selected}`, 'DELETE');
              await refresh();
              setSelected('');
              setNotice('Preset removed from the library. Existing edits are unchanged.');
            })
          }
        >
          Delete preset
        </button>
      </div>
      {preset && (
        <p className="field-hint">
          From {preset.source.project} · {preset.source.reel}
          {preset.colour ? ` · Tone ${Math.round(preset.colour.strength * 100)}%` : ''}
          {preset.pacing
            ? ` · ${preset.pacing.pattern.length} beat rhythm · ${preset.pacing.reframes ? 'with' : 'without'} reframing`
            : ''}
        </p>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="control-notice">
          {notice}
        </p>
      )}
    </section>
  );
}
