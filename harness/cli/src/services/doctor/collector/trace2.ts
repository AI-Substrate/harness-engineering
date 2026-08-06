import type { ExecPort } from '../../../adapters/exec/exec-port.js';

/**
 * The trace2 guard (plan 073 · ac-0008; o-prime's ruling of 2026-08-06).
 *
 * git-ai's `install-hooks` opens with `configure_daemon_trace2`, which runs
 * `git config --global --remove-section trace2` and then writes its own two keys
 * (`src/commands/install_hooks.rs:256-283`). That is a MACHINE-WIDE deletion:
 * every repo on the box, not just this one. Harness does not use trace2 — but
 * "we don't use it" does not make someone else's config ours to give away.
 *
 * So the rule, and it applies before EVERY `install-hooks` invocation — the
 * first install and every later re-check, because git-ai re-applies the removal
 * every time:
 *
 * - **Non-empty** → do NOT invoke `install-hooks` at all. Warn, name exactly
 *   what is there, print manual instructions. The CLI install is unaffected.
 * - **Empty** → record that it was OBSERVED empty, then proceed. An unrecorded
 *   empty is indistinguishable from an erased one, which is the entire lesson.
 * - **Unknown** (git missing, config unreadable) → treat as non-empty. A guard
 *   that cannot read the thing it is guarding must not report all clear.
 *
 * Harness NEVER deletes a trace2 config. There is nothing to consent to,
 * because nothing destructive is on offer.
 */

export type Trace2Status = 'empty' | 'present' | 'unknown';

export interface Trace2Reading {
  status: Trace2Status;
  /** The `key=value` lines exactly as git reported them (empty when absent). */
  entries: string[];
  /** Operator-facing sentence for the doctor/report surface. */
  detail: string;
  observedAt: string;
}

/**
 * True when `install-hooks` may run.
 *
 * The ONLY unconditional yes is an observed-EMPTY config. There is exactly one
 * narrow second case, and it exists because the first one would otherwise make
 * the re-check (ac-0010) impossible: once git-ai's hooks are on, git-ai's OWN
 * two trace2 keys are in the global config, so a guard that only accepted
 * "empty" would refuse to hook a coding harness installed next month — forever,
 * on every machine that ever succeeded.
 *
 * So a re-install is permitted when BOTH hold:
 *
 * 1. every key present is one git-ai itself writes (`trace2.eventTarget`,
 *    `trace2.eventNesting`), and
 * 2. this harness has a RECORDED, verified install of its own.
 *
 * Together those mean the config we would be overwriting is the config we put
 * there. If a developer set `trace2.eventTarget` themselves and we never
 * installed, condition 2 fails and the guard blocks exactly as before. The
 * protection is unchanged: we still never delete a trace2 config that is not
 * already ours.
 */
export function mayInstallHooks(
  reading: Trace2Reading,
  opts: { priorInstallVerified?: boolean } = {},
): boolean {
  if (reading.status === 'empty') return true;
  // `unknown` still fails closed: a guard that cannot read must not clear.
  if (reading.status !== 'present') return false;
  if (opts.priorInstallVerified !== true) return false;
  return reading.entries.length > 0 && reading.entries.every(isGitAiOwnTrace2Key);
}

/** Keys git-ai writes for itself — the only ones a re-install may pass over. */
function isGitAiOwnTrace2Key(entry: string): boolean {
  return /^trace2\.(eventtarget|eventnesting)(\s|=|$)/i.test(entry.trim());
}

/**
 * The config key git-ai ALWAYS writes when it installs hooks.
 * `configure_daemon_trace2` (`src/commands/install_hooks.rs:256-283`) removes
 * the global `trace2` section and then writes `trace2.eventTarget` (plus
 * `trace2.eventNesting`) — unconditionally, on every successful invocation.
 * git reports config keys lowercased, hence the spelling here.
 */
const GITAI_TRACE2_KEY = 'trace2.eventtarget';

export type Trace2VerificationStatus = 'verified' | 'absent' | 'unreadable';

export interface Trace2Verification {
  status: Trace2VerificationStatus;
  detail: string;
}

/**
 * Did `install-hooks` actually do the thing it always does? (plan 073 · P1 of
 * the phase-1 review.)
 *
 * This exists because of the live dogfood finding: git-ai's argument parser ends
 * in `_ => {}`, so it exits ZERO for invocations it never understood. An exit
 * code from that binary is therefore not evidence, and the post-install read was
 * being recorded while the outcome was decided by the exit code anyway — which
 * is the same as not having read it.
 *
 * So the post-read is turned into a verdict:
 *
 * - **verified** — git-ai's own `trace2.eventTarget` is now in the global
 *   config, which only happens on a real hook install.
 * - **absent** — the config is readable and git-ai's key is NOT there. It exited
 *   zero having installed nothing. Never `installed`.
 * - **unreadable** — we could not check. Absent evidence is not good news; the
 *   caller records a non-healthy state and says why.
 */
export function verifyInstalledTrace2(reading: Trace2Reading): Trace2Verification {
  if (reading.status === 'unknown') {
    return {
      status: 'unreadable',
      detail: `install-hooks exited 0 but the global trace2 config could not be re-read afterwards (${reading.detail}) — the install is UNVERIFIED`,
    };
  }
  const found = reading.entries.some((entry) =>
    entry.toLowerCase().trimStart().startsWith(GITAI_TRACE2_KEY),
  );
  if (found) {
    return {
      status: 'verified',
      detail: `install-hooks verified by re-reading the global config: ${GITAI_TRACE2_KEY} is present`,
    };
  }
  return {
    status: 'absent',
    detail: `install-hooks exited 0 but did NOT write ${GITAI_TRACE2_KEY} to the global git config — it always does on a real install, so nothing was hooked (git-ai's arg parser ignores what it does not understand and still exits 0)`,
  };
}

/**
 * What to tell an operator who WANTS git-ai's hooks on a machine that has a
 * trace2 config. We do not perform this for them — the whole point is that the
 * destructive step stays theirs.
 */
export function manualHookInstructions(binaryPath: string, entries: readonly string[]): string[] {
  return [
    'git-ai hooks were NOT installed: a global git trace2 config is present, and `git-ai install-hooks`',
    'begins by deleting the whole `trace2` section from your GLOBAL git config — every repo on this machine.',
    `Present now: ${entries.length > 0 ? entries.join(', ') : '(unreadable)'}`,
    'To proceed yourself, first save what is there:',
    "  git config --global --get-regexp '^trace2\\.' > ~/trace2-backup.txt",
    'then install the hooks knowing the section will be replaced:',
    `  ${binaryPath} install-hooks`,
    'and restore any keys you still want afterwards. Harness will keep reporting this state until then.',
  ];
}

export interface Trace2Deps {
  exec: ExecPort;
  cwd: string;
  /** The git executable; injected so a test never depends on PATH. */
  gitCmd?: string;
  timeoutMs?: number;
}

/**
 * Read the GLOBAL trace2 config. Read-only by construction: `--get-regexp`
 * cannot mutate, and no other git invocation lives in this module.
 */
export async function readGlobalTrace2(
  deps: Trace2Deps,
  observedAt: string,
): Promise<Trace2Reading> {
  const git = deps.gitCmd ?? 'git';
  let result: { code: number; stdout: string; stderr: string };
  try {
    result = await deps.exec.run(git, ['config', '--global', '--get-regexp', '^trace2\\.'], {
      cwd: deps.cwd,
      timeoutMs: deps.timeoutMs ?? 10_000,
    });
  } catch (err) {
    return {
      status: 'unknown',
      entries: [],
      detail: `could not read the global trace2 config (${
        err instanceof Error ? err.message : String(err)
      }) — treating as PRESENT, so hooks are not installed`,
      observedAt,
    };
  }

  const entries = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  // git exits 1 with no output when the regexp matched nothing — that is the
  // genuine "empty" answer, and the ONLY one that unlocks install-hooks.
  if (result.code === 1 && entries.length === 0) {
    return {
      status: 'empty',
      entries: [],
      detail:
        'global trace2 config observed EMPTY — nothing of yours is at risk from install-hooks',
      observedAt,
    };
  }
  if (result.code === 0) {
    return entries.length === 0
      ? {
          status: 'empty',
          entries: [],
          detail:
            'global trace2 config observed EMPTY — nothing of yours is at risk from install-hooks',
          observedAt,
        }
      : {
          status: 'present',
          entries,
          detail: `global trace2 config is PRESENT (${entries.length} key(s): ${entries.join(
            ', ',
          )}) — git-ai's install-hooks would delete the whole section, machine-wide`,
          observedAt,
        };
  }
  return {
    status: 'unknown',
    entries,
    detail: `could not read the global trace2 config (git exit ${result.code}${
      result.stderr.trim() === '' ? '' : `: ${result.stderr.trim()}`
    }) — treating as PRESENT, so hooks are not installed`,
    observedAt,
  };
}
