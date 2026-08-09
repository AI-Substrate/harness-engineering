import type { FsPort } from '../../adapters/fs/fs-port.js';

/**
 * The agent's hook payload (plan 082 tk-0009) — parsed defensively, because it is
 * the one input this runtime does not control.
 *
 * Every field is optional and every failure yields a value rather than a throw. A
 * hook that crashed on a payload shape it did not expect would break the agent it
 * is supposed to observe, on a version bump nobody tested against.
 */
export interface HookPayload {
  /** The repository this fire concerns, or `null` when the payload does not say. */
  repoRoot: string | null;
  /** The bracket's command line, for the second guard layer. */
  command: string | null;
  /** The agent's tool name, journalled for diagnosis. Never a decision input. */
  toolName: string | null;
}

const EMPTY: HookPayload = { repoRoot: null, command: null, toolName: null };

function firstString(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate;
  }
  return null;
}

/**
 * Parse an agent hook payload.
 *
 * MEASURED shape (Cursor, from captured PRE records): `tool_name`, and
 * `tool_input.command` / `tool_input.cwd`. `workspace_roots[0]` is the POC's
 * fallback and is kept because it is what the proven prototype read.
 *
 * Anything unparseable is an EMPTY payload, never a partial guess: a repo path
 * inferred from a malformed document could point the state store at the wrong
 * repository, and mis-attributing to the wrong repo is worse than not firing.
 */
export function parseHookPayload(raw: string | null): HookPayload {
  if (raw === null || raw.trim().length === 0) return EMPTY;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (typeof parsed !== 'object' || parsed === null) return EMPTY;
  const doc = parsed as Record<string, unknown>;
  const toolInput = (
    typeof doc.tool_input === 'object' && doc.tool_input !== null ? doc.tool_input : {}
  ) as Record<string, unknown>;
  const roots = Array.isArray(doc.workspace_roots) ? doc.workspace_roots : [];

  return {
    repoRoot: firstString(toolInput.cwd, roots[0], doc.cwd, doc.workspace_root),
    command: firstString(toolInput.command, doc.command),
    toolName: firstString(doc.tool_name, doc.toolName),
  };
}

/**
 * Tool names that cannot possibly be commit-bearing.
 *
 * The hook fires on EVERY tool call — measured at ~38 invocations across a
 * 19-tool-call run — and Node starts far slower than git-ai's Rust binary. Exiting
 * before any git work on a tool that cannot have committed is the mitigation the
 * plan's Node-startup watch-item names.
 *
 * Deliberately a DENY list of names known to be read-only, not an allow list of
 * names known to commit: an unrecognised tool must still be observed, because the
 * cost of skipping a real commit is a lost note while the cost of observing a
 * harmless one is a few milliseconds.
 */
const NEVER_COMMIT_BEARING = new Set(['read', 'read_file', 'glob', 'grep', 'search', 'list_dir']);

export function couldBeCommitBearing(toolName: string | null): boolean {
  if (toolName === null) return true;
  return !NEVER_COMMIT_BEARING.has(toolName.trim().toLowerCase());
}

/**
 * Where a repository's hook state and journal live. Under the user's home so the
 * observed repository is never written to — the hook must leave no trace in the
 * tree the agent is working in.
 */
export function hookStateDir(home: string): string {
  return `${home}/.harness/hooks`;
}

export function hookJournalPath(home: string): string {
  return `${hookStateDir(home)}/fires.jsonl`;
}

/** True when `path` looks like a git repository we can act on. */
export function looksLikeRepo(fs: FsPort, repoRoot: string | null): boolean {
  return repoRoot !== null && fs.exists(`${repoRoot}/.git`);
}
