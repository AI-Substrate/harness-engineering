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

/** The facts every extraction has, in either mode. Never constructed directly. */
interface HarnessSourceBase {
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
  /**
   * The resolved session id for THIS capture, threaded by the capture core so an
   * adapter never re-derives it from a mutable source. For env-keyed harnesses
   * it's the session-id env var; for VS Code Copilot Chat it's the ONCE-resolved
   * cwd→latest-session lookup.
   */
  sessionId?: string;
  /**
   * Standard Claude's selected config root and the complete bounded set of
   * explicit Git worktree roots for this capture. The object identity is shared
   * by position and extraction so the adapter can memoize one safe resolution.
   */
  readonly standardClaude?: {
    readonly configRoot: string;
    readonly projectRoots: readonly string[];
  };
}

/**
 * A LIVE extraction: the running process IS the session, so its environment is a
 * fact about the work being captured and the adapter may read it.
 */
export interface LiveHarnessSource extends HarnessSourceBase {
  env: EnvPort;
  /** Never set in live mode — the discriminant against {@link ReconcileHarnessSource}. */
  readonly reconcile?: undefined;
}

/**
 * A RECONCILED extraction (plan 070): a window recovered LONG after its session
 * ended, from inside a *different, live* process.
 *
 * There is NO {@link EnvPort} here, and that absence is the point. Environment at
 * recovery time describes the RECOVERING shell — its `CLAUDE_EFFORT`, its `HOME`
 * and `APPDATA`, its session-id vars — none of which are facts about the lane
 * being recovered. An adapter that read them would attribute the recovering
 * agent's effort level, or select the recovering user's model/timing store, and
 * stamp both onto a dead session's segment: a cross-lane fabrication that reads
 * as measurement. Taking the port away makes that a COMPILE error rather than a
 * convention, so a future adapter cannot reintroduce it by forgetting.
 *
 * What remains is exactly the immutable evidence the lane's own liveness marker
 * recorded. Any fact that cannot be established from those sources is OMITTED
 * (`null`) — never inherited from the recovery process.
 */
export interface ReconcileHarnessSource extends HarnessSourceBase {
  /** Structurally unavailable — see the interface doc. */
  readonly env?: undefined;
  readonly reconcile: {
    /** The session source file recorded on the marker when the lane was alive. */
    readonly sourcePath: string;
    /** The lane's own session id — the ONLY id this extraction may attribute to. */
    readonly sessionId: string;
  };
}

/**
 * The window-independent source an adapter reads — used to probe the current extent.
 *
 * A UNION, not a flag: `src.env` is `EnvPort | undefined` until the code proves
 * which mode it is in (see {@link ReconcileHarnessSource}).
 */
export type HarnessSource = LiveHarnessSource | ReconcileHarnessSource;

/** Read-only context an adapter extracts counts from (a source + the computed window). */
export type HarnessContext = HarnessSource & {
  /** The "since last command" window the cursor computed. */
  window: SegmentWindow;
  /**
   * Capture wall-clock (ISO) — the window's END anchor, threaded by the capture
   * core so an adapter over an UNTIMED source (cursor's transcript carries no
   * timestamps) can stamp events with `t_precision: 'interval'` instead of
   * dropping them. Optional: timed sources never need it.
   */
  capturedAt?: string;
};

/**
 * Counts-only capabilities an adapter can extract. EVERY field is optional and
 * nullable: `null` means "unavailable / unimplemented" — never estimated, never
 * dropped (the serializer supplies the segment default).
 */
export interface HarnessCapabilities {
  harness_session_id?: string | null;
  tokens?: SegmentTokens | null;
  /**
   * WHY tokens are absent, when the harness can say precisely (finding 07). A bare
   * `tokens: null` renders as the generic `no_observation` on every surface, so a
   * token-blind session could only be diagnosed by source-diving. Adapters that
   * resolve a transcript set the closed reason they already computed.
   */
  token_unavailable_reason?: string | null;
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
  /**
   * The path whose extent {@link HarnessAdapter.currentPosition} measures — the
   * session's own source file (plan 070). Optional: an adapter whose source is
   * not a single file (or a null-default with no source at all) omits it, and
   * liveness simply makes no residue claim about that harness.
   *
   * It exists so a lane's UNCONSUMED RESIDUE stays checkable AFTER the session
   * stops running commands. Every in-flight signal is blind to the failure where
   * the source itself lags: each attempt honestly sees "nothing new", captures
   * nothing, and the transcript only reaches its full length once no further
   * harness invocation will ever look at it. Recording the path lets `doctor`
   * re-measure the source later and notice a watermark that never caught up.
   */
  sourcePath?(src: HarnessSource): string | null;
  /**
   * Declares that this adapter has a real {@link ReconcileHarnessSource} path —
   * i.e. it can read its source and identify its session from the marker's
   * recorded facts ALONE, with no env (plan 070).
   *
   * Opt-in, and absent by default, because the failure of the alternative is
   * silent: an adapter that only knows how to find its source through env would,
   * asked to reconcile, either read nothing (and have that misreported as "the
   * source holds no evidence") or — worse — resolve some other live session's
   * store. The reconciler skips any adapter that has not declared this, and
   * `doctor` names those lanes unrecoverable rather than pretending.
   */
  readonly reconciles?: true;
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
