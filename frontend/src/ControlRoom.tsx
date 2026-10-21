import { useEffect, useRef, useState } from 'react';
import {
  Copy,
  Palette,
  Scissors,
  Type,
  Undo2,
  MessageSquare,
  ArrowRight,
  Loader2,
  Check,
  SlidersHorizontal,
} from 'lucide-react';
import type { Changes, ControlArea, ControlPreview, ControlRequest, Project, Reel } from './types';
import { api } from './api';
import PresetLibrary from './PresetLibrary';
type Props = {
  project: Project;
  reel: Reel;
  disabled: boolean;
  dirty: boolean;
  onAction: (action: string, body: Record<string, unknown>) => Promise<void>;
  onOpen: (tab: string) => void;
};
const label: Record<ControlArea, string> = {
  colour: 'Colour tone',
  pacing: 'Cuts & pacing',
  captions: 'Captions',
  all: 'Entire reel',
};
function description(c: Changes): string[] {
  const rows: string[] = [];
  if (c.editing?.colour)
    rows.push(
      `Tone strength ${Math.round(c.editing.colour.strength * 100)}% · saturation ${c.editing.colour.saturation.toFixed(2)}×`,
    );
  if (c.editing?.captions) {
    const s = c.editing.captions.style;
    rows.push(
      c.editing.captions.enabled === false
        ? 'Hide captions'
        : s
          ? `Captions: ${s.font || 'current font'}${s.size ? `, ${s.size}px` : ''}${s.fill ? `, ${s.fill}` : ''}${s.box?.color ? ', with a background box' : ''}`
          : 'Show captions',
    );
  }
  if (c.editing?.crop) rows.push(`Framing: zoom ${c.editing.crop.zoom ?? 'unchanged'}×`);
  if (c.editing?.music)
    rows.push(
      c.editing.music.muted
        ? 'Mute background music'
        : `Music ${c.editing.music.gain_db ?? 'current'} dB`,
    );
  if (c.title_text !== undefined) rows.push(`Opening title: ${c.title_text || 'removed'}`);
  if (c.cta !== undefined) rows.push(`Closing text: ${c.cta || 'removed'}`);
  if (c.caption_text) rows.push(`${Object.keys(c.caption_text).length} caption corrections`);
  return rows;
}
export default function ControlRoom({ project, reel, disabled, dirty, onAction, onOpen }: Props) {
  const proposalRef = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState(reel.id),
    [area, setArea] = useState<ControlArea>('all'),
    [text, setText] = useState('');
  const [strength, setStrength] = useState(100),
    [seconds, setSeconds] = useState(
      reel.editing?.pacing?.target || project.reference?.caption_analysis?.pacing?.median_shot || 1,
    ),
    [reframes, setReframes] = useState(true);
  const [preview, setPreview] = useState<ControlPreview | null>(null),
    [pending, setPending] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  useEffect(() => {
    setTarget(reel.id);
    setPreview(null);
    setError('');
    setNotice('');
    setSeconds(
      reel.editing?.pacing?.target || project.reference?.caption_analysis?.pacing?.median_shot || 1,
    );
  }, [reel.id]);
  const a = project.reference?.caption_analysis,
    busy = disabled || !!pending;
  useEffect(() => {
    if (preview) {
      proposalRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      proposalRef.current?.focus({ preventScroll: true });
    }
  }, [preview]);
  async function analyze(kind: 'reference-pacing' | 'reference-colour') {
    setPending(kind);
    setError('');
    setNotice(
      kind === 'reference-colour'
        ? 'Measuring and applying reference tone to the selected footage…'
        : 'Measuring reference shot changes, then rebuilding the cut preview…',
    );
    try {
      await onAction(kind, {
        generation: project.generation,
        revision: project.revision,
        reel_id: target,
        reframes,
        strength: strength / 100,
      });
    } catch (e) {
      setError((e as Error).message);
      setNotice('');
    } finally {
      setPending('');
    }
  }
  const action = (q: Omit<ControlRequest, 'reel_id'>): ControlRequest => ({
    ...q,
    reel_id: target,
  });
  async function apply(request: ControlRequest, expected?: ControlPreview) {
    setPending(request.area);
    setError('');
    setNotice('');
    try {
      await onAction('control-apply', {
        request,
        generation: expected?.generation ?? project.generation,
        revision: expected?.revision ?? project.revision,
      });
      setPreview(null);
      setNotice(
        `${label[request.area]} edit saved for ${target === 'all' ? 'all reels' : target.toUpperCase()}. Review the new storyboard and GIF.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending('');
    }
  }
  async function previewRequest(request: ControlRequest) {
    setPending(request.action);
    setError('');
    setNotice('');
    setPreview(null);
    try {
      setPreview(
        await api<ControlPreview>(`/projects/${project.id}/control-preview`, 'POST', {
          generation: project.generation,
          revision: project.revision,
          request,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending('');
    }
  }
  async function prompt() {
    if (text.trim()) await previewRequest(action({ area, action: 'prompt', text }));
  }
  function writeInstruction(next: ControlArea, value: string) {
    setArea(next);
    setText(value);
    setPreview(null);
    requestAnimationFrame(() => {
      const box = document.getElementById('control-instruction');
      box?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      box?.focus({ preventScroll: true });
    });
  }
  const stale =
    preview && (preview.generation !== project.generation || preview.revision !== project.revision);
  return (
    <section className="control-room" aria-label="Editing control room">
      <div className="control-room-heading">
        <div>
          <span className="eyebrow">YOU DIRECT THE EDIT</span>
          <h2>The control room</h2>
          <p>Captions copy by default. Copy colour tone and cut rhythm when you choose.</p>
        </div>
        <label className="field">
          Apply to
          <select
            aria-label="Control room target"
            value={target}
            disabled={busy}
            onChange={(e) => {
              setTarget(e.target.value);
              setPreview(null);
              setNotice('');
            }}
          >
            {project.reels.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title || r.id} · {r.id.toUpperCase()}
              </option>
            ))}
            <option value="all">All {project.reels.length} reels</option>
          </select>
        </label>
      </div>
      <div className="control-feedback" aria-live="polite">
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {(project.busy || pending) && (
          <p role="status" className="control-notice">
            <Loader2 size={14} className="spin" />{' '}
            {project.browserProgress || 'Preparing the edit…'}
          </p>
        )}
        {!project.busy && notice && (
          <p role="status" className="control-notice">
            {notice}{' '}
            <button
              className="text-button"
              onClick={() =>
                document
                  .querySelector('[aria-label="Video preview"]')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            >
              Review result
            </button>
          </p>
        )}
      </div>
      <div className="control-room-cards">
        <article className="control-card" aria-label="Caption copy controls">
          <Type size={22} />
          <h3>Caption style</h3>
          <p>
            {a?.style
              ? `${a.style.font || 'Measured font'} · ${a.style.size}px · ${a.style.box?.color ? 'boxed' : 'unboxed'}`
              : 'Add a captioned reference to copy its appearance.'}
          </p>
          <small>Font, size, colour, outline and placement. Your footage supplies the words.</small>
          <button
            className="button dark full"
            disabled={busy || a?.status !== 'detected'}
            onClick={() => void apply(action({ area: 'captions', action: 'copy' }))}
          >
            <Copy size={15} />
            Copy caption style
          </button>
          <button
            className="text-button"
            onClick={() => {
              writeInstruction('captions', 'Make captions bigger and move them to the bottom');
            }}
          >
            Write a caption instruction <ArrowRight size={13} />
          </button>
        </article>
        <article className="control-card" aria-label="Colour copy controls">
          <Palette size={22} />
          <h3>Colour tone</h3>
          <p>
            {reel.editing?.colour?.strength
              ? 'Tone correction active on this reel'
              : 'Original colour on this reel'}
          </p>
          <label className="slider-field">
            <span>
              Copy strength <output>{strength}%</output>
            </span>
            <input
              aria-label="Tone copy strength"
              type="range"
              min={0}
              max={100}
              step={5}
              disabled={busy}
              value={strength}
              onChange={(e) => setStrength(+e.target.value)}
            />
          </label>
          <small>
            {project.reference?.matched_colour
              ? 'Measured reference tone is ready to copy.'
              : 'Choose a reference to measure its tone.'}
          </small>
          {project.reference?.colour_report && (
            <p role="status" className="control-notice">
              {project.reference.colour_report}
            </p>
          )}
          {reel.tone_preview && (
            <div className="tone-comparison" aria-label="Tone before and after">
              <figure>
                <img src={reel.tone_preview.before} alt="Original colour preview" />
                <figcaption>Original</figcaption>
              </figure>
              <figure>
                <img src={reel.tone_preview.after} alt="Applied colour preview" />
                <figcaption>
                  {reel.editing?.colour?.strength ? 'Applied tone' : 'Original tone'}
                </figcaption>
              </figure>
            </div>
          )}
          <button
            className="button dark full"
            disabled={busy || !project.reference}
            onClick={() => void analyze('reference-colour')}
          >
            <Copy size={15} />
            Copy colour tone
          </button>
          <div className="control-card-links">
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void apply(action({ area: 'colour', action: 'reset' }))}
            >
              Reset tone
            </button>
            <button
              className="text-button"
              onClick={() => {
                writeInstruction('colour', 'Make it warmer and less saturated');
              }}
            >
              Write tone instruction
            </button>
          </div>
        </article>
        <article className="control-card" aria-label="Cut and pacing controls">
          <Scissors size={22} />
          <h3>Cuts & pacing</h3>
          <p>
            {a?.pacing?.confidence === 'measured'
              ? `${a.pacing.cuts.length} reference cuts in ${(a.pacing.window_seconds || a.window_seconds)?.toFixed(1)}s`
              : 'No clear reference cuts detected'}{' '}
            · {reel.segments.length} current shots
          </p>
          <small>
            {a?.pacing?.confidence === 'measured'
              ? `Cut times: ${a.pacing.cuts
                  .slice(0, 10)
                  .map((t) => t.toFixed(2) + 's')
                  .join(', ')}${a.pacing.cuts.length > 10 ? '…' : ''}`
              : 'Copy checks up to 30 seconds for scene changes and subtle jump cuts. If none are found, timing is kept.'}
          </small>
          {project.reference?.pacing_report && (
            <p role="status" className="control-notice">
              {project.reference.pacing_report}
            </p>
          )}
          <div className="control-shot-field">
            <label className="field">
              Shot length (seconds)
              <input
                aria-label="Control room shot length"
                type="number"
                min={0.35}
                max={5}
                step={0.05}
                value={seconds}
                disabled={busy}
                onChange={(e) => setSeconds(+e.target.value)}
              />
            </label>
            <button
              className="button secondary"
              disabled={busy || !Number.isFinite(seconds) || seconds < 0.35 || seconds > 5}
              onClick={() =>
                void apply(action({ area: 'pacing', action: 'settings', seconds, reframes }))
              }
            >
              Set pace
            </button>
          </div>
          <label className="control-check">
            <input
              type="checkbox"
              aria-label="Alternate reframing at cuts"
              checked={reframes}
              disabled={busy}
              onChange={(e) => setReframes(e.target.checked)}
            />
            Alternate reframing at cuts
          </label>
          <button
            className="button dark full"
            disabled={busy || !project.reference}
            onClick={() => void analyze('reference-pacing')}
          >
            <Copy size={15} />
            Copy cuts & pacing
          </button>
          <div className="control-card-links">
            <button
              className="text-button"
              disabled={
                busy ||
                (target === 'all'
                  ? !project.reels.some(
                      (r) =>
                        r.control_baseline_segments || r.editing?.pacing || r.segments.length > 1,
                    )
                  : !project.reels.some(
                      (r) =>
                        r.id === target &&
                        (r.control_baseline_segments || r.editing?.pacing || r.segments.length > 1),
                    ))
              }
              onClick={() => void apply(action({ area: 'pacing', action: 'reset' }))}
            >
              Reset cuts
            </button>
            <button
              className="text-button"
              onClick={() => {
                writeInstruction('pacing', 'Cuts every 1 second');
              }}
            >
              Write pacing instruction
            </button>
          </div>
        </article>
      </div>
      <PresetLibrary
        project={project}
        reelId={reel.id}
        disabled={busy}
        dirty={dirty}
        onPreview={(preset_id, area) =>
          previewRequest(action({ area, action: 'preset', preset_id }))
        }
      />
      <form
        className="control-prompt"
        onSubmit={(e) => {
          e.preventDefault();
          void prompt();
        }}
      >
        <div>
          <MessageSquare size={18} />
          <strong>Direct the edit in your own words</strong>
          <span>Free local commands · preview first</span>
        </div>
        <label className="field">
          Editing area
          <select
            aria-label="Control room editing area"
            value={area}
            disabled={busy}
            onChange={(e) => {
              setArea(e.target.value as ControlArea);
              setPreview(null);
            }}
          >
            {Object.entries(label).map(([key, value]) => (
              <option key={key} value={key}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="field control-prompt-text">
          Your instruction
          <textarea
            id="control-instruction"
            aria-label="Control room instruction"
            placeholder="Warmer and less saturated, cuts every 1 second, or bigger captions…"
            rows={2}
            maxLength={2000}
            value={text}
            disabled={busy}
            onChange={(e) => {
              setText(e.target.value);
              setPreview(null);
            }}
          />
        </label>
        <button className="button orange" type="submit" disabled={busy || !text.trim()}>
          {pending === 'prompt' ? (
            <Loader2 size={16} className="spin" />
          ) : (
            <SlidersHorizontal size={16} />
          )}
          Preview instruction
        </button>
      </form>
      {preview && (
        <div
          ref={proposalRef}
          tabIndex={-1}
          className="control-proposal"
          aria-label="Control room proposal"
        >
          <strong>
            {stale ? 'This edit changed — preview your instruction again' : 'Proposed edit'}
          </strong>
          <p>{preview.explanation}</p>
          {preview.reels.map((r) => (
            <div key={r.id}>
              <b>{r.id.toUpperCase()}</b> · {r.shots} shots · {r.before.toFixed(2)}s →{' '}
              {r.after.toFixed(2)}s
              {description(r.changes).map((s) => (
                <p key={s}>{s}</p>
              ))}
            </div>
          ))}
          <button
            className="button orange"
            disabled={busy || !!stale || !preview.reels.some((r) => Object.keys(r.changes).length)}
            onClick={() => void apply(preview.request, preview)}
          >
            <Check size={15} />
            {preview.request.action === 'preset' ? 'Apply preset' : 'Apply instruction'}
          </button>
          <button className="text-button" onClick={() => setPreview(null)}>
            Discard proposal
          </button>
        </div>
      )}
      {dirty && (
        <p className="field-hint">
          Update or discard the pending inspector changes to use the control room.
        </p>
      )}
      {project.terminal && (
        <p className="field-hint">Duplicate this completed project to make another edit.</p>
      )}
      <div className="control-room-footer">
        <p>
          Copy actions rebuild sampled previews. Full rendering still requires storyboard approval.
        </p>
        <div>
          {[
            ['captions', 'Caption details'],
            ['framing', 'Framing & motion'],
            ['audio', 'Audio'],
            ['ask', 'Editing chat'],
          ].map(([tab, name]) => (
            <button className="text-button" key={tab} onClick={() => onOpen(tab)}>
              {name}
            </button>
          ))}
          <button
            className="button secondary"
            disabled={busy}
            onClick={async () => {
              setPending('undo');
              setError('');
              try {
                await onAction('undo', {
                  generation: project.generation,
                  revision: project.revision,
                });
                setPreview(null);
                setNotice('Previous edit restored. Review the new storyboard.');
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setPending('');
              }
            }}
          >
            <Undo2 size={14} />
            Undo last change
          </button>
        </div>
      </div>
    </section>
  );
}
