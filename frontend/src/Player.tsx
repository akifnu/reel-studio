import { useEffect, useId, useRef, useState } from 'react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Expand,
  Film,
  Image as ImageIcon,
  Video,
  MousePointer2,
} from 'lucide-react';
import type { Changes, Project, Reel } from './types';
import { shotAt, sourceTime, time } from './utils';
import { browserMode } from './features';

type Props = {
  project: Project;
  reel: Reel;
  patch: Changes;
  onChange: (x: Changes) => void;
  onTime: (t: number) => void;
  seekTo: { t: number; key: number } | null;
  framing: boolean;
};

export default function Player({ project, reel, patch, onChange, onTime, seekTo, framing }: Props) {
  const [view, setView] = useState<'gif' | 'source' | 'render'>(reel.gif.url ? 'gif' : 'source');
  const [t, setT] = useState(0),
    [playing, setPlaying] = useState(false),
    [muted, setMuted] = useState(false),
    [mediaError, setMediaError] = useState('');
  const [size, setSize] = useState({ w: 270, h: 480 });
  const [captionImage, setCaptionImage] = useState('');
  const video = useRef<HTMLVideoElement>(null),
    music = useRef<HTMLAudioElement>(null),
    stage = useRef<HTMLDivElement>(null);
  const desired = useRef(0),
    drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const previousGif = useRef(reel.gif.url);
  const gradeId = 'grade' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const grade = patch.editing?.colour || reel.editing?.colour;
  const strength = grade?.strength || 0,
    saturation = 1 + ((grade?.saturation ?? 1) - 1) * strength;
  const matrix = [0, 1, 2].flatMap((i) => [
    ...[0.299, 0.587, 0.114].map((v, j) => (1 - saturation) * v + (i === j ? saturation : 0)),
    0,
    0,
  ]);
  const gradeMatrix = [...matrix, 0, 0, 0, 1, 0].join(' ');
  const duration = reel.duration || 0;
  const shot = shotAt(reel.shot_list, t),
    source = shot ? project.sources[shot.source] : Object.values(project.sources)[0];
  const url = view === 'render' ? reel.render.url : source?.url;
  const capStyle = {
    ...reel.effective_style.captions?.style,
    ...reel.editing?.captions?.style,
    ...patch.editing?.captions?.style,
  };
  const crop = { x: 0.5, y: 0.5, zoom: 1, ...reel.editing?.crop, ...patch.editing?.crop };
  if (
    (patch.editing?.pacing || reel.editing?.pacing)?.reframes &&
    shot &&
    reel.shot_list.indexOf(shot) % 2 === 1
  )
    crop.zoom *= 1.1;
  const enabled =
    patch.editing?.captions?.enabled ??
    reel.editing?.captions?.enabled ??
    reel.effective_style.captions?.present ??
    true;
  const refH = reel.effective_style.sample?.height || 1280;
  const event = reel.caption_events.find((e) => e.s <= t && t < e.e) || reel.caption_events[0];
  let text = event?.text || reel.speech.split(' ').slice(0, 5).join(' ');
  if (shot && patch.caption_text) {
    const sentence = project.transcripts[shot.source]?.sentences.find(
      (s) => s.s <= sourceTime(shot, t) && sourceTime(shot, t) <= s.e,
    );
    if (sentence)
      text =
        patch.caption_text[`${shot.source}:${sentence.id}`] ||
        patch.caption_text[String(sentence.id)] ||
        text;
  }
  if ((patch.title_text ?? reel.title_text) && t < 2)
    text = patch.title_text ?? reel.title_text ?? text;
  const captionKey = JSON.stringify(capStyle);
  useEffect(() => {
    let live = true;
    if (browserMode && view === 'source' && enabled && text) {
      void import('./browser/compositor').then(({ captionCanvas }) => {
        const r = {
          ...reel,
          editing: { ...reel.editing, captions: { enabled: true, style: capStyle } },
        };
        const canvas = captionCanvas(
          r,
          text,
          Math.max(1, Math.round(size.w)),
          Math.max(1, Math.round(size.h)),
        );
        if (live) setCaptionImage(canvas.toDataURL());
      });
    } else setCaptionImage('');
    return () => {
      live = false;
    };
  }, [captionKey, text, size.w, size.h, view, enabled]);
  const scale = source ? Math.max(size.w / source.width, size.h / source.height) * crop.zoom : 1;
  const pw = (source?.width || size.w) * scale,
    ph = (source?.height || size.h) * scale;
  const ox = Math.max(-(pw - size.w) / 2, Math.min((pw - size.w) / 2, (0.5 - crop.x) * pw));
  const oy = Math.max(-(ph - size.h) / 2, Math.min((ph - size.h) / 2, (0.5 - crop.y) * ph));

  useEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver(([e]) =>
      setSize({ w: e.contentRect.width, h: e.contentRect.height }),
    );
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setT(0);
    desired.current = 0;
    setPlaying(false);
    setMediaError('');
    setView(reel.render.url ? 'render' : reel.gif.url ? 'gif' : 'source');
  }, [reel.id, project.id]);
  useEffect(() => {
    if (project.needs?.step === 'review' && reel.render.url) setView('render');
  }, [project.needs?.step, reel.render.url]);
  useEffect(() => {
    if (
      previousGif.current !== reel.gif.url &&
      reel.gif.url &&
      !Object.keys(patch).length &&
      project.needs?.step !== 'review'
    ) {
      setView('gif');
    }
    previousGif.current = reel.gif.url;
  }, [reel.gif.url, patch, project.needs?.step]);
  useEffect(() => {
    if (Object.keys(patch).length) {
      setView('source');
    }
  }, [patch]);
  useEffect(() => {
    onTime(t);
  }, [t]);
  useEffect(() => {
    if (view === 'gif') {
      setPlaying(false);
      music.current?.pause();
    }
    setMediaError('');
  }, [view]);
  useEffect(() => {
    if (seekTo) {
      if (view === 'gif') setView('source');
      seek(seekTo.t);
    }
  }, [seekTo?.key]);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const target =
      view === 'render' ? desired.current : shot ? sourceTime(shot, desired.current) : 0;
    const loaded = () => {
      v.currentTime = Math.max(0, Math.min(target, Math.max(0, v.duration - 0.01)));
      if (playing) void v.play().catch(() => setPlaying(false));
    };
    v.addEventListener('loadedmetadata', loaded);
    if (v.readyState >= 1) loaded();
    return () => {
      v.pause();
      v.removeEventListener('loadedmetadata', loaded);
    };
  }, [url, view]);
  useEffect(() => {
    const a = music.current;
    if (!a) return;
    const cfg = { ...reel.editing?.music, ...patch.editing?.music };
    a.volume = Math.min(1, 10 ** ((cfg.gain_db ?? -18) / 20));
    a.muted = !!cfg.muted || muted;
    if (playing && view === 'source') void a.play().catch(() => {});
    else a.pause();
    return () => a.pause();
  }, [playing, view, muted, reel.editing?.music, patch.editing?.music]);

  function seek(value: number) {
    const next = Math.max(0, Math.min(value, Math.max(0, duration - 0.01)));
    desired.current = next;
    setT(next);
    const s = shotAt(reel.shot_list, next);
    const v = video.current;
    if (v) {
      const target = view === 'render' ? next : s ? sourceTime(s, next) : 0;
      try {
        v.currentTime = target;
      } catch {
        /* metadata will seek on load */
      }
    }
    if (music.current && Number.isFinite(music.current.duration))
      music.current.currentTime = next % music.current.duration;
  }
  function update() {
    const v = video.current;
    if (!v) return;
    if (view === 'render') {
      setT(v.currentTime);
      return;
    }
    if (!shot) return;
    const next = shot.start + Math.max(0, v.currentTime - shot.source_in);
    if (v.currentTime >= shot.source_out - 0.04) {
      const following = reel.shot_list[reel.shot_list.indexOf(shot) + 1];
      if (following) seek(following.start);
      else {
        v.pause();
        setPlaying(false);
        setT(duration);
      }
      return;
    }
    setT(Math.min(duration, next));
  }
  function toggle() {
    const v = video.current;
    if (!v) return;
    if (playing) {
      v.pause();
      setPlaying(false);
    } else {
      if (t >= duration - 0.05) seek(0);
      void v
        .play()
        .then(() => setPlaying(true))
        .catch(() => setMediaError('Tap the video to allow playback.'));
    }
  }
  function pointerDown(e: React.PointerEvent) {
    if (!framing || view !== 'source') return;
    drag.current = { x: e.clientX, y: e.clientY, cx: crop.x, cy: crop.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  const caseText =
    capStyle.case === 'upper'
      ? text.toUpperCase()
      : capStyle.case === 'lower'
        ? text.toLowerCase()
        : text;
  return (
    <section className="player-panel" aria-label="Video preview">
      {browserMode && grade && (
        <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>
          <defs>
            <filter id={gradeId} colorInterpolationFilters="sRGB">
              <feComponentTransfer>
                {(['R', 'G', 'B'] as const).map((channel, i) => {
                  const props = {
                    type: 'linear' as const,
                    slope: 1 + (grade.gain[i] - 1) * strength,
                    intercept: (grade.offset[i] * strength) / 255,
                  };
                  return channel === 'R' ? (
                    <feFuncR key={channel} {...props} />
                  ) : channel === 'G' ? (
                    <feFuncG key={channel} {...props} />
                  ) : (
                    <feFuncB key={channel} {...props} />
                  );
                })}
              </feComponentTransfer>
              <feColorMatrix type="matrix" values={gradeMatrix} />
            </filter>
          </defs>
        </svg>
      )}

      <div className="player-toolbar">
        <span className="eyebrow">
          <span className="live-dot" />
          THE PREVIEW
        </span>
        <div className="segmented" aria-label="Preview mode">
          <button
            className={view === 'gif' ? 'active' : ''}
            disabled={!reel.gif.url}
            onClick={() => setView('gif')}
          >
            <ImageIcon size={13} />
            GIF
          </button>
          <button
            className={view === 'source' ? 'active' : ''}
            disabled={!source}
            onClick={() => setView('source')}
          >
            <Film size={13} />
            Source
          </button>
          <button
            className={view === 'render' ? 'active' : ''}
            disabled={!reel.render.url}
            onClick={() => setView('render')}
          >
            <Video size={13} />
            Render
          </button>
        </div>
      </div>
      <div className="canvas-well">
        <span className="canvas-label">
          9:16 <span>VERTICAL</span>
        </span>
        <div
          ref={stage}
          className={`video-stage ${framing && view === 'source' ? 'draggable' : ''}`}
          onPointerDown={pointerDown}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            onChange({
              editing: {
                crop: {
                  x: Math.max(0, Math.min(1, drag.current.cx - (e.clientX - drag.current.x) / pw)),
                  y: Math.max(0, Math.min(1, drag.current.cy - (e.clientY - drag.current.y) / ph)),
                },
              },
            });
          }}
        >
          {view === 'gif' && reel.gif.url ? (
            <img
              src={reel.gif.url}
              alt={`Silent storyboard animation for ${reel.title || reel.id}`}
            />
          ) : (
            <>
              {url ? (
                <video
                  ref={video}
                  src={url}
                  playsInline
                  preload="metadata"
                  muted={muted}
                  onTimeUpdate={update}
                  onEnded={() => setPlaying(false)}
                  onError={() =>
                    setMediaError(
                      'This browser cannot play this source format. The generated GIF is available; use an MP4/H.264 source for browser playback.',
                    )
                  }
                  style={
                    view === 'source'
                      ? {
                          filter: browserMode && grade ? `url(#${gradeId})` : undefined,
                          width: pw,
                          height: ph,
                          left: (size.w - pw) / 2 + ox,
                          top: (size.h - ph) / 2 + oy,
                        }
                      : undefined
                  }
                />
              ) : (
                <div className="stage-empty">
                  <Film />
                  Preview is preparing
                </div>
              )}
              {view === 'source' && enabled && text && (
                <div
                  className="caption-overlay"
                  aria-label="Live caption preview"
                  style={{
                    opacity: browserMode ? 0 : 1,
                    fontFamily: `"${capStyle.font || 'Arimo'}", sans-serif`,
                    fontSize: ((capStyle.size || 56) * size.h) / refH,
                    fontWeight: capStyle.weight || 700,
                    color: capStyle.fill || '#ffffff',
                    top: size.h / 2 + ((capStyle.y || 0) * size.h) / refH,
                    left: size.w / 2 + ((capStyle.x || 0) * size.h) / refH,
                    background: capStyle.box?.color,
                    WebkitTextStroke: `${((capStyle.stroke?.width || 0) * size.h) / refH}px ${capStyle.stroke?.color || '#000000'}`,
                    textShadow: '0 2px 8px #0006',
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    drag.current = { x: e.clientX, y: e.clientY, cx: 0, cy: capStyle.y || 0 };
                  }}
                  onPointerMove={(e) => {
                    if (drag.current && e.currentTarget.hasPointerCapture(e.pointerId)) {
                      onChange({
                        editing: {
                          captions: {
                            style: {
                              y: Math.round(
                                Math.max(
                                  -560,
                                  Math.min(
                                    560,
                                    drag.current.cy +
                                      ((e.clientY - drag.current.y) * refH) / size.h,
                                  ),
                                ),
                              ),
                            },
                          },
                        },
                      });
                      e.stopPropagation();
                    }
                  }}
                  onPointerUp={(e) => {
                    e.stopPropagation();
                    drag.current = null;
                  }}
                >
                  {caseText}
                </div>
              )}
            </>
          )}
          {browserMode && view === 'source' && enabled && captionImage && (
            <img className="canvas-caption-overlay" src={captionImage} alt="" aria-hidden="true" />
          )}
          <span className="stage-badge">
            {view === 'render'
              ? 'RENDERED'
              : view === 'gif'
                ? 'SILENT PREVIEW'
                : 'LIVE APPROXIMATION'}
          </span>
        </div>
        <button
          className="icon-button expand"
          aria-label="Expand preview"
          onClick={() => void stage.current?.requestFullscreen?.()}
        >
          <Expand size={16} />
        </button>
        {framing && view === 'source' && (
          <span className="drag-hint">
            <MousePointer2 size={12} />
            Drag to reframe
          </span>
        )}
      </div>
      {project.music_url && <audio ref={music} src={project.music_url} loop preload="none" />}
      {mediaError && <p className="inline-error">{mediaError}</p>}
      <div className="transport">
        {view === 'gif' ? (
          <span className="gif-note">
            ↻ {reel.gif.duration?.toFixed(1)}s loop · selected moments · no audio
          </span>
        ) : (
          <>
            <button
              className="play-button"
              aria-label={playing ? 'Pause video' : 'Play video'}
              onClick={toggle}
            >
              {playing ? <Pause size={16} /> : <Play size={16} fill="currentColor" />}
            </button>
            <span className="timecode">
              {time(t)} <span>/ {time(duration)}</span>
            </span>
            <input
              aria-label="Seek video"
              className="seek"
              type="range"
              min={0}
              max={duration || 1}
              step={0.01}
              value={Math.min(t, duration)}
              onChange={(e) => seek(+e.target.value)}
            />
            <button
              className="icon-button"
              aria-label={muted ? 'Unmute video' : 'Mute video'}
              onClick={() => setMuted(!muted)}
            >
              {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
          </>
        )}
      </div>
      <p className="preview-note">
        {view === 'source'
          ? 'Source playback approximates your draft layout. Update the storyboard to verify the composed captions and effects.'
          : view === 'gif'
            ? 'An impression of your edit. Review full motion and audio after rendering.'
            : 'Final encoded video. Check the picture, sound and QC findings before accepting.'}
      </p>
    </section>
  );
}
