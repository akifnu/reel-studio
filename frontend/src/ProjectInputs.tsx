import type { Project } from './types';

export default function ProjectInputs({
  project,
  disabled = false,
  onMatch,
}: {
  project: Project;
  disabled?: boolean;
  onMatch?: () => void;
}) {
  if (project.demo) return null;
  return (
    <details className="project-inputs">
      <summary>
        Project inputs · {project.reference ? '1 style reference' : 'Caption preset'} ·{' '}
        {Object.keys(project.sources).length} raw clip
        {Object.keys(project.sources).length === 1 ? '' : 's'}
      </summary>
      <div className="input-comparison">
        <section aria-label="Reference style input">
          <span className="eyebrow">1 · REFERENCE STYLE</span>
          <h3>{project.reference?.name || 'Caption preset'}</h3>
          <p>Pacing, colour tone, caption treatment and hook inspiration.</p>
          {project.reference && project.sample_url && (
            <video
              aria-label="Style reference video"
              src={project.sample_url}
              controls
              playsInline
              preload="none"
            />
          )}
          {project.reference?.notes && <p className="reference-brief">{project.reference.notes}</p>}
          <p>
            {project.reference?.mode === 'caption-measured'
              ? 'Caption box colour, text size and position measured locally from a short reference sample. Font is approximate. Pacing, hook wording and colour grading remain manual.'
              : project.reference?.mode === 'manual'
                ? 'No measured caption style is applied. Match reference captions to analyze a short sample, or adjust the settings manually. Video colour grading stays manual.'
                : project.reference
                  ? 'Analyzed separately by the server. Check the measured style and storyboard before approving.'
                  : 'No reference reel selected. Your edit starts from the chosen caption preset.'}
          </p>
          {project.reference?.caption_analysis && (
            <p>
              {project.reference.caption_analysis.matches}/
              {project.reference.caption_analysis.frames} sample frames matched ·{' '}
              {project.reference.caption_analysis.window_seconds?.toFixed(1)}s window.
            </p>
          )}
          {onMatch && project.reference && !project.terminal && (
            <button className="button secondary" disabled={disabled} onClick={onMatch}>
              Match reference captions on all reels
            </button>
          )}
          <small>Reference picture and audio are excluded from the edit.</small>
        </section>
        <section aria-label="Raw footage input">
          <span className="eyebrow">2 · RAW FOOTAGE</span>
          <h3>Your content to edit</h3>
          <p>Only these recordings supply the picture and speech in your reel.</p>
          <ul>
            {Object.entries(project.sources).map(([key, source]) => (
              <li key={key}>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {key} · {source.name} ↗
                </a>
              </li>
            ))}
          </ul>
          <small>Background music is a separate, optional audio input.</small>
        </section>
      </div>
    </details>
  );
}
