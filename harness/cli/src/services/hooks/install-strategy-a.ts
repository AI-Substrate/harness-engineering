import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { AgentSpec } from './agent-matrix.js';
import { resolveConfigFiles } from './agent-matrix.js';
import { appendToArray, writeThroughSymlink } from './config-writer.js';
import { HOOK_MARKER, HOOK_MARKER_FLAG, isOwnedByUs } from './hook-marker.js';

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
  return { hooks: { [spec.events.pre]: [], [spec.events.post]: [] } };
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

  // Idempotency: our entry is FOUND by the marker, never by string equality with
  // what we would write — the binary path can legitimately differ between installs.
  if (containsOurEntry(before, spec)) {
    if (created) writeThroughSymlink(fs, path, before);
    return { agent: spec.agent, path, created, alreadyPresent: true };
  }

  let text = before;
  for (const [phase, key] of [
    ['pre', spec.events.pre],
    ['post', spec.events.post],
  ] as const) {
    text = appendToArray(text, {
      path: ['hooks', key],
      entry: { command: hookCommand(binary, spec.agent, phase) },
    });
  }

  writeThroughSymlink(fs, path, text);
  return { agent: spec.agent, path, created, alreadyPresent: false };
}

/** Is our marked entry already in either event array? */
function containsOurEntry(text: string, spec: AgentSpec): boolean {
  let doc: { hooks?: Record<string, { command?: unknown }[]> };
  try {
    doc = JSON.parse(stripComments(text)) as typeof doc;
  } catch {
    return false;
  }
  const arrays = [spec.events.pre, spec.events.post].map((key) => doc.hooks?.[key] ?? []);
  return arrays.some((entries) =>
    entries.some((entry) => typeof entry.command === 'string' && isOwnedByUs(entry.command)),
  );
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
