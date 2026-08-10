import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { AgentSpec } from './agent-matrix.js';
import { eventKeys, phaseKeys, resolveConfigFiles } from './agent-matrix.js';
import { extractBinaryPath } from './binary-path.js';
import { appendToArray, setValue, writeThroughSymlink } from './config-writer.js';
import { entryIsOwnedByUs, HOOK_MARKER, HOOK_MARKER_FLAG } from './hook-marker.js';

/**
 * STRATEGY A — merge our hook entry into an agent's JSON config (plan 082 tk-0005).
 *
 * ONE code path for all seven agents. Everything that differs between them is read
 * from the matrix row, so adding an agent is adding a row — proven by driving a
 * FAKE agent row through this same function with no code change (dw-0010).
 *
 * THE ABSENT-FILE CASE IS FIRST-CLASS, NOT AN EDGE. It is not hypothetical:
 * `collector/evidence.ts` already records that git-ai created copilot's hooks file
 * fresh on this machine. A detected agent with no config yet is a NORMAL state, and
 * it is one situation with THREE consequences that must be kept together:
 *
 * 1. **Create** the file AND its parent directories, with a defined skeleton — an
 *    agent whose config we create must end up with a document the agent can read,
 *    not a fragment.
 * 2. **It is created-not-backed-up, NOT covered.** `backupAgentConfigs` skips a
 *    non-existent source, so no backup exists for this agent — and "no backup" and
 *    "backed up successfully" must never look the same to a caller. That is what
 *    {@link InstallOutcome.created} is for.
 * 3. **Uninstall's symmetry is DELETE, not restore.** There are no original bytes
 *    to restore, so restoring is undefined. Recorded here for tk-000d rather than
 *    solved here: the flag this install returns is the input that decision needs.
 */

/** The document written when an agent has no config at all. */
export interface Skeleton {
  hooks: Record<string, unknown[]>;
}

export interface InstallOutcome {
  agent: string;
  /** Absolute path written. */
  path: string;
  /**
   * TRUE when this install CREATED the file (and possibly its parents).
   *
   * Load-bearing beyond reporting: a created file has NO BACKUP — `backupAgentConfigs`
   * skips a non-existent source — so uninstall must DELETE it rather than restore
   * bytes that never existed. A boolean here is what stops "we created it" and "we
   * modified it" being indistinguishable later, which is when the wrong uninstall
   * gets written.
   */
  created: boolean;
  /** TRUE when our entry was already present, so nothing was written (idempotency). */
  alreadyPresent: boolean;
  /**
   * Event-array keys that did NOT exist in this file before we wrote — i.e. keys
   * `appendToArray` created (plan 082, phase-2 review F003).
   *
   * PROVENANCE, RECORDED AT THE ONLY MOMENT IT IS KNOWABLE. Uninstall used to infer
   * "we created this key" from "this array is now empty", which is not the same
   * question: a user who already had an empty `PreToolUse: []` lost it. The cross-model
   * review confirmed that as a contract violation independent of whether any loader
   * treats absent and empty alike — the promise is surgical removal of what WE added,
   * and an empty array we did not add is not ours to remove.
   *
   * By the time uninstall runs, the difference is unrecoverable from the file itself.
   * So it is captured here and persisted (`install-record.ts`).
   */
  createdKeys: string[];
  /**
   * Root-field paths THIS INSTALL created — e.g. `['tools','enableHooks']` or
   * `['version']` (plan 082, phase-5 review F2).
   *
   * SAME PROVENANCE PROBLEM AS `createdKeys`, ONE LEVEL UP, and it was missed
   * because retention was made unconditional instead. Uninstall retained every root
   * field on the argument that it might belong to a peer — true when a peer exists,
   * and on a config with no other hook consumer it just meant
   * `{"tools":{"enableHooks":true}}` left behind forever: our write, rationalised as
   * shared.
   *
   * KNOWABLE ONLY HERE. Afterwards the field exists and nothing in the file says who
   * put it there. Recorded per PATH, and the path shape carries the second half of
   * the answer: an ABSENT `tools` records `['tools']` (we made the whole object, we
   * may remove the whole object), while a `tools` that merely lacked the flag records
   * `['tools','enableHooks']` (we made one key, we may remove one key).
   */
  createdRootExtras: string[][];
}

/** The command we install for one agent and phase. */
export const hookCommand = (binary: string, agent: string, phase: 'pre' | 'post'): string =>
  `${binary} hooks fire ${agent} --phase ${phase} --hook-input stdin ${HOOK_MARKER_FLAG} ${HOOK_MARKER}`;

/**
 * The skeleton for an agent with no config.
 *
 * Built FROM THE MATRIX ROW, so it carries that agent's own event-key casing —
 * a skeleton hard-coded to `PreToolUse` would produce a config gemini and cursor
 * silently ignore. Both keys are present even though only one is filled, because a
 * config missing a key the agent expects is a different shape from an empty one.
 */
export function skeletonFor(spec: AgentSpec): Skeleton {
  const hooks: Record<string, unknown[]> = {};
  for (const key of eventKeys(spec)) hooks[key] = [];
  return { hooks };
}

/**
 * Install our hook entry into every config file this agent uses.
 *
 * Returns one outcome PER FILE — which is what makes windsurf's two paths visible
 * to a caller instead of collapsing into a single "installed" (dw-0014). Half-working
 * is the failure mode this plan keeps meeting, and a single return value is how it
 * hides.
 */
export function installStrategyA(
  fs: FsPort,
  spec: AgentSpec,
  home: string,
  env: (name: string) => string | undefined,
  binary: string,
): InstallOutcome[] {
  return resolveConfigFiles(spec, home, env).map((path) => installOneFile(fs, spec, path, binary));
}

/**
 * Build the ENTRY we append, in this agent's own shape (plan 082 F005).
 *
 * ONE PLACE ANSWERS "what does an entry look like here", because F005 is what
 * happens when the answer is assumed instead: the flat shape went into three
 * configs that require the nested one and disabled all three files outright.
 *
 * The nested form wraps the command in a matcher block — and it is OUR OWN block,
 * never git-ai's. Appending into a `matcher: "*"` block somebody else wrote would
 * mean editing an entry we do not own, which is the posture `hook-marker.ts`
 * exists to refuse. Claude Code, gemini and droid all accept multiple blocks per
 * event, so our own block is both valid and clean to remove.
 */
export function buildEntry(
  spec: AgentSpec,
  binary: string,
  phase: 'pre' | 'post',
): Record<string, unknown> {
  const command = hookCommand(binary, spec.agent, phase);
  const extras = spec.entryExtras ?? {};

  if (spec.powershellVariant === true) {
    const raw = extractBinaryPath(binary) ?? binary;
    // `& '<path>'` with embedded single quotes doubled — powershell's own escaping,
    // and the form git-ai writes (github_copilot.rs:59-69).
    const invocation = `& '${raw.replace(/'/g, "''")}'`;
    Object.assign(extras, { powershell: `${invocation} ${command.slice(binary.length).trim()}` });
  }

  if (spec.entryShape === 'nested') {
    return {
      matcher: spec.matcher ?? '*',
      hooks: [{ type: 'command', command, ...extras }],
    };
  }
  return { command, ...extras };
}

/**
 * Fields the DOCUMENT ROOT needs, limited to those genuinely absent.
 *
 * A root key is shared with settings we have no business touching, so an existing
 * value is left exactly as the user wrote it — we add what is missing and nothing
 * else. Gemini's `tools.enableHooks` is the reason this exists at all: git-ai sets
 * it on every gemini install and asserts it (`gemini.rs:99-106`, `:478-480`), and
 * we were not setting it.
 *
 * MATCHED-NOT-VERIFIED (phase-5 review F3): that is a parity claim about the
 * upstream WRITER, not a claim that gemini's runtime gates dispatch on the flag.
 * No runtime has been exercised either way.
 *
 * WHAT IT RETURNS IS ALSO PROVENANCE. The list is exactly what this install is
 * about to create, which is the only moment that is knowable — `installOneFile`
 * records it so uninstall can reverse our own write and nobody else's.
 */
export function missingRootExtras(
  text: string,
  spec: AgentSpec,
): [path: string[], value: unknown][] {
  const wanted = spec.rootExtras;
  if (wanted === undefined) return [];
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(stripComments(text)) as Record<string, unknown>;
  } catch {
    return [];
  }
  const out: [string[], unknown][] = [];
  for (const [key, value] of Object.entries(wanted)) {
    const current = doc[key];
    if (current === undefined) {
      out.push([[key], value]);
      continue;
    }
    // A nested object (gemini's `tools`) merges KEY BY KEY, so an existing `tools`
    // block carrying the user's own settings keeps them and gains only what is
    // missing. Replacing the whole object would silently delete them.
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const existing = (typeof current === 'object' && current !== null ? current : {}) as Record<
        string,
        unknown
      >;
      for (const [inner, innerValue] of Object.entries(value as Record<string, unknown>)) {
        if (existing[inner] === undefined) out.push([[key, inner], innerValue]);
      }
    }
  }
  return out;
}

function installOneFile(fs: FsPort, spec: AgentSpec, path: string, binary: string): InstallOutcome {
  const existing = fs.exists(path) ? fs.readText(path) : null;
  const created = existing === null;

  if (created) {
    // Parent directories too: copilot's config lives at `.copilot/hooks/git-ai.json`
    // and windsurf's second file at `.codeium/windsurf/hooks.json`, so the parent is
    // routinely more than one level deep and routinely absent.
    fs.mkdirp(parentOf(path));
  }

  const before = existing ?? `${JSON.stringify(skeletonFor(spec), null, 2)}\n`;
  // Sampled BEFORE the first write, because afterwards every key exists.
  const createdKeys = eventKeys(spec).filter((key) => !hasEventKey(before, key));

  // Idempotency: our entry is FOUND by the marker, never by string equality with
  // what we would write — the binary path can legitimately differ between installs.
  if (containsOurEntry(before, spec)) {
    if (created) writeThroughSymlink(fs, path, before);
    return {
      agent: spec.agent,
      path,
      created,
      alreadyPresent: true,
      createdKeys,
      // We wrote nothing this run, so we created no root field this run. An EARLIER
      // run's provenance is in the record and is merged, never overwritten.
      createdRootExtras: [],
    };
  }

  let text = before;
  const rootExtras = missingRootExtras(text, spec);
  for (const [path_, value] of rootExtras) {
    text = setValue(text, path_, value);
  }
  for (const [phase, key] of phaseKeys(spec)) {
    text = appendToArray(text, {
      path: ['hooks', key],
      // The ENTRY comes from the matrix row's shape, never from a branch on the
      // agent name — see `buildEntry` for what F005 cost when it was assumed.
      entry: buildEntry(spec, binary, phase),
    });
  }

  writeThroughSymlink(fs, path, text);
  return {
    agent: spec.agent,
    path,
    created,
    alreadyPresent: false,
    createdKeys,
    createdRootExtras: rootExtras.map(([keyPath]) => keyPath),
  };
}

/**
 * Does this document already carry this event array?
 *
 * PRESENT-BUT-EMPTY COUNTS AS PRESENT — that is the whole distinction F003 turns on.
 * A key holding `[]` is a key the user has, and we did not create it.
 */
function hasEventKey(text: string, key: string): boolean {
  try {
    const doc = JSON.parse(stripComments(text)) as { hooks?: Record<string, unknown> };
    return doc.hooks !== undefined && Object.hasOwn(doc.hooks, key);
  } catch {
    return false;
  }
}

/** Is our marked entry already in either event array? */
function containsOurEntry(text: string, spec: AgentSpec): boolean {
  let doc: { hooks?: Record<string, unknown[]> };
  try {
    doc = JSON.parse(stripComments(text)) as typeof doc;
  } catch {
    return false;
  }
  const arrays = eventKeys(spec).map((key) => doc.hooks?.[key] ?? []);
  return arrays.some((entries) => entries.some(entryIsOwnedByUs));
}

const stripComments = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');

/** Parent directory, POSIX-style. The matrix composes POSIX paths. */
function parentOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut <= 0 ? '/' : path.slice(0, cut);
}
