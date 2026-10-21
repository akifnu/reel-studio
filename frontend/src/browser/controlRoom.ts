import type {
  Changes,
  ColourGrade,
  ControlArea,
  ControlPreview,
  ControlRequest,
  Project,
  Reel,
  Segment,
} from '../types';
import { merge } from '../utils';
import { compile } from './compositor';
import { editingReply } from './editingAssistant';
import { clamp, sourceRanges } from './referenceLook';
const identity = (): ColourGrade => ({
  gain: [1, 1, 1],
  offset: [0, 0, 0],
  saturation: 1,
  strength: 0,
});
export function scopedChanges(changes: Changes, area: ControlArea): Changes {
  if (area === 'all') return changes;
  if (area === 'colour')
    return changes.editing?.colour ? { editing: { colour: changes.editing.colour } } : {};
  if (area === 'captions')
    return {
      ...(changes.editing?.captions ? { editing: { captions: changes.editing.captions } } : {}),
      ...(changes.caption_text ? { caption_text: changes.caption_text } : {}),
    };
  return {
    ...(changes.segments ? { segments: changes.segments } : {}),
    ...(changes.editing?.pacing ? { editing: { pacing: changes.editing.pacing } } : {}),
  };
}
export function rhythmCuts(p: Project, r: Reel, pattern: number[]): Segment[] {
  const durations = pattern
    .filter((v) => Number.isFinite(v) && v > 0)
    .map((v) => clamp(v, 0.35, 5));
  if (!durations.length) throw new Error('No reference cut rhythm is available.');
  const shots: Segment[] = [];
  let index = 0,
    remaining = durations[0];
  for (const source of sourceRanges(p, r.segments)) {
    let t = source.s!;
    while (t < source.e! - 0.00001) {
      const take = Math.min(remaining, source.e! - t);
      shots.push({ src: source.src, s: t, e: t + take });
      t += take;
      remaining -= take;
      if (remaining < 0.00001) remaining = durations[++index % durations.length];
      if (shots.length > 120)
        throw new Error('This rhythm exceeds 120 cuts. Shorten the reel or choose a slower pace.');
    }
  }
  return shots;
}
function changesFor(
  p: Project,
  r: Reel,
  q: ControlRequest,
): { changes: Changes; explanation: string } {
  const a = p.reference?.caption_analysis;
  if (q.action === 'prompt') {
    const response = editingReply(p, r, String(q.text || ''));
    const changes = scopedChanges(response.changes, q.area);
    const excluded =
      Object.keys(response.changes).length &&
      JSON.stringify(changes) !== JSON.stringify(response.changes);
    return {
      changes,
      explanation: excluded
        ? `This proposal includes only ${q.area === 'colour' ? 'colour tone' : q.area === 'pacing' ? 'cut timing and pacing' : 'captions'}. Other requested areas were excluded. Review the changes before applying.`
        : response.explanation,
    };
  }
  if (q.area === 'colour') {
    if (q.action === 'reset')
      return {
        changes: { editing: { colour: identity() } },
        explanation: 'Remove the colour correction.',
      };
    const grade =
      q.action === 'copy'
        ? p.reference?.matched_colour
        : r.editing?.colour || p.reference?.matched_colour || identity();
    if (!grade) throw new Error('Analyze a reference reel before copying its colour tone.');
    const strength = q.strength ?? 1;
    if (!Number.isFinite(strength) || strength < 0 || strength > 1)
      throw new Error('Choose a colour strength between 0 and 100%.');
    return {
      changes: { editing: { colour: { ...structuredClone(grade), strength } } },
      explanation: `${q.action === 'copy' ? 'Copy the measured reference tone' : 'Set colour strength'} at ${Math.round(strength * 100)}%.`,
    };
  }
  if (q.area === 'captions') {
    if (q.action !== 'copy') throw new Error('Use Copy caption style or a caption instruction.');
    if (a?.status !== 'detected' || !a.style)
      throw new Error(
        'No confident reference caption style is available. Analyze a clearer reference or use the caption controls.',
      );
    return {
      changes: { editing: { captions: { enabled: true, style: structuredClone(a.style) } } },
      explanation: 'Copy the measured caption appearance. Wording remains from your raw footage.',
    };
  }
  if (q.area === 'pacing') {
    if (q.action === 'reset') {
      return {
        changes: {
          segments: r.control_baseline_segments
            ? structuredClone(r.control_baseline_segments)
            : sourceRanges(p, r.segments),
          editing: { pacing: { target: 5, reframes: false, pattern: [] } },
        },
        explanation: r.control_baseline_segments
          ? 'Restore timing saved before the first control-room pacing edit.'
          : 'Merge contiguous cuts from the older edit and turn off paced reframing. Existing source selections are retained.',
      };
    }
    let pattern: number[], target: number;
    if (q.action === 'copy') {
      if (a?.pacing?.confidence !== 'measured')
        throw new Error(
          'No clear reference cuts were detected. Set a shot length instead; the current timing is kept.',
        );
      const end = a.window_seconds || 5,
        points = [0, ...a.pacing.cuts, end];
      pattern = points.slice(1).map((t, i) => clamp(t - points[i], 0.35, 5));
      target = a.pacing.median_shot;
    } else {
      target = q.seconds ?? 1;
      if (!Number.isFinite(target) || target < 0.35 || target > 5)
        throw new Error('Choose a shot length between 0.35 and 5 seconds.');
      pattern = [target];
    }
    return {
      changes: {
        segments: rhythmCuts(p, r, pattern),
        editing: { pacing: { target, reframes: q.reframes ?? true, pattern } },
      },
      explanation:
        q.action === 'copy'
          ? 'Copy the sampled cut rhythm onto your footage. All selected footage and audio are retained; alternating reframes are optional.'
          : `Use ${target.toFixed(2)} second shots while retaining the selected footage and audio.`,
    };
  }
  throw new Error('Choose a specific editing area for a copy or reset.');
}
export function controlPreview(p: Project, q: ControlRequest): ControlPreview {
  if (
    !q ||
    !['colour', 'pacing', 'captions', 'all'].includes(q.area) ||
    !['copy', 'prompt', 'settings', 'reset'].includes(q.action) ||
    typeof q.reel_id !== 'string'
  )
    throw new Error('Choose an editing area, action and target reel.');
  if (q.text !== undefined && (typeof q.text !== 'string' || q.text.length > 2000))
    throw new Error('Use an instruction under 2,000 characters.');
  if (q.reframes !== undefined && typeof q.reframes !== 'boolean')
    throw new Error('Choose whether to reframe cuts.');
  const reels = q.reel_id === 'all' ? p.reels : p.reels.filter((r) => r.id === q.reel_id);
  if (!reels.length) throw new Error('The target reel is no longer available.');
  const explanations: string[] = [];
  const plans = reels.map((r) => {
    const { changes, explanation } = changesFor(p, r, q);
    explanations.push(explanation);
    const copy = merge(r as unknown as Record<string, unknown>, changes) as unknown as Reel;
    compile(p, copy);
    return {
      id: r.id,
      changes,
      before: r.duration || 0,
      after: copy.duration || 0,
      shots: copy.segments.length,
    };
  });
  return {
    request: structuredClone(q),
    generation: p.generation,
    revision: p.revision,
    explanation: [...new Set(explanations)].join('\n'),
    reels: plans,
  };
}
