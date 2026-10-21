import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronDown,
  Clapperboard,
  Copy,
  Film,
  FolderOpen,
  History,
  Layers,
  Loader2,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Undo2,
  X,
  AlertCircle,
  Play,
  Clock3,
} from 'lucide-react';
import { api, ApiError, waitTask, upload } from './api';
import type { Changes, Config, Project, ProjectSummary, Reel } from './types';
import { merge, phase, time } from './utils';
import NewProject from './NewProject';
import ProjectInputs from './ProjectInputs';
import CapCutExport from './CapCutExport';
import Player from './Player';
import Inspector from './Inspector';
import { browserMode } from './features';

export default function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]),
    [project, setProject] = useState<Project | null>(null);
  const [active, setActive] = useState(
    new URLSearchParams(location.search).get('project') ||
      localStorage.getItem('studio:project') ||
      '',
  );
  const [rid, setRid] = useState(''),
    [patch, setPatch] = useState<Changes>({}),
    [patchGen, setPatchGen] = useState(0),
    [config, setConfig] = useState<Config | null>(null);
  const [newProject, setNewProject] = useState(false),
    [working, setWorking] = useState(false),
    [error, setError] = useState(''),
    [tab, setTab] = useState('captions');
  const [commentsOpen, setCommentsOpen] = useState(false),
    [comment, setComment] = useState(''),
    [currentTime, setCurrentTime] = useState(0),
    [seek, setSeek] = useState<{ t: number; key: number } | null>(null);
  const [login, setLogin] = useState(false),
    [accessKey, setAccessKey] = useState(''),
    [setup, setSetup] = useState(''),
    [activity, setActivity] = useState(false),
    [mobileNav, setMobileNav] = useState(false);
  const [notice, setNotice] = useState('');
  const activeRef = useRef(active);
  activeRef.current = active;
  const selected = project?.reels.find((r) => r.id === rid) || project?.reels[0];
  const dirty = Object.keys(patch).length > 0,
    conflicted = dirty && patchGen !== project?.generation;
  const disabled = working || !!project?.busy || !!project?.terminal || conflicted;

  const loadProjects = useCallback(async () => {
    const list = await api<ProjectSummary[]>('/projects');
    setProjects(list);
    if (browserMode && activeRef.current && !list.some((p) => p.id === activeRef.current)) {
      activeRef.current = list[0]?.id || '';
      setActive(activeRef.current);
      setError('');
    }
    if (!activeRef.current && list[0]) setActive(list[0].id);
  }, []);
  const refresh = useCallback(async () => {
    if (!activeRef.current) return;
    const data = await api<Project>(`/projects/${activeRef.current}`);
    if (data.id === activeRef.current) setProject(data);
  }, []);
  useEffect(() => {
    const fn = () => setLogin(true);
    window.addEventListener('studio:login', fn);
    void api<{ pipeline: boolean; setup_error: string | null }>('/health')
      .then((h) => {
        if (!h.pipeline) setSetup(h.setup_error || 'Connect your pipeline to get started.');
      })
      .catch((e) => setSetup(e.message));
    void api<Config>('/config')
      .then(setConfig)
      .catch((e) => {
        if (!(e instanceof ApiError && e.status === 401)) setSetup(e.message);
      });
    void loadProjects().catch((e) => {
      if (!(e instanceof ApiError && e.status === 401)) setError(e.message);
    });
    return () => window.removeEventListener('studio:login', fn);
  }, []);
  useEffect(() => {
    if (!active) return;
    setProject(null);
    setRid('');
    setPatch({});
    setSeek(null);
    localStorage.setItem('studio:project', active);
    history.replaceState(null, '', `?project=${encodeURIComponent(active)}`);
    void refresh().catch((e) => setError(e.message));
    const timer = setInterval(() => {
      void refresh().catch((e) => {
        if (!(e instanceof ApiError && e.status === 401)) setError(e.message);
      });
    }, 2000);
    return () => clearInterval(timer);
  }, [active]);
  useEffect(() => {
    const id = setInterval(() => {
      void loadProjects().catch(() => {});
    }, 6000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [dirty]);

  async function run(fn: () => Promise<unknown>) {
    setWorking(true);
    setError('');
    try {
      const result = (await fn()) as { task_id?: string } | undefined;
      if (result?.task_id && !browserMode) await waitTask(result.task_id);
      await Promise.all([refresh(), loadProjects()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  function change(value: Changes) {
    if (!project || disabled) return;
    if (!dirty) setPatchGen(project.generation);
    setPatch(
      (prev) => merge(prev as Record<string, unknown>, value as Record<string, unknown>) as Changes,
    );
  }
  function discard() {
    setPatch({});
    setPatchGen(0);
  }
  function selectProject(id: string) {
    if (dirty) {
      setError('Update or discard your changes before switching projects.');
      return;
    }
    setActive(id);
    setMobileNav(false);
  }
  function selectReel(r: Reel) {
    if (dirty) {
      setError('Update or discard your changes before switching reels.');
      return;
    }
    setRid(r.id);
    setSeek({ t: 0, key: Date.now() });
  }
  async function apply() {
    if (!project || !selected || !dirty) return;
    await run(async () => {
      const result = await api(`/projects/${project.id}/reels/${selected.id}`, 'PATCH', {
        generation: patchGen,
        revision: project.revision,
        changes: patch,
      });
      discard();
      return result;
    });
  }
  async function approve() {
    if (!project?.needs || dirty) return;
    const n = project.needs;
    await run(() =>
      api(`/projects/${project.id}/approve`, 'POST', {
        need_id: n.need_id,
        revision: n.revision,
        sha256: n.storyboard_sha256,
      }),
    );
  }
  async function addComment() {
    if (!project || !selected || !comment.trim()) return;
    await run(async () => {
      await api(`/projects/${project.id}/comments`, 'POST', {
        reel_id: selected.id,
        generation: project.generation,
        time: currentTime,
        text: comment,
      });
      setComment('');
    });
  }
  async function addMusic(file: File) {
    if (!project) return;
    if (dirty) {
      setError('Update or discard your local changes before replacing project music.');
      return;
    }
    try {
      await run(async () => {
        const record = await upload(file, 'music', (n) =>
          setNotice(`Uploading background music… ${n}%`),
        );
        setNotice('Updating the project music…');
        return api(`/projects/${project.id}/music`, 'POST', {
          upload_id: record.id,
          generation: project.generation,
          revision: project.revision,
        });
      });
    } finally {
      setNotice('');
    }
  }
  async function deleteLocalProject() {
    if (!project || !confirm('Delete this local project and its unused source files?')) return;
    setWorking(true);
    setError('');
    try {
      await api(`/projects/${project.id}/delete`, 'POST');
      activeRef.current = '';
      localStorage.removeItem('studio:project');
      setActive('');
      setProject(null);
      await loadProjects();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  async function acceptRenders() {
    if (!project?.needs) return;
    const n = project.needs;
    const assigned = n.assigned || [];
    const ready = assigned.filter((a) => ['pass', 'warn'].includes(a.qc_verdict));
    await run(() =>
      api(`/projects/${project.id}/review`, 'POST', {
        need_id: n.need_id,
        revision: n.revision,
        results: ready.map((a) => ({
          reel_id: a.id,
          render_sha256: a.render_sha256,
          decision: 'accept',
          findings: [],
        })),
      }),
    );
  }
  async function requestFix() {
    if (!project?.needs || !selected) return;
    const note =
      comment.trim() ||
      displayedComments
        .filter((c) => !c.resolved && c.generation === project.generation)
        .map((c) => `${time(c.time)}: ${c.text}`)
        .join('\n');
    if (!note) {
      setCommentsOpen(true);
      setError('Describe the change in a timestamped comment first.');
      return;
    }
    const n = project.needs;
    if (n.step === 'approve_storyboard')
      await run(() =>
        api(`/projects/${project.id}/revise`, 'POST', {
          need_id: n.need_id,
          revision: n.revision,
          sha256: n.storyboard_sha256,
          notes: `${selected.id} at ${time(currentTime)}: ${note}`,
        }),
      );
    if (n.step === 'review') {
      const a = n.assigned?.find((x) => x.id === selected.id);
      if (!a) {
        setError('This reel is not assigned for review.');
        return;
      }
      await run(() =>
        api(`/projects/${project.id}/review`, 'POST', {
          need_id: n.need_id,
          revision: n.revision,
          results: [
            {
              reel_id: a.id,
              render_sha256: a.render_sha256,
              decision: 'fix_required',
              findings: [
                {
                  code: 'USER_REVIEW',
                  severity: 'blocking',
                  what: `At ${time(currentTime)}: ${note}`,
                  how: note,
                },
              ],
            },
          ],
        }),
      );
    }
    setComment('');
  }
  const status = project ? phase(project.status) : 'Your edit, your call.';
  const ready = project?.needs?.step === 'approve_storyboard',
    renderReview = project?.needs?.step === 'review';
  const displayedComments = (project?.comments || []).filter(
    (c) => !selected || c.reel_id === selected.id,
  );

  return (
    <div className="app-shell">
      <style>
        {(browserMode ? [] : config?.fonts || [])
          .flatMap((font) =>
            [400, 700, 800].map(
              (weight) =>
                `@font-face{font-family:"${font}";font-style:normal;font-weight:${weight};font-display:swap;src:url("/api/fonts/${encodeURIComponent(font)}?weight=${weight}") format("truetype");}`,
            ),
          )
          .join('\n')}
      </style>
      <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
        <button
          className="icon-button mobile-nav-close"
          aria-label="Close projects"
          onClick={() => setMobileNav(false)}
        >
          <X size={18} />
        </button>
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            if (!dirty) {
              setActive('');
              setProject(null);
            }
          }}
        >
          <span className="brand-mark">
            <Clapperboard size={21} />
          </span>
          <span>
            reel<span className="brand-light">studio</span>
            <small>GOOD STORIES, WELL TOLD.</small>
          </span>
        </a>
        <button
          className="button dark full new-project"
          disabled={!!setup}
          onClick={() => setNewProject(true)}
        >
          <Plus size={16} />
          New project
        </button>
        <div className="nav-heading">
          YOUR WORKSPACE <span>{projects.length}</span>
        </div>
        <nav aria-label="Projects">
          {projects.map((p) => (
            <button
              className={`project-nav ${active === p.id ? 'active' : ''}`}
              key={p.id}
              onClick={() => selectProject(p.id)}
            >
              <span className="project-icon">
                <Film size={17} />
              </span>
              <span>
                {p.name}
                <small>{p.demo ? 'Demo project' : phase(p.status)}</small>
              </span>
              <span className={`project-dot ${p.status === 'succeeded' ? 'done' : ''}`} />
            </button>
          ))}
          {!projects.length && (
            <div className="nav-empty">
              <FolderOpen size={21} />
              <p>
                A little room for
                <br />
                your next big idea.
              </p>
            </div>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="approval-reminder">
            <ShieldCheck size={18} />
            <div>
              You're in control.
              <p>
                Every render starts with
                <br />
                your storyboard approval.
              </p>
            </div>
          </div>
          <button
            className="workspace-user"
            onClick={() =>
              void run(async () => {
                await api('/session', 'DELETE');
                setLogin(true);
              })
            }
          >
            <span className="avatar">A</span>
            <span>
              My workspace<small>Private · single owner</small>
            </span>
            <LogOut size={14} />
          </button>
        </div>
      </aside>
      {mobileNav && (
        <button
          className="nav-backdrop"
          aria-label="Close project navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Show projects"
              onClick={() => setMobileNav(!mobileNav)}
            >
              <Layers size={19} />
            </button>
            <span>Workspace</span>
            <span>/</span>
            <strong>{project?.name || 'Your projects'}</strong>
            {project?.demo && <span className="demo-badge">DEMO</span>}
          </div>
          <div className="topbar-actions">
            {project && (
              <>
                <button
                  className="icon-button"
                  aria-label="Refresh project"
                  onClick={() => void run(refresh)}
                  disabled={working}
                >
                  <RefreshCw size={16} />
                </button>
                <button
                  className={`icon-button ${activity ? 'selected' : ''}`}
                  aria-label="Show revision history"
                  onClick={() => setActivity(!activity)}
                >
                  <History size={17} />
                </button>
                <button
                  className="button secondary compact"
                  disabled={working || project.busy || dirty}
                  onClick={() =>
                    void run(async () => {
                      const result = await api<{ id: string; task_id: string }>(
                        `/projects/${project.id}/duplicate`,
                        'POST',
                      );
                      setActive(result.id);
                      return result;
                    })
                  }
                >
                  <Copy size={14} />
                  <span>Duplicate</span>
                </button>
              </>
            )}
            {browserMode && project && (
              <CapCutExport
                project={project}
                disabled={working || project.busy || dirty}
                run={run}
              />
            )}
            <a
              className={`button dark compact ${!project?.deliverables.length ? 'is-disabled' : ''}`}
              aria-label="Export reels"
              role="link"
              aria-disabled={!project?.deliverables.length}
              href={project?.deliverables.length ? `/api/projects/${project.id}/export` : undefined}
              onClick={
                browserMode
                  ? (e) => {
                      e.preventDefault();
                      if (project?.deliverables.length)
                        void run(async () =>
                          (await import('./browser/api')).downloadProject(project),
                        );
                    }
                  : undefined
              }
            >
              <ArrowDownToLine size={15} />
              <span>Export reels</span>
            </a>
          </div>
        </header>
        {browserMode && (
          <div className="browser-banner">
            <ShieldCheck size={18} />
            <div>
              <strong>Free · processes on this device</strong>
              <p>
                Videos stay in this browser. Keep this tab open while processing. First render
                downloads about 32 MB. Optional English auto captions download a speech model
                (roughly 60 MB). Download finished reels before clearing browser storage.
              </p>
            </div>
            {project && (
              <div className="browser-actions">
                <button
                  className="button secondary compact"
                  disabled={disabled || dirty}
                  onClick={() =>
                    void run(() =>
                      api(`/projects/${project.id}/transcribe`, 'POST', {
                        generation: project.generation,
                        revision: project.revision,
                      }),
                    )
                  }
                >
                  Auto captions (English)
                </button>
                <button
                  className="text-button"
                  disabled={project.busy || working}
                  onClick={() => void deleteLocalProject()}
                >
                  Delete project
                </button>
              </div>
            )}
          </div>
        )}
        {setup && (
          <div className="setup-banner">
            <Settings2 size={20} />
            <div>
              <strong>Connect your reel pipeline</strong>
              <p>{setup}</p>
              <p>Follow the setup steps in the repository README, then restart Studio.</p>
            </div>
          </div>
        )}
        {error && (
          <div className="error-banner" role="alert">
            <AlertCircle size={17} />
            <span>{error}</span>
            <button aria-label="Dismiss error" className="icon-button" onClick={() => setError('')}>
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="notice-banner" role="status">
            <Loader2 size={15} className="spin" />
            {notice}
          </div>
        )}
        {project ? (
          <>
            <div className="project-heading">
              <div>
                <span className="eyebrow">
                  THE CUTTING ROOM <span> / </span> GENERATION {project.generation || '—'}
                </span>
                <h1>{project.name}</h1>
                <p>
                  {project.browserProgress || status}
                  {project.busy && <Loader2 size={14} className="spin" />}
                </p>
              </div>
              <div className={`status-pill ${ready ? 'ready' : ''} ${project.busy ? 'busy' : ''}`}>
                <span className="live-dot" />
                {ready
                  ? 'AWAITING YOUR APPROVAL'
                  : project.busy
                    ? 'WORK IN PROGRESS'
                    : project.terminal
                      ? 'PROJECT COMPLETE'
                      : 'YOUR NEXT MOVE'}
              </div>
            </div>
            {project.demo && (
              <div className="demo-note">
                <Film size={14} />
                <p>
                  {browserMode
                    ? 'Generated sample footage. Try a real storyboard and MP4 render here, or choose New project to use your own video. Sample captions are illustrative.'
                    : 'Demo workspace. Captions are illustrative examples, not a transcription of this footage. Create a project with your own media for a real edit.'}
                </p>
              </div>
            )}
            <ProjectInputs
              project={project}
              disabled={working || dirty || project.busy}
              onMatch={
                browserMode
                  ? () =>
                      void run(() =>
                        api(`/projects/${project.id}/reference-captions`, 'POST', {
                          generation: project.generation,
                          revision: project.revision,
                        }),
                      )
                  : undefined
              }
            />
            {project.error && (
              <div className="state-callout error">
                <AlertCircle size={20} />
                <div>
                  <strong>The last step stopped safely.</strong>
                  <p>{project.error.cause}</p>
                </div>
                <button
                  className="button secondary"
                  disabled={working}
                  onClick={() => void run(() => api(`/projects/${project.id}/retry`, 'POST'))}
                >
                  <RefreshCw size={14} />
                  Retry
                </button>
              </div>
            )}
            {conflicted && (
              <div className="state-callout">
                <AlertCircle size={20} />
                <p>
                  This plan changed while you were editing. Discard your local changes to load the
                  latest version.
                </p>
                <button className="button secondary" onClick={discard}>
                  Load latest
                </button>
              </div>
            )}
            {project.needs?.step === 'verify_style' && (
              <div className="style-review state-callout">
                <Film size={22} />
                <div>
                  <strong>Check the style measured from your reference.</strong>
                  <p>
                    Watch your reference and inspect the comparison sheet. You can fine-tune each
                    reel’s captions after planning.
                  </p>
                  <div className="inline-links">
                    {project.sample_url && (
                      <a href={project.sample_url} target="_blank" rel="noreferrer">
                        Watch reference ↗
                      </a>
                    )}
                    {project.sample_review_url && (
                      <a href={project.sample_review_url} target="_blank" rel="noreferrer">
                        Open comparison sheet ↗
                      </a>
                    )}
                  </div>
                </div>
                <button
                  className="button orange"
                  disabled={working}
                  onClick={() =>
                    void run(() =>
                      api(`/projects/${project.id}/verify-style`, 'POST', {
                        need_id: project.needs!.need_id,
                        revision: project.needs!.revision,
                      }),
                    )
                  }
                >
                  <Check size={16} />
                  Use this style
                </button>
              </div>
            )}
            {project.needs?.step === 'plan' && (
              <div className="state-callout">
                <Sparkles size={22} />
                <div>
                  <strong>
                    {project.needs.storyboard_feedback?.length
                      ? 'Your requested changes are ready to plan.'
                      : 'Choose the moments worth keeping.'}
                  </strong>
                  <p>
                    {project.needs.storyboard_feedback?.at(-1)?.notes ||
                      'Create a suggestion from complete transcript sentences, then refine individual reels.'}
                  </p>
                  {!!project.needs.fixes?.length && <p>{JSON.stringify(project.needs.fixes)}</p>}
                  <p className="field-hint">
                    Local suggestions organize complete sentences; they do not judge story quality.
                    Apply precise changes with the controls, or use the optional AI edit proposals.
                  </p>
                </div>
                {!project.generation && (
                  <button
                    className="button orange"
                    disabled={working}
                    onClick={() =>
                      void run(() =>
                        api(`/projects/${project.id}/plan`, 'POST', {
                          need_id: project.needs!.need_id,
                          revision: project.needs!.revision,
                        }),
                      )
                    }
                  >
                    Suggest reels
                    <ArrowRight size={15} />
                  </button>
                )}
              </div>
            )}
            {!!project.reels.length && (
              <div className="reel-selector" aria-label="Reels">
                <span className="eyebrow">
                  YOUR REELS <span>{project.reels.length.toString().padStart(2, '0')}</span>
                </span>
                <div>
                  {project.reels.map((r, i) => (
                    <button
                      className={selected?.id === r.id ? 'active' : ''}
                      key={r.id}
                      onClick={() => selectReel(r)}
                    >
                      <span className="reel-number">{(i + 1).toString().padStart(2, '0')}</span>
                      <span>
                        {r.title || r.id}
                        <small>
                          {time(r.duration || 0)} · {r.frames.length} frames
                        </small>
                      </span>
                      {r.frames[0] && <img src={r.frames[0].url} alt="" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {selected ? (
              <>
                <div className="editor-grid">
                  <div className="editor-main">
                    <Player
                      key={`${project.id}-${selected.id}`}
                      project={project}
                      reel={selected}
                      patch={patch}
                      onChange={change}
                      onTime={setCurrentTime}
                      seekTo={seek}
                      framing={tab === 'framing'}
                    />
                    <section className="storyline">
                      <div className="section-head">
                        <div>
                          <span className="eyebrow">THE STORYLINE</span>
                          <h3>A few moments. One clear story.</h3>
                        </div>
                        <button
                          className="text-button"
                          onClick={() => setCommentsOpen(!commentsOpen)}
                        >
                          <MessageCircle size={15} />
                          {displayedComments.filter((c) => !c.resolved).length} comments
                        </button>
                      </div>
                      <div className="timeline-ruler">
                        <span>0:00</span>
                        <span>{time((selected.duration || 0) / 2)}</span>
                        <span>{time(selected.duration || 0)}</span>
                      </div>
                      <div className="timeline-track">
                        {selected.shot_list.map((s, i) => (
                          <button
                            key={i}
                            style={{ flexGrow: s.duration }}
                            title={`Source ${s.source}: ${s.source_in.toFixed(2)}–${s.source_out.toFixed(2)}s`}
                            aria-label={`Seek shot ${i + 1}`}
                            onClick={() => setSeek({ t: s.start, key: Date.now() })}
                          >
                            <span>{(i + 1).toString().padStart(2, '0')}</span>
                            <span>{s.source}</span>
                          </button>
                        ))}
                        <div
                          className="playhead"
                          style={{ left: `${(100 * currentTime) / (selected.duration || 1)}%` }}
                        />
                      </div>
                      <div className="storyboard-stills">
                        {selected.frames.map((f, i) => (
                          <button
                            key={i}
                            onClick={() => setSeek({ t: f.t, key: Date.now() })}
                            aria-label={`Preview frame at ${f.t.toFixed(2)} seconds`}
                          >
                            <img src={f.url} alt={`Storyboard frame ${i + 1}`} />
                            <span>
                              {i === 0
                                ? 'The hook'
                                : i === selected.frames.length - 1
                                  ? 'The payoff'
                                  : 'The middle'}
                              <small>{time(f.t)}</small>
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>
                    {renderReview && (
                      <div className="qc-card">
                        <ShieldCheck size={20} />
                        <div>
                          <strong>Render checks: {selected.render.qc_verdict || 'pending'}</strong>
                          <p>Watch the rendered video with sound before accepting it.</p>
                          {selected.render.issues.length > 0 && (
                            <ul>
                              {selected.render.issues.map((issue, i) => (
                                <li key={i}>
                                  {typeof issue === 'string' ? issue : JSON.stringify(issue)}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    )}
                    {commentsOpen && (
                      <section className="comments-panel">
                        <div className="section-head">
                          <h3>Notes for this reel</h3>
                          <button
                            className="icon-button"
                            aria-label="Close comments"
                            onClick={() => setCommentsOpen(false)}
                          >
                            <X size={16} />
                          </button>
                        </div>
                        {!displayedComments.length && (
                          <p className="empty-note">
                            A thought about this moment? Leave it right where it belongs.
                          </p>
                        )}
                        {displayedComments.map((c) => (
                          <article className={`comment ${c.resolved ? 'resolved' : ''}`} key={c.id}>
                            <button
                              className="comment-time"
                              onClick={() => setSeek({ t: c.time, key: Date.now() })}
                            >
                              {time(c.time)}
                            </button>
                            <div>
                              <p>{c.text}</p>
                              <small>
                                Generation {c.generation}
                                {c.resolved ? ' · Resolved' : ''}
                              </small>
                            </div>
                            <button
                              className="icon-button"
                              aria-label={c.resolved ? 'Reopen comment' : 'Resolve comment'}
                              onClick={() =>
                                void run(() =>
                                  api(`/projects/${project.id}/comments/${c.id}`, 'PATCH', {
                                    resolved: !c.resolved,
                                  }),
                                )
                              }
                            >
                              <Check size={15} />
                            </button>
                          </article>
                        ))}
                        <div className="comment-compose">
                          <span className="comment-time">{time(currentTime)}</span>
                          <textarea
                            aria-label="Timestamped comment"
                            rows={2}
                            maxLength={4000}
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                            placeholder="A note about this moment…"
                          />
                          <button
                            className="button dark compact"
                            aria-label="Add comment"
                            disabled={working || !comment.trim()}
                            onClick={() => void addComment()}
                          >
                            <ArrowRight size={15} />
                          </button>
                        </div>
                        {(ready || renderReview) && (
                          <button
                            className="text-button"
                            disabled={
                              working ||
                              (!comment.trim() &&
                                !displayedComments.some(
                                  (c) => !c.resolved && c.generation === project.generation,
                                ))
                            }
                            onClick={() => void requestFix()}
                          >
                            Request these changes before continuing
                            <ArrowRight size={13} />
                          </button>
                        )}
                      </section>
                    )}
                  </div>
                  <Inspector
                    key={`${project.id}-${selected.id}`}
                    project={project}
                    reel={selected}
                    patch={patch}
                    config={config}
                    disabled={disabled}
                    tab={tab}
                    setTab={setTab}
                    onChange={change}
                    onApply={() => void apply()}
                    onDiscard={discard}
                    onProposal={change}
                    onError={setError}
                    onMusic={(file) => void addMusic(file)}
                  />
                </div>
                <div className="approval-bar">
                  <div>
                    <span className="approval-icon">
                      <ShieldCheck size={21} />
                    </span>
                    <div>
                      <strong>
                        {ready
                          ? 'Looks like your story?'
                          : renderReview
                            ? 'The final word is yours.'
                            : project.deliverables.length
                              ? 'Your reels are ready.'
                              : 'Make it right before you make it final.'}
                      </strong>
                      <p>
                        {project.busy
                          ? browserMode
                            ? 'Processing on your device. Keep this tab open; you can cancel below.'
                            : 'The worker is running. You can safely close this tab and come back.'
                          : ready
                            ? 'Approve this exact storyboard to begin full rendering.'
                            : renderReview
                              ? browserMode
                                ? 'Check the video and audio yourself, then accept it for download. Automatic speech/tracking QC is not run.'
                                : 'Accept passing renders after checking picture and sound.'
                              : 'Every new plan gets a fresh storyboard and approval.'}
                      </p>
                    </div>
                  </div>
                  <div>
                    {project.busy ? (
                      <button
                        className="button secondary"
                        disabled={working}
                        onClick={() =>
                          void run(() => api(`/projects/${project.id}/cancel`, 'POST'))
                        }
                      >
                        <Square size={13} />
                        Stop worker
                      </button>
                    ) : project.status === 'cancelled' ? (
                      <button
                        className="button secondary"
                        disabled={working}
                        onClick={() => void run(() => api(`/projects/${project.id}/retry`, 'POST'))}
                      >
                        Resume project
                        <Play size={14} />
                      </button>
                    ) : ready ? (
                      <button
                        className="button orange"
                        disabled={working || dirty}
                        onClick={() => void approve()}
                      >
                        {working ? <Loader2 className="spin" size={16} /> : <Check size={16} />}
                        Approve & render
                      </button>
                    ) : renderReview ? (
                      <button
                        className="button orange"
                        disabled={
                          working ||
                          dirty ||
                          !project.needs?.assigned?.some((a) =>
                            ['pass', 'warn'].includes(a.qc_verdict),
                          )
                        }
                        onClick={() => void acceptRenders()}
                      >
                        <Check size={16} />
                        Accept passing renders
                      </button>
                    ) : !project.terminal && !project.needs ? (
                      <button
                        className="button secondary"
                        disabled={working}
                        onClick={() => void run(() => api(`/projects/${project.id}/start`, 'POST'))}
                      >
                        Continue
                        <ArrowRight size={15} />
                      </button>
                    ) : null}
                    {!!project.history.length && !project.terminal && (
                      <button
                        className="icon-button"
                        aria-label="Undo last edit"
                        disabled={
                          disabled ||
                          dirty ||
                          project.history.at(-1)?.generation !== project.generation
                        }
                        onClick={() =>
                          void run(() =>
                            api(`/projects/${project.id}/undo`, 'POST', {
                              generation: project.generation,
                              revision: project.revision,
                              changes: {},
                            }),
                          )
                        }
                      >
                        <Undo2 size={17} />
                      </button>
                    )}
                  </div>
                </div>
                {browserMode && project.deliverables.length > 0 && (
                  <div className="direct-downloads">
                    {project.deliverables.map((d) => (
                      <a className="button orange" key={d.name} href={d.url} download={d.name}>
                        <ArrowDownToLine size={16} />
                        Download {d.name}
                      </a>
                    ))}
                  </div>
                )}
                <div className="resource-note">
                  <Clock3 size={12} />
                  {project.storyboard.frames} stills + {project.storyboard.gif_frames} GIF frames ·{' '}
                  {project.storyboard.elapsed_s?.toFixed(1) || '—'}s to preview ·{' '}
                  {project.storyboard.cache_hits} reel previews reused{' '}
                  <span>
                    Full video ≈ {project.storyboard.estimated_render_frames.toLocaleString()}{' '}
                    frames
                  </span>
                </div>
              </>
            ) : (
              <div className="preparing-state">
                <div className="preparing-icon">
                  <Clapperboard size={34} />
                  {project.busy && <Loader2 className="spin" size={20} />}
                </div>
                <h2>{status}</h2>
                <p>
                  {project.busy
                    ? 'Your media is being prepared. The storyboard will appear here.'
                    : 'Your project is waiting for the next step above.'}
                </p>
                {project.busy && (
                  <button
                    className="button secondary"
                    disabled={working}
                    onClick={() => void run(() => api(`/projects/${project.id}/cancel`, 'POST'))}
                  >
                    <Square size={13} />
                    Stop worker
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="welcome">
            <span className="eyebrow">LESS EDITING. MORE CREATING.</span>
            <h1>
              Your next great reel
              <br />
              starts with <em>a little direction.</em>
            </h1>
            <p>
              Find the story. Shape the details. Make it yours.
              <br />
              See your storyboard before you spend time rendering.
            </p>
            <button
              className="button orange"
              disabled={!!setup}
              onClick={() => setNewProject(true)}
            >
              <Plus size={17} />
              Start a new project
              <ArrowRight size={17} />
            </button>
            <div className="welcome-steps">
              {[
                [Film, '01', 'Bring your footage', 'Upload a video and choose a style.'],
                [Layers, '02', 'Find your story', 'Review stills, GIFs and the words.'],
                [ShieldCheck, '03', 'Give it the green light', 'Render only when you’re happy.'],
              ].map(([Icon, n, title, sub]) => {
                const I = Icon as typeof Film;
                return (
                  <div key={n as string}>
                    <I size={21} />
                    <span>{n as string}</span>
                    <h3>{title as string}</h3>
                    <p>{sub as string}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <footer className="workspace-footer">
          <span>Made for the story. Built around you.</span>
          <span>
            <span className="live-dot" />
            LOCAL WORKSPACE
          </span>
        </footer>
      </div>
      {activity && project && (
        <aside className="activity-drawer">
          <div className="section-head">
            <h2>Behind the edit</h2>
            <button
              className="icon-button"
              aria-label="Close history"
              onClick={() => setActivity(false)}
            >
              <X size={18} />
            </button>
          </div>
          <span className="eyebrow">REVISION HISTORY</span>
          {project.history.length ? (
            project.history
              .slice()
              .reverse()
              .map((x) => (
                <article key={x.id}>
                  <span className="tiny-tag">G{x.generation}</span>
                  <strong>{x.description}</strong>
                  <small>{new Date(x.at * 1000).toLocaleString()}</small>
                </article>
              ))
          ) : (
            <p className="empty-note">Your first edit will appear here.</p>
          )}
          <div className="divider" />
          <span className="eyebrow">PROJECT ACTIVITY</span>
          {project.activity
            .slice()
            .reverse()
            .map((x, i) => (
              <p className="activity-line" key={i}>
                <span className="live-dot" />
                {x.msg}
              </p>
            ))}
          <div className="divider" />
          <span className="eyebrow">PREVIEW BUDGET</span>
          <dl className="budget-list">
            {Object.entries(project.storyboard.limits).map(([key, value]) => (
              <div key={key}>
                <dt>
                  {(
                    {
                      width: 'Still width',
                      frames_per_reel: 'Stills per reel',
                      max_frames: 'Still limit',
                      timeout_s: 'Time limit',
                      gif_width: 'GIF width',
                      gif_fps: 'GIF frame rate',
                      gif_seconds: 'GIF duration',
                      max_gif_frames: 'GIF frame limit',
                      max_gif_bytes: 'GIF size limit',
                    } as Record<string, string>
                  )[key] || key.replaceAll('_', ' ')}
                </dt>
                <dd>
                  {key === 'max_gif_bytes'
                    ? `${(value / 1048576).toFixed(0)} MiB`
                    : value.toLocaleString() +
                      (key === 'timeout_s' || key === 'gif_seconds'
                        ? ' s'
                        : key.endsWith('width')
                          ? ' px'
                          : key === 'gif_fps'
                            ? ' fps'
                            : '')}
                </dd>
              </div>
            ))}
          </dl>
        </aside>
      )}
      {newProject && (
        <NewProject
          onClose={() => setNewProject(false)}
          onCreated={(id, task) => {
            setNewProject(false);
            setActive(id);
            void run(async () => {
              if (!browserMode) await waitTask(task);
            });
          }}
        />
      )}
      {login && (
        <div className="login-overlay">
          <form
            className="login-card"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api('/session', 'POST', { token: accessKey });
                setLogin(false);
                setAccessKey('');
                setConfig(await api('/config'));
                await loadProjects();
              });
            }}
          >
            <span className="brand-mark">
              <Clapperboard size={25} />
            </span>
            <h2>Your studio, privately.</h2>
            <p>Enter your Studio access key to continue.</p>
            <label className="field">
              Access key
              <input
                aria-label="Studio access key"
                autoFocus
                type="password"
                autoComplete="current-password"
                value={accessKey}
                onChange={(e) => setAccessKey(e.target.value)}
              />
            </label>
            {error && <p className="inline-error">{error}</p>}
            <button className="button dark full" disabled={working}>
              Open Studio
              <ArrowRight size={15} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
