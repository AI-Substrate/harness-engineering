import type { FsPort } from '../../adapters/fs/fs-port.js';
import { posixJoin, toPosix } from '../shared/posix-path.js';

/**
 * codex rollout-ledger reader (plan 052 · T004 — dossier F-02). codex lanes are
 * recoverable: every rollout `~/.codex/sessions/<Y>/<M>/<D>/rollout-*.jsonl` carries
 * per-turn `token_count` events, and the LAST one's `payload.info.total_token_usage`
 * is the session's running total (input / output / cached / reasoning / total). This
 * reader recovers that grand total deterministically.
 *
 * PURE + FAIL-SAFE: `extractCodexLedger` is a pure function of the file text; any
 * missing / malformed shape degrades to `measured:false` with null buckets (AC-02)
 * — never a throw, never a guessed number. PRIVACY (P12): only the token counts +
 * the context-window size are lifted; no message/response bodies are read.
 *
 * JOIN (F-04): the pij descriptor's `transcriptPath` points straight at the rollout
 * file (preferred); absent that, {@link findCodexRollout} locates it by the harness
 * session id embedded in the rollout filename.
 */

/** codex `total_token_usage` buckets — the running session total. */
export interface CodexTokenBuckets {
  input: number | null;
  output: number | null;
  cached: number | null;
  reasoning: number | null;
  total: number;
}

/** The recovered codex token record, or an honest unmeasured shell. */
export interface CodexLedger {
  /** `true` iff a `token_count` event with a numeric `total_tokens` was found. */
  measured: boolean;
  token_buckets: CodexTokenBuckets | null;
  /** `model_context_window` if the last token_count carried it, else null. */
  context_window: number | null;
}

const UNMEASURED: CodexLedger = { measured: false, token_buckets: null, context_window: null };

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/**
 * Extract the codex token total from a rollout `jsonl` text (pure). Reads the LAST
 * `token_count` event's `payload.info.total_token_usage`. Any absence / malformed
 * shape → {@link UNMEASURED} (never throws).
 */
export function extractCodexLedger(rolloutJsonl: string): CodexLedger {
  let info: Record<string, unknown> | null = null;
  for (const line of rolloutJsonl.split('\n')) {
    const t = line.trim();
    if (t === '' || !t.includes('token_count')) continue;
    try {
      const e = JSON.parse(t) as Record<string, unknown>;
      // The event is `{type:'token_count', payload:{info:{...}}}` (payload may also
      // re-tag its own `type`); accept either the top-level or payload tag.
      const payload = obj(e.payload);
      const isTokenCount = e.type === 'token_count' || payload.type === 'token_count';
      if (!isTokenCount) continue;
      const candidate = obj(payload.info);
      if (Object.keys(candidate).length > 0) info = candidate;
    } catch {
      // a corrupt line is skipped, never fatal
    }
  }
  if (info === null) return UNMEASURED;

  const usage = obj(info.total_token_usage);
  const total = num(usage.total_tokens);
  if (total === null) return UNMEASURED; // no grand total → honestly unmeasured
  return {
    measured: true,
    token_buckets: {
      input: num(usage.input_tokens),
      output: num(usage.output_tokens),
      cached: num(usage.cached_input_tokens),
      reasoning: num(usage.reasoning_output_tokens),
      total,
    },
    context_window: num(info.model_context_window),
  };
}

/** The `~/.codex/sessions` root for a resolved home, in POSIX form. */
export function codexSessionsRoot(home: string): string {
  return posixJoin(toPosix(home), '.codex', 'sessions');
}

/**
 * Locate a codex rollout file by the harness session id embedded in its filename,
 * walking `~/.codex/sessions/<Y>/<M>/<D>/`. Returns the first match's POSIX path, or
 * null. Bounded + fail-safe: a missing tree / unreadable dir → null (never throws).
 * The pij `transcriptPath` is the preferred join — this is the fallback locator.
 */
export function findCodexRollout(
  fs: Pick<FsPort, 'readdir'>,
  home: string | undefined,
  sessionId: string,
): string | null {
  if (!home || sessionId.length === 0) return null;
  const root = codexSessionsRoot(home);
  for (const year of fs.readdir(root).filter((y) => /^\d{4}$/.test(y))) {
    const yPath = posixJoin(root, year);
    for (const month of fs.readdir(yPath).filter((m) => /^\d{2}$/.test(m))) {
      const mPath = posixJoin(yPath, month);
      for (const day of fs.readdir(mPath).filter((d) => /^\d{2}$/.test(d))) {
        const dPath = posixJoin(mPath, day);
        for (const name of fs.readdir(dPath)) {
          if (/^rollout-.*\.jsonl$/.test(name) && name.includes(sessionId)) {
            return posixJoin(dPath, name);
          }
        }
      }
    }
  }
  return null;
}

/**
 * Read + extract a codex lane's token ledger from a rollout path. Missing path →
 * {@link UNMEASURED} (never throws). Ports-only (P2).
 */
export function readCodexLedger(
  fs: Pick<FsPort, 'readText'>,
  rolloutPath: string | null | undefined,
): CodexLedger {
  if (!rolloutPath) return UNMEASURED;
  const raw = fs.readText(rolloutPath);
  if (raw === null) return UNMEASURED;
  return extractCodexLedger(raw);
}
