import { agentsMissingHooks, detectAgents } from './agents.js';
import { clearAutoInstallBlock } from './auto-install-block.js';
import { backupAgentConfigs } from './backup.js';
import { downloadAndVerify } from './download.js';
import { GITAI_PIN } from './pin.js';
import { binaryPathFor, configPathFor, resolveArtifact } from './platform.js';
import { manualSkillsInstructions, readSkillsGuard } from './skills-guard.js';
import {
  type CollectorState,
  emptyCollectorState,
  type HooksInstallStatus,
  readCollectorState,
  recordTrace2Observation,
  writeCollectorState,
} from './state.js';
import {
  manualHookInstructions,
  mayInstallHooks,
  readGlobalTrace2,
  verifyInstalledTrace2,
} from './trace2.js';
import { type CollectorDeps, INSTALL_HOOKS_TIMEOUT_MS } from './types.js';

/**
 * The collector lifecycle (plan 073 · ac-0007, ac-0009, ac-0013, ac-0014, ac-0016).
 *
 * TWO INDEPENDENT STAGES, and the independence is the point:
 *
 *   1. Place the pinned, digest-verified CLI, and write git-ai's config so its
 *      auto-updater cannot move off the pin.
 *   2. Install the agent hooks — which may be SKIPPED, and whose skipping must
 *      never undo, revert or fail stage 1 (ac-0013).
 *
 * The result state that matters most is the partial one: **CLI installed, hooks
 * not installed because trace2 is present** (ac-0014). It is not healthy, it is
 * not a failed install, and it is not "could not determine". It is a real,
 * reachable, reportable configuration, and folding it into any of the other
 * three is how an operator ends up believing collection is running when it is
 * not.
 *
 * WE NEVER RUN `install.sh`. Their installer edits shell rc files, prepends to
 * PATH, symlinks a `git` shim, and calls `install-hooks` itself — which would
 * seize trace2 before we could look at it, making the guard above unenforceable.
 * We fetch the same published artifact ourselves and invoke `install-hooks`
 * directly, which is the only reason the guard exists at all.
 */

export type CliStage = 'installed' | 'already-current' | 'failed' | 'unsupported-platform';
export type HooksStage =
  | 'installed'
  | 'skipped-trace2'
  /**
   * Real user content sits where git-ai keeps its skill links, so invoking
   * `install-hooks` at all would delete or overwrite it. Same shape as
   * `skipped-trace2`: a deliberate, reportable, recoverable non-install.
   */
  | 'skipped-skills'
  /**
   * `install-hooks` exited 0, and the config it ALWAYS writes is not there (or
   * could not be re-read). Deliberately not `installed` and deliberately not
   * `failed`: the command did not report an error, and we must not invent one —
   * but we saw no evidence it worked, and evidence is the only currency here.
   */
  | 'unverified'
  | 'failed'
  | 'not-attempted';

export interface CollectorInstallResult {
  cli: CliStage;
  hooks: HooksStage;
  state: CollectorState;
  /** Non-blocking operator warnings — doctor never fails a run on these. */
  warnings: string[];
  /** What `install-hooks` changes on its own — bounded and stated up front. */
  disclosures: string[];
  /** Present when hooks were skipped: how to do it deliberately, by hand. */
  manualInstructions: string[];
}

/**
 * What `git-ai install-hooks` still does that we do NOT control (ac-0009). Ours
 * is the decision to run it; these are its terms, and they are disclosed rather
 * than discovered.
 */
export const INSTALL_HOOKS_DISCLOSURES: readonly string[] = [
  'resets the GLOBAL git `trace2` section and writes its own trace2.eventTarget/eventNesting — machine-wide, every repo (only ever run here on an observed-EMPTY trace2 config)',
  'stops and restarts the git-ai background daemon',
  'rewrites each detected agent config file in place (Claude/Codex/Gemini/Droid/Cursor/Windsurf/… ), reformatting it and discarding JSONC comments — git-ai keeps no backups',
  'runs `uninstall_skills` whenever `--skills` is absent, removing git-ai skill links on every invocation — so we always invoke WITHOUT `--skills`, and it always removes them. A precondition guard inspects all nine skill paths first (`ask`, `prompt-analysis`, `git-ai-search` under ~/.agents, ~/.cursor and $CLAUDE_CONFIG_DIR|~/.claude): if any holds real content rather than a symlink, we do not invoke it at all',
  'CANNOT be scoped to chosen agents — there is no per-agent selector, so it hooks every coding harness it detects in one shot (ten of them on the dogfood machine)',
  'installs a VS Code extension into BOTH Code and Code-Insiders and rewrites both settings.json files',
  'does NOT instrument agents that are already running — a live session stays uninstrumented until it restarts, and its prior work is attributed to the human',
];

/**
 * Argument spellings we must NEVER pass to `install-hooks` (live dogfood, 2026-08-06).
 *
 * `parse_install_options` ends in `_ => {}` (`install_hooks.rs:357-388`), so an
 * unrecognised argument is silently ignored and the command runs with defaults
 * — a FULL, machine-wide install. `git ai install-hooks --help` installed
 * everything on the dogfood machine, and every near-miss spelling of the safety
 * flag (`--dryrun`, `--dry_run`, `--dry-run=1`, `--dry-run true`) does the same.
 *
 * The safety flag fails OPEN. So the collector never relies on one: it passes
 * exactly `['install-hooks']` and verifies the outcome by RE-READING the global
 * git config afterwards, never by trusting an exit code or a flag.
 */
export const FORBIDDEN_HOOK_ARGS: readonly string[] = [
  '--help',
  '-h',
  '--dryrun',
  '--dry_run',
  '--dry-run=1',
  '--dry-run',
];

/**
 * git-ai config keys that pin the pin (ac-0007). Written BEFORE the binary is
 * first executed: their updater runs on invocation, and an updater that fires
 * once has already replaced the artifact we verified.
 */
export const GITAI_PIN_CONFIG = {
  disable_auto_updates: true,
  disable_version_checks: true,
} as const;

/** Merge our two keys into any existing git-ai config, preserving the rest. */
function writePinnedConfig(deps: CollectorDeps): { ok: boolean; detail: string } {
  const path = configPathFor(deps.host.home);
  let existing: Record<string, unknown> = {};
  if (deps.fs.exists(path)) {
    const raw = deps.fs.readText(path);
    if (raw !== null && raw.trim() !== '') {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          existing = parsed as Record<string, unknown>;
        }
      } catch {
        // A config we cannot parse is one we must not silently replace: keep the
        // keys we own, and say so. Their loader tolerates a rewritten file.
        return { ok: false, detail: `existing ${path} is not valid JSON — left untouched` };
      }
    }
  }
  try {
    deps.fs.mkdirp(path.replace(/\/[^/]*$/, ''));
    deps.fs.writeText(path, `${JSON.stringify({ ...existing, ...GITAI_PIN_CONFIG }, null, 2)}\n`);
    return { ok: true, detail: `auto-update and version checks disabled in ${path}` };
  } catch (err) {
    return {
      ok: false,
      detail: `could not write ${path}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Agent ids named in git-ai's install-hooks output (best-effort, never fatal). */
function parseInstalledAgents(stdout: string): string[] {
  const ids = new Set<string>();
  for (const line of stdout.split('\n')) {
    const match = /^\s*([a-z0-9_-]+)\s*[:=]\s*(installed|already_installed)\b/i.exec(line);
    if (match?.[1]) ids.add(match[1].toLowerCase());
  }
  return [...ids].sort();
}

/**
 * Record the OUTCOME OF AN ATTEMPT without lying about the MACHINE.
 *
 * `preserveCoverage` is not a convenience flag — it is the distinction between
 * the two ways an install can fail to happen:
 *
 * - A **precondition guard refused** (`skipped-trace2`, `skipped-skills`). We
 *   never invoked git-ai, so nothing on this machine changed. Hooks that were
 *   proven installed are still installed and still collecting, and saying
 *   otherwise is a confident wrong number (phase-1 review, round 3).
 * - **git-ai ran and the outcome was bad** (`failed`, `unverified`). It may have
 *   changed the machine, and we have no evidence about what survived. Prior
 *   coverage is no longer proven, so it is not carried forward.
 *
 * Either way the attempt itself is written down, so a re-check that got blocked
 * is visible as a blocked re-check rather than inferred from a missing agent.
 */
function recordAttempt(
  state: CollectorState,
  now: string,
  attempt: {
    status: HooksInstallStatus;
    detail: string;
    uncovered: string[];
    preserveCoverage: boolean;
  },
): CollectorState {
  const keep = attempt.preserveCoverage && state.hooks.status === 'installed';
  return {
    ...state,
    updated_at: now,
    last_attempt: {
      status: attempt.status,
      at: now,
      detail: attempt.detail,
      uncovered: attempt.uncovered,
    },
    hooks: keep
      ? state.hooks
      : { status: attempt.status, at: now, agents: [], detail: attempt.detail },
  };
}

/** Agents on this machine the RECORDED install does not cover — a pure fs read. */
function uncoveredAgentIds(deps: CollectorDeps, state: CollectorState): string[] {
  const covered = state.hooks.status === 'installed' ? state.hooks.agents : [];
  return agentsMissingHooks(detectAgents(deps.fs, deps.host.home), covered).map(
    (agent) => agent.id,
  );
}

/**
 * Stage 2 — hooks. Callable on its own for a re-check (ac-0010): the trace2
 * guard runs EVERY time, first install and re-check alike, because git-ai
 * re-applies the trace2 removal on every invocation.
 *
 * A re-check therefore behaves like a first install in every respect, including
 * the block: once hooks are on, git-ai's own two trace2 keys are in the global
 * config, so a later re-check observes `present` and STOPS — new agents are
 * still reported, and the operator gets the manual instructions. That is the
 * intended posture, not a gap: nothing local can prove a machine-wide git value
 * is still ours to delete (phase-1 review, round 2 P0).
 *
 * What a block does NOT do is revoke coverage we already proved. The blocked
 * attempt lands in `last_attempt`; `hooks` keeps saying what the machine
 * actually has (see {@link recordAttempt}).
 */
export async function installHooks(
  deps: CollectorDeps,
  state: CollectorState,
  binaryPath: string,
): Promise<{ hooks: HooksStage; state: CollectorState; warnings: string[]; manual: string[] }> {
  const now = deps.clock.nowIso();
  const reading = await readGlobalTrace2({ exec: deps.exec, cwd: deps.cwd }, now);
  let next = recordTrace2Observation(state, {
    observed: reading.status,
    entries: reading.entries,
    at: reading.observedAt,
    phase: 'guard',
  });

  if (!mayInstallHooks(reading)) {
    const manual = manualHookInstructions(binaryPath, reading.entries);
    const uncovered = uncoveredAgentIds(deps, next);
    const preserved = next.hooks.status === 'installed';
    next = recordAttempt(next, now, {
      status: 'skipped-trace2',
      detail: reading.detail,
      uncovered,
      preserveCoverage: true,
    });
    writeCollectorState(deps.fs, deps.cwd, next);
    return {
      hooks: 'skipped-trace2',
      state: next,
      warnings: [
        preserved
          ? `git-ai hooks could NOT be added for ${uncovered.join(', ') || 'the new harness'} — ${reading.detail}. The hooks already installed for ${next.hooks.agents.join(', ')} are UNAFFECTED and still collecting; the pinned CLI is unaffected too.`
          : `git-ai hooks NOT installed — ${reading.detail}. The pinned CLI is installed and unaffected.`,
      ],
      manual,
    };
  }

  // SECOND precondition, same shape as the first: inspect, and decline to
  // destroy. git-ai removes its three skill links when invoked without
  // `--skills` and overwrites them when invoked with it, so a real directory at
  // any of those nine paths makes BOTH spellings destructive. There is no flag
  // value that is safe here — only not invoking is (phase-1 review, skills).
  const skills = readSkillsGuard(deps.paths, deps.host);
  if (!skills.mayInstall) {
    const uncovered = uncoveredAgentIds(deps, next);
    const preserved = next.hooks.status === 'installed';
    next = recordAttempt(next, now, {
      status: 'skipped-skills',
      detail: skills.detail,
      uncovered,
      preserveCoverage: true,
    });
    writeCollectorState(deps.fs, deps.cwd, next);
    return {
      hooks: 'skipped-skills',
      state: next,
      warnings: [
        preserved
          ? `git-ai hooks could NOT be added for ${uncovered.join(', ') || 'the new harness'} — ${skills.detail}. The hooks already installed for ${next.hooks.agents.join(', ')} are UNAFFECTED and still collecting.`
          : `git-ai hooks NOT installed — ${skills.detail}`,
      ],
      manual: manualSkillsInstructions(binaryPath, skills.blocking),
    };
  }

  // Observed empty, and written down before we act on it.
  //
  // LAST MOMENT BEFORE THE ONLY UNRECOVERABLE STEP: `install-hooks` rewrites
  // each detected agent's config in place and discards JSONC comments, keeping
  // no backup of its own. Copy them first. Placed AFTER both guards on purpose —
  // a refused install changes nothing, so backing up ahead of the guards would
  // litter the disk on exactly the runs that touched nothing.
  const backup = backupAgentConfigs(deps);
  if (backup.failed.length > 0) {
    // P1-C (cross-model review 2026-08-09). A BACKUP WE COULD NOT TAKE MUST STOP
    // THE STEP IT EXISTS TO PROTECT.
    //
    // This block reverses a judgement made when the backup was written — that a
    // backup which could abort the install would be a worse failure than the
    // comment loss it prevents. The review is right that it had it backwards,
    // and the reason is not the loss itself but the CLAIM: `backupAgentConfigs`
    // is non-blocking, so the success line could name a backup directory for an
    // operator whose config was rewritten and NOT copied. Telling someone their
    // originals are safe, having destroyed them, is worse than not copying at
    // all — they stop looking.
    //
    // Only `failed` blocks. `undeclared` is the honest, declared denominator gap
    // (agents git-ai hooks that we do not enumerate); blocking on that would be a
    // permanent refusal on every machine, which is a refusal nobody can act on.
    const detail = `install-hooks was NOT run: the agent configs it rewrites in place could not be copied first (${backup.failed.join('; ')}). It discards JSONC comments and keeps no backup of its own, so harness will not run it without one.`;
    next = recordAttempt(next, now, {
      status: 'not-attempted',
      detail,
      uncovered: uncoveredAgentIds(deps, next),
      preserveCoverage: true,
    });
    writeCollectorState(deps.fs, deps.cwd, next);
    return {
      hooks: 'not-attempted',
      state: next,
      warnings: [detail],
      manual: manualHookInstructions(binaryPath, reading.entries),
    };
  }
  let result: { code: number; stdout: string; stderr: string };
  try {
    result = await deps.exec.run(binaryPath, ['install-hooks'], {
      cwd: deps.cwd,
      timeoutMs: INSTALL_HOOKS_TIMEOUT_MS,
    });
  } catch (err) {
    next = recordAttempt(next, now, {
      status: 'failed',
      detail: `install-hooks could not be run: ${err instanceof Error ? err.message : String(err)}`,
      uncovered: uncoveredAgentIds(deps, next),
      preserveCoverage: false,
    });
    writeCollectorState(deps.fs, deps.cwd, next);
    return { hooks: 'failed', state: next, warnings: [next.hooks.detail], manual: [] };
  }

  if (result.code !== 0) {
    next = recordAttempt(next, now, {
      status: 'failed',
      detail: `install-hooks exited ${result.code}${
        result.stderr.trim() === '' ? '' : `: ${result.stderr.trim().split('\n')[0]}`
      }`,
      uncovered: uncoveredAgentIds(deps, next),
      preserveCoverage: false,
    });
    writeCollectorState(deps.fs, deps.cwd, next);
    return { hooks: 'failed', state: next, warnings: [next.hooks.detail], manual: [] };
  }

  const reported = parseInstalledAgents(result.stdout);
  const agents =
    reported.length > 0 ? reported : detectAgents(deps.fs, deps.host.home).map((a) => a.id);

  // VERIFY BY RE-READING, never by trusting the exit code (live dogfood): their
  // safety flag fails open, so the only trustworthy statement about what
  // install-hooks did to the global config is a fresh read of that config. This
  // second observation also records what git-ai left behind — the next reader can
  // see we found trace2 empty and that git-ai's own keys are now there.
  const after = await readGlobalTrace2({ exec: deps.exec, cwd: deps.cwd }, deps.clock.nowIso());
  next = recordTrace2Observation(next, {
    observed: after.status,
    entries: after.entries,
    at: after.observedAt,
    phase: 'post-install',
  });

  // …and the verification DECIDES the outcome. Recording the evidence and then
  // ruling on the exit code anyway is the exact defect this re-read exists to
  // prevent: git-ai exits 0 for arguments it never understood, so a zero exit is
  // not a claim about hooks. Absent or unreadable ⇒ never `installed`.
  const verification = verifyInstalledTrace2(after);
  if (verification.status !== 'verified') {
    next = recordAttempt(next, now, {
      status: 'unverified',
      detail: verification.detail,
      uncovered: uncoveredAgentIds(deps, next),
      preserveCoverage: false,
    });
    writeCollectorState(deps.fs, deps.cwd, next);
    return {
      hooks: 'unverified',
      state: next,
      warnings: [
        `${verification.detail}. Treat AI attribution as NOT being collected; the pinned CLI is installed and unaffected.`,
      ],
      manual: manualHookInstructions(binaryPath, after.entries),
    };
  }

  next = {
    ...next,
    updated_at: now,
    last_attempt: {
      status: 'installed',
      at: now,
      detail: 'install-hooks ran and was verified by re-reading the global trace2 config',
      uncovered: [],
    },
    hooks: {
      status: 'installed',
      at: now,
      agents,
      detail: `hooks installed for ${agents.length} agent(s): ${agents.join(', ') || '(none detected)'} — verified by re-reading the global trace2 config; agents already RUNNING stay uninstrumented until they restart`,
    },
  };
  writeCollectorState(deps.fs, deps.cwd, next);
  // The backup location is reported on the SUCCESS path too — that is the run
  // where configs were actually rewritten, so it is the run whose operator most
  // needs to know where the originals went. Reported as a warning-channel line
  // because it is information, not a problem; doctor never fails on these.
  //
  // `undeclared` counts as something to say, and adding it is the same P1-C
  // principle applied to its inverse. It used to be suppressed whenever nothing
  // was copied — so a machine where we DETECTED an agent and simply did not know
  // where its config lives reported the identical silence as a machine with
  // nothing to copy. "We backed up nothing because there was nothing" and "we
  // backed up nothing because we did not look" are different facts, and only one
  // of them means the operator's file is safe. (`failed` can no longer reach
  // here at all — it blocks above — and is kept only so this line stays true if
  // that ever changes.)
  const backupWorthSaying =
    backup.copied.length > 0 || backup.failed.length > 0 || backup.undeclared.length > 0;
  return {
    hooks: 'installed',
    state: next,
    warnings: backupWorthSaying ? [backup.detail] : [],
    manual: [],
  };
}

/** The full lifecycle: stage 1 (pinned CLI) then stage 2 (hooks, skippable). */
export async function installCollector(deps: CollectorDeps): Promise<CollectorInstallResult> {
  const manifest = deps.manifest ?? GITAI_PIN;
  const now = deps.clock.nowIso();
  let state = readCollectorState(deps.fs, deps.cwd) ?? emptyCollectorState(now, manifest);
  state = {
    ...state,
    updated_at: now,
    manifest: {
      ...state.manifest,
      version: manifest.version,
      expect_schema_version: manifest.expect_schema_version,
    },
    note_schema: { ...state.note_schema, expected: manifest.expect_schema_version },
  };
  const warnings: string[] = [];
  // Any fresh attempt supersedes the machine-wide "stop retrying" record — an
  // explicit `--install-collector` IS the retry, and on the automatic path this
  // is a no-op because a blocked run never reaches here. Cleared BEFORE the
  // attempt so a second failure writes a current record rather than preserving
  // a stale timestamp.
  clearAutoInstallBlock(deps.fs, deps.host);

  const resolution = resolveArtifact(deps.host.platform, deps.host.arch, manifest);
  if (!resolution.ok) {
    state = {
      ...state,
      cli: {
        status: 'unsupported-platform',
        path: null,
        digest: null,
        verified_at: null,
        executable: false,
        detail: resolution.detail,
      },
      hooks: { status: 'not-attempted', at: null, agents: [], detail: 'no CLI to hook with' },
    };
    writeCollectorState(deps.fs, deps.cwd, state);
    return {
      cli: 'unsupported-platform',
      hooks: 'not-attempted',
      state,
      warnings: [resolution.detail],
      disclosures: [],
      manualInstructions: [],
    };
  }

  const artifact = resolution.artifact;
  const binaryPath = binaryPathFor(deps.host.home, deps.host.platform);
  state = {
    ...state,
    manifest: {
      ...state.manifest,
      platform: artifact.key,
      artifact: artifact.file,
      sha256: artifact.sha256,
    },
  };

  // Already-current short-circuit: hash what is on disk, never trust the record.
  let cli: CliStage = 'installed';
  const onDisk = deps.fs.exists(binaryPath) ? deps.fs.readBytesNoFollow(binaryPath) : null;
  const onDiskDigest = onDisk === null ? null : deps.hash.sha256Hex(onDisk).toLowerCase();
  if (onDiskDigest === artifact.sha256.toLowerCase()) {
    cli = 'already-current';
    state = {
      ...state,
      cli: {
        status: 'already-current',
        path: binaryPath,
        digest: onDiskDigest,
        verified_at: now,
        executable: state.cli.executable,
        detail: `pinned ${manifest.version} already present and hash-matching`,
      },
    };
  } else {
    const downloaded = await downloadAndVerify(
      { fs: deps.fs, hash: deps.hash, http: deps.http, exe: deps.exe },
      {
        url: artifact.url,
        sha256: artifact.sha256,
        destPath: binaryPath,
        platform: deps.host.platform,
      },
    );
    if (!downloaded.ok) {
      state = {
        ...state,
        cli: {
          status: 'failed',
          path: null,
          digest: null,
          verified_at: null,
          executable: false,
          detail: `${downloaded.reason}: ${downloaded.detail}`,
        },
        hooks: {
          status: 'not-attempted',
          at: null,
          agents: [],
          detail: 'no verified CLI to hook with',
        },
      };
      writeCollectorState(deps.fs, deps.cwd, state);
      return {
        cli: 'failed',
        hooks: 'not-attempted',
        state,
        warnings: [state.cli.detail],
        disclosures: [],
        manualInstructions: [],
      };
    }
    state = {
      ...state,
      cli: {
        status: 'installed',
        path: downloaded.path,
        digest: downloaded.digest,
        verified_at: now,
        executable: downloaded.executable,
        detail: `pinned ${manifest.version} verified (${downloaded.bytes} bytes) and placed at ${downloaded.path}`,
      },
    };
    if (deps.host.platform !== 'win32' && !downloaded.executable) {
      warnings.push(`could not set the executable bit on ${downloaded.path}`);
    }
  }

  // Config BEFORE first execution (ac-0007) — the updater runs on invocation, so
  // "before the first run" is the only moment this write is worth anything.
  //
  // AND A FAILED WRITE STOPS THE EXECUTION (P1-B, cross-model review 2026-08-09).
  // It used to push a warning and run the binary anyway, which defeats the
  // ordering entirely: the whole value of writing the config first is that
  // git-ai never gets to self-update away from the pin, and a warning does not
  // prevent that — it annotates it. If we cannot disable the updater, the pinned,
  // digest-verified artifact we just placed is exactly what we must not run.
  //
  // Nothing is half-done here: the CLI stage's own result stands (the binary is
  // placed and verified), and NEITHER binary invocation happens — not
  // `install-hooks`, not the `status --json` schema probe.
  const config = writePinnedConfig(deps);
  if (!config.ok) {
    state = {
      ...state,
      hooks: {
        status: 'not-attempted',
        at: null,
        agents: [],
        detail: `git-ai's auto-update could not be disabled (${config.detail}), so the pinned binary was NOT executed — running it could replace the digest-verified artifact with whatever the updater fetches`,
      },
    };
    writeCollectorState(deps.fs, deps.cwd, state);
    return {
      cli,
      hooks: 'not-attempted',
      state,
      warnings: [...warnings, config.detail, state.hooks.detail],
      // Nothing was invoked, so nothing was disclosed-and-done.
      disclosures: [],
      manualInstructions: [],
    };
  }

  writeCollectorState(deps.fs, deps.cwd, state);

  const hooks = await installHooks(deps, state, binaryPath);
  const schema = await assertNoteSchema(deps, hooks.state, binaryPath);

  return {
    cli,
    hooks: hooks.hooks,
    state: schema.state,
    warnings: [...warnings, ...hooks.warnings, ...schema.warnings],
    disclosures: [...INSTALL_HOOKS_DISCLOSURES],
    manualInstructions: hooks.manual,
  };
}

export interface CollectorRecheckResult {
  /** Agent ids present on the machine that the recorded install did not cover. */
  newAgents: string[];
  /**
   * The outcome of THIS attempt — `skipped-trace2` when a guard refused. Not a
   * statement about what the machine has: read {@link CollectorRecheckResult.coverage}
   * for that.
   */
  hooks: HooksStage;
  /**
   * Hook coverage as it stands AFTER the re-check — unchanged by a guard that
   * refused to invoke git-ai. A blocked re-check leaves this exactly as it was,
   * which is the whole point (phase-1 review, round 3).
   */
  coverage: { status: HooksInstallStatus; agents: string[] };
  state: CollectorState;
  warnings: string[];
  manualInstructions: string[];
}

/**
 * The RE-CHECK (ac-0010): a new coding harness appeared on this machine after
 * the hooks went on, so its edits are being attributed to nobody.
 *
 * Re-running hooks goes through {@link installHooks}, which means the trace2
 * guard runs AGAIN — this is exactly the case the ruling's condition 4 was
 * written for. git-ai re-applies the trace2 removal on every `install-hooks`,
 * so a guard that only ran on first install would protect the first developer
 * and quietly hand over everyone else's config on the second run.
 *
 * A blocked re-check is therefore an ordinary outcome, and it must leave the
 * report BETTER than not running it: existing coverage survives untouched, the
 * new agent stays named as the gap, and the block is recorded as an attempt.
 */
export async function recheckCollector(deps: CollectorDeps): Promise<CollectorRecheckResult> {
  const manifest = deps.manifest ?? GITAI_PIN;
  const now = deps.clock.nowIso();
  const state = readCollectorState(deps.fs, deps.cwd) ?? emptyCollectorState(now, manifest);
  const detected = detectAgents(deps.fs, deps.host.home);
  const covered = new Set(state.hooks.agents.map((id) => id.toLowerCase()));
  const newAgents = detected.filter((agent) => !covered.has(agent.id.toLowerCase()));

  const coverageOf = (s: CollectorState) => ({ status: s.hooks.status, agents: s.hooks.agents });

  if (newAgents.length === 0) {
    return {
      newAgents: [],
      hooks: state.hooks.status,
      coverage: coverageOf(state),
      state,
      warnings: [],
      manualInstructions: [],
    };
  }
  if (state.cli.path === null) {
    return {
      newAgents: newAgents.map((agent) => agent.id),
      hooks: 'not-attempted',
      coverage: coverageOf(state),
      state,
      warnings: [
        `${newAgents.map((a) => a.label).join(', ')} present but git-ai is not installed — no attribution is being collected for them`,
      ],
      manualInstructions: [],
    };
  }

  const result = await installHooks(deps, state, state.cli.path);
  return {
    newAgents: newAgents.map((agent) => agent.id),
    hooks: result.hooks,
    coverage: coverageOf(result.state),
    state: result.state,
    warnings: [
      `new coding harness detected since the last hook install: ${newAgents
        .map((agent) => agent.label)
        .join(', ')}`,
      ...result.warnings,
    ],
    manualInstructions: result.manual,
  };
}

/**
 * ac-000f — assert the pinned `expect_schema_version` against the installed
 * binary AFTER install, so binary drift and note-format drift land in the same
 * review.
 *
 * Honest about its own reach: git-ai exposes no "what note schema do you write?"
 * query, so this reads the schema string out of the binary's own reported
 * capabilities where it can and records `unknown` where it cannot. `unknown` is
 * a distinct recorded value, never a pass.
 */
export async function assertNoteSchema(
  deps: CollectorDeps,
  state: CollectorState,
  binaryPath: string,
): Promise<{ state: CollectorState; warnings: string[] }> {
  const expected = (deps.manifest ?? GITAI_PIN).expect_schema_version;
  let observed: string | null = null;
  try {
    const result = await deps.exec.run(binaryPath, ['status', '--json'], {
      cwd: deps.cwd,
      timeoutMs: 15_000,
    });
    const match = /authorship\/\d+\.\d+\.\d+/.exec(`${result.stdout}\n${result.stderr}`);
    observed = match?.[0] ?? null;
  } catch {
    observed = null;
  }
  const status = observed === null ? 'unknown' : observed === expected ? 'match' : 'mismatch';
  const next: CollectorState = {
    ...state,
    updated_at: deps.clock.nowIso(),
    note_schema: { expected, observed, status },
  };
  writeCollectorState(deps.fs, deps.cwd, next);
  return {
    state: next,
    warnings:
      status === 'mismatch'
        ? [
            `git-ai reports note schema ${observed as string}, but the manifest expects ${expected} — review the manifest and the readers together before trusting the notes`,
          ]
        : [],
  };
}
