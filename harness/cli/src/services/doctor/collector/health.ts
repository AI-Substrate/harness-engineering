import type { HashPort } from '../../../adapters/hash/hash-port.js';
import { type AgentMarker, agentsMissingHooks, detectAgents } from './agents.js';
import { GITAI_PIN } from './pin.js';
import { binaryPathFor, daemonPidPathFor, resolveArtifact } from './platform.js';
import { type CollectorState, readCollectorState } from './state.js';
import type { CollectorFsPort, CollectorPin, HostTarget } from './types.js';

/**
 * The collector health read (plan 073 · ac-000a, ac-000b, ac-000c, ac-0010,
 * ac-0012, ac-0014).
 *
 * SIMPLE AND BOUNDED, on purpose. It answers four questions a filesystem can
 * answer — is the pinned binary present and still hash-matching, were the hooks
 * installed and do they cover every agent now on this machine, is there a daemon
 * pid file, is the note schema the one we pinned — and it stops there.
 *
 * It does NOT claim collection is occurring, and that omission is the honest
 * part (ac-0012). `git ai status --json` reports only the CURRENT uncommitted
 * working log, which git-ai deletes at commit, and its `time_ago` is a human
 * string rather than a timestamp. A healthy collector therefore reads EMPTY
 * immediately after any commit — so a "recent checkpoint" check cannot tell a
 * broken collector from a clean tree. v1 records that gap instead of shipping a
 * check that would be wrong exactly when it mattered.
 *
 * `could-not-determine` is its own verdict. It is never rendered as healthy and
 * never folded into "not installed": absent is not green, and empty is not
 * clean. And every verdict is advisory — doctor warns, doctor never blocks
 * (ac-000c).
 */

export type CollectorVerdict =
  | 'healthy'
  | 'not-installed'
  | 'cli-only-trace2'
  | 'hooks-incomplete'
  | 'degraded'
  | 'could-not-determine';

export interface CollectorHealth {
  verdict: CollectorVerdict;
  /** One-line operator summary. */
  detail: string;
  /** What to do about it — present for every non-healthy verdict. */
  next_action?: string;
  binary: {
    path: string;
    present: boolean;
    /** 'match' | 'mismatch' | 'unknown' — unknown when no hash port was wired. */
    digest: 'match' | 'mismatch' | 'unknown';
  };
  hooks: {
    status: CollectorState['hooks']['status'] | 'unknown';
    /** Agents on this machine with no recorded hook install (ac-0010). */
    missing: string[];
  };
  daemon: 'pidfile-present' | 'pidfile-absent' | 'unknown';
  noteSchema: {
    expected: string;
    observed: string | null;
    status: 'match' | 'mismatch' | 'unknown';
  };
  /** The trace2 observation this read is standing on, if any was ever recorded. */
  trace2: { observed: 'empty' | 'present' | 'unknown'; at: string } | null;
}

export interface CollectorHealthDeps {
  fs: CollectorFsPort;
  host: HostTarget;
  cwd: string;
  /**
   * Optional: with a hash port the binary's digest is RE-checked against the pin
   * on every read; without one the digest reads `unknown` and the verdict cannot
   * be `healthy`. Absent evidence never upgrades to good news.
   */
  hash?: HashPort;
  manifest?: CollectorPin;
}

/** Never `healthy`: a verdict that rests on evidence we did not actually read. */
function undetermined(
  detail: string,
  binary: CollectorHealth['binary'],
  extra: Partial<CollectorHealth> = {},
): CollectorHealth {
  return {
    verdict: 'could-not-determine',
    detail,
    next_action:
      'Run `harness doctor --install-collector` to (re)place the pinned git-ai binary and record its state, then re-run doctor.',
    binary,
    hooks: { status: 'unknown', missing: [] },
    daemon: 'unknown',
    noteSchema: { expected: GITAI_PIN.expect_schema_version, observed: null, status: 'unknown' },
    trace2: null,
    ...extra,
  };
}

export function readCollectorHealth(deps: CollectorHealthDeps): CollectorHealth {
  const manifest = deps.manifest ?? GITAI_PIN;
  const binaryPath = binaryPathFor(deps.host.home, deps.host.platform);
  const present = deps.fs.exists(binaryPath);
  const state = readCollectorState(deps.fs, deps.cwd);

  const resolution = resolveArtifact(deps.host.platform, deps.host.arch, manifest);
  if (!resolution.ok) {
    return {
      verdict: 'not-installed',
      detail: resolution.detail,
      next_action:
        'git-ai publishes no binary for this platform/arch. AI attribution cannot be collected here; nothing was installed.',
      binary: { path: binaryPath, present, digest: 'unknown' },
      hooks: { status: 'unknown', missing: [] },
      daemon: 'unknown',
      noteSchema: { expected: manifest.expect_schema_version, observed: null, status: 'unknown' },
      trace2: null,
    };
  }

  // Digest: re-read from disk when a hash port is wired. `unknown` is honest and
  // is NOT healthy — it is the difference between "we checked" and "we assumed".
  let digest: CollectorHealth['binary']['digest'] = 'unknown';
  if (present && deps.hash !== undefined) {
    const bytes = deps.fs.readBytesNoFollow(binaryPath);
    digest =
      bytes === null
        ? 'unknown'
        : deps.hash.sha256Hex(bytes).toLowerCase() === resolution.artifact.sha256.toLowerCase()
          ? 'match'
          : 'mismatch';
  } else if (present && state?.cli.digest != null) {
    digest =
      state.cli.digest.toLowerCase() === resolution.artifact.sha256.toLowerCase()
        ? 'match'
        : 'mismatch';
  }

  const binary = { path: binaryPath, present, digest };

  if (!present && state === null) {
    return {
      verdict: 'not-installed',
      detail: `git-ai is not installed (no binary at ${binaryPath}, no recorded install)`,
      next_action:
        'Run `harness doctor --install-collector` to fetch the pinned git-ai release, verify its SHA-256, and install the agent hooks.',
      binary,
      hooks: { status: 'unknown', missing: [] },
      daemon: 'unknown',
      noteSchema: { expected: manifest.expect_schema_version, observed: null, status: 'unknown' },
      trace2: null,
    };
  }
  if (state === null) {
    return undetermined(
      `a git-ai binary exists at ${binaryPath} but harness has no record of installing it — provenance and hook state are unknown`,
      binary,
    );
  }
  if (!present) {
    return undetermined(
      `harness recorded a git-ai install (${state.cli.status}) but nothing is at ${binaryPath} — the binary has been moved or removed`,
      binary,
      { trace2: latestTrace2(state) },
    );
  }

  const detected = detectAgents(deps.fs, deps.host.home);
  const missing: AgentMarker[] =
    state.hooks.status === 'installed' ? agentsMissingHooks(detected, state.hooks.agents) : [];
  const daemon: CollectorHealth['daemon'] = deps.fs.exists(daemonPidPathFor(deps.host.home))
    ? 'pidfile-present'
    : 'pidfile-absent';
  const base = {
    binary,
    hooks: { status: state.hooks.status, missing: missing.map((agent) => agent.id) },
    daemon,
    noteSchema: state.note_schema,
    trace2: latestTrace2(state),
  };

  if (digest === 'mismatch') {
    return {
      ...base,
      verdict: 'degraded',
      detail: `the git-ai binary at ${binaryPath} does NOT match the pinned ${manifest.version} digest — it has been replaced or upgraded out from under the manifest`,
      next_action:
        'Re-run `harness doctor --install-collector` to restore the pinned, verified binary (git-ai auto-update should already be disabled in ~/.git-ai/config.json).',
    };
  }

  // The distinct partial state (ac-0014): the CLI is genuinely installed and
  // verified; the hooks are genuinely not on, for a named and recoverable
  // reason. Not healthy, not a failed install, not could-not-determine.
  if (state.hooks.status === 'skipped-trace2') {
    return {
      ...base,
      verdict: 'cli-only-trace2',
      detail: `git-ai CLI installed and hash-matching (${manifest.version}), hooks NOT installed because a global trace2 config is present — no AI attribution is being collected`,
      next_action:
        'Back up your global trace2 keys, then run `git-ai install-hooks` yourself (it deletes the whole global trace2 section). Harness will not do it for you.',
    };
  }
  if (state.hooks.status === 'failed' || state.hooks.status === 'not-attempted') {
    return {
      ...base,
      verdict: 'degraded',
      detail: `git-ai CLI installed but hooks are ${state.hooks.status} — ${state.hooks.detail}`,
      next_action: 'Re-run `harness doctor --install-collector` and read the reported cause.',
    };
  }
  if (missing.length > 0) {
    return {
      ...base,
      verdict: 'hooks-incomplete',
      detail: `a coding harness appeared since the hooks were installed: ${missing
        .map((agent) => agent.label)
        .join(', ')} — its edits are not being attributed`,
      next_action:
        'Re-run `harness doctor --install-collector` to install hooks for the new harness (the trace2 guard runs again first).',
    };
  }
  if (digest === 'unknown') {
    return undetermined(
      `git-ai is present at ${binaryPath} but its digest could not be re-verified on this read`,
      binary,
      { hooks: base.hooks, daemon, noteSchema: base.noteSchema, trace2: base.trace2 },
    );
  }
  if (state.note_schema.status === 'mismatch') {
    return {
      ...base,
      verdict: 'degraded',
      detail: `git-ai writes note schema ${state.note_schema.observed ?? 'unknown'} but the manifest expects ${state.note_schema.expected} — readers may misparse the notes`,
      next_action:
        'Review the manifest and the note readers together; bump `expect_schema_version` in manifest.ts only with the readers.',
    };
  }

  return {
    ...base,
    verdict: 'healthy',
    detail: `git-ai ${manifest.version} installed and hash-matching, hooks installed for ${state.hooks.agents.length} agent(s), daemon pid file ${
      daemon === 'pidfile-present' ? 'present' : 'absent'
    } — collection is CONFIGURED (v1 cannot prove it is occurring; see docs/how/gitai-collector.md)`,
  };
}

function latestTrace2(state: CollectorState): CollectorHealth['trace2'] {
  const latest = state.trace2[0];
  return latest === undefined ? null : { observed: latest.observed, at: latest.at };
}
