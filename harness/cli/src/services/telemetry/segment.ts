import {
  isWithin,
  posixJoin,
  posixNormalize,
  posixRelative,
  toPosix,
} from '../shared/posix-path.js';

/**
 * The `segment` — the normalized, **counts-only** per-session telemetry record
 * (plan 034 Phase 1). This is the load-bearing cross-tool / cross-repo contract
 * consumed by the downstream eng-thrive scraper, mirrored by `segment.schema.json`
 * (kept key-set-equal by `segment-schema.test.ts`).
 *
 * PRIVACY (AC-04, Constitution P12): a segment carries ONLY allowlisted counts
 * and identifiers — never prompt/message text, file contents, or free-form
 * tool-arg strings, and file paths are repo-relative (never absolute `/Users/…`).
 * The guarantee is structural: {@link serializeSegment} is an allowlist BY
 * CONSTRUCTION — it picks each field explicitly and never spreads its input — so
 * a stray field handed in by an adapter or caller cannot reach the output.
 *
 * All capability fields are nullable; an unimplemented capability serializes
 * `null` / empty (never absent, never estimated).
 */

/** The cross-tool schema version of the segment contract. Bump on a field-set change. */
export const SEGMENT_SCHEMA_VERSION = '1.0';

export interface SegmentTokens {
  input: number;
  output: number;
  cache_create: number;
  cache_read: number;
  total: number;
  subagent_tokens: number;
  grand_total: number;
}

export interface SegmentModelStat {
  turns: number;
  output_tokens: number;
}

export interface SegmentSubagent {
  type: string | null;
  agent_name: string | null;
  model: string | null;
  status: string | null;
  tokens: number | null;
  tool_uses: number | null;
}

export interface SegmentWindow {
  /** `session-start` on the first capture of a session; `last-command` thereafter. */
  since: 'session-start' | 'last-command';
  /** Source-relative window bounds (byte/line offsets — counts, not content). */
  from: number;
  to: number;
}

export interface SegmentFiles {
  written: string[];
  edited: string[];
}

export interface SegmentCompaction {
  trigger: string | null;
  pre_tokens: number;
  post_tokens: number;
}

export interface SegmentEvents {
  compactions: SegmentCompaction[];
  api_errors: number;
  local_commands: number;
}

export interface SegmentThinking {
  blocks: number;
}

/** The normalized counts-only segment. Every top-level key is in {@link SEGMENT_FIELD_KEYS}. */
export interface Segment {
  schema_version: string;
  /** The harness command that triggered capture (e.g. `flow`). */
  command: string;
  /** The detected innermost harness (`claude-code` | `copilot-cli` | `cursor` | …). */
  harness: string;
  /** Opaque correlation handle — NOT an individual identity (AC-11/13). */
  harness_session_id: string;
  timecode: string;
  window: SegmentWindow;
  branch: string | null;
  branch_changed: boolean;
  tokens: SegmentTokens | null;
  models: Record<string, SegmentModelStat>;
  effort: string | null;
  skills: Record<string, number>;
  tools: Record<string, number>;
  subagents: SegmentSubagent[];
  files: SegmentFiles;
  plans_touched: string[];
  events: SegmentEvents;
  thinking: SegmentThinking | null;
}

/**
 * The canonical allowlist — the EXACT top-level field set of a {@link Segment}.
 * `segment-schema.test.ts` asserts `segment.schema.json`'s property set equals
 * this (key-set equality, not subset), and T001 asserts a serialized segment's
 * keys equal this. Adding a field here without bumping {@link SEGMENT_SCHEMA_VERSION}
 * trips the version-freeze test.
 */
export const SEGMENT_FIELD_KEYS = [
  'schema_version',
  'command',
  'harness',
  'harness_session_id',
  'timecode',
  'window',
  'branch',
  'branch_changed',
  'tokens',
  'models',
  'effort',
  'skills',
  'tools',
  'subagents',
  'files',
  'plans_touched',
  'events',
  'thinking',
] as const;

/** The loosely-typed capture input the serializer narrows into a clean {@link Segment}. */
export interface SegmentInput {
  command: string;
  harness: string;
  harness_session_id: string;
  timecode: string;
  window: SegmentWindow;
  branch: string | null;
  branch_changed: boolean;
  tokens?: SegmentTokens | null;
  models?: Record<string, SegmentModelStat>;
  effort?: string | null;
  skills?: Record<string, number>;
  tools?: Record<string, number>;
  subagents?: SegmentSubagent[];
  files?: { written?: string[]; edited?: string[] };
  plans_touched?: string[];
  events?: Partial<SegmentEvents>;
  thinking?: SegmentThinking | null;
}

const ABSOLUTE_LOGICAL = /^([A-Za-z]:)?\//;

/**
 * Reduce a path to a privacy-safe, repo-relative form:
 * - inside the repo (absolute OR relative) → relative to `repoRoot` (e.g. `src/x.ts`);
 * - OUTSIDE the repo (absolute, OR a `..`-climbing relative path) → basename only
 *   — the directory (incl. any `/Users/…` or `../…`) is dropped, never leaked.
 *
 * A relative input is resolved against `repoRoot` BEFORE the containment check so
 * a `../outside/secret.txt` traversal can never pass through unchanged
 * (companion F001 — AC-04).
 */
function relativizePath(raw: string, repoRoot: string): string {
  const root = posixNormalize(toPosix(repoRoot));
  const p = toPosix(raw);
  const abs = ABSOLUTE_LOGICAL.test(p) ? posixNormalize(p) : posixNormalize(posixJoin(root, p));
  if (isWithin(root, abs)) {
    const rel = posixRelative(root, abs);
    return rel === '' ? '.' : rel;
  }
  return abs.split('/').pop() ?? '';
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Serialize a capture input into a clean counts-only {@link Segment}. ALLOWLIST
 * BY CONSTRUCTION: every field is picked explicitly — the input is never spread —
 * so a planted secret / raw content in a non-allowlisted field cannot reach the
 * output. File paths are relativized; `plans_touched` is deduped.
 */
export function serializeSegment(input: SegmentInput, repoRoot: string): Segment {
  return {
    schema_version: SEGMENT_SCHEMA_VERSION,
    command: input.command,
    harness: input.harness,
    harness_session_id: input.harness_session_id,
    timecode: input.timecode,
    window: {
      since: input.window.since,
      from: input.window.from,
      to: input.window.to,
    },
    branch: input.branch,
    branch_changed: input.branch_changed,
    tokens: input.tokens ?? null,
    models: input.models ?? {},
    effort: input.effort ?? null,
    skills: input.skills ?? {},
    tools: input.tools ?? {},
    subagents: (input.subagents ?? []).map((s) => ({
      type: s.type ?? null,
      agent_name: s.agent_name ?? null,
      model: s.model ?? null,
      status: s.status ?? null,
      tokens: s.tokens ?? null,
      tool_uses: s.tool_uses ?? null,
    })),
    files: {
      written: (input.files?.written ?? []).map((p) => relativizePath(p, repoRoot)),
      edited: (input.files?.edited ?? []).map((p) => relativizePath(p, repoRoot)),
    },
    plans_touched: dedupe(input.plans_touched ?? []),
    events: {
      compactions: (input.events?.compactions ?? []).map((c) => ({
        trigger: c.trigger ?? null,
        pre_tokens: c.pre_tokens,
        post_tokens: c.post_tokens,
      })),
      api_errors: input.events?.api_errors ?? 0,
      local_commands: input.events?.local_commands ?? 0,
    },
    thinking: input.thinking ?? null,
  };
}
