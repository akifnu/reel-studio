import { useEffect, useRef, useState } from 'react';
import { api, waitTask } from './api';
import type { Project } from './types';
import { all, asset, blobURL, get, put } from './browser/store';
import { rhythmCuts, scopedChanges } from './browser/controlRoom';
import type { Changes, ControlArea } from './types';
import { loadVideo, releaseVideo, seek } from './browser/compositor';
import { analyzePacing, averageLooks, matchColour, sourceLook } from './browser/referenceLook';
type Frame = {
  role: 'reference' | 'source' | 'storyboard';
  source?: string;
  t: number;
  image: string;
};
type SavedStyle = {
  kind: 'agent-style';
  id: string;
  name: string;
  description: string;
  editing: Project['reels'][number]['editing'];
  preview: string;
  created: number;
};
type Command = { id: string; tool: string; generation: number; args: Record<string, any> };
type Props = { project: Project; dirty: boolean; onChanged: () => Promise<void> };
export default function ChatGPTConnection({ project, dirty, onChanged }: Props) {
  const [key, setKey] = useState(() => localStorage.getItem('reel-chatgpt:' + project.id) || '');
  const [connected, setConnected] = useState(false),
    [status, setStatus] = useState(''),
    [error, setError] = useState('');
  const [approved, setApproved] = useState<number | null>(null),
    [working, setWorking] = useState(false);
  const [styles, setStyles] = useState<SavedStyle[]>([]);
  const boardKey = useRef('');
  async function loadStyles() {
    const found = (await all<SavedStyle>('undo')).filter((s) => s?.kind === 'agent-style');
    setStyles(found);
    return found;
  }
  async function downloadStyle(style: SavedStyle) {
    const { zipSync, strToU8 } = await import('fflate');
    const name =
      style.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'approved-reel-style';
    const instructions = `---\nname: ${name}\ndescription: ${JSON.stringify(style.description || 'Reuse this approved reel appearance.')}\n---\n\n# ${style.name}\n\nUse style.json as the visual recipe for new raw footage. Inspect preview.jpg before matching captions, tone and rhythm. Keep dialogue and source selections from the new footage. Request a storyboard and GIF before full rendering. Use the original font file if that face is unavailable on the new device.\n`;
    const files: Record<string, Uint8Array> = {
      'SKILL.md': strToU8(instructions),
      'style.json': strToU8(
        JSON.stringify(
          { version: 1, name: style.name, description: style.description, editing: style.editing },
          null,
          2,
        ),
      ),
    };
    if (style.preview)
      files['preview.jpg'] = Uint8Array.from(atob(style.preview.split(',')[1]), (c) =>
        c.charCodeAt(0),
      );
    const zip = Uint8Array.from(zipSync(files)),
      url = URL.createObjectURL(new Blob([zip.buffer], { type: 'application/zip' })),
      link = document.createElement('a');
    link.href = url;
    link.download = name + '-skill.zip';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  useEffect(() => {
    void loadStyles();
  }, []);
  async function dataImage(url: string) {
    const blob = await (await fetch(url)).blob();
    return new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('Preview could not be read.'));
      r.readAsDataURL(blob);
    });
  }
  const latest = useRef(project),
    frames = useRef<Frame[]>([]),
    approvedBoard = useRef<{ generation: number; sha: string } | null>(null),
    processing = useRef(false),
    last = useRef(''),
    alive = useRef(true),
    dirtyRef = useRef(dirty);
  latest.current = project;
  dirtyRef.current = dirty;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (approvedBoard.current?.generation !== project.generation) {
      approvedBoard.current = null;
      setApproved(null);
    }
  }, [project.generation]);
  async function request(connection: string, body?: unknown) {
    const response = await fetch('/api/bridge', {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: 'Bearer ' + connection,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error('The ChatGPT tool connection is not available on this version of the Site.');
    }
    if (!response.ok) throw new Error(result.error || 'ChatGPT connection failed.');
    return result;
  }
  async function snapshot(connection: string, p = latest.current) {
    const board = p.reels.flatMap((r) => r.frames.map((f) => ({ ...f, source: r.id }))),
      cache = JSON.stringify(board.map((f) => f.url));
    if (p.browserReady && !p.busy && board.length && cache !== boardKey.current) {
      const evidence: Frame[] = [];
      for (const frame of board) {
        evidence.push({
          role: 'storyboard',
          source: frame.source,
          t: frame.t,
          image: await dataImage(frame.url),
        });
      }
      frames.current = [
        ...frames.current.filter((f) => f.role !== 'storyboard'),
        ...evidence,
      ].slice(-48);
      boardKey.current = cache;
    }
    await request(connection, {
      action: 'snapshot',
      snapshot: {
        project_id: p.id,
        name: p.name,
        request: p.story_notes || '',
        generation: p.generation,
        revision: p.revision,
        status: p.status,
        terminal: p.terminal,
        storyboard_ready: !!p.browserReady,
        busy: p.busy || processing.current,
        approved_generation:
          approvedBoard.current?.generation === p.generation
            ? approvedBoard.current.generation
            : null,
        instructions:
          'ChatGPT/Codex is the editing agent. Inspect actual reference and raw frames, choose explicit cuts and caption settings, then build a storyboard/GIF. The open browser executes tools. Full FFmpeg rendering requires approval of this current storyboard in the browser. Do not invent observations or describe numerical measurements as an autonomous agent.',
        reference: p.reference
          ? {
              name: p.reference.name,
              analysis: p.reference.caption_analysis
                ? { ...p.reference.caption_analysis, preview: undefined }
                : undefined,
            }
          : null,
        sources: Object.fromEntries(
          Object.entries(p.sources).map(([id, s]) => [
            id,
            { name: s.name, duration: s.duration, width: s.width, height: s.height },
          ]),
        ),
        reels: p.reels.map((r) => ({
          id: r.id,
          duration: r.duration,
          segments: r.segments,
          editing: r.editing,
          speech: r.speech,
          frames: r.frames.map((f) => ({ t: f.t })),
          render_status: r.render.status,
        })),
        transcript: Object.fromEntries(
          Object.entries(p.transcripts).map(([id, t]) => [
            id,
            {
              timing: t.timing,
              sentences: t.sentences.map((s) => ({ s: s.s, e: s.e, text: s.text })),
            },
          ]),
        ),
        frames: frames.current,
      },
    });
  }
  async function sample(p: Project, role: 'reference' | 'source', source = 'A', times?: number[]) {
    if (!['reference', 'source'].includes(role))
      throw new Error('Choose reference or source frames.');
    const id = role === 'reference' ? p.reference?.id : p.sources[source]?.id;
    if (!id) throw new Error('That media input is not available.');
    const a = await asset(id),
      v = await loadVideo(await blobURL(a.id, a.blob));
    try {
      const wanted =
        times ||
        Array.from(
          { length: 6 },
          (_, i) => ((i + 0.5) / 6) * (role === 'reference' ? Math.min(5, v.duration) : v.duration),
        );
      if (wanted.length > 24 || wanted.some((t) => !Number.isFinite(t) || t < 0 || t >= v.duration))
        throw new Error('Choose at most 24 timestamps inside the video.');
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(360, v.videoWidth);
      canvas.height = Math.round((canvas.width * v.videoHeight) / v.videoWidth);
      const ctx = canvas.getContext('2d')!;
      const found: Frame[] = [];
      for (const t of wanted) {
        if (!alive.current) throw new Error('Connection closed.');
        await seek(v, t);
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        found.push({
          role,
          ...(role === 'source' ? { source } : {}),
          t,
          image: canvas.toDataURL('image/jpeg', 0.65),
        });
      }
      frames.current = [
        ...frames.current.filter(
          (f) => !(f.role === role && (role === 'reference' || f.source === source)),
        ),
        ...found,
      ].slice(-48);
      return { role, source, frames: found.map(({ image, ...f }) => f) };
    } finally {
      releaseVideo(v);
    }
  }
  async function connect() {
    setWorking(true);
    setError('');
    setStatus('Preparing a few real frames for ChatGPT…');
    try {
      const connection =
        key ||
        Array.from(crypto.getRandomValues(new Uint8Array(32)), (v) =>
          v.toString(16).padStart(2, '0'),
        ).join('');
      if (project.reference) await sample(project, 'reference');
      for (const source of Object.keys(project.sources)) await sample(project, 'source', source);
      await snapshot(connection);
      localStorage.setItem('reel-chatgpt:' + project.id, connection);
      setKey(connection);
      setConnected(true);
      setStatus(
        'Connected. Copy the prompt below into ChatGPT with the Reel Studio plugin enabled. Keep this tab open.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  async function perform(command: Command, connection: string) {
    const p = await api<Project>(`/projects/${latest.current.id}`);
    if (command.generation !== p.generation)
      throw new Error(
        'The edit changed after this command was queued. Read the context and try again.',
      );
    if (
      p.busy ||
      dirtyRef.current ||
      (p.terminal &&
        !['sample_frames', 'measure_reference', 'save_style', 'list_styles'].includes(command.tool))
    )
      throw new Error(
        'Finish processing or update/discard pending manual edits before running an agent tool. Duplicate a finished project to edit it.',
      );
    const a = command.args || {};
    if (command.tool === 'list_styles')
      return { styles: (await loadStyles()).map(({ preview, ...s }) => s) };
    if (command.tool === 'save_style') {
      if (!p.terminal)
        throw new Error('Accept the finished render in the browser before saving its style.');
      if (typeof a.name !== 'string' || !a.name.trim() || a.name.length > 80)
        throw new Error('Give the style a name under 80 characters.');
      const reel = p.reels.find((r) => r.id === a.reel_id) || p.reels[0],
        id = 'agent-style-' + crypto.randomUUID();
      const editing = structuredClone(reel.editing || {});
      editing.captions = {
        ...editing.captions,
        style: { ...reel.effective_style.captions?.style, ...editing.captions?.style },
      };
      const style: SavedStyle = {
        kind: 'agent-style',
        id,
        name: a.name.trim(),
        description: String(a.description || '').slice(0, 2000),
        editing,
        preview: reel.frames[0] ? await dataImage(reel.frames[0].url) : '',
        created: Date.now(),
      };
      await put('undo', id, style);
      await loadStyles();
      return {
        id,
        name: style.name,
        editing,
        description: style.description,
        message:
          'Approved look saved with a visual preview. It is available across projects in this browser.',
      };
    }
    if (command.tool === 'sample_frames') return sample(p, a.role, a.source || 'A', a.times);
    if (command.tool === 'measure_reference') {
      if (!p.reference) throw new Error('Upload a style reference first.');
      const reference = await asset(p.reference.id),
        v = await loadVideo(await blobURL(reference.id, reference.blob));
      try {
        const { analyzeBoxedReference } = await import('./browser/referenceStyle');
        const analysis = reference.caption_analysis || (await analyzeBoxedReference(v));
        analysis.pacing = await analyzePacing(v);
        reference.caption_analysis = analysis;
        await put('assets', reference.id, reference);
        const looks = [];
        for (const s of Object.values(p.sources)) {
          const raw = await asset(s.id),
            video = await loadVideo(await blobURL(raw.id, raw.blob));
          try {
            looks.push(await sourceLook(video));
          } finally {
            releaseVideo(video);
          }
        }
        return {
          ...analysis,
          preview: undefined,
          suggested_colour: analysis.look ? matchColour(averageLooks(looks), analysis.look) : null,
          note: 'These are measurements for the agent to review against actual frames. No colour, cut, or caption edit was applied by this tool.',
        };
      } finally {
        releaseVideo(v);
      }
    }
    let result: { task_id?: string };
    if (command.tool === 'apply_style') {
      const style = await get<SavedStyle>('undo', String(a.style_id));
      if (style?.kind !== 'agent-style')
        throw new Error('Choose an approved style from list_styles.');
      const reel = p.reels.find((r) => r.id === a.reel_id);
      if (!reel) throw new Error('Choose a destination reel.');
      const area = a.area || 'all';
      if (!['all', 'captions', 'colour', 'pacing'].includes(area))
        throw new Error('Choose captions, colour, pacing, or all.');
      const changes: Changes = { editing: structuredClone(style.editing) };
      if (style.editing?.pacing)
        changes.segments = rhythmCuts(
          p,
          reel,
          style.editing.pacing.pattern?.length
            ? style.editing.pacing.pattern
            : [style.editing.pacing.target],
        );
      result = await api(`/projects/${p.id}/reels/${reel.id}`, 'PATCH', {
        generation: p.generation,
        revision: p.revision,
        changes: scopedChanges(changes, area as ControlArea),
      });
      approvedBoard.current = null;
      setApproved(null);
    } else if (command.tool === 'apply_edit') {
      if (
        typeof a.reel_id !== 'string' ||
        !a.changes ||
        typeof a.changes !== 'object' ||
        Array.isArray(a.changes)
      )
        throw new Error('Provide a reel ID and an explicit Changes object.');
      const allowed = [
        'title',
        'title_text',
        'cta',
        'caption_text',
        'emphasis',
        'segments',
        'editing',
      ];
      if (Object.keys(a.changes).some((k) => !allowed.includes(k)))
        throw new Error('The edit includes an unsupported field.');
      result = await api(`/projects/${p.id}/reels/${a.reel_id}`, 'PATCH', {
        generation: p.generation,
        revision: p.revision,
        changes: a.changes,
      });
      approvedBoard.current = null;
      setApproved(null);
    } else if (command.tool === 'ffmpeg_render') {
      const approval = approvedBoard.current;
      if (
        !approval ||
        approval.generation !== p.generation ||
        approval.sha !== p.needs?.storyboard_sha256 ||
        p.needs?.step !== 'approve_storyboard'
      )
        throw new Error(
          'Approve the current storyboard in this browser before ChatGPT can run FFmpeg.',
        );
      approvedBoard.current = null;
      setApproved(null);
      await snapshot(connection, p);
      result = await api(`/projects/${p.id}/approve`, 'POST', {
        need_id: p.needs.need_id,
        revision: p.needs.revision,
        sha256: approval.sha,
      });
    } else if (command.tool === 'transcribe_selected')
      result = await api(`/projects/${p.id}/transcribe`, 'POST', {
        generation: p.generation,
        revision: p.revision,
      });
    else if (command.tool === 'build_storyboard')
      result = await api(`/projects/${p.id}/start`, 'POST');
    else throw new Error('Unknown media tool.');
    if (result.task_id) await waitTask(result.task_id);
    const updated = await api<Project>(`/projects/${p.id}`);
    await onChanged();
    await snapshot(connection, updated);
    return {
      project_id: p.id,
      generation: updated.generation,
      status: updated.status,
      reels: updated.reels.map((r) => ({
        id: r.id,
        duration: r.duration,
        segments: r.segments,
        editing: r.editing,
        render_status: r.render.status,
      })),
      message:
        command.tool === 'ffmpeg_render'
          ? 'FFmpeg finished. Review picture and audio in the browser before accepting and downloading.'
          : 'Tool finished. Review the storyboard and GIF; no full video was rendered.',
    };
  }
  useEffect(() => {
    if (!connected || !key) return;
    let stopped = false;
    const tick = async () => {
      if (stopped || processing.current) return;
      try {
        const { command } = await request(key);
        if (stopped || processing.current) return;
        if (!command || command.id === last.current) return;
        last.current = command.id;
        processing.current = true;
        setWorking(true);
        setStatus(`ChatGPT tool: ${command.tool}…`);
        setError('');
        try {
          const result = await perform(command, key);
          await request(key, { action: 'result', id: command.id, status: 'succeeded', result });
          setStatus(`${command.tool} finished. ChatGPT can read the result.`);
        } catch (e) {
          const message = (e as Error).message;
          await request(key, {
            action: 'result',
            id: command.id,
            status: 'failed',
            error: message,
          });
          setError(message);
        } finally {
          processing.current = false;
          setWorking(false);
          await snapshot(key, await api<Project>(`/projects/${latest.current.id}`));
        }
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
    };
    void tick();
    const poll = setInterval(() => void tick(), 2500),
      heartbeat = setInterval(() => {
        void snapshot(key).catch((e) => setError(e.message));
      }, 20000);
    return () => {
      stopped = true;
      clearInterval(poll);
      clearInterval(heartbeat);
    };
  }, [connected, key]);
  const prompt = `Use the Reel Studio plugin as my editing tools. Connection key: ${key}. Read the current context and actual reference/source frames first. Use Codex/ChatGPT to choose a coherent edit and copy the observed reference caption appearance. Show storyboard/GIF options before a full render; ask me to approve in the browser before calling ffmpeg_render. Save the approved look as a reusable style recipe. Do not build another editor or use a paid model API.`;
  return (
    <section className="chatgpt-connection" aria-label="ChatGPT editing connection">
      <div>
        <span className="eyebrow">CHATGPT DIRECTS · YOUR BROWSER RUNS THE TOOLS</span>
        <h2>Edit with ChatGPT</h2>
        <p>
          Give the reference and raw footage to ChatGPT, review its storyboard here, then approve
          the render. This page does not run its own AI model.
        </p>
        <p>
          The current storyboard is a starting draft. ChatGPT makes editing decisions after you
          connect.
        </p>
      </div>
      <div className="chatgpt-connection-actions">
        <button
          className="button dark"
          disabled={working || project.busy || dirty}
          onClick={() => void connect()}
        >
          {connected ? 'Refresh shared frames' : 'Connect this project to ChatGPT'}
        </button>
        {connected && (
          <button
            className="button secondary"
            disabled={working}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(prompt);
                setStatus(
                  'Prompt copied. Paste it into ChatGPT with the Reel Studio plugin enabled.',
                );
              } catch {
                setStatus('Copy the prompt from the box below.');
              }
            }}
          >
            Copy ChatGPT prompt
          </button>
        )}
        {connected && (
          <button
            className="button orange"
            disabled={
              working ||
              project.busy ||
              dirty ||
              !project.browserReady ||
              project.needs?.step !== 'approve_storyboard'
            }
            onClick={async () => {
              if (!project.needs?.storyboard_sha256) return;
              approvedBoard.current = {
                generation: project.generation,
                sha: project.needs.storyboard_sha256,
              };
              setApproved(project.generation);
              await snapshot(key);
              setStatus(
                'Storyboard approved for one FFmpeg render. Tell ChatGPT to run ffmpeg_render.',
              );
            }}
          >
            Approve storyboard for ChatGPT
          </button>
        )}
        {connected && (
          <button
            className="text-button"
            disabled={working}
            onClick={async () => {
              try {
                await request(key, { action: 'disconnect' });
                setConnected(false);
                frames.current = [];
                approvedBoard.current = null;
                setApproved(null);
                setStatus('Disconnected. Shared frames and queued jobs were removed.');
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Disconnect
          </button>
        )}
      </div>
      {connected && (
        <label className="field">
          Paste this into ChatGPT with your Reel Studio plugin enabled
          <textarea aria-label="ChatGPT editing prompt" readOnly value={prompt} rows={4} />
        </label>
      )}
      {approved === project.generation && (
        <p className="control-notice">
          This storyboard is approved for one agent-initiated render. Any edit cancels that
          approval.
        </p>
      )}
      {status && (
        <p role="status" className="control-notice">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <details className="agent-style-menu">
        <summary>Saved style menu · {styles.length} approved looks</summary>
        {styles.length ? (
          <div>
            {styles.map((s) => (
              <article key={s.id}>
                {s.preview && <img src={s.preview} alt={s.name + ' approved preview'} />}
                <strong>{s.name}</strong>
                <p>{s.description}</p>
                <button
                  className="text-button"
                  onClick={() => void downloadStyle(s).catch((e) => setError(e.message))}
                >
                  Download style skill
                </button>
              </article>
            ))}
          </div>
        ) : (
          <p>
            After you accept a finished video, ask ChatGPT to save its look as a reusable style.
            This menu stores real approved results.
          </p>
        )}
      </details>
      <small>
        Connecting shares sampled frames, transcript and edit settings with this Site’s ChatGPT tool
        bridge. Raw video stays in this browser. Install/connect the Site’s plugin once in ChatGPT;
        a normal website tab cannot invoke your ChatGPT account by itself.
      </small>
    </section>
  );
}
