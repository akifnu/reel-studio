import { useState } from 'react';
import {
  Type,
  Crop,
  AudioLines,
  Sparkles,
  RotateCcw,
  ChevronDown,
  MessageSquare,
  Check,
  ArrowUp,
  ArrowDown,
  Trash2,
  Plus,
  Loader2,
} from 'lucide-react';
import type { Changes, Config, Project, Proposal, Reel, Segment } from './types';
import { api } from './api';
import { controlSummary, time } from './utils';

type Props = {
  project: Project;
  reel: Reel;
  patch: Changes;
  config: Config | null;
  disabled: boolean;
  tab: string;
  setTab: (s: string) => void;
  onChange: (x: Changes) => void;
  onApply: () => void;
  onDiscard: () => void;
  onProposal: (changes: Changes) => void;
  onError: (s: string) => void;
  onMusic: (file: File) => void;
};

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = '',
  onChange,
  disabled = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="slider-field">
      <span>
        {label}
        <output>
          {Number.isInteger(value) ? value : value.toFixed(2)}
          {suffix}
        </output>
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(+e.target.value)}
      />
    </label>
  );
}
function Toggle({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (x: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <input
        aria-label={label}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

export default function Inspector(p: Props) {
  const { project, reel, patch, disabled, tab, setTab, onChange } = p;
  const [instruction, setInstruction] = useState(''),
    [proposal, setProposal] = useState<Proposal | null>(null),
    [asking, setAsking] = useState(false);
  const edit = {
    captions: { ...reel.editing?.captions, ...patch.editing?.captions },
    crop: { ...reel.editing?.crop, ...patch.editing?.crop },
    music: { ...reel.editing?.music, ...patch.editing?.music },
    sfx: { ...reel.editing?.sfx, ...patch.editing?.sfx },
    motion: { ...reel.editing?.motion, ...patch.editing?.motion },
  };
  const style = {
    ...reel.effective_style.captions?.style,
    ...reel.editing?.captions?.style,
    ...patch.editing?.captions?.style,
  };
  const cap = (changes: Record<string, unknown>) =>
    onChange({ editing: { captions: { style: changes } } });
  const segments = patch.segments || reel.segments;
  const dirty = Object.keys(patch).length > 0;
  const selectedKeys = new Set(
    [...(reel.hook ? [reel.hook] : []), ...segments].flatMap((s) =>
      s.sentences
        ? Array.from(
            { length: Math.min(500, s.sentences.at(-1)! - s.sentences[0] + 1) },
            (_, i) => `${s.src}:${s.sentences![0] + i}`,
          )
        : (project.transcripts[s.src]?.sentences || [])
            .filter((x) => x.s < (s.e || 0) && x.e > (s.s || 0))
            .map((x) => `${s.src}:${x.id}`),
    ),
  );
  const colors = ['#ffffff', '#ffe600', '#a3e635', '#60a5fa', '#f9a8d4', '#fb923c'];
  async function ask() {
    if (!instruction.trim()) return;
    setAsking(true);
    setProposal(null);
    try {
      setProposal(
        await api<Proposal>(`/projects/${project.id}/propose`, 'POST', {
          reel_id: reel.id,
          generation: project.generation,
          text: instruction,
        }),
      );
    } catch (e) {
      p.onError((e as Error).message);
    } finally {
      setAsking(false);
    }
  }
  function reorder(i: number, delta: number) {
    const list = segments.map((x) => ({ ...x }));
    [list[i], list[i + delta]] = [list[i + delta], list[i]];
    onChange({ segments: list });
  }
  return (
    <aside className="inspector" aria-label="Reel settings">
      <div className="inspector-heading">
        <div>
          <span className="eyebrow">MAKE IT YOURS</span>
          <h2>The details</h2>
        </div>
        <span className="tiny-tag">{reel.id.toUpperCase()}</span>
      </div>
      <div className="inspector-tabs" role="tablist" aria-label="Editing controls">
        {[
          ['captions', Type, 'Captions'],
          ['framing', Crop, 'Framing'],
          ['audio', AudioLines, 'Audio'],
          ['ask', Sparkles, 'Ask'],
        ].map(([id, Icon, label]) => {
          const I = Icon as typeof Type;
          return (
            <button
              key={id as string}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id as string)}
              className={tab === id ? 'active' : ''}
            >
              <I size={17} />
              <span>{label as string}</span>
            </button>
          );
        })}
      </div>
      <div className="inspector-body">
        {tab === 'captions' && (
          <>
            <Toggle
              label="Show captions"
              checked={
                patch.editing?.captions?.enabled ??
                reel.editing?.captions?.enabled ??
                reel.effective_style.captions?.present ??
                true
              }
              disabled={disabled}
              onChange={(enabled) => onChange({ editing: { captions: { enabled } } })}
            />
            <label className="field">
              Font
              <select
                aria-label="Caption font"
                disabled={disabled}
                value={style.font || 'Arimo'}
                onChange={(e) => cap({ font: e.target.value })}
              >
                {(
                  p.config?.fonts || [
                    'Arimo',
                    'Montserrat',
                    'Anton',
                    'Oswald',
                    'Roboto',
                    'Bebas Neue',
                  ]
                ).map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            <div className="field-pair">
              <label className="field">
                Weight
                <select
                  aria-label="Caption weight"
                  disabled={disabled}
                  value={style.weight || 700}
                  onChange={(e) => cap({ weight: +e.target.value })}
                >
                  {[400, 500, 600, 700, 800, 900].map((n) => (
                    <option key={n} value={n}>
                      {n === 400 ? 'Regular' : n === 700 ? 'Bold' : n === 900 ? 'Black' : n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Case
                <select
                  aria-label="Caption case"
                  disabled={disabled}
                  value={style.case || 'none'}
                  onChange={(e) => cap({ case: e.target.value })}
                >
                  <option value="none">As spoken</option>
                  <option value="upper">UPPERCASE</option>
                  <option value="lower">lowercase</option>
                </select>
              </label>
            </div>
            <Slider
              label="Text size"
              min={12}
              max={140}
              value={style.size || 56}
              onChange={(size) => cap({ size })}
              disabled={disabled}
            />
            <div className="field">
              <span>Text colour</span>
              <div className="swatches">
                {colors.map((c) => (
                  <button
                    key={c}
                    aria-label={`Caption colour ${c}`}
                    title={c}
                    disabled={disabled}
                    onClick={() => cap({ fill: c })}
                    style={{ background: c }}
                    className={(style.fill || '#ffffff').toLowerCase() === c ? 'selected' : ''}
                  />
                ))}
                <input
                  aria-label="Custom caption colour"
                  type="color"
                  disabled={disabled}
                  value={/^#[0-9a-f]{6}$/i.test(style.fill || '') ? style.fill : '#ffffff'}
                  onChange={(e) => cap({ fill: e.target.value })}
                />
              </div>
            </div>
            <Slider
              label="Vertical position"
              min={-560}
              max={560}
              value={style.y || 0}
              onChange={(y) => cap({ y })}
              disabled={disabled}
            />
            <p className="field-hint">Or drag the captions directly in Source preview.</p>
            <label className="field">
              Entrance
              <select
                aria-label="Caption animation"
                disabled={disabled}
                value={style.anim?.in || 'none'}
                onChange={(e) => cap({ anim: { ...style.anim, in: e.target.value, in_dur: 0.15 } })}
              >
                {[
                  ['none', 'None'],
                  ['pop', 'Pop'],
                  ['fade', 'Fade'],
                  ['slide_up', 'Slide up'],
                  ['word_reveal', 'Word reveal'],
                ].map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <div className="divider" />
            <label className="field">
              Opening hook
              <input
                aria-label="Opening hook"
                disabled={disabled}
                maxLength={120}
                placeholder="Let the opening words speak"
                value={patch.title_text ?? reel.title_text ?? ''}
                onChange={(e) => onChange({ title_text: e.target.value })}
              />
            </label>
            <label className="field">
              Closing call to action
              <input
                aria-label="Closing call to action"
                disabled={disabled}
                maxLength={120}
                placeholder="Optional closing line"
                value={patch.cta ?? reel.cta ?? ''}
                onChange={(e) => onChange({ cta: e.target.value })}
              />
            </label>
            <details className="caption-editor">
              <summary>
                Correct the spoken captions <ChevronDown size={14} />
              </summary>
              {Object.entries(project.transcripts).flatMap(([src, tr]) =>
                tr.sentences
                  .filter((s) => selectedKeys.has(`${src}:${s.id}`))
                  .map((s) => (
                    <label className="field transcript-line" key={`${src}:${s.id}`}>
                      <span>
                        {src} · {time(s.s)}
                      </span>
                      <textarea
                        aria-label={`Caption ${src} sentence ${s.id}`}
                        rows={2}
                        disabled={disabled}
                        maxLength={1000}
                        value={
                          patch.caption_text?.[`${src}:${s.id}`] ??
                          reel.caption_text?.[`${src}:${s.id}`] ??
                          reel.caption_text?.[String(s.id)] ??
                          s.text
                        }
                        onChange={(e) =>
                          onChange({ caption_text: { [`${src}:${s.id}`]: e.target.value } })
                        }
                      />
                    </label>
                  )),
              )}
            </details>
          </>
        )}
        {tab === 'framing' && (
          <>
            <div className="inspector-callout">
              <Crop size={20} />
              <p>Choose a crop, then drag the picture in Source preview to place your subject.</p>
            </div>
            <Slider
              label="Zoom"
              min={1}
              max={3}
              step={0.01}
              value={edit.crop?.zoom ?? 1}
              suffix="×"
              onChange={(zoom) => onChange({ editing: { crop: { zoom } } })}
              disabled={disabled}
            />
            <Slider
              label="Horizontal centre"
              min={0}
              max={1}
              step={0.01}
              value={edit.crop?.x ?? 0.5}
              onChange={(x) => onChange({ editing: { crop: { x } } })}
              disabled={disabled}
            />
            <Slider
              label="Vertical centre"
              min={0}
              max={1}
              step={0.01}
              value={edit.crop?.y ?? 0.5}
              onChange={(y) => onChange({ editing: { crop: { y } } })}
              disabled={disabled}
            />
            <button
              className="text-button"
              disabled={disabled}
              onClick={() => onChange({ editing: { crop: { x: 0.5, y: 0.5, zoom: 1 } } })}
            >
              <RotateCcw size={13} />
              Centre the frame
            </button>
            <div className="divider" />
            <h3>A little movement</h3>
            <Slider
              label="Punch-ins"
              min={0}
              max={1}
              step={0.05}
              value={edit.motion?.punch_rate ?? reel.effective_style.motion?.punch_rate ?? 0}
              onChange={(punch_rate) => onChange({ editing: { motion: { punch_rate } } })}
              disabled={disabled}
            />
            <Slider
              label="Slow pushes"
              min={0}
              max={1}
              step={0.05}
              value={edit.motion?.push_rate ?? reel.effective_style.motion?.push_rate ?? 0}
              onChange={(push_rate) => onChange({ editing: { motion: { push_rate } } })}
              disabled={disabled}
            />
            <div className="divider" />
            <h3>Your selected moments</h3>
            <p className="field-hint">
              Reorder or trim segments. Each change creates a new storyboard to review.
            </p>
            {segments.map((seg, i) => (
              <div className="segment-card" key={i}>
                <div>
                  <span>
                    {i + 1}. Source {seg.src}
                  </span>
                  <div className="segment-actions">
                    <button
                      aria-label={`Move segment ${i + 1} up`}
                      disabled={disabled || i === 0}
                      onClick={() => reorder(i, -1)}
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      aria-label={`Move segment ${i + 1} down`}
                      disabled={disabled || i === segments.length - 1}
                      onClick={() => reorder(i, 1)}
                    >
                      <ArrowDown size={13} />
                    </button>
                    <button
                      aria-label={`Remove segment ${i + 1}`}
                      disabled={disabled || segments.length === 1}
                      onClick={() => onChange({ segments: segments.filter((_, j) => j !== i) })}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                {seg.sentences ? (
                  <div className="field-pair">
                    <label className="field">
                      First sentence
                      <input
                        type="number"
                        min={0}
                        aria-label={`Segment ${i + 1} first sentence`}
                        value={seg.sentences[0]}
                        disabled={disabled}
                        onChange={(e) =>
                          onChange({
                            segments: segments.map((s, j) =>
                              j === i
                                ? { src: s.src, sentences: [+e.target.value, s.sentences!.at(-1)!] }
                                : s,
                            ),
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      Last sentence
                      <input
                        type="number"
                        min={0}
                        aria-label={`Segment ${i + 1} last sentence`}
                        value={seg.sentences.at(-1)}
                        disabled={disabled}
                        onChange={(e) =>
                          onChange({
                            segments: segments.map((s, j) =>
                              j === i
                                ? { src: s.src, sentences: [s.sentences![0], +e.target.value] }
                                : s,
                            ),
                          })
                        }
                      />
                    </label>
                  </div>
                ) : (
                  <div className="field-pair">
                    {(['s', 'e'] as const).map((k) => (
                      <label className="field" key={k}>
                        {k === 's' ? 'Start (s)' : 'End (s)'}
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          disabled={disabled}
                          value={seg[k]}
                          aria-label={`Segment ${i + 1} ${k === 's' ? 'start' : 'end'}`}
                          onChange={(e) =>
                            onChange({
                              segments: segments.map((s, j) =>
                                j === i ? { ...s, [k]: +e.target.value } : s,
                              ),
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <details className="caption-editor">
              <summary>
                Add from the transcript <Plus size={14} />
              </summary>
              {Object.entries(project.transcripts).flatMap(([src, tr]) =>
                tr.sentences.map((s) => (
                  <button
                    className="sentence-pick"
                    key={`${src}:${s.id}`}
                    disabled={disabled}
                    onClick={() =>
                      onChange({ segments: [...segments, { src, sentences: [s.id, s.id] }] })
                    }
                  >
                    <span>
                      {src} · {time(s.s)}
                    </span>
                    {s.text}
                    <Plus size={12} />
                  </button>
                )),
              )}
            </details>
          </>
        )}
        {tab === 'audio' && (
          <>
            <div className="inspector-callout">
              <AudioLines size={20} />
              <p>
                The GIF is silent. Audition your source and music here, then review the final mix
                after rendering.
              </p>
            </div>
            {project.music_url ? (
              <>
                <h3>Background music</h3>
                <Toggle
                  label="Music enabled"
                  checked={!edit.music?.muted}
                  disabled={disabled}
                  onChange={(enabled) => onChange({ editing: { music: { muted: !enabled } } })}
                />
                <Slider
                  label="Music level"
                  min={-60}
                  max={0}
                  value={edit.music?.gain_db ?? -18}
                  suffix=" dB"
                  disabled={disabled}
                  onChange={(gain_db) => onChange({ editing: { music: { gain_db } } })}
                />
                <audio className="music-audition" controls src={project.music_url} preload="none" />
                <p className="field-hint">
                  Source playback is an audition. Voice ducking and loudness are applied in the
                  final render.
                </p>
              </>
            ) : (
              <p className="empty-note">
                No background music yet. Add a track to audition it against your footage.
              </p>
            )}
            <label
              className={`button secondary full music-upload ${disabled ? 'is-disabled' : ''}`}
            >
              <Plus size={14} />
              {project.music_url ? 'Replace music' : 'Add background music'}
              <input
                type="file"
                aria-label="Upload background music"
                accept="audio/*"
                disabled={disabled}
                onChange={(e) => {
                  if (e.target.files?.[0]) p.onMusic(e.target.files[0]);
                  e.target.value = '';
                }}
              />
            </label>
            <p className="field-hint music-scope">
              The track belongs to this project. Volume and mute controls apply only to this reel.
            </p>
            <div className="divider" />
            <h3>Sound effects</h3>
            <Toggle
              label="Sound effects enabled"
              checked={!edit.sfx?.muted}
              disabled={disabled}
              onChange={(enabled) => onChange({ editing: { sfx: { muted: !enabled } } })}
            />
            <Slider
              label="Effects level"
              min={-60}
              max={0}
              value={edit.sfx?.gain_db ?? -10}
              suffix=" dB"
              disabled={disabled}
              onChange={(gain_db) => onChange({ editing: { sfx: { gain_db } } })}
            />
            <p className="field-hint">
              Effects follow the reference style. Enabling them does not add effect occasions when
              the reference has none.
            </p>
          </>
        )}
        {tab === 'ask' && (
          <>
            <div className="ask-heading">
              <Sparkles size={23} />
              <h3>Say it your way.</h3>
              <p>Describe a change. Review the suggestion, then apply it to this reel.</p>
            </div>
            <label className="sr-only" htmlFor="instruction">
              Edit instruction
            </label>
            <textarea
              id="instruction"
              className="instruction-input"
              rows={5}
              disabled={disabled || asking}
              maxLength={4000}
              placeholder={'“Yellow captions, zoom to 1.2 and mute music.”'}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            />
            <button
              className="button dark full"
              disabled={disabled || asking || !instruction.trim()}
              onClick={() => void ask()}
            >
              {asking ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}Suggest
              changes
            </button>
            <p className="field-hint">
              {p.config?.ai_enabled
                ? 'AI suggestions are enabled. Nothing changes until you apply.'
                : 'Quick instructions work locally. Broader requests need an optional AI provider configured on the server.'}
            </p>
            {proposal && (
              <div className="proposal">
                <span className="eyebrow">PROPOSED EDIT</span>
                <ul>
                  {controlSummary(proposal.changes).map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
                <p>{proposal.explanation}</p>
                <button
                  className="button orange full"
                  disabled={disabled || project.generation !== proposal.generation}
                  onClick={() => {
                    p.onProposal(proposal.changes);
                    setProposal(null);
                  }}
                >
                  <Check size={15} />
                  Use these changes
                </button>
              </div>
            )}
            <div className="divider" />
            <span className="eyebrow">TRY A QUICK EDIT</span>
            <div className="prompt-chips">
              {['White captions at the bottom', 'Zoom to 1.15', 'Mute music', 'Font size 64'].map(
                (x) => (
                  <button key={x} disabled={disabled} onClick={() => setInstruction(x)}>
                    {x}
                  </button>
                ),
              )}
            </div>
          </>
        )}
      </div>
      <div className={`inspector-footer ${dirty ? 'dirty' : ''}`}>
        <p>
          <span className="live-dot" />
          {dirty
            ? 'Changes stay local until you update.'
            : 'Your storyboard is the source of truth.'}
        </p>
        <button className="button dark full" disabled={disabled || !dirty} onClick={p.onApply}>
          <Sparkles size={15} />
          Update storyboard
        </button>
        {dirty && (
          <button className="text-button discard" disabled={disabled} onClick={p.onDiscard}>
            Discard changes
          </button>
        )}
      </div>
    </aside>
  );
}
