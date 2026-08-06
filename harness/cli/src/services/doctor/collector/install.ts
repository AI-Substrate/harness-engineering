import { detectAgents } from './agents.js';
import { downloadAndVerify } from './download.js';
import { GITAI_PIN } from './pin.js';
import { binaryPathFor, configPathFor, resolveArtifact } from './platform.js';
import {
  type CollectorState,
  emptyCollectorState,
  readCollectorState,
  recordTrace2Observation,
  writeCollectorState,
} from './state.js';
import { manualHookInstructions, mayInstallHooks, readGlobalTrace2 } from './trace2.js';
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
export type HooksStage = 'installed' | 'skipped-trace2' | 'failed' | 'not-attempted';

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
  'runs `uninstall_skills` whenever `--skills` is absent, removing git-ai skill links on every invocation — so we always invoke WITHOUT `--skills`, and it always removes them',
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
 * Stage 2 — hooks. Callable on its own for a re-check (ac-0010): the trace2
 * guard runs EVERY time, first install and re-check alike, because git-ai
 * re-applies the trace2 removal on every invocation.
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
    next = {
      ...next,
      updated_at: now,
      hooks: {
        status: 'skipped-trace2',
        at: now,
        agents: [],
        detail: reading.detail,
      },
    };
    writeCollectorState(deps.fs, deps.cwd, next);
    return {
      hooks: 'skipped-trace2',
      state: next,
      warnings: [
        `git-ai hooks NOT installed — ${reading.detail}. The pinned CLI is installed and unaffected.`,
      ],
      manual,
    };
  }

  // Observed empty, and written down before we act on it.
  let result: { code: number; stdout: string; stderr: string };
  try {
    result = await deps.exec.run(binaryPath, ['install-hooks'], {
      cwd: deps.cwd,
      timeoutMs: INSTALL_HOOKS_TIMEOUT_MS,
    });
  } catch (err) {
    next = {
      ...next,
      updated_at: now,
      hooks: {
        status: 'failed',
        at: now,
        agents: [],
        detail: `install-hooks could not be run: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
    writeCollectorState(deps.fs, deps.cwd, next);
    return { hooks: 'failed', state: next, warnings: [next.hooks.detail], manual: [] };
  }

  if (result.code !== 0) {
    next = {
      ...next,
      updated_at: now,
      hooks: {
        status: 'failed',
        at: now,
        agents: [],
        detail: `install-hooks exited ${result.code}${
          result.stderr.trim() === '' ? '' : `: ${result.stderr.trim().split('\n')[0]}`
        }`,
      },
    };
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

  next = {
    ...next,
    updated_at: now,
    hooks: {
      status: 'installed',
      at: now,
      agents,
      detail: `hooks installed for ${agents.length} agent(s): ${agents.join(', ') || '(none detected)'} — agents already RUNNING stay uninstrumented until they restart`,
    },
  };
  writeCollectorState(deps.fs, deps.cwd, next);
  return { hooks: 'installed', state: next, warnings: [], manual: [] };
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
        expectHost: manifest.release_host,
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
  const config = writePinnedConfig(deps);
  if (!config.ok) warnings.push(config.detail);

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
  hooks: HooksStage;
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
 */
export async function recheckCollector(deps: CollectorDeps): Promise<CollectorRecheckResult> {
  const manifest = deps.manifest ?? GITAI_PIN;
  const now = deps.clock.nowIso();
  const state = readCollectorState(deps.fs, deps.cwd) ?? emptyCollectorState(now, manifest);
  const detected = detectAgents(deps.fs, deps.host.home);
  const covered = new Set(state.hooks.agents.map((id) => id.toLowerCase()));
  const newAgents = detected.filter((agent) => !covered.has(agent.id.toLowerCase()));

  if (newAgents.length === 0) {
    return {
      newAgents: [],
      hooks: state.hooks.status,
      state,
      warnings: [],
      manualInstructions: [],
    };
  }
  if (state.cli.path === null) {
    return {
      newAgents: newAgents.map((agent) => agent.id),
      hooks: 'not-attempted',
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
