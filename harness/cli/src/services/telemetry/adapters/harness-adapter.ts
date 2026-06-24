import type { DbPort } from '../../../adapters/db/db-port.js';
import type { EnvPort } from '../../../adapters/env/env-port.js';
import type { FsPort } from '../../../adapters/fs/fs-port.js';
import type { Event } from '../events.js';
import type {
  SegmentCompaction,
  SegmentFiles,
  SegmentModelStat,
  SegmentSubagentInput,
  SegmentThinking,
  SegmentTokens,
  SegmentWindow,
} from '../segment.js';

/**
 * The per-harness capability seam (plan 034, T004 — pulled into Phase 1 per
 * validation F1 so Phase 2 implements adapters AGAINST this interface without
 * editing the capture core). A `HarnessAdapter` turns one harness's native
 * session artifacts into counts-only {@link HarnessCapabilities}.
 *
 * AC-12: a new harness adapter registers as a capability module WITHOUT changing
 * the segment schema or capture core. Every capability is optional/nullable —
 * an unimplemented or unavailable capability is `null` (never estimated), and
 * the serializer fills the segment default, so the schema never changes.
 *
 * Ports-only (P2): an adapter reads through injected `env`/`fs`, never `node:*`.
 */

/** The window-independent source an adapter reads — used to probe the current extent. */
export interface HarnessSource {
  env: EnvPort;
  fs: FsPort;
  /**
   * Read-only SQLite access for harnesses whose richer signal lives in a local
   * db (e.g. Cursor's `state.vscdb` model attribution). Optional: adapters that
   * read only text files never touch it, and the null-default never has one.
   */
  db?: DbPort;
  /** Repo root (posix) — for path relativization. */
  repoRoot: string;
  /** The detected harness id this extraction is for. */
  harness: string;
}

/** Read-only context an adapter extracts counts from (a source + the computed window). */
export interface HarnessContext extends HarnessSource {
  /** The "since last command" window the cursor computed. */
  window: SegmentWindow;
}

/**
 * Counts-only capabilities an adapter can extract. EVERY field is optional and
 * nullable: `null` means "unavailable / unimplemented" — never estimated, never
 * dropped (the serializer supplies the segment default).
 */
export interface HarnessCapabilities {
  harness_session_id?: string | null;
  tokens?: SegmentTokens | null;
  models?: Record<string, SegmentModelStat> | null;
  effort?: string | null;
  skills?: Record<string, number> | null;
  tools?: Record<string, number> | null;
  user_prompts?: number[] | null;
  subagents?: SegmentSubagentInput[] | null;
  files?: SegmentFiles | null;
  compactions?: SegmentCompaction[] | null;
  api_errors?: number | null;
  local_commands?: number | null;
  thinking?: SegmentThinking | null;
  /**
   * v2.0 — the ordered, timestamped event stream for the window (the substrate;
   * the rollup is derived from it by the serializer). `null` when the harness's
   * source carries no timestamps (e.g. a transcript without `timestamp` lines).
   */
  event_stream?: Event[] | null;
}

/** A per-harness capability module (Claude / Copilot / Cursor / …). The plug-in seam. */
export interface HarnessAdapter {
  /** Stable harness id this adapter handles (e.g. `claude-code`); `*` = catch-all. */
  readonly harness: string;
  /** Does this adapter handle the detected harness id? */
  handles(harnessId: string): boolean;
  /**
   * The current extent of the harness's session source (e.g. transcript byte
   * size), used by the cursor to compute the "since last command" window.
   * `null` when the source is missing/unreadable (→ an empty window — no data to
   * capture this command). Optional: the null-default has no source.
   */
  currentPosition?(src: HarnessSource): number | null;
  /** Extract counts-only capabilities for the window; each capability `null` if unavailable. */
  extract(ctx: HarnessContext): HarnessCapabilities;
}

/**
 * The null-default adapter — the seam's safety net (AC-12). Handles ANY detected
 * harness and returns all-null capabilities, so a harness that is present in the
 * environment but has no specific adapter yet still produces a schema-valid,
 * all-null segment — no schema or capture-core change needed to add a future
 * harness. Phase 2's real Claude/Copilot adapters are matched ahead of it.
 */
export const nullDefaultAdapter: HarnessAdapter = {
  harness: '*',
  handles: () => true,
  extract: () => ({
    harness_session_id: null,
    tokens: null,
    models: null,
    effort: null,
    skills: null,
    tools: null,
    user_prompts: null,
    subagents: null,
    files: null,
    compactions: null,
    api_errors: null,
    local_commands: null,
    thinking: null,
    event_stream: null,
  }),
};
