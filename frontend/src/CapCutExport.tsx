import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Film, Loader2, X } from 'lucide-react';
import type { Project } from './types';

export default function CapCutExport({
  project,
  disabled,
  run,
}: {
  project: Project;
  disabled: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState('');
  const dialog = useRef<HTMLDialogElement>(null),
    abort = useRef<AbortController | null>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  useEffect(() => () => abort.current?.abort(), []);
  async function download(mode: 'desktop' | 'mobile') {
    setBusy(true);
    setProgress('Checking the accepted project and original media…');
    const controller = new AbortController();
    abort.current = controller;
    try {
      await run(async () => {
        const { exportCapCut } = await import('./capcut/export');
        try {
          await exportCapCut(project, mode, controller.signal, setProgress);
          setProgress('Download ready. Start with READ ME FIRST.txt inside the ZIP.');
        } catch (e) {
          setProgress(
            controller.signal.aborted
              ? 'Export cancelled. Your accepted reel is unchanged.'
              : (e as Error).message,
          );
          if (!controller.signal.aborted) throw e;
        }
      });
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }
  const allowed =
    project.terminal &&
    project.deliverables.length === project.reels.length &&
    project.reels.length > 0;
  return (
    <>
      <button
        className="button secondary compact"
        disabled={disabled || !allowed}
        title={
          allowed
            ? 'Download editable material for CapCut'
            : 'Accept your finished renders to enable CapCut downloads'
        }
        onClick={() => setOpen(true)}
      >
        <Film size={15} />
        <span>Edit in CapCut</span>
      </button>
      <dialog
        ref={dialog}
        className="project-dialog capcut-dialog"
        onCancel={(e) => {
          if (busy) {
            e.preventDefault();
            abort.current?.abort();
          } else setOpen(false);
        }}
      >
        <div className="modal-head">
          <span className="eyebrow">KEEP EDITING YOUR REEL</span>
          <button
            className="icon-button"
            aria-label="Close CapCut export"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            <X size={19} />
          </button>
        </div>
        <h2>Take your reel to CapCut.</h2>
        <p>Choose the version you’ll use next. Your accepted MP4 stays unchanged.</p>
        <section className="capcut-option">
          <h3>
            Desktop editable draft <small>Experimental · Windows / Mac</small>
          </h3>
          <p>
            Original footage, editable cuts and text, static framing and separate music. No extra
            video render.
          </p>
          <p className="field-hint">
            Extract the ZIP and open its installer in desktop Chrome or Edge. It transfers the
            timeline into a new empty CapCut project. CapCut versions can differ; this isn’t a
            universal .capcut file. Fonts, animations, motion, SFX and music ducking may need
            touch-ups.
          </p>
          <button className="button dark" disabled={busy} onClick={() => void download('desktop')}>
            <ArrowDownToLine size={16} />
            Download desktop draft ZIP
          </button>
        </section>
        <section className="capcut-option">
          <h3>
            Mobile remaster clips <small>Android / iPhone</small>
          </h3>
          <p>
            Separate, numbered clips to import in order. Clean picture and recording audio; add
            fresh captions, music and effects in CapCut.
          </p>
          <p className="field-hint">
            This prepares cropped 540p clips on this device, only when you request it. Repeated
            downloads reuse cached clips. Trim handles and crop edges aren’t retained; the desktop
            pack keeps the originals. Mobile can’t directly open the desktop draft.
          </p>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void download('mobile')}
          >
            <ArrowDownToLine size={16} />
            Prepare mobile clips ZIP
          </button>
        </section>
        {progress && (
          <div className="capcut-progress" role="status">
            {busy && <Loader2 size={16} className="spin" />}
            <span>{progress}</span>
            {busy && (
              <button className="button secondary" onClick={() => abort.current?.abort()}>
                Cancel export
              </button>
            )}
          </div>
        )}
        <p className="field-hint">
          Both downloads include caption timings, the edit plan, reopening instructions and the
          accepted MP4 for comparison. Reference-style footage is excluded.
        </p>
      </dialog>
    </>
  );
}
