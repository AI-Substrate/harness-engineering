import type { Clock } from '../../adapters/clock/clock-port.js';
import type { EnvPort } from '../../adapters/env/env-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { GitPort } from '../../adapters/git/git-port.js';
import type { ProcessPort } from '../../adapters/process/process-port.js';
import { type Envelope, formatDegraded, formatOk } from '../../output/envelope.js';
import { ErrorCodes } from '../../output/error-codes.js';
import { parse as parseDd } from '../dd/core/parse.js';
import { shouldExcludeFromSweep } from '../dd/core/walk.js';
import { DD_SUFFIX, scanCorpus } from '../dd/links/scan.js';
import type { ExtensionRecord } from '../extensions/contract.js';
import type { VerbRegistry } from '../extensions/registry.js';
import type { RecordRegistry, RecordTypeEntry } from '../record/registry.js';
import { SensorStateStore } from '../sensors/state-store.js';
import { posixDirname, posixJoin, posixRelative, toPosix } from '../shared/posix-path.js';
import { HARNESS_DIR, TEMP_DIR } from '../shared/temp.js';
import {
  evaluateCaptureLiveness,
  readLivenessRecords,
  sourceExtent,
} from '../telemetry/capture-liveness.js';

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

export interface QuietDoctorExtension {
  name: string;
  status: ExtensionRecord['status'];
  verbs: string[];
  /** Present for registries built by the v2-aware loader. */
  format?: string;
}

export interface QuietDoctorReport {
  layers: Array<Pick<LayerReport, 'name' | 'ok'>>;
  branch: string | null;
  extensions: QuietDoctorExtension[];
}

function extensionName(entryPath: string): string {
  const parts = toPosix(entryPath).split('/');
  const file = parts.at(-1) ?? entryPath;
  if (file === 'extension.ts' || file === 'extension.js') {
    return parts.at(-2) ?? file.replace(/\.[^.]+$/, '');
  }
  return file.replace(/\.[^.]+$/, '');
}

function quietDoctorReport(report: DoctorReport): QuietDoctorReport {
  return {
    layers: report.layers.map(({ name, ok }) => ({ name, ok })),
    branch: report.branch,
    extensions: report.extensions.map((extension) => ({
      name: extensionName(extension.entryPath),
      status: extension.status,
      verbs: extension.verbs.map((verb) => verb.name),
      ...(extension.format !== undefined && { format: extension.format }),
    })),
  };
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
 * Sensor-watcher liveness (plan 059 follow-up, field-requested 2026-07-16). When a
 * repo registers sensors, the live picture only stays fresh while the headless
 * watcher runs and publishes a heartbeat to `.harness/temp/sensors/daemon.json`
 * (the 15s liveness window is owned by {@link SensorStateStore.readDaemon}, reused
 * here so this row can never drift from the watcher's own definition of "running").
 * A repo WITH sensors but NO running watcher is reported degraded (advisory, exit 0
 * — the harness never gates) with the three things a caller needs: how to run the
 * watcher (and WHEN to restart it — the watch set is read once at startup, so a
 * newly added extension/sensor is invisible until a restart), how an AGENT reads
 * sensors, and how a HUMAN views them. A repo with no sensors registered stays ok
 * (no nag) — the same "don't pester a repo the feature doesn't apply to" posture as
 * the quality-gate and telemetry-flush rows. NEVER runs a sensor (P7) — a pure
 * heartbeat-file read through the injected fs/clock ports.
 */
function checkSensorWatcher(
  fs: FsPort,
  clock: Clock,
  proc: ProcessPort,
  registry: VerbRegistry,
): LayerReport {
  const name = 'sensor-watcher';
  const sensorCount = (registry.sensors ?? []).length;
  if (sensorCount === 0) {
    return {
      name,
      ok: true,
      detail:
        'no sensors registered — watcher not needed (scaffold one with `harness new <name> --sensor`)',
    };
  }
  // repoRoot matches the sensors act (deps.proc.cwd()) so this reads the exact
  // heartbeat file the watcher writes.
  const daemon = new SensorStateStore({ fs, clock, repoRoot: proc.cwd() }).readDaemon();
  if (daemon.ok && daemon.value.running) {
    return {
      name,
      ok: true,
      detail: `watch scanner running (pid ${daemon.value.pid}, since ${daemon.value.since}) — ${sensorCount} sensor(s) live`,
    };
  }
  return {
    name,
    ok: false,
    detail:
      `${sensorCount} sensor(s) registered but the watch scanner is not running (no live heartbeat) — ` +
      'readings will be stale or absent until it runs',
    next_action:
      'Start the watch scanner so sensors keep measuring: `harness sensors watch` (run it in the ' +
      'background — e.g. via your task runner or `harness sensors watch &` — and RESTART it after ' +
      'adding or changing an extension/sensor, since the watch set is read once at startup). ' +
      'An agent reads the results with `harness sensors --json` (machine-readable status of every ' +
      'sensor; or `harness sensors check` for a one-shot run that exits non-zero on failures, for CI). ' +
      'A human views them live with `harness sensors` (the interactive TUI).',
  };
}

/**
 * Deterministic-document health, as the SHIPPED core sees it (AC-07's consumer
 * half).
 *
 * `harness checks` is this repository's own unpublished extension, so a consumer
 * repo gets nothing from it. This layer is what a consumer actually installs, and
 * it answers the one dd question a doctor is allowed to answer: **is every
 * committed document's rendered sibling present?** That is the breakage people
 * really ship — a `.dd.json` edited and committed without its `.dd.md` — and it is
 * knowable from `exists()` alone.
 *
 * It NEVER runs the sweep (P7): the deep answer is `harness dd doctor`, and the
 * next_action says so rather than this row pretending to have asked. A repo with
 * no dd documents stays ok and silent — the same "don't pester a repo the feature
 * doesn't apply to" posture as the quality-gate and telemetry rows.
 *
 * The sweep's exclusion contract is honoured exactly, by asking dd-core rather
 * than re-deriving it: a known-bad fixture and a `sweep_exclude` document are not
 * missing a render, they are deliberately not participating (AC-15).
 */
function checkDd(fs: FsPort, proc: ProcessPort): LayerReport {
  const name = 'dd-documents';
  const cwd = toPosix(proc.cwd());
  const scan = scanCorpus(fs, cwd);
  if (scan.issues.length > 0) {
    return {
      name,
      ok: false,
      detail: `deterministic documents could not be enumerated: ${scan.issues[0]?.message ?? 'unknown'}`,
      next_action:
        'Fix the unreadable path, then re-run `harness doctor`. `harness dd doctor` gives the full sweep.',
    };
  }

  const swept: string[] = [];
  for (const path of scan.paths) {
    const text = fs.readText(path);
    if (text === null) continue;
    const doc = parseDd(text);
    if (Array.isArray(doc) || shouldExcludeFromSweep(path, doc)) continue;
    swept.push(path);
  }
  if (swept.length === 0) {
    return { name, ok: true, detail: `no ${DD_SUFFIX} documents here — dd not in use` };
  }

  const unrendered = swept.filter(
    (path) => !fs.exists(`${path.slice(0, -DD_SUFFIX.length)}.dd.md`),
  );
  if (unrendered.length === 0) {
    return {
      name,
      ok: true,
      detail: `${swept.length} deterministic document(s), each with its rendered sibling — run \`harness dd doctor\` for the full sweep`,
    };
  }
  return {
    name,
    ok: false,
    detail: `${unrendered.length} of ${swept.length} deterministic document(s) have no rendered sibling: ${unrendered
      .map((path) => posixRelative(cwd, path) || path)
      .slice(0, 3)
      .join(', ')}${unrendered.length > 3 ? ', …' : ''}`,
    next_action:
      'Regenerate with `harness dd build <path>` (or `harness plan render <plan>`) and commit the sibling beside its document. `harness dd doctor` reports the deeper findings this row cannot.',
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
        '`harness telemetry sync` (a counts-only ref push; NOT the heavyweight checks gate). ' +
        'It also arms the `pre-commit` capture hook that anchors evidence to the right commit; ' +
        'disarm just that one with HARNESS_NO_TELEMETRY_PRECOMMIT=1.'
      : 'Add a `post-commit` git hook that runs `harness telemetry sync`, so each commit flushes ' +
        'buffered telemetry to refs/harness-telemetry/* (counts-only; recursion-safe).',
  };
}

/**
 * The **capture-liveness** layer (plan 070 · AC-1) — the product's answer to a
 * capture that silently stops happening.
 *
 * Session `1a501a09` captured once, then went quiet for ~10 further eligible
 * invocations while its transcript grew 2 → 56 lines, and committed ONE thin,
 * plausible, non-zero segment: **a confident wrong number, not a gap.** Nothing
 * could see it, because capture failures are swallowed by contract. The capture
 * path now writes down every eligible attempt that did NOT consume an available
 * window ({@link recordCaptureAttempt}); this layer is where that absence
 * becomes visible.
 *
 * Deliberately quiet for every healthy shape: the kill-switch (no marker is ever
 * written — the switch keeps its zero-side-effect contract), a repo that has
 * never captured, idle polls with no new transcript, adapters with no position
 * sense, and lanes that recovered (an anomaly followed by a capture). It reads
 * markers only — it NEVER invokes capture (P7) and never fabricates a segment.
 */
function checkCaptureLiveness(
  fs: FsPort,
  proc: ProcessPort,
  env: EnvPort,
  clock: Clock,
): LayerReport {
  const name = 'capture-liveness';
  const cwd = toPosix(proc.cwd());
  if (env.get(TELEMETRY_KILL_SWITCH) === '1') {
    return {
      name,
      ok: true,
      detail: 'telemetry disabled (HARNESS_NO_TELEMETRY=1) — nothing to prove live',
    };
  }
  if (!fs.exists(posixJoin(cwd, HARNESS_DIR, TEMP_DIR, 'telemetry'))) {
    return { name, ok: true, detail: 'no telemetry captured yet — no capture lane to watch' };
  }
  const verdict = evaluateCaptureLiveness(
    readLivenessRecords(fs, cwd),
    (path) => sourceExtent(fs, path),
    clock.nowIso(),
  );
  if (verdict.stalled.length === 0 && verdict.residue.length === 0) {
    const seen =
      verdict.sessions === 0
        ? 'no capture attempts recorded yet'
        : `${verdict.sessions} session lane(s) recorded, none stalled`;
    const past =
      verdict.anomalies > 0
        ? ` (${verdict.anomalies} un-captured window(s) seen earlier, since recovered)`
        : '';
    return { name, ok: true, detail: `${seen}${past}` };
  }
  const stalls = verdict.stalled
    .map(
      (s) =>
        `${s.session} (${s.harness}): cursor ${s.cursor ?? 'none'} vs source ${s.position ?? 'unreadable'}, ` +
        `${s.consecutive_uncaptured} un-captured attempt(s), last ${s.last_outcome}` +
        (s.last_error_kind !== undefined ? ` [${s.last_error_kind}]` : '') +
        ` on \`${s.last_command}\` at ${s.last_attempt_at}`,
    )
    .join('; ');
  const residues = verdict.residue
    .map(
      (r) =>
        `${r.session} (${r.harness}): captured ${r.cursor} of ${r.extent} source lines, ` +
        `${r.residue} never captured, idle ${r.idle_hours}h`,
    )
    .join('; ');
  const parts: string[] = [];
  if (verdict.stalled.length > 0) {
    parts.push(`CAPTURE STALLED on ${verdict.stalled.length} lane(s): ${stalls}`);
  }
  if (verdict.residue.length > 0) {
    parts.push(
      `${verdict.residue.length} finished lane(s) left more uncaptured than they captured: ${residues}`,
    );
  }
  return {
    name,
    ok: false,
    detail:
      `${parts.join(' — ')} — telemetry for this work was LOST silently, so what IS committed ` +
      `under-represents the session (a plausible non-zero number, not a visible gap)`,
    next_action:
      'Treat these sessions\u2019 committed telemetry as incomplete — do NOT read their counts as the ' +
      'real volume of work. Preserve the marker files (.harness/temp/telemetry/*.liveness.json) as ' +
      'evidence before the buffer is pruned; `last_outcome` names which stage of capture stopped ' +
      '(error = a swallowed throw, source-unreadable = the transcript could not be read, ' +
      'unread-window = a window was available and skipped), and a residue-only report with healthy ' +
      'attempts points at the SOURCE lagging rather than at capture.',
  };
}

/**
 * The p95 wall-time budget for the `pre-commit` telemetry-capture hook, in
 * milliseconds. Recorded as a CONSTANT, not a comment, because the hook sits on
 * the critical path of every commit: a plan that lands 84 commits pays this
 * number 84 times, so the difference between 200 ms and 2 s is minutes of pure
 * hook tax on one stream. 2000 ms is the o-prime's proposed ceiling from the
 * enablement discussion; move it only with fresh measurements attached.
 */
export const PRECOMMIT_P95_BUDGET_MS = 2000;

/** Samples below this floor describe one host's luck, not a distribution — reported, never judged. */
export const PRECOMMIT_MIN_SAMPLES = 5;

/** Where the pre-commit hook appends `<epoch_ms>\t<duration_ms>` (gitignored transient). */
const PRECOMMIT_SAMPLES_FILE = 'precommit-latency.tsv';

/** Nearest-rank percentile over an ASCENDING-sorted, non-empty array. */
function percentile(sortedAsc: readonly number[], p: number): number {
  const rank = Math.ceil(p * sortedAsc.length);
  return sortedAsc[Math.min(Math.max(rank, 1), sortedAsc.length) - 1] as number;
}

/**
 * The C4 budget INSTRUMENT for the `pre-commit` telemetry-capture hook — the
 * condition that a time budget must be something that can fail, not a sentence
 * in a header. The hook appends one `<epoch_ms>\t<duration_ms>` line per fire to
 * `.harness/temp/precommit-latency.tsv`; this reads that ring and compares p95
 * against {@link PRECOMMIT_P95_BUDGET_MS}.
 *
 * Honest about its own gaps rather than silent (plan 068's house rule): no file
 * means "never fired / no sub-second clock on this host", not "fast"; fewer than
 * {@link PRECOMMIT_MIN_SAMPLES} readings are reported WITH their percentiles but
 * never used to fail a verdict; unparseable lines are counted and named instead
 * of being quietly dropped. NEVER invokes anything (P7) — a pure fs/port read.
 */
function checkPrecommitLatency(fs: FsPort, proc: ProcessPort): LayerReport {
  const name = 'precommit-hook-latency';
  const cwd = toPosix(proc.cwd());
  const path = posixJoin(cwd, HARNESS_DIR, TEMP_DIR, PRECOMMIT_SAMPLES_FILE);
  if (!fs.exists(path)) {
    return {
      name,
      ok: true,
      detail:
        'no pre-commit capture timings recorded — the hook has not fired here ' +
        '(not installed, or this host has no sub-second clock)',
    };
  }
  const lines = (fs.readText(path) ?? '').split('\n').filter((l) => l.trim() !== '');
  const durations: number[] = [];
  let unparseable = 0;
  for (const line of lines) {
    const raw = line.split('\t')[1];
    const ms = raw === undefined ? Number.NaN : Number(raw);
    if (Number.isFinite(ms) && ms >= 0) durations.push(ms);
    else unparseable++;
  }
  const skipped = unparseable > 0 ? `, ${unparseable} unparseable line(s) skipped` : '';
  if (durations.length === 0) {
    return {
      name,
      ok: true,
      detail: `pre-commit capture timings file present but holds no readable samples${skipped}`,
    };
  }
  const sorted = [...durations].sort((a, b) => a - b);
  const p50 = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  const stats = `${durations.length} sample(s): p50 ${p50}ms, p95 ${p95}ms (budget ${PRECOMMIT_P95_BUDGET_MS}ms)`;
  if (durations.length < PRECOMMIT_MIN_SAMPLES) {
    return {
      name,
      ok: true,
      detail: `${stats} — below the ${PRECOMMIT_MIN_SAMPLES}-sample floor, reported not judged${skipped}`,
    };
  }
  if (p95 > PRECOMMIT_P95_BUDGET_MS) {
    return {
      name,
      ok: false,
      detail: `pre-commit capture hook is OVER BUDGET — ${stats}${skipped}`,
      next_action:
        'The pre-commit telemetry capture is taxing every commit. Disarm it with ' +
        '`export HARNESS_NO_TELEMETRY_PRECOMMIT=1` (post-commit flush keeps working), ' +
        'then find the cost — a very long first-capture transcript is the usual one.',
    };
  }
  return { name, ok: true, detail: `pre-commit capture hook within budget — ${stats}${skipped}` };
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
    checkSensorWatcher(deps.fs, deps.clock, deps.proc, registry),
    checkTelemetryHook(deps.fs, deps.proc, deps.git, deps.env),
    checkCaptureLiveness(deps.fs, deps.proc, deps.env, deps.clock),
    checkDd(deps.fs, deps.proc),
    checkPrecommitLatency(deps.fs, deps.proc),
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
export function doctorEnvelope(report: DoctorReport, clock: Clock, quiet = false): Envelope {
  const anyFail = report.layers.some((layer) => !layer.ok);
  const evidence = [{ label: 'doctor report', none: true }];
  const data = quiet ? quietDoctorReport(report) : report;
  return anyFail
    ? formatDegraded(
        'doctor',
        data,
        'Resolve the unconfigured/failing layers below; run `harness help` for the verb map.',
        clock,
        { evidence },
      )
    : formatOk('doctor', data, clock, { evidence });
}

/** Convenience: gather + envelope in one call. */
export function runDoctor(
  deps: DoctorDeps,
  registry: VerbRegistry,
  recordRegistry?: RecordRegistry,
  quiet = false,
): Envelope {
  return doctorEnvelope(buildDoctorReport(deps, registry, recordRegistry), deps.clock, quiet);
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
        const sensorNames = (ext.sensors ?? []).map((sensor) => `${sensor.name} (sensor)`);
        const customNames = (ext.customItems ?? []).map(
          (item) => `${item.type}.${item.name} (custom)`,
        );
        const names =
          [...verbNames, ...recordNames, ...sensorNames, ...customNames].join(', ') || '(none)';
        const suffix = ext.error ? ` — ${ext.error}` : '';
        lines.push(
          `    ${mark} ${names} [${ext.status}]  format: ${ext.format ?? 'v1'}  ${ext.entryPath}${suffix}`,
        );
        for (const info of ext.info ?? []) {
          lines.push(`      ℹ ${info}`);
        }
        if (ext.next_action) {
          lines.push(`      → ${ext.next_action}`);
        }
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
