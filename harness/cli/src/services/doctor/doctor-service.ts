import type { Clock } from '../../adapters/clock/clock-port.js';
import type { EnvPort } from '../../adapters/env/env-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { GitPort } from '../../adapters/git/git-port.js';
import type { ProcessPort } from '../../adapters/process/process-port.js';
import { type Envelope, formatDegraded, formatOk } from '../../output/envelope.js';
import { ErrorCodes } from '../../output/error-codes.js';
import type { ExtensionRecord } from '../extensions/contract.js';
import type { VerbRegistry } from '../extensions/registry.js';
import type { RecordRegistry, RecordTypeEntry } from '../record/registry.js';
import { posixDirname, posixJoin, posixRelative, toPosix } from '../shared/posix-path.js';
import { HARNESS_DIR, TEMP_DIR } from '../shared/temp.js';

/** Adapters the doctor service depends on (injected — never constructed here). */
export interface DoctorDeps {
  fs: FsPort;
  proc: ProcessPort;
  git: GitPort;
  env: EnvPort;
  clock: Clock;
  /** The RUNNING CLI's version — an injected string (`readVersion` reads `node:fs`, so it stays in the wiring, never the service — P2). Absent → the skew check is skipped. */
  runningVersion?: string;
}

/** One layer of the doctor report. */
export interface LayerReport {
  name: string;
  /** True when the layer is configured/ready. */
  ok: boolean;
  detail: string;
  /** Present when the layer is not ok — what to do about it. */
  next_action?: string;
}

/**
 * A package-convention violation for one loaded extension (plan 014 D2). The
 * record itself STAYS `loaded` (the verb runs — AC-9); the complaint lives here
 * so the contract's `ExtensionRecord` shape is untouched (D5).
 */
export interface ConventionComplaint {
  /** The extension folder in violation. */
  folder: string;
  /** E144-prefixed complaint line. */
  detail: string;
  /** What to do about it (P7). */
  next_action: string;
}

/** The full doctor report (the envelope `data`). */
export interface DoctorReport {
  layers: LayerReport[];
  branch: string | null;
  /** Whether HARNESS_JSON forces JSON output (read via the env port). */
  json_env: boolean;
  /** Per-extension provenance enumerated WITHOUT invoking any handler (P7). */
  extensions: ExtensionRecord[];
  /** Package-convention complaints (missing `instructions.md`) — the doctor wail (plan 014 D2). */
  conventions: ConventionComplaint[];
  /** The merged record types (core ∪ extension) enumerated declaratively. */
  recordTypes: RecordTypeEntry[];
}

/**
 * Dev mode (this repo, the harness's home): the toolchain that builds and checks
 * the CLI itself. `just` (recipe runner) and `biome` (lint/format) are THIS
 * repo's dev tools — never a consumer's, so they are enforced only in dev mode.
 */
const DEV_TOOLS = ['node', 'just', 'biome'];
/**
 * Consumer mode (installed clone): the core cannot know the repo's toolchain, and
 * deciding "is the repo ready / does it build" is the boot extension's per-repo
 * job (constitution P10 — the core hardcodes no repo command/tool list). The only
 * tool the core itself needs is `node` (the CLI is a Node program; engines
 * node>=22), so that is all consumer mode enforces — `just`/`biome` are not a
 * consumer's concern.
 */
const CORE_TOOLS = ['node'];
/**
 * The minimum Node major the CLI supports (mirrors `engines.node` `">=22"`). The
 * floor is load-bearing on Windows: launching a `.cmd` shim needs a patched Node
 * — a bare `.cmd` spawn EINVALs on <20.12.2, and the CLI standardises on ≥22
 * (plan 031 / workshop 001). `engines` is only advisory (npx won't enforce it),
 * so the doctor `node-runtime` layer enforces it at runtime.
 */
const NODE_FLOOR_MAJOR = 22;
/**
 * Relative to cwd. The dev-vs-consumer marker (FX001 / plan-013 FIND-2) gates BOTH
 * the toolchain and cli-build layers:
 * - Dev (marker present): enforce the full dev toolchain (DEV_TOOLS) and check the
 *   build output.
 * - Consumer (marker absent): the dev toolchain + build checks do not apply — the
 *   toolchain layer enforces only `node` (CORE_TOOLS) and both layers report ok with
 *   a `consumer` detail instead of falsely degrading the envelope. What "ready" means
 *   for the consumer's own toolchain is the boot extension's job.
 * The marker is a FILE (not the `harness/cli/` dir) so both NodeFs and FakeFs resolve it
 * with plain exists(); there is no `harness/cli/package.json` — the CLI builds from the
 * root package, so its tsconfig is the stable dev-tree marker.
 */
const CLI_DEV_MARKER = 'harness/cli/tsconfig.json';
const CLI_BUILD_PATH = 'harness/cli/dist/index.js';

function checkToolchain(proc: ProcessPort, fs: FsPort): LayerReport {
  const dev = fs.exists(CLI_DEV_MARKER);
  const required = dev ? DEV_TOOLS : CORE_TOOLS;
  const missing = required.filter((tool) => proc.which(tool) === null);
  if (missing.length > 0) {
    return {
      name: 'toolchain',
      ok: false,
      detail: `missing tools: ${missing.join(', ')}`,
      next_action: `Install the missing tools: ${missing.join(', ')}.`,
    };
  }
  return {
    name: 'toolchain',
    ok: true,
    detail: dev
      ? `all required tools present (${required.join(', ')})`
      : 'consumer install — core needs only node (present); repo toolchain is owned by the boot extension',
  };
}

/**
 * Runtime Node-version guard (plan 031). Even when `node` is on PATH, an old
 * RUNNING interpreter breaks the Windows `.cmd` launch path — so flag a Node
 * below {@link NODE_FLOOR_MAJOR} as not-ok with a clear upgrade `next_action`
 * (advisory — degrades the envelope, never blocks; the harness never gates).
 * A version string we cannot parse is treated as ok (don't false-alarm).
 */
function checkNodeRuntime(proc: ProcessPort): LayerReport {
  const version = proc.nodeVersion();
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  if (Number.isFinite(major) && major < NODE_FLOOR_MAJOR) {
    return {
      name: 'node-runtime',
      ok: false,
      detail: `Node ${version} is below the supported floor (>=${NODE_FLOOR_MAJOR})`,
      next_action:
        `Upgrade to Node >=${NODE_FLOOR_MAJOR} (the CLI's engines floor). Launching a ` +
        `.cmd shim on Windows needs a patched Node — a bare .cmd spawn EINVALs on older ` +
        `runtimes. Install Node ${NODE_FLOOR_MAJOR} LTS (e.g. \`nvm install ${NODE_FLOOR_MAJOR}\`) and re-run.`,
    };
  }
  return {
    name: 'node-runtime',
    ok: true,
    detail: `Node ${version} (>=${NODE_FLOOR_MAJOR})`,
  };
}

/**
 * Version-skew guard (field-reported 2026-07-04: npm latest lagged the repo head,
 * so reinstalls silently DOWNGRADED consumers — osk-split-billing ran 0.6.0 against
 * a 0.7.0 doctrine and produced stale flow renders + old-schema telemetry). In the
 * dev tree, compare the RUNNING binary's version (its own shipped package.json,
 * injected) against the repo root `package.json`: a mismatch means a stale
 * global/npm install is shadowing the repo build. Advisory — degrades the
 * envelope, never blocks. Old binaries can't self-report (they lack this layer),
 * so the check protects every version from the one that ships it onward; the
 * consumer-repo case has no local version source to compare and is skipped.
 */
function checkVersionSkew(fs: FsPort, runningVersion?: string): LayerReport {
  const name = 'version-skew';
  if (!fs.exists(CLI_DEV_MARKER)) {
    return {
      name,
      ok: true,
      detail: 'consumer install — skew check n/a (no dev tree to compare against)',
    };
  }
  if (!runningVersion) {
    return { name, ok: true, detail: 'running version not injected — skew check skipped' };
  }
  const raw = fs.exists('package.json') ? fs.readText('package.json') : null;
  let repoVersion: string | null = null;
  if (raw !== null) {
    try {
      const manifest = JSON.parse(raw) as { version?: unknown };
      if (typeof manifest.version === 'string') repoVersion = manifest.version;
    } catch {
      // unparseable manifest → skip rather than false-alarm
    }
  }
  if (repoVersion === null) {
    return { name, ok: true, detail: 'repo package.json version unreadable — skew check skipped' };
  }
  if (repoVersion === runningVersion) {
    return {
      name,
      ok: true,
      detail: `running ${runningVersion} matches the repo (no stale install shadowing)`,
    };
  }
  return {
    name,
    ok: false,
    detail:
      `running harness ${runningVersion} but this repo is ${repoVersion} — a stale global/npm ` +
      'install is shadowing the repo build (its renders/telemetry follow OLD behaviour)',
    next_action:
      'Re-point the global at the repo build: `npm link` from the repo root, then `hash -r` and ' +
      're-check `harness --version`. Or run the repo dist directly (`node harness/cli/dist/index.js`). ' +
      'Publishing the current version to npm removes the stale-latest trap for other machines.',
  };
}

function checkCliBuild(fs: FsPort): LayerReport {
  if (!fs.exists(CLI_DEV_MARKER)) {
    return {
      name: 'cli-build',
      ok: true,
      detail: `consumer install — dev build check n/a (no ${CLI_DEV_MARKER})`,
    };
  }
  const built = fs.exists(CLI_BUILD_PATH);
  return {
    name: 'cli-build',
    ok: built,
    detail: built ? `${CLI_BUILD_PATH} present` : `${CLI_BUILD_PATH} not built`,
    ...(built ? {} : { next_action: 'Run `npm run build` to compile the CLI.' }),
  };
}

/**
 * Probe each LOADED extension folder for its convention-required
 * `instructions.md` (plan 014 D2 — extensions are little packages; doctor wails
 * about missing convention files but the verb keeps running, AC-9). The
 * `next_action` path is repo-relative (companion F001 — matches the E143
 * guidance and the public docs); `folder` in the report stays absolute (data).
 */
function checkConventions(
  fs: FsPort,
  proc: ProcessPort,
  registry: VerbRegistry,
): ConventionComplaint[] {
  const complaints: ConventionComplaint[] = [];
  for (const record of registry.records) {
    if (record.status !== 'loaded') {
      continue;
    }
    // entryPath is POSIX from discovery (the single POSIX origin, plan 017);
    // these stay in POSIX space so `folder` matches it shape-for-shape.
    const folder = posixDirname(record.entryPath);
    if (!fs.exists(posixJoin(folder, 'instructions.md'))) {
      const relFolder = posixRelative(toPosix(proc.cwd()), folder) || folder;
      complaints.push({
        folder,
        detail: `${ErrorCodes.EXTENSION_INSTRUCTIONS_MISSING}: missing instructions.md (the agent briefing for this extension's verbs)`,
        next_action: `author ${posixJoin(relFolder, 'instructions.md')} — see \`harness instructions\` for the pattern`,
      });
    }
  }

  // Temp-hygiene probe (plan 015 D5, AC-6): the transient storage class is only
  // safe while its nested self-.gitignore exists. Complaint ONLY when the temp
  // dir exists unprotected; no temp dir yet → silent; no `.harness/` → silent.
  const tempDir = posixJoin(toPosix(proc.cwd()), HARNESS_DIR, TEMP_DIR);
  if (fs.exists(tempDir) && !fs.exists(posixJoin(tempDir, '.gitignore'))) {
    complaints.push({
      folder: tempDir,
      detail: `transient scratch ${HARNESS_DIR}/${TEMP_DIR}/ exists without its nested .gitignore — session buffers risk being committed`,
      next_action: `create ${HARNESS_DIR}/${TEMP_DIR}/.gitignore (a \`harness observe\` capture or \`harness record <type>\` call restores it)`,
    });
  }
  return complaints;
}

/**
 * Enumerate the discovered extensions from the assembled registry (P7). A purely
 * declarative pass — `doctor` NEVER invokes a verb handler; it only reports what
 * the loader already recorded (loaded / failed / conflict). A failed or
 * conflicting extension — or a package-convention violation (plan 014 D2) —
 * makes the layer not-ok (degraded), but is never fatal.
 */
function checkExtensions(registry: VerbRegistry, conventions: ConventionComplaint[]): LayerReport {
  const loaded = registry.records.filter((r) => r.status === 'loaded').length;
  const failed = registry.records.filter((r) => r.status === 'failed').length;
  const conflicts = registry.records.filter((r) => r.status === 'conflict').length;

  const instrMissing = conventions.filter((c) => c.detail.includes('instructions.md')).length;
  const tempUnprotected = conventions.length - instrMissing;
  const suffixParts: string[] = [];
  if (instrMissing > 0) suffixParts.push(`${instrMissing} missing instructions.md`);
  if (tempUnprotected > 0) suffixParts.push('transient scratch unprotected');
  const conventionSuffix = suffixParts.length > 0 ? `, ${suffixParts.join(', ')}` : '';

  if (registry.records.length === 0) {
    const ok = conventions.length === 0;
    return {
      name: 'extensions',
      ok,
      detail: `no extensions installed (from ./.harness/extensions)${conventionSuffix}`,
      next_action: ok
        ? 'Add a verb with `harness new <name>` (a package at `./.harness/extensions/<name>/`).'
        : 'Restore the convention files listed below; run `harness doctor` again.',
    };
  }

  const broken = failed > 0 || conflicts > 0;
  const ok = !broken && conventions.length === 0;
  return {
    name: 'extensions',
    ok,
    detail: `${loaded} loaded, ${failed} failed, ${conflicts} conflict(s)${conventionSuffix} (from ./.harness/extensions)`,
    ...(ok
      ? {}
      : {
          next_action: broken
            ? 'Fix or remove the failed/conflicting extensions listed below; run `harness doctor` again.'
            : instrMissing > 0
              ? 'Author the missing instructions.md briefings listed below — see `harness instructions`.'
              : 'Restore the convention files listed below; run `harness doctor` again.',
        }),
  };
}

/**
 * The mandated quality-gate nucleus (`boot` + `checks`). This row SHIPS in the core
 * (compiled into `dist/`), so every machine is nudged toward the gate regardless of
 * which extensions a repo authored. The check is a declarative verb-name lookup —
 * `doctor` NEVER invokes a handler (P7) — so it is independent of any specific
 * `boot`/`checks` implementation (a consumer's home-grown boot still satisfies it).
 *
 * `checks` is the mandated lint/test/typecheck gate an agent runs before work is
 * "done" (teams gate commits/push on it); `boot` readies the system and composes it.
 * A repo that has begun authoring extensions but lacks either is reported `degraded`
 * (advisory, exit 0 — the harness never gates) with the exact `harness new …` fix.
 * A pristine repo with NO extensions yet stays ok: the gate is an adoption
 * deliverable, and the `extensions` layer already guides bootstrap — doctor doesn't
 * pile a second degrade onto a freshly-installed clone.
 */
const QUALITY_GATE_VERBS = ['boot', 'checks'] as const;

function checkQualityGate(registry: VerbRegistry): LayerReport {
  const verbNames = new Set(
    registry.records
      .filter((r) => r.status === 'loaded')
      .flatMap((r) => r.verbs.map((v) => v.name)),
  );
  const missing = QUALITY_GATE_VERBS.filter((v) => !verbNames.has(v));

  if (registry.records.length === 0) {
    // Pristine clone — the gate is authored during adoption; bootstrap guidance
    // already lives in the extensions layer, so stay quiet here (don't false-degrade).
    return {
      name: 'quality-gate',
      ok: true,
      detail: 'no verbs yet — `boot` + `checks` are authored during adoption',
    };
  }
  if (missing.length === 0) {
    return { name: 'quality-gate', ok: true, detail: '`boot` + `checks` verbs present' };
  }

  const fixes: string[] = [];
  if (missing.includes('checks')) {
    fixes.push(
      'author the mandated quality gate `harness new checks --wrap "<lint+test+typecheck>"` ' +
        '(agents run it before work is done; teams gate commits/push on it)',
    );
  }
  if (missing.includes('boot')) {
    fixes.push(
      'author a boot with `harness new boot` (readies the system, then composes `harness checks`)',
    );
  }
  const have = QUALITY_GATE_VERBS.filter((v) => verbNames.has(v));
  return {
    name: 'quality-gate',
    ok: false,
    detail:
      `missing ${missing.join(' + ')} verb${missing.length > 1 ? 's' : ''}` +
      (have.length > 0 ? ` (have ${have.join(', ')})` : ''),
    next_action: `${fixes.join('; ')}.`,
  };
}

/**
 * The core agent briefing ships baked into the CLI, so this row is always
 * present and always ok (plan 014 D2) — it exists to make the briefing channel
 * discoverable from doctor output.
 */
function checkCoreInstructions(): LayerReport {
  return {
    name: 'instructions',
    ok: true,
    detail: 'core agent briefing baked into the CLI — run `harness instructions`',
  };
}

/**
 * Enumerate the merged record types (core ∪ extension) declaratively — `doctor`
 * NEVER invokes anything; it just reports what the registry resolved. Informational
 * (always ok): an extension type that shadowed a core/earlier type already surfaces
 * as a `conflict` in the extensions layer above (recordShadows), so this line need
 * not re-flag it.
 */
function checkRecordTypes(recordTypes: RecordTypeEntry[]): LayerReport {
  const core = recordTypes.filter((t) => t.source === 'core').length;
  const ext = recordTypes.filter((t) => t.source === 'extension').length;
  return {
    name: 'record-types',
    ok: true,
    detail: `${recordTypes.length} available (${core} core, ${ext} extension)`,
  };
}

/** The kill-switch env (mirrors capture-service's `KILL_SWITCH_ENV`; doctor stays
 *  decoupled from the telemetry module, so the name is duplicated, not imported). */
const TELEMETRY_KILL_SWITCH = 'HARNESS_NO_TELEMETRY';

/**
 * Resolve the EFFECTIVE git hooks dir: `core.hooksPath` when set (read from
 * `.git/config` — deterministic for the standard single-repo layout; worktrees /
 * config-includes fall back to `.git/hooks`, which is the git default anyway).
 */
function resolveHooksDir(fs: FsPort, cwd: string): string {
  const cfg = fs.exists(posixJoin(cwd, '.git/config'))
    ? fs.readText(posixJoin(cwd, '.git/config'))
    : null;
  const m = cfg?.match(/^\s*hooksPath\s*=\s*(.+?)\s*$/m);
  if (m?.[1]) {
    const p = m[1].trim();
    return p.startsWith('/') ? p : posixJoin(cwd, p);
  }
  return posixJoin(cwd, '.git/hooks');
}

/**
 * Deterministic scan for the **post-commit telemetry-flush hook** — the
 * recursion-safe mechanism that flushes the counts-only telemetry buffer to
 * `refs/harness-telemetry/*` on every commit, so a session that commits without
 * running `checks`/`ship` never strands its telemetry (the model can't "forget").
 *
 * Scoped to the case that actually matters: a git repo that IS capturing telemetry
 * (the buffer exists) but has NO flush hook. A repo that never captured, has
 * telemetry disabled, or isn't a git repo gets no nag (stays ok). The hook is
 * "active" when the effective hooks dir holds a `post-commit` that runs
 * `harness telemetry sync`. NEVER invokes anything (P7) — a pure fs/port read.
 */
function checkTelemetryHook(
  fs: FsPort,
  proc: ProcessPort,
  git: GitPort,
  env: EnvPort,
): LayerReport {
  const name = 'telemetry-flush-hook';
  const cwd = toPosix(proc.cwd());
  const capturing = fs.exists(posixJoin(cwd, HARNESS_DIR, TEMP_DIR, 'telemetry'));
  if (!capturing || !git.isRepo() || env.get(TELEMETRY_KILL_SWITCH) === '1') {
    return {
      name,
      ok: true,
      detail: capturing
        ? 'telemetry off or not a git repo — flush hook not needed'
        : 'no telemetry captured yet — flush hook not needed',
    };
  }
  const hookPath = posixJoin(resolveHooksDir(fs, cwd), 'post-commit');
  const body = fs.exists(hookPath) ? fs.readText(hookPath) : null;
  if (body?.includes('telemetry sync')) {
    return {
      name,
      ok: true,
      detail: `post-commit telemetry-sync hook active (${posixRelative(cwd, hookPath) || hookPath})`,
    };
  }
  const dev = fs.exists(CLI_DEV_MARKER);
  return {
    name,
    ok: false,
    detail:
      'telemetry is being captured but NO post-commit flush hook is installed — buffered ' +
      'segments may never reach refs/harness-telemetry/* if you commit without running `checks`/`ship`',
    next_action: dev
      ? 'Run `just install-hooks` — installs a recursion-safe `post-commit` hook that runs ' +
        '`harness telemetry sync` (a counts-only ref push; NOT the heavyweight checks gate).'
      : 'Add a `post-commit` git hook that runs `harness telemetry sync`, so each commit flushes ' +
        'buffered telemetry to refs/harness-telemetry/* (counts-only; recursion-safe).',
  };
}

/**
 * Gather the doctor report via the injected adapters + the assembled verb
 * registry. Pure of `process.exit` and direct Node I/O — all side effects go
 * through the ports, so the whole thing is unit-testable with fakes. The optional
 * `recordRegistry` adds the record-types enumeration (core ∪ extension).
 */
export function buildDoctorReport(
  deps: DoctorDeps,
  registry: VerbRegistry,
  recordRegistry?: RecordRegistry,
): DoctorReport {
  const recordTypes = recordRegistry?.types ?? [];
  const conventions = checkConventions(deps.fs, deps.proc, registry);
  const layers = [
    checkToolchain(deps.proc, deps.fs),
    checkNodeRuntime(deps.proc),
    checkCliBuild(deps.fs),
    checkVersionSkew(deps.fs, deps.runningVersion),
    checkExtensions(registry, conventions),
    checkQualityGate(registry),
    checkTelemetryHook(deps.fs, deps.proc, deps.git, deps.env),
    checkCoreInstructions(),
    checkRecordTypes(recordTypes),
  ];
  const branch = deps.git.isRepo() ? deps.git.currentBranch() : null;
  const json_env = deps.env.get('HARNESS_JSON') === '1';
  return { layers, branch, json_env, extensions: registry.records, conventions, recordTypes };
}

/**
 * Turn a report into an envelope: `ok` when every layer is ready, else
 * `degraded` (still exit 0 — reporting succeeded) with a required next_action.
 * Doctor produces no durable evidence, so it records `{none: true}`.
 */
export function doctorEnvelope(report: DoctorReport, clock: Clock): Envelope {
  const anyFail = report.layers.some((layer) => !layer.ok);
  const evidence = [{ label: 'doctor report', none: true }];
  return anyFail
    ? formatDegraded(
        'doctor',
        report,
        'Resolve the unconfigured/failing layers below; run `harness help` for the verb map.',
        clock,
        { evidence },
      )
    : formatOk('doctor', report, clock, { evidence });
}

/** Convenience: gather + envelope in one call. */
export function runDoctor(
  deps: DoctorDeps,
  registry: VerbRegistry,
  recordRegistry?: RecordRegistry,
): Envelope {
  return doctorEnvelope(buildDoctorReport(deps, registry, recordRegistry), deps.clock);
}

/** Render the report as human diagnostics text (each layer, the extensions, the branch). */
export function renderDoctorText(report: DoctorReport): string {
  const lines: string[] = ['harness doctor — readiness report', ''];
  for (const layer of report.layers) {
    lines.push(`${layer.ok ? '✓' : '✗'} ${layer.name}: ${layer.detail}`);
    if (layer.name === 'extensions') {
      for (const ext of report.extensions) {
        const mark = ext.status === 'loaded' ? '•' : '✗';
        const verbNames = ext.verbs.map((v) => v.name);
        const recordNames = (ext.recordTypes ?? []).map((t) => `${t.type} (record)`);
        const names = [...verbNames, ...recordNames].join(', ') || '(none)';
        const suffix = ext.error ? ` — ${ext.error}` : '';
        lines.push(`    ${mark} ${names} [${ext.status}]  ${ext.entryPath}${suffix}`);
        // Both comparison sides in POSIX space (plan 017 — no partial-normalization mismatch).
        const complaint = report.conventions.find((c) => posixDirname(ext.entryPath) === c.folder);
        if (complaint && ext.status === 'loaded') {
          lines.push(`      ✗ ${complaint.detail}`);
          lines.push(`        → ${complaint.next_action}`);
        }
      }
      // Complaints not tied to an extension folder (e.g. the temp-hygiene probe,
      // plan 015 D5) — the prescription must still be visible (P7).
      for (const complaint of report.conventions) {
        if (!report.extensions.some((ext) => posixDirname(ext.entryPath) === complaint.folder)) {
          lines.push(`    ✗ ${complaint.detail}`);
          lines.push(`      → ${complaint.next_action}`);
        }
      }
    }
    if (layer.name === 'record-types') {
      for (const rt of report.recordTypes) {
        const provenance =
          rt.source === 'extension' ? `[extension] ${rt.entryPath ?? ''}`.trim() : '[core]';
        lines.push(`    • ${rt.type} ${provenance}`);
      }
    }
    if (layer.next_action) {
      lines.push(`    → ${layer.next_action}`);
    }
  }
  lines.push('', `branch: ${report.branch ?? '(detached or not a repo)'}`);
  lines.push(`output: ${report.json_env ? 'JSON forced via HARNESS_JSON' : 'auto (TTY/flag)'}`);
  return `${lines.join('\n')}\n`;
}
