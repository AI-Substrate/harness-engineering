import { detectAgents } from './agents.js';
import type { CollectorFsPort, HostTarget } from './types.js';

/**
 * Cursor's sandbox, as a DIAGNOSTIC row (#144).
 *
 * Cursor can run an agent's terminal commands inside a sandbox. Commands named
 * in `~/.cursor/permissions.json`'s `terminalAllowlist` run OUTSIDE it; the rest
 * run inside, where a unix-socket `connect()` may not be permitted — and the
 * collector's ingress is exactly such a socket. So a sandboxed `git commit` can
 * produce a commit with no AI attribution at all.
 *
 * TWO SETTINGS, AND THE ALLOWLIST IS THE WEAKER ONE
 *
 * This row first shipped reading the allowlist alone. A measured session on
 * 2026-08-09 (plan 082 research dossier §3, §6) established that the allowlist
 * is not the deciding setting:
 *
 * - A sandboxed Cursor shell got **EPERM on both git-ai daemon sockets**.
 * - `git` was **already on `terminalAllowlist`** and the commit still ran
 *   sandboxed, because the agent wrote a compound `git add -A && git commit …`
 *   chain unprompted. The allowlist matches a LONE command, so `&&` defeats it.
 * - Setting Auto-Run Network Access to *Allow All* made both sockets connect.
 * - `sandbox.json`'s `networkPolicy.allow` list takes hosts, wildcards and CIDR.
 *   **A unix socket has no domain, so no entry there can ever match it.** Only
 *   `networkPolicy.default: "allow"` reaches the socket at all.
 *
 * So the deciding setting is `networkPolicy.default`, and reading only the
 * allowlist was wrong in BOTH directions: silent on a machine whose network
 * policy blocks the socket outright, and alarming on one whose policy already
 * permits everything. Both are fixed here.
 *
 * The two settings are independent escapes, which is why the logic below is a
 * conjunction rather than a pair of separate warnings: an allowlisted command
 * runs OUTSIDE the sandbox and `networkPolicy` never applies to it, while a
 * command inside the sandbox needs `networkPolicy.default: "allow"`.
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
 * **It says what the config PERMITS, never what it GUARANTEES.** Our own
 * evidence contradicts the stronger claim twice: a probe once reported
 * `connected` and a plain `git commit` still produced no note; and a live Cursor
 * run on 2026-08-09 used a COMPOUND `git add … && git commit …` with no
 * `networkPolicy` at all and still produced correct line-level attribution. A
 * restrictive `networkPolicy` therefore reads as "does not PERMIT", never as
 * "blocks" — F-11 observed the socket reachable from inside a sandbox.
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
 * `sandbox.json`, in priority order: the per-repo file first, then the user's.
 *
 * Note the `.cursor/` SUBDIRECTORY in both. Cursor's own settings UI names the
 * file without it, which cost a measured attempt on 2026-08-09 — the file was
 * written one level too high and simply never read.
 */
export function sandboxPathsFor(home: string, workspace?: string): string[] {
  const trim = (p: string): string => p.replace(/\/+$/, '');
  const paths = [
    ...(workspace !== undefined && workspace.trim() !== ''
      ? [`${trim(workspace)}/.cursor/sandbox.json`]
      : []),
    `${trim(home)}/.cursor/sandbox.json`,
  ];
  // A repo checked out AT `$HOME` would otherwise read the same file twice and
  // report it as two independent agreeing sources.
  return [...new Set(paths)];
}

/**
 * What the sandbox's network policy PERMITS.
 *
 * `allow`      — `networkPolicy.default: "allow"`. Sandboxed commands may reach
 *                the collector socket. The only setting that can: see the
 *                module note on why `networkPolicy.allow` cannot match a socket.
 * `restricted` — `default` is set to something other than `"allow"`. The config
 *                does not permit socket egress from inside the sandbox. NOT a
 *                claim that anything is blocked.
 * `unknown`    — no file, no `networkPolicy`, no `default`, or unreadable.
 *                **Absent is NOT permissive** and it is not restrictive either;
 *                it is the third state, and it stays first-class.
 */
export type SandboxNetworkPolicy = 'allow' | 'restricted' | 'unknown';

export interface SandboxNetworkReading {
  policy: SandboxNetworkPolicy;
  /** The file that decided, when one did. */
  source: string | null;
  /** Why the reading is `unknown`, when it is. */
  unreadable: string | null;
}

/**
 * Read `networkPolicy.default` from the first `sandbox.json` that states one.
 *
 * PER-REPO PRIORITY, AND ITS ONE HONEST GAP: a per-repo file that exists but
 * states no `default` does not decide, so the read falls through to the user's
 * file. Whether Cursor treats that as inherit-or-reset is not something we have
 * measured, and guessing either way would manufacture a verdict from a file that
 * expressed no opinion. Falling through is the reading that assumes least.
 */
export function readSandboxNetwork(
  fs: CollectorFsPort,
  home: string,
  workspace?: string,
): SandboxNetworkReading {
  const reasons: string[] = [];

  for (const path of sandboxPathsFor(home, workspace)) {
    if (!fs.exists(path)) {
      reasons.push(`${path} does not exist`);
      continue;
    }

    const raw = fs.readText(path);
    if (raw === null || raw.trim() === '') {
      reasons.push(`${path} is empty or unreadable`);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      reasons.push(
        `${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      reasons.push(`${path} is not a JSON object`);
      continue;
    }

    const policy = (parsed as Record<string, unknown>).networkPolicy;
    if (policy === null || typeof policy !== 'object' || Array.isArray(policy)) {
      reasons.push(`${path} has no \`networkPolicy\` object`);
      continue;
    }

    const dflt = (policy as Record<string, unknown>).default;
    if (typeof dflt !== 'string' || dflt.trim() === '') {
      reasons.push(`${path} has no \`networkPolicy.default\``);
      continue;
    }

    return {
      policy: dflt.trim().toLowerCase() === 'allow' ? 'allow' : 'restricted',
      source: path,
      unreadable: null,
    };
  }

  return { policy: 'unknown', source: null, unreadable: reasons.join('; ') };
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
 * Silence has THREE distinct causes now, and only the last two are "healthy":
 * no Cursor marker means the question does not apply; `networkPolicy.default:
 * "allow"` means sandboxed commands are permitted to reach the socket, so the
 * allowlist is moot; and both commands allowlisted means they run outside the
 * sandbox in the first place. None of them is a claim about the collector.
 *
 * `workspace` is the repo root, so a per-repo `.cursor/sandbox.json` can take
 * priority over the user's. Absent → only the user's file is read.
 */
export function cursorSandboxRow(
  fs: CollectorFsPort,
  host: HostTarget,
  workspace?: string,
): CursorSandboxRow | null {
  const cursorPresent = detectAgents(fs, host.home).some((agent) => agent.id === CURSOR_AGENT_ID);
  if (!cursorPresent) return null;

  const network = readSandboxNetwork(fs, host.home, workspace);

  // The wide-open case, and the FALSE ALARM this read exists to stop: with
  // `default: "allow"` a sandboxed command may reach the socket, so warning
  // about the allowlist here would report a risk the config has already lifted.
  if (network.policy === 'allow') return null;

  const reading = readCursorSandbox(fs, host.home);

  const gitAbsent = reading.status.git === 'absent';
  const harnessAbsent = reading.status.harness === 'absent';
  const allowlistUnreadable = reading.unreadable !== null;

  // The FALSE SILENCE this read exists to stop: a restrictive `networkPolicy`
  // is the deciding setting, so it is worth a row even when both commands are
  // allowlisted — the allowlist matches a LONE command, and the measured
  // 2026-08-09 run had `git` allowlisted and still ran sandboxed because the
  // agent wrote an `&&` chain.
  const restricted = network.policy === 'restricted';

  if (!restricted && !allowlistUnreadable && !gitAbsent && !harnessAbsent) return null;

  const parts: string[] = [];

  if (restricted) {
    parts.push(
      `Cursor's sandbox sets \`networkPolicy.default\` to something other than "allow" (${network.source}), which does not PERMIT a sandboxed command to reach the collector's unix socket — and no allowlist entry can change that, because \`networkPolicy.allow\` matches hosts, wildcards and CIDR, and a unix socket has no domain`,
    );
  }

  if (allowlistUnreadable) {
    parts.push(
      `Cursor's terminal allowlist could not be read (${reading.unreadable}), so whether \`git\` and \`harness\` run outside the sandbox is UNKNOWN`,
    );
  }
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
  if (!restricted && network.policy === 'unknown' && (gitAbsent || harnessAbsent)) {
    // Absent is not permissive: say the deciding setting went unread rather than
    // letting the allowlist prose imply it is the whole story.
    parts.push(
      'the deciding setting — `networkPolicy.default` in `.cursor/sandbox.json` — could not be read either, so this is what the allowlist permits, not the whole picture',
    );
  }

  const degradedRemedy = harnessAbsent || restricted;

  // CANNOT-TELL stays first-class. When nothing was affirmatively found — no
  // restrictive policy, no command established as absent, only reads that
  // failed — the row must announce itself as an unread state and not as a
  // finding. An unknown dressed as a warning teaches operators to ignore the row.
  const nothingEstablished = !restricted && !gitAbsent && !harnessAbsent;
  const prefix = nothingEstablished ? 'cursor-sandbox — cannot-tell:' : 'cursor-sandbox —';
  const closing = nothingEstablished ? ' — this is not a report that anything is wrong' : '';

  return {
    detail: `${prefix} ${parts.join('; ')}${closing}`,
    next_action: degradedRemedy
      ? 'Commit through `harness commit "<message>"`, and note the remedy may itself be degraded here: it will tell you whether the commit was CONFIRMED or BUFFERED, and a buffered one needs `harness doctor telemetry-nudge` from an UNSANDBOXED shell. This row reports only what the config PERMITS; an ingress probe that has actually connected is the sole evidence of what the collector can do.'
      : 'Commit through `harness commit "<message>"` rather than a bare `git commit`: it reports whether attribution was confirmed or buffered instead of failing silently. This row reports only what the config PERMITS; an ingress probe that has actually connected is the sole evidence of what the collector can do.',
  };
}
