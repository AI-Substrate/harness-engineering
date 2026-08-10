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
  /**
   * A leading UTF-8 BOM was removed before parsing.
   *
   * Reported rather than swallowed so a CHANGE in what arrives on the wire is
   * visible the first time instead of the fiftieth. The caller rides it on a
   * journal entry it was already writing — a stripped BOM is not itself an event
   * worth a line of its own.
   */
  strippedBom: boolean;
  /**
   * Why the document could not be read, or `null` when nothing was wrong with it.
   *
   * THE OTHER HALF OF DO-NOT-GUESS. Returning an EMPTY payload is right and stays;
   * returning it *without saying so* is what made a parse failure the one thing
   * this runtime's journal could not record. `null` for an absent or blank input
   * too: nothing arriving is not a failure to parse, and calling it one would put
   * a journal line on disk for every fire that skipped stdin.
   */
  unparseable: UnparseableDetail | null;
}

/** What is safe to say about a document we could not read. */
export interface UnparseableDetail {
  /** The single failure this parser can have. A named constant, not a message. */
  reason: 'payload-not-json';
  /**
   * How much arrived, in BYTES ON THE WIRE — a size, never content.
   */
  rawLen: number;
  /**
   * The first {@link HEAD_HEX_BYTES} bytes AS RECEIVED, lowercase hex, space-separated.
   *
   * THE WIRE BYTES, NOT A RE-ENCODING OF A DECODED STRING, and that distinction is
   * the entire value of the field. This defect cost two hours because a text-mode
   * instrument decoded `EF BB BF` into the ASCII `n++` and the rendering was
   * trusted as a measurement; a `headHex` computed after a lossy UTF-8 decode
   * would repeat that error inside the record meant to prevent it. MEASURED: a
   * UTF-16LE payload (PowerShell 5.1's default when it redirects or pipes)
   * decodes to U+FFFD and re-encodes as `ef bf bd ef bf bd` — the replacement
   * character, identical for every unknown encoding. Read from the wire it is
   * `ff fe`, which NAMES the encoding on sight.
   *
   * THE BODY IS NEVER JOURNALLED: it carries `user_email` and `transcript_path`.
   * The head of a JSON document is punctuation and key names, and a bounded prefix
   * is the whole diagnostic — a three-byte BOM is exactly what a reader needs to
   * see, and it is what nobody could see for three sessions.
   */
  headHex: string;
}

/**
 * How many leading bytes {@link UnparseableDetail.headHex} reports.
 *
 * Enough to show a prefix and the brace behind it; far too few to carry a value.
 * Every encoding mark we could plausibly meet is 2–4 bytes: UTF-8 `EF BB BF`,
 * UTF-16LE `FF FE`, UTF-16BE `FE FF`. A BOM-less UTF-16 document has no mark at
 * all, and 8 bytes still names it — `7b 00 22 00` is a brace and a quote with
 * interleaved NULs, which is UTF-16LE written plainly.
 */
const HEAD_HEX_BYTES = 8;

const EMPTY: HookPayload = {
  repoRoot: null,
  command: null,
  toolName: null,
  strippedBom: false,
  unparseable: null,
};

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
 *
 * AND IT SAYS SO. That half was missing, and the omission was the defect: a
 * failure to parse returned before the caller's journal existed, so the hook
 * exited 0 and recorded nothing — an agent invoking it and an agent never
 * invoking it produced byte-identical evidence. Do-not-guess was implemented;
 * say-you-could-not-parse was not. {@link HookPayload.unparseable} is that half.
 *
 * A LEADING UTF-8 BOM IS STRIPPED, AND NOTHING ELSE IS. Cursor on Windows
 * prepends `EF BB BF` to the hook payload, `JSON.parse` rejects it, and that is
 * why the journal stayed empty across three sessions and ~58 real invocations.
 * The strip matches git-ai's `strip_utf8_bom` — one code point, at position zero,
 * or nothing.
 *
 * IT IS DELIBERATELY NOT A SCAN TO THE FIRST BRACE. That was proposed while the
 * prefix was believed to be ASCII junk of unknown shape, and it is WITHDRAWN: a
 * scan would silently swallow the genuinely malformed payloads that
 * {@link HookPayload.unparseable} exists to expose, reintroducing this very defect
 * behind a fix for it. A precise strip plus a recorded failure is strictly better
 * than tolerating whatever happens to precede a brace.
 */
export function parseHookPayload(raw: string | Uint8Array | null): HookPayload {
  if (raw === null) return EMPTY;
  // The BYTES are kept whole, unconditionally, because they are the only faithful
  // description of a document we may be about to fail to read.
  const bytes = typeof raw === 'string' ? Buffer.from(raw, 'utf8') : Buffer.from(raw);
  const decoded = typeof raw === 'string' ? raw : bytes.toString('utf8');
  if (decoded.trim().length === 0) return EMPTY;
  // One BOM, at position zero. `^` and no `g` are the whole precision.
  const text = decoded.replace(/^\uFEFF/, '');
  const strippedBom = text.length !== decoded.length;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ...EMPTY, strippedBom, unparseable: describeUnparseable(bytes) };
  }
  if (typeof parsed !== 'object' || parsed === null) return { ...EMPTY, strippedBom };
  const doc = parsed as Record<string, unknown>;
  const toolInput = (
    typeof doc.tool_input === 'object' && doc.tool_input !== null ? doc.tool_input : {}
  ) as Record<string, unknown>;
  const roots = Array.isArray(doc.workspace_roots) ? doc.workspace_roots : [];

  return {
    repoRoot: firstString(toolInput.cwd, roots[0], doc.cwd, doc.workspace_root),
    command: firstString(toolInput.command, doc.command),
    toolName: firstString(doc.tool_name, doc.toolName),
    strippedBom,
    unparseable: null,
  };
}

/**
 * Everything we are willing to say about a document we could not read.
 *
 * Describes the RAW BYTES, BOM included: the reader needs to see what actually
 * arrived, and a head reported after stripping — or after a decode — would hide
 * the very prefix that caused this investigation. A caller that hands us a string
 * has already decoded, so this can only be as faithful as its input; the runtime
 * caller hands us bytes for exactly that reason.
 *
 * WE DO NOT DECODE UTF-16, DELIBERATELY. git-ai's decoder handles UTF-16LE and BE
 * by BOM plus a NUL-position heuristic for BOM-less UTF-16, and PowerShell 5.1
 * defaults to UTF-16LE when it redirects or pipes, so the case is plausible on the
 * platform this defect came from. But nothing we have MEASURED sends it to us, and
 * an unmeasured decode path is speculation — the same guessing this parser
 * refuses. The bargain is that the failure DESCRIBES ITSELF instead: a UTF-16
 * payload journals `unparseable` with a `headHex` beginning `ff fe` or `fe ff`,
 * and a BOM-less one shows `7b 00 22 00` — a brace and a quote with interleaved
 * NULs. Either is diagnosable from the record alone, in seconds, by someone who
 * has never read this file.
 */
function describeUnparseable(bytes: Buffer): UnparseableDetail {
  const head = bytes.subarray(0, HEAD_HEX_BYTES);
  return {
    reason: 'payload-not-json',
    rawLen: bytes.length,
    headHex: [...head].map((byte) => byte.toString(16).padStart(2, '0')).join(' '),
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
