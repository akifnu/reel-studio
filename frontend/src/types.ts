export type TextStyle = {
  font?: string;
  weight?: number;
  size?: number;
  fill?: string;
  y?: number;
  x?: number;
  case?: string;
  stroke?: { color?: string; width?: number };
  box?: {
    color?: string;
    opacity?: number;
    per_line?: boolean;
    radius?: number;
    pad_x?: number;
    pad_y?: number;
  };
  line_height?: number;
  max_width?: number;
  words_per_caption?: number;
  highlight?: { fill?: string; mode?: string };
  anim?: { in?: string; in_dur?: number };
};
export type ColourStats = { mean: number[]; deviation: number[]; saturation: number };
export type ColourGrade = {
  gain: number[];
  offset: number[];
  saturation: number;
  strength: number;
};
export type PacingAnalysis = {
  cuts: number[];
  median_shot: number;
  confidence: 'measured' | 'no-cuts';
  interval: number;
};
export type CaptionAnalysis = {
  look?: ColourStats;
  pacing?: PacingAnalysis;
  method?: 'boxed' | 'ocr';
  font_match?: string;
  ocr_text?: string;
  preview?: { image: string; t: number };
  version?: number;
  window_seconds?: number;
  times?: number[];
  status: 'detected' | 'unsupported';
  frames: number;
  matches: number;
  style?: TextStyle;
  notes: string;
};
export type Editing = {
  colour?: ColourGrade;
  pacing?: { target: number; reframes: boolean };
  captions?: { enabled?: boolean; style?: TextStyle };
  crop?: { x?: number; y?: number; zoom?: number };
  music?: { gain_db?: number; muted?: boolean };
  sfx?: { gain_db?: number; muted?: boolean };
  motion?: { punch_rate?: number; push_rate?: number };
};
export type Segment = { src: string; sentences?: number[]; s?: number; e?: number };
export type Changes = {
  title?: string;
  title_text?: string;
  cta?: string;
  caption_text?: Record<string, string>;
  emphasis?: string[];
  segments?: Segment[];
  editing?: Editing;
};
export type Style = {
  sample?: { height?: number; width?: number };
  captions?: { present?: boolean; style?: TextStyle };
  motion?: { punch_rate?: number; push_rate?: number };
  audio?: { music?: { gain_db?: number }; sfx?: { gain_db?: number } };
};
export type Shot = {
  start: number;
  duration: number;
  source: string;
  source_in: number;
  source_out: number;
};
export type CaptionEvent = {
  s: number;
  e: number;
  text: string;
  role?: string;
  words?: { w: string; s: number; e: number }[];
};
export type Reel = Changes & {
  id: string;
  duration: number | null;
  speech: string;
  segments: Segment[];
  hook?: Segment;
  frames: { t: number; url: string }[];
  gif: { url: string | null; duration?: number; sampled_ranges?: { s: number; e: number }[] };
  shot_list: Shot[];
  caption_events: CaptionEvent[];
  text_events: CaptionEvent[];
  effective_style: Style;
  render: {
    url: string | null;
    status: string | null;
    qc_verdict: string | null;
    issues: unknown[];
    error: string | null;
    sha256: string | null;
  };
};
export type Sentence = { id: number; s: number; e: number; text: string; w0: number; w1: number };
export type Source = {
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
  duration: number;
};
export type Need = {
  step: string;
  need_id: string;
  revision: number;
  storyboard_sha256?: string;
  errors?: string[];
  notes?: string;
  limitations?: string;
  storyboard_feedback?: { notes: string }[];
  fixes?: unknown[];
  assigned?: { id: string; render_sha256: string; qc_verdict: string; issues: unknown[] }[];
};
export type Comment = {
  id: string;
  job_id: string;
  reel_id: string;
  generation: number;
  time: number;
  text: string;
  resolved: boolean;
  at: number;
};
export type Project = {
  browserProgress?: string;
  browserReady?: boolean;
  id: string;
  name: string;
  demo: boolean;
  status: string;
  revision: number;
  generation: number;
  terminal: boolean;
  busy: boolean;
  needs: Need | null;
  reels: Reel[];
  style: Style;
  sources: Record<string, Source>;
  transcripts: Record<string, { sentences: Sentence[]; timing: string; lang: string }>;
  reference?: {
    id: string;
    name: string;
    notes: string;
    mode: 'manual' | 'analyzed' | 'caption-measured';
    caption_analysis?: CaptionAnalysis;
    baselineVersion?: number;
    matchError?: string;
    autoMatchAttempted?: boolean;
    autoMatchVersion?: number;
    source_look?: ColourStats;
    matched_colour?: ColourGrade;
  };
  sample_url: string | null;
  sample_review_url: string | null;
  music_url: string | null;
  storyboard: {
    frames: number;
    gif_frames: number;
    elapsed_s: number | null;
    cache_hits: number;
    estimated_render_frames: number;
    sheet_url: string | null;
    limitations: string;
    limits: Record<string, number>;
  };
  comments: Comment[];
  history: { id: string; at: number; description: string; generation: number }[];
  activity: { at: string; msg: string }[];
  error: { cause: string } | null;
  counts: Record<string, number> | null;
  deliverables: { name: string; url: string }[];
};
export type ProjectSummary = {
  id: string;
  name: string;
  status: string;
  terminal: boolean;
  demo: boolean;
  created: string;
};
export type Config = {
  ai_enabled: boolean;
  fonts: string[];
  max_upload_bytes: number;
  presets: string[];
  storyboard_limits: Record<string, number>;
};
export type Upload = {
  id: string;
  name: string;
  role: string;
  bytes: number;
  preview_url?: string;
  caption_analysis?: CaptionAnalysis;
};
export type Proposal = {
  changes: Changes;
  explanation: string;
  provider: string;
  generation: number;
};
