import { detectAgents } from './agents.js';
import type { CollectorFsPort, HostTarget } from './types.js';

/**
 * Cursor's sandbox allowlist, as a DIAGNOSTIC row (#144).
 *
 * Cursor can run an agent's terminal commands inside a sandbox. Commands named
 * in `~/.cursor/permissions.json`'s `terminalAllowlist` run OUTSIDE it; the rest
 * run inside, where a unix-socket `connect()` may not be permitted — and the
 * collector's ingress is exactly such a socket. So a sandboxed `git commit` can
 * produce a commit with no AI attribution at all.
 *
 * WHAT THIS ROW IS NOT
 *
 * **The probe decides; this config only explains.** Finding F-11 observed the
 * collector socket REACHABLE from inside a sandbox with `CURSOR_SANDBOX=seatbelt`
 * set. A config-driven verdict would have called that healthy session blocked. So
 * this row never overrides, contradicts, or gates on an ingress probe — it is a
 * diagnostic, not a verdict input, and it never claims the collector IS
 * unreachable.
 *
 * **It says what the config PERMITS, never what it GUARANTEES.** Our own evidence
 * contradicts the stronger claim twice: a probe once reported `connected` and a
 * plain `git commit` still produced no note; and a live Cursor run on 2026-08-09
 * used a COMPOUND `git add … && git commit …` with no `networkPolicy` at all and
 * still produced correct line-level attribution. We do not actually know the
 * allowlist is the deciding factor.
 *
 * **It never tells anyone to edit their Cursor config.** The acceptance criterion
 * for the whole feature is telemetry WITHOUT customising the machine, and the
 * allowlist is not a reliable remedy anyway: it matches a lone allowlisted
 * command, and agents write `&&`-chained commands by default — which is exactly
 * what the 2026-08-09 run did. The remedy named here is `harness commit`, which
 * we already ship.
 *
 * ANTICIPATED EXTENSION, deliberately not built: a future switch may auto-add
 * `harness` to the allowlist. That is a decision to take on purpose, not a
 * side effect of a diagnostic — so this module WRITES NOTHING to `~/.cursor`,
 * and this note exists so the next person does not re-derive that we considered
 * it.
 */

/** Detection is deliberately blunt: ANY Cursor marker is enough (#144). */
const CURSOR_AGENT_ID = 'cursor';

/** The commands whose absence from the allowlist is worth reporting. */
export const WATCHED_COMMANDS = ['git', 'harness'] as const;
export type WatchedCommand = (typeof WATCHED_COMMANDS)[number];

export interface CursorSandboxReading {
  /**
   * `permitted` — the command is allowlisted, so it runs outside the sandbox.
   * `absent`    — allowlisted commands were read and this one is not among them.
   * `unknown`   — we could not read the allowlist at all. NEVER a green and
   *               never an alarm; a fresh Cursor install has none of these files.
   */
  status: Record<WatchedCommand, 'permitted' | 'absent' | 'unknown'>;
  /** Why the reading is `unknown`, when it is. */
  unreadable: string | null;
}

/** `~/.cursor/permissions.json` — NOT the Application Support settings.json. */
export function permissionsPathFor(home: string): string {
  // The obvious place is the wrong one: `~/Library/Application Support/Cursor/
  // User/settings.json` carries NONE of this. Two people lost time there, so the
  // note lives at the path itself rather than only in the docs.
  return `${home.replace(/\/+$/, '')}/.cursor/permissions.json`;
}

/**
 * Read the allowlist. Every failure yields `unknown` for both commands — a file
 * we could not parse tells us nothing about what it permits, and pretending
 * otherwise in either direction is the bug this third state exists to prevent.
 */
export function readCursorSandbox(fs: CollectorFsPort, home: string): CursorSandboxReading {
  const unknown = (why: string): CursorSandboxReading => ({
    status: { git: 'unknown', harness: 'unknown' },
    unreadable: why,
  });

  const path = permissionsPathFor(home);
  if (!fs.exists(path)) return unknown(`${path} does not exist`);

  const raw = fs.readText(path);
  if (raw === null || raw.trim() === '') return unknown(`${path} is empty or unreadable`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return unknown(
      `${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return unknown(`${path} is not a JSON object`);
  }

  const list = (parsed as Record<string, unknown>).terminalAllowlist;
  if (!Array.isArray(list)) return unknown(`${path} has no \`terminalAllowlist\` array`);

  // Match the COMMAND, not the whole string: an entry may be `git` or a fuller
  // invocation. Anything non-string is ignored rather than coerced.
  const named = new Set(
    list
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim().split(/\s+/)[0] ?? '')
      .filter((head) => head !== ''),
  );

  return {
    status: {
      git: named.has('git') ? 'permitted' : 'absent',
      harness: named.has('harness') ? 'permitted' : 'absent',
    },
    unreadable: null,
  };
}

export interface CursorSandboxRow {
  detail: string;
  next_action: string;
}

/**
 * The row, or `null` for silence.
 *
 * Silent in two distinct cases, and the distinction matters: no Cursor marker
 * means the question does not apply, while both commands permitted means the
 * question was asked and answered well. Neither deserves a row, but only the
 * second is "healthy" — and this row never claims either way about the collector
 * itself.
 */
export function cursorSandboxRow(fs: CollectorFsPort, host: HostTarget): CursorSandboxRow | null {
  const cursorPresent = detectAgents(fs, host.home).some((agent) => agent.id === CURSOR_AGENT_ID);
  if (!cursorPresent) return null;

  const reading = readCursorSandbox(fs, host.home);

  if (reading.unreadable !== null) {
    return {
      detail: `cannot-tell — Cursor is present but its sandbox allowlist could not be read (${reading.unreadable}), so whether \`git\` and \`harness\` run outside the sandbox is UNKNOWN — this is not a report that anything is wrong`,
      next_action: `Nothing to fix on this evidence. Commit through \`harness commit "<message>"\` regardless: it reports whether attribution was confirmed or buffered instead of failing silently. Read \`harness instructions commit\`.`,
    };
  }

  const gitAbsent = reading.status.git === 'absent';
  const harnessAbsent = reading.status.harness === 'absent';
  if (!gitAbsent && !harnessAbsent) return null;

  const parts: string[] = [];
  if (gitAbsent) {
    parts.push(
      "`git` is not on Cursor's terminal allowlist, so a plain `git commit` from a sandboxed Cursor command MAY not reach the collector — commits made that way can carry no AI attribution, and git-ai's recovery ladder may later attest those lines as known-human",
    );
  }
  if (harnessAbsent) {
    // The quieter and worse case: the remedy we recommend is itself sandboxed.
    parts.push(
      '`harness` is not on the allowlist either — the config does not permit it out of the sandbox — so `harness commit`, the remedy, runs inside the sandbox too. Capture still survives (the buffer is a filesystem write), but the DRAIN needs the collector socket, so recovery may require an unsandboxed shell: everything looks captured and nothing leaves',
    );
  }

  return {
    detail: `cursor-sandbox — ${parts.join('; ')}`,
    next_action: harnessAbsent
      ? 'Commit through `harness commit "<message>"`, and note the remedy is itself degraded here: it will tell you whether the commit was CONFIRMED or BUFFERED, and a buffered one needs `harness doctor telemetry-nudge` from an UNSANDBOXED shell. This row reports only what the config PERMITS; an ingress probe that has actually connected is the sole evidence of what the collector can do.'
      : 'Commit through `harness commit "<message>"` rather than a bare `git commit`: it reports whether attribution was confirmed or buffered instead of failing silently. This row reports only what the config PERMITS; an ingress probe that has actually connected is the sole evidence of what the collector can do.',
  };
}
