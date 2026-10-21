import type { Changes, ColourGrade, Project, Reel } from '../types';
import { merge } from '../utils';
import { clamp, paceSegments } from './referenceLook';
const identity = (): ColourGrade => ({
  gain: [1, 1, 1],
  offset: [0, 0, 0],
  saturation: 1,
  strength: 1,
});
type Context = { role: string; text: string; changes?: Changes }[];
export function editingReply(p: Project, reel: Reel, input: string, context: Context = []) {
  const text = input.trim(),
    t = text.toLowerCase(),
    changes: Changes = {},
    answers: string[] = [];
  const followup = /\b(them|it|that|those|instead|more|less|again)\b/.test(t);
  const prior = followup
    ? [...context].reverse().find((c) => c.role === 'assistant' && c.changes)?.changes
    : undefined;
  const r = prior
    ? (merge(reel as unknown as Record<string, unknown>, prior) as unknown as Reel)
    : reel;
  let edit: NonNullable<Changes['editing']> = {};
  const cap = (patch: Record<string, unknown>) => {
    edit = merge(edit, { captions: { enabled: true, style: patch } });
  };
  if (!text) return { changes, explanation: 'Tell me what you want to change.' };
  if (/^(undo|undo last edit|revert|go back)[.!]?$/i.test(text))
    return {
      changes,
      explanation:
        'Use Undo last edit below the editor to restore the previous saved version. For unsaved changes, choose Discard changes.',
    };
  if (/\b(don't|do not|never)\b/.test(t))
    return {
      changes,
      explanation: 'I kept the edit unchanged. Request the change directly when you are ready.',
    };
  const question =
    /\?|^(how|why|what|can you|help|explain|where|does|is there)\b/.test(t) &&
    !/^can you (make|change|set|move|mute|remove|match|copy|zoom|trim|cut)/.test(t);
  if (question) {
    if (/detect|reference|sample/.test(t)) {
      const a = p.reference?.caption_analysis;
      answers.push(
        a
          ? `Reference analysis: ${a.frames} sampled frames over ${a.window_seconds?.toFixed(1)}s; captions ${a.status} (${a.method || 'uncertain'}); colour ${a.look ? 'measured' : 'unavailable'}; ${a.pacing?.cuts.length || 0} cut boundaries. ${a.font_match || ''}`
          : 'No reference is selected. Add one in a new project to measure its look and timing.',
      );
    }
    if (/caption|font|text|detect/.test(t))
      answers.push(
        p.reference?.caption_analysis?.notes ||
          'Captions use your raw footage’s transcript or caption script. Use Auto captions to transcribe; upload a reference for measured styling. You can import an original font in Captions.',
      );
    if (/pac|cut|fast|slow/.test(t)) {
      const a = p.reference?.caption_analysis?.pacing;
      answers.push(
        a
          ? `The sampled reference has ${a.cuts.length} detected cuts in ${p.reference?.caption_analysis?.window_seconds?.toFixed(1)}s. ${a.confidence === 'measured' ? `Median shot: ${a.median_shot.toFixed(2)}s.` : 'No clear cuts were found, so its timing was kept.'} This reel has ${r.segments.length} cuts. Say “match reference pacing” or “cuts every 1 second”. Speech edits respect complete transcript sentences; contiguous reframe cuts preserve footage without a transcript.`
          : 'Upload a reference to measure its cuts, or ask for “cuts every 1 second”. Without a transcript, this uses contiguous reframe cuts.',
      );
    }
    if (/colo[u]?r|ton|grad|look/.test(t))
      answers.push(
        p.reference?.matched_colour
          ? 'Reference colour matching uses bounded RGB contrast, brightness and saturation measurements. It approximates the look; it cannot recover the original LUT or separate lighting from grading. Try “warmer”, “cooler”, “less saturated” or “match reference colour”.'
          : 'Try “warmer”, “cooler”, “brighter” or upload a reference to measure its colour.',
      );
    if (/export|render|download|capcut/.test(t))
      answers.push(
        'Apply the edit, review the new storyboard and GIF, then choose Approve & render. After accepting the MP4, download it or open Edit in CapCut. I never start a full render from chat.',
      );
    return {
      changes,
      explanation:
        answers.join('\n\n') ||
        'I can help with reference colour and pacing, captions, crop, music, hooks and trimming. Try “warmer and faster”, “remove the caption box”, “yellow captions”, “trim to 10 seconds” or “what did you detect?”. I run locally with supported editing commands; I am not a general AI model.',
    };
  }
  const style = { ...r.effective_style.captions?.style, ...r.editing?.captions?.style };
  if (/(?:copy|match|restore|use).*(?:reference|sample)/.test(t)) {
    if (/caption|font|style|everything/.test(t)) {
      const a = p.reference?.caption_analysis;
      if (a?.style) cap(structuredClone(a.style));
      else
        answers.push(
          'The reference caption style is uncertain. Reanalyze it or upload a clearer reference; I have not substituted a preset.',
        );
    }
    if (/colo[u]?r|ton|grad|look|style|everything/.test(t)) {
      const grade = p.reference?.matched_colour;
      if (grade) edit.colour = structuredClone(grade);
      else answers.push('No measured reference colour is available yet.');
    }
    if (/pac|fast|cut|style|everything/.test(t)) {
      const a = p.reference?.caption_analysis?.pacing;
      if (a?.confidence === 'measured') {
        changes.segments = paceSegments(p, r, a.median_shot);
        edit.pacing = { target: a.median_shot, reframes: true };
      } else answers.push('No clear reference cuts were detected. I kept the existing timing.');
    }
  }
  const negation = /\b(don't|do not|never|keep)\b/.test(t);
  const hasColour = /warmer|cooler|bright|dark|saturat|contrast/.test(t);
  if (hasColour && !negation) {
    const g = structuredClone(edit.colour || r.editing?.colour || identity());
    g.strength = 1;
    if (/warmer/.test(t)) {
      g.offset[0] += 6;
      g.offset[2] -= 6;
    }
    if (/cooler/.test(t)) {
      g.offset[0] -= 6;
      g.offset[2] += 6;
    }
    if (/brighter/.test(t)) g.offset = g.offset.map((v) => v + 8);
    if (/darker/.test(t)) g.offset = g.offset.map((v) => v - 8);
    if (/(?:less|de)saturat/.test(t)) g.saturation -= 0.15;
    else if (/(?:more )?saturat/.test(t)) g.saturation += 0.15;
    if (/(?:more|higher) contrast/.test(t)) g.gain = g.gain.map((v) => v + 0.08);
    if (/(?:less|lower) contrast/.test(t)) g.gain = g.gain.map((v) => v - 0.08);
    g.gain = g.gain.map((v) => clamp(v, 0.5, 2));
    g.offset = g.offset.map((v) => clamp(v, -80, 80));
    g.saturation = clamp(g.saturation, 0, 2);
    edit.colour = g;
  }
  if (/(?:remove|reset|no) (?:colo[u]?r|grad|ton)/.test(t))
    edit.colour = { ...(r.editing?.colour || identity()), strength: 0 };
  const pace = t.match(
    /(?:cuts? (?:every|at)|shot(?: length)?(?: to)?)\s*([\d.]+)\s*(?:s|sec|second)/,
  );
  if ((pace || /\b(faster|slower)\b/.test(t)) && !negation) {
    const target = pace
      ? +pace[1]
      : clamp(
          ((r.duration || 10) / Math.max(1, r.segments.length)) * (/faster/.test(t) ? 0.65 : 1.5),
          0.35,
          5,
        );
    changes.segments = paceSegments(p, r, target);
    edit.pacing = { target, reframes: true };
    answers.push(
      'Cut timing changed. Complete spoken sentences are preserved. Without a transcript, contiguous reframe cuts preserve all footage and audio.',
    );
  }
  if (!negation) {
    const colors: Record<string, string> = {
      yellow: '#ffe600',
      white: '#ffffff',
      blue: '#60a5fa',
      pink: '#f9a8d4',
      orange: '#fb923c',
      green: '#a3e635',
      red: '#ff3030',
      black: '#000000',
    };
    for (const [name, fill] of Object.entries(colors))
      if (new RegExp(`\\b${name}\\b`).test(t) && (/caption|text|font/.test(t) || !hasColour))
        cap({ fill });
    const hex = t.match(/#[0-9a-f]{6}\b/);
    if (hex && /caption|text/.test(t)) cap({ fill: hex[0] });
    const size = t.match(/(?:font|text|caption) size\s*(\d+)/);
    if (size) cap({ size: clamp(+size[1], 12, 160) });
    if (/\b(bigger|larger|smaller)\b/.test(t))
      cap({ size: clamp((style.size || 56) + (/smaller/.test(t) ? -6 : 6), 12, 160) });
    if (/(?:remove|without|no) (?:(?:the|a) )?(?:caption )?(box|bar|background)/.test(t))
      cap({ box: { ...style.box, color: '', opacity: 0 } });
    if (/(?:add|use) (?:a )?(?:black )?(?:caption )?(box|bar)/.test(t))
      cap({ box: { color: '#000000', opacity: 0.8, pad_x: 12, pad_y: 8, radius: 6 } });
    if (/bold/.test(t)) cap({ weight: 700 });
    if (/regular|normal weight/.test(t)) cap({ weight: 400 });
    if (/bottom|lower captions/.test(t)) cap({ y: 360 });
    if (/top|higher captions/.test(t)) cap({ y: -350 });
    if (/center(?:ed)? captions/.test(t)) cap({ x: 0, y: 0 });
    if (/uppercase|all caps/.test(t)) cap({ case: 'upper' });
    if (/lowercase/.test(t)) cap({ case: 'lower' });
    if (/(?:hide|remove|disable) captions/.test(t)) edit.captions = { enabled: false };
    if (/(?:show|enable) captions/.test(t)) edit.captions = { ...edit.captions, enabled: true };
    if (/(?:remove|no) outline/.test(t)) cap({ stroke: { color: '#000000', width: 0 } });
    if (/(?:add|black) outline/.test(t)) cap({ stroke: { color: '#000000', width: 3 } });
    const zoom = t.match(/zoom(?: to)?\s*([\d.]+)/);
    if (zoom) edit.crop = { zoom: clamp(+zoom[1], 1, 3) };
    if (/unmute music/.test(t)) edit.music = { muted: false };
    else if (/mute music/.test(t)) edit.music = { muted: true };
    if (/quieter music/.test(t))
      edit.music = { gain_db: clamp((r.editing?.music?.gain_db ?? -18) - 4, -60, 6) };
    const title = text.match(/(?:title|hook):\s*["“](.+?)["”]/i);
    if (title) changes.title_text = title[1];
    const trim = t.match(/trim(?: it)? to\s*([\d.]+)\s*(?:s|sec|second)/);
    if (trim) {
      let left = clamp(+trim[1], 0.1, 60);
      changes.segments = [];
      for (const shot of r.shot_list) {
        if (left <= 0) break;
        const take = Math.min(left, shot.duration);
        changes.segments.push({ src: shot.source, s: shot.source_in, e: shot.source_in + take });
        left -= take;
      }
    }
  }
  if (Object.keys(edit).length) changes.editing = edit;
  if (negation && !Object.keys(changes).length)
    answers.push(
      'I kept the edit unchanged. Tell me the change you want directly, such as “warmer” or “remove the caption box”.',
    );
  if (Object.keys(changes).length)
    answers.unshift(
      'Here is a proposed edit for this reel. Apply it to rebuild the storyboard and GIF; rendering still needs your approval.',
    );
  if (!answers.length)
    answers.push(
      'I could not map that request to an edit, so nothing changed. Try “warmer and faster”, “yellow captions without a box”, “cuts every 1 second”, “trim to 10 seconds”, or ask about this reference. For an exact font, import its file in Captions.',
    );
  return { changes, explanation: answers.join('\n\n') };
}
