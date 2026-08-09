import type { Clock } from '../../adapters/clock/clock-port.js';
import type { DbPort } from '../../adapters/db/db-port.js';
import type { EnvPort } from '../../adapters/env/env-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { GitAttributionPort } from '../../adapters/git/git-attribution-port.js';
import type { GitPort } from '../../adapters/git/git-port.js';
import type { HashPort } from '../../adapters/hash/hash-port.js';
import type { ProcessPort } from '../../adapters/process/process-port.js';
import { type Envelope, formatDegraded, formatOk } from '../../output/envelope.js';
import { ErrorCodes } from '../../output/error-codes.js';
import { parse as parseDd } from '../dd/core/parse.js';
import { shouldExcludeFromSweep } from '../dd/core/walk.js';
import { DD_SUFFIX, scanCorpus } from '../dd/links/scan.js';
import type { ExtensionRecord } from '../extensions/contract.js';
import type { VerbRegistry } from '../extensions/registry.js';
import { AGENTS_FILE, readAgentsBlock } from '../instructions/commit-guidance.js';
import type { RecordRegistry, RecordTypeEntry } from '../record/registry.js';
import { SensorStateStore } from '../sensors/state-store.js';
import { posixDirname, posixJoin, posixRelative, toPosix } from '../shared/posix-path.js';
import { HARNESS_DIR, TEMP_DIR } from '../shared/temp.js';
import type { HarnessAdapter } from '../telemetry/adapters/harness-adapter.js';
import { coreTelemetryAdapters } from '../telemetry/adapters/index.js';
import { captureDisabledReason } from '../telemetry/capture-gate.js';
import {
  evaluateCaptureLiveness,
  readLivenessRecords,
  sourceExtent,
} from '../telemetry/capture-liveness.js';
import { laneRecoveryReason, type SkipLaneReason } from '../telemetry/capture-reconcile.js';
import { type AtRiskReport, enumerateAtRisk } from './collector/at-risk.js';
import { type CursorSandboxRow, cursorSandboxRow } from './collector/cursor-sandbox.js';
import { type CollectorHealth, readCollectorHealth } from './collector/health.js';
import type { IngressReading } from './collector/ingress.js';
import type { HostTarget } from './collector/types.js';

/** Adapters the doctor service depends on (injected — never constructed here). */
export interface DoctorDeps {
  fs: FsPort;
  proc: ProcessPort;
  git: GitPort;
  env: EnvPort;
  clock: Clock;
  /** The RUNNING CLI's version — an injected string (`readVersion` reads `node:fs`, so it stays in the wiring, never the service — P2). Absent → the skew check is skipped. */
  runningVersion?: string;
  /**
   * Per-harness telemetry adapter OVERRIDE (plan 070) — tests only. Doctor asks
   * the RECONCILER whether each owed capture lane can actually be paid back, and
   * that answer depends on whether a reader for the lane's harness exists.
   *
   * It DEFAULTS to the real registry rather than being required, because the
   * failure mode of forgetting to wire it is the worst one this layer has: every
   * recoverable lane would be reported UNRECOVERABLE — crying wolf on the one
   * surface that must not. The registry is a fixed in-repo constant, not a port,
   * so there is no reason a caller should have to supply it and every reason the
   * mistake should be impossible to make.
   */
  adapters?: HarnessAdapter[];
  /**
   * Read-only SQLite (plan 070). Wired so doctor's recoverability probe sees the
   * SAME sources the sync-time recovery will — without it a lane whose only
   * evidence is timed turns could be reported unrecoverable when sync would in
   * fact recover it, i.e. crying wolf on the one surface that must not.
   */
  db?: DbPort;
  /**
   * The host the git-ai collector resolves against (plan 073) — platform, arch
   * and home. Present ONLY when the composition root supplies it: `ProcessPort`
   * carries no platform/arch, so a service cannot invent this without reading
   * `process` directly (P2). Absent → the collector row is omitted entirely
   * rather than reported as an unknown, because a row that says "could not
   * determine" on every host with no wiring teaches operators to ignore it.
   */
  collectorHost?: HostTarget;
  /**
   * `HARNESS_NO_COLLECTOR=1`. Read at the composition root (P2) and threaded
   * through so the collector row can say "you opted out" rather than describing
   * a deliberate choice as an undiagnosable machine.
   */
  collectorOptedOut?: boolean;
  /**
   * SHA-256 for the collector row (plan 073 · ac-000a). With it, the pinned
   * binary's digest is RE-verified on every doctor run; without it the digest
   * falls back to the recorded install value and can never read `healthy` on
   * evidence this run did not gather.
   */
  hash?: HashPort;
  /**
   * An ALREADY-PERFORMED ingress probe (plan 074 · ac-0002). The probe is async
   * and this report is sync, so the composition root probes once and injects the
   * reading. Absent → the ingress rung is not evaluated and the at-risk row is
   * omitted entirely rather than reported against evidence nobody gathered.
   */
  ingress?: IngressReading;
  /**
   * The narrow git surface the at-risk enumeration reads (plan 074 · ac-0003).
   * Present only when the composition root wires it; absent → no at-risk row.
   *
   * READ-ONLY here BY CONSTRUCTION (ac-0007): doctor is handed the `commitWindow`
   * + `hasAiNote` reads and nothing else, so a bare doctor run structurally
   * cannot stage, commit, replay, or move a ref. The write half of the port and
   * the relay port are given only to the explicitly-invoked verbs.
   */
  attribution?: Pick<GitAttributionPort, 'commitWindow' | 'listNotedShas'>;
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
/** Short, human-scannable session handle. Never the full id — it is a correlation
 * handle, and eight characters is enough to match a lane against a marker file. */
function shortSession(session: string): string {
  return session.slice(0, 8);
}

/** Trailing path segment of a recorded source — a NAME, never a directory. */
function sourceName(path: string): string {
  const parts = toPosix(path).split('/');
  return parts[parts.length - 1] ?? path;
}

/**
 * Render WHY a flagged lane can never be recovered, in operator language.
 *
 * `already-consumed` never reaches here: it means something else captured the
 * window, which is a healthy lane rather than a finding.
 */
function unrecoverableReason(reason: SkipLaneReason, harness: string): string {
  switch (reason) {
    case 'no-adapter':
      return `no reconcile adapter for ${harness}`;
    case 'no-signal':
      return 'source has no usable evidence';
    case 'source-unreadable':
      return 'source file no longer exists';
    default:
      return 'recovery attempt failed';
  }
}

function checkCaptureLiveness(
  fs: FsPort,
  proc: ProcessPort,
  env: EnvPort,
  clock: Clock,
  adapters: HarnessAdapter[] = coreTelemetryAdapters,
  db?: DbPort,
): LayerReport {
  const name = 'capture-liveness';
  const cwd = toPosix(proc.cwd());
  // GATED ON CAPTURE BEING ENABLED (plan 074 · ac-0004). This is the fix for the
  // GREEN-FOREVER failure mode: after plan 073 inverted the capture default,
  // this layer answered `ok:true` on every default install forever — "no capture
  // lane to watch" reads as reassurance, and it was reassurance about a
  // measurement that had stopped being taken at all.
  //
  // Capture-off is not healthy and it is not broken; it is UNDETERMINABLE. There
  // is no capture lane, so nothing about liveness can be established either way,
  // and the honest verdict is the one 073 already established for exactly this
  // shape: `could-not-determine` — never rendered as healthy, never folded into
  // good news. Warn-only, like every doctor rung: doctor exits 0 (073 ac-000c).
  const disabled = captureDisabledReason(env);
  if (disabled !== null) {
    return {
      name,
      ok: false,
      detail:
        disabled === 'kill-switch'
          ? 'could-not-determine — harness telemetry capture is OFF via HARNESS_NO_TELEMETRY=1, so there is no capture lane and liveness cannot be established either way (this is NOT a healthy reading; it is an absent one)'
          : 'could-not-determine — harness telemetry capture is OFF by default since the git-ai collector handover, so there is no capture lane and liveness cannot be established either way (this is NOT a healthy reading; it is an absent one)',
      next_action:
        disabled === 'kill-switch'
          ? "Nothing to fix if that is intended. AI attribution is git-ai's job now — check it with the `gitai-collector` row. To watch harness-side capture again, unset HARNESS_NO_TELEMETRY and set HARNESS_TELEMETRY_CAPTURE=1."
          : "Nothing to fix if that is intended — AI attribution is git-ai's job now, so read the `gitai-collector` row for collection health. Set HARNESS_TELEMETRY_CAPTURE=1 to re-enable harness-side capture and make this layer measurable again.",
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
  // Split the OWED lanes from the UNRECOVERABLE ones, asking the RECONCILER
  // itself which is which — `laneRecoveryReason` is the same function the sync
  // pass runs, so doctor cannot claim a lane is recoverable that sync will skip
  // (or vice versa). Two projections of one answer, never two implementations.
  const owed: string[] = [];
  const unrecoverable: string[] = [];
  // No `env`: doctor asks the recoverability question exactly as sync will answer
  // it, and sync has no EnvPort to give an adapter either (plan 070 P1-B).
  const reconcileDeps = { fs, clock, proc, adapters, ...(db !== undefined && { db }) };
  for (const r of verdict.residue) {
    const reason = laneRecoveryReason(reconcileDeps, cwd, r);
    if (reason === null) {
      owed.push(
        `session ${shortSession(r.session)}: ${r.residue} lines uncaptured, ` +
          `recoverable on next telemetry sync (source: ${sourceName(r.source)})`,
      );
    } else if (reason !== 'already-consumed') {
      // A lane sync will never pay. Reporting it as merely "owed" would be a
      // standing promise that silently never comes true.
      unrecoverable.push(
        `session ${shortSession(r.session)}: ${r.residue} lines uncaptured, ` +
          `UNRECOVERABLE — ${unrecoverableReason(reason, r.harness)}`,
      );
    }
    // `already-consumed` is NOT a finding: something else captured the window.
  }
  // Lanes whose source is gone were never measurable as residue at all — they
  // reach here from the marker's OWN recorded observation of a window it saw and
  // did not capture. The evidence is destroyed; only the fact of the loss remains.
  for (const l of verdict.lost) {
    unrecoverable.push(
      `session ${shortSession(l.session)}: ${l.uncaptured} lines uncaptured, ` +
        `UNRECOVERABLE — ${unrecoverableReason('source-unreadable', l.harness)}`,
    );
  }

  if (verdict.stalled.length === 0 && owed.length === 0 && unrecoverable.length === 0) {
    const seen =
      verdict.sessions === 0
        ? 'no capture attempts recorded yet'
        : `${verdict.sessions} session lane(s) recorded, none stalled, nothing owed`;
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
  const parts: string[] = [];
  if (verdict.stalled.length > 0) {
    parts.push(`CAPTURE STALLED on ${verdict.stalled.length} lane(s): ${stalls}`);
  }
  if (owed.length > 0) {
    parts.push(`${owed.length} lane(s) OWED telemetry they never captured: ${owed.join('; ')}`);
  }
  if (unrecoverable.length > 0) {
    parts.push(`${unrecoverable.length} lane(s) UNRECOVERABLE: ${unrecoverable.join('; ')}`);
  }
  // Only an OWED lane has an action a human can take. An unrecoverable one is a
  // fact to be believed, not a task — saying "run sync" there would be a promise
  // that quietly never comes true, which is the failure this layer exists to end.
  const action =
    owed.length > 0
      ? 'Run `harness telemetry sync` to pay the owed lanes back \u2014 the recovered segments ' +
        'declare themselves (`capture_mode: reconciled`) and contribute counts, never measured time. '
      : '';
  const lost =
    unrecoverable.length > 0 || verdict.stalled.length > 0
      ? 'For the lanes named UNRECOVERABLE (and any stall above), treat those sessions\u2019 committed ' +
        'telemetry as INCOMPLETE \u2014 do NOT read their counts as the real volume of work. Preserve the ' +
        'marker files (.harness/temp/telemetry/*.liveness.json) as evidence before the buffer is pruned; ' +
        '`last_outcome` names which stage of capture stopped (error = a swallowed throw, ' +
        'source-unreadable = the transcript could not be read, unread-window = a window was available ' +
        'and skipped).'
      : '';
  return {
    name,
    // Never an ERROR: this layer is diagnosis, and diagnosis must not block a gate.
    // But it is never quietly OK either — an unrecoverable lane is a confident,
    // permanent under-count, and that is precisely what must not sit green.
    ok: false,
    detail:
      `${parts.join(' — ')} — an uncaptured window is a plausible non-zero number, ` +
      `not a visible gap, so nothing downstream can notice it on its own`,
    next_action: `${action}${lost}`.trim(),
  };
}

/**
 * The **git-ai collector** layer (plan 073 · ac-000a, ac-000b, ac-000c, ac-0014).
 *
 * Harness stopped collecting its own telemetry, so this row is the only place a
 * developer learns that nothing is collecting instead. It reports a bounded read
 * — pinned binary present and hash-matching, hooks installed and covering every
 * coding harness on the machine, daemon pid file, note schema as pinned — and
 * refuses to overclaim: it never says collection IS occurring, because no signal
 * available in v1 can distinguish a broken collector from a clean tree
 * (ac-0012).
 *
 * Three verdicts are deliberately NOT healthy and deliberately not each other:
 * `cli-only-trace2` (installed, hooks skipped because someone's global trace2
 * config is present), `could-not-determine` (we could not read what we needed),
 * and `not-installed`. Absent is not green; empty is not clean.
 *
 * NEVER invokes anything (P7) — a pure fs/port read over the state the install
 * path wrote down. Warn-only: like every doctor row it degrades the envelope and
 * exits 0 (ac-000c).
 */
function checkCollector(
  fs: FsPort,
  proc: ProcessPort,
  host: HostTarget,
  hash?: HashPort,
  ingress?: IngressReading,
  optedOut = false,
): LayerReport {
  const name = 'gitai-collector';
  // MEASURED, not defensive-by-habit: before this guard, a single throwing
  // `fs.exists` on a `.git-ai` path took the WHOLE `harness doctor` verb down —
  // no envelope at all, not a degraded row. The layers are built in one array
  // literal, so a throw here escapes the entire report.
  //
  // That matters more the more this path does. `doctor` is the health command;
  // it runs for people who never opted into telemetry, and the collector row is
  // the one row backed by on-disk state written by another program. An
  // unreadable state file must cost that ROW, never the verb.
  //
  // Degraded and never healthy: a reading we could not take is not good news.
  let health: CollectorHealth;
  try {
    health = readCollectorHealth({
      fs,
      host,
      cwd: toPosix(proc.cwd()),
      ...(hash !== undefined ? { hash } : {}),
      ...(ingress !== undefined ? { ingress } : {}),
      optedOut,
    });
  } catch (err) {
    return {
      name,
      ok: false,
      detail: `could-not-determine — reading the collector's recorded state failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
      next_action:
        'This row could not be read; every other row above is unaffected. Re-run `harness doctor` and, if it persists, inspect the collector state file it names.',
    };
  }
  return {
    name,
    ok: health.verdict === 'healthy',
    detail: `${health.verdict} — ${health.detail}`,
    ...(health.next_action !== undefined ? { next_action: health.next_action } : {}),
  };
}

/**
 * The **attribution-at-risk** row (plan 074 · ac-0003, ac-0007) — commits on
 * this branch that carry no `refs/notes/ai` entry.
 *
 * READ-ONLY, and that is the whole contract of this row. It DETECTS and it
 * REPORTS, and its `next_action` NAMES the recovery command
 * (`harness doctor telemetry-nudge`) — but it never runs it. No bare `doctor`
 * and no `checks` run ever mutates a socket, a buffer, or a ref; recovery
 * happens only when a human or agent explicitly invokes the nudge. A doctor that
 * quietly replayed events would be a diagnostic with side effects, which is the
 * one thing a diagnostic must never be (P7).
 *
 * Its honesty rule mirrors the collector read above: an empty list under a
 * blocked or unprobeable ingress reports `unproven`, never `clean`.
 */
function checkAttributionAtRisk(
  attribution: NonNullable<DoctorDeps['attribution']>,
  ingress?: IngressReading,
): { layer: LayerReport; report: AtRiskReport } {
  const report = enumerateAtRisk({
    git: attribution,
    ...(ingress !== undefined ? { ingress } : {}),
  });
  return {
    layer: {
      name: 'attribution-at-risk',
      ok: report.status === 'clean',
      detail: `${report.status} — ${report.detail}`,
      ...(report.next_action !== undefined ? { next_action: report.next_action } : {}),
    },
    report,
  };
}

/**
 * The **commit-guidance** row (plan 074 · ac-0008) — is the managed `AGENTS.md`
 * block present and current?
 *
 * WARNS, NEVER EDITS. `AGENTS.md` is the user's own agent-context surface; a
 * diagnostic that silently rewrote it would be a side effect nobody asked for
 * (P7). So this row reports, names the exact command that injects or refreshes
 * the block, and stops there.
 */
function checkCommitGuidance(fs: FsPort, proc: ProcessPort): LayerReport {
  const name = 'commit-guidance';
  const state = readAgentsBlock({ fs, cwd: toPosix(proc.cwd()) });
  if (state === 'current') {
    return {
      name,
      ok: true,
      detail: `${AGENTS_FILE} carries the managed harness:commit-guidance block`,
    };
  }
  const detail =
    state === 'no-file'
      ? `no ${AGENTS_FILE} in this repo, so agents have no committed cue to use \`harness commit\` — a chained \`git add … && git commit\` can silently lose AI attribution`
      : state === 'absent'
        ? `${AGENTS_FILE} carries no harness:commit-guidance block — agents have no committed cue to use \`harness commit\`, and a chained \`git add … && git commit\` can silently lose AI attribution`
        : `${AGENTS_FILE}'s harness:commit-guidance block is STALE — it no longer matches the guidance this CLI ships`;
  return {
    name,
    ok: false,
    detail,
    next_action:
      'Run `harness instructions commit --inject` to write or refresh the managed block (idempotent; it only ever touches the region between its own markers). Read the page itself with `harness instructions commit`.',
  };
}

/**
 * Run one layer so that a throw inside it costs THE ROW, never the verb.
 *
 * MEASURED, not defensive-by-habit. Before this existed, a single throwing
 * `fs.exists` on a `.git-ai` path produced NO ENVELOPE AT ALL from `harness
 * doctor` — not a degraded row, not a failed layer. The mechanism is structural:
 * every layer is built in ONE array literal, so a throw in any element escapes
 * the whole report.
 *
 * That matters because `doctor` is the health command. It is what you run WHEN
 * something is already wrong, on a machine whose state may be exactly what is
 * broken, and several rows are backed by state written by OTHER programs. The row
 * that cannot be read is the row you most need to see reported.
 *
 * NEVER `ok: true` on a caught throw. A reading we could not take is not good
 * news — the same rule the collector's `undetermined()` already enforces.
 */
function safeLayer(name: string, read: () => LayerReport): LayerReport {
  try {
    return read();
  } catch (err) {
    return {
      name,
      ok: false,
      detail: `could-not-determine — this check failed while running: ${
        err instanceof Error ? err.message : String(err)
      }`,
      next_action: `The \`${name}\` check could not complete; every other row in this report is unaffected and was read normally. Re-run \`harness doctor\`, and if it persists the error above names what failed.`,
    };
  }
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
  // OUTSIDE the array literal, and the one that gets missed: `conventions` is
  // computed first and feeds BOTH `checkExtensions` and the report body, so a
  // throw here killed the verb without ever reaching a layer. It cannot use
  // `safeLayer` — it returns complaints, not a row — so it degrades to "no
  // complaints readable" and the extensions row carries the visible failure.
  const collectorHost = deps.collectorHost;
  const attribution = deps.attribution;
  // #144 read, taken here and guarded here so the layer-array condition below
  // tests an already-safe value rather than calling into the filesystem.
  let cursorSandbox: CursorSandboxRow | null = null;
  try {
    cursorSandbox = collectorHost === undefined ? null : cursorSandboxRow(deps.fs, collectorHost);
  } catch {
    // A reading we could not take is silence, never an alarm — the same rule the
    // `unknown` status inside the module follows.
    cursorSandbox = null;
  }
  let conventions: ConventionComplaint[];
  let conventionsError: string | null = null;
  try {
    conventions = checkConventions(deps.fs, deps.proc, registry);
  } catch (err) {
    conventions = [];
    conventionsError = err instanceof Error ? err.message : String(err);
  }
  const layers = [
    safeLayer('toolchain', () => checkToolchain(deps.proc, deps.fs)),
    safeLayer('node-runtime', () => checkNodeRuntime(deps.proc)),
    safeLayer('cli-build', () => checkCliBuild(deps.fs)),
    safeLayer('version-skew', () => checkVersionSkew(deps.fs, deps.runningVersion)),
    // An empty `conventions` after a throw would otherwise read as "no
    // convention complaints", which is good news we did not establish.
    conventionsError !== null
      ? {
          name: 'extensions',
          ok: false,
          detail: `could-not-determine — the convention scan failed while running: ${conventionsError}`,
          next_action:
            'Extension convention complaints could not be read, so this row cannot speak for them; every other row in this report is unaffected. Re-run `harness doctor`.',
        }
      : safeLayer('extensions', () => checkExtensions(registry, conventions)),
    safeLayer('quality-gate', () => checkQualityGate(registry)),
    safeLayer('sensor-watcher', () => checkSensorWatcher(deps.fs, deps.clock, deps.proc, registry)),
    safeLayer('capture-liveness', () =>
      checkCaptureLiveness(deps.fs, deps.proc, deps.env, deps.clock, deps.adapters, deps.db),
    ),
    // Hoisted rather than cast: capturing the narrowed value keeps TypeScript's
    // control-flow narrowing through the closure, so neither of these needs an
    // `as`. A cast here would have silenced a real mismatch — the first draft
    // asserted the wrong type on `attribution` and tsc caught it.
    ...(collectorHost !== undefined
      ? [
          safeLayer('gitai-collector', () =>
            checkCollector(
              deps.fs,
              deps.proc,
              collectorHost,
              deps.hash,
              deps.ingress,
              deps.collectorOptedOut === true,
            ),
          ),
        ]
      : []),
    // #144 — the 18th wrapped site. Conditional on BOTH a resolvable host and a
    // row actually being warranted: no Cursor marker, or an allowlist that
    // permits both commands, emits nothing at all.
    //
    // The reading is computed ONCE above, inside its own guard. Calling it in
    // this condition would have put an unguarded call outside `safeLayer` —
    // a throw there escapes the whole report, which is precisely the class
    // `safeLayer` exists to contain. The condition must only ever test an
    // already-safe value.
    ...(cursorSandbox !== null
      ? [
          safeLayer('cursor-sandbox', () => ({
            name: 'cursor-sandbox',
            // Warn-only and never gating. `ok: false` degrades the envelope
            // (exit 0) exactly as every other doctor row does; it never
            // contradicts the ingress probe, which is the only thing entitled
            // to say the collector is unreachable.
            ok: false,
            detail: cursorSandbox.detail,
            next_action: cursorSandbox.next_action,
          })),
        ]
      : []),
    ...(attribution !== undefined
      ? [
          safeLayer(
            'attribution-at-risk',
            () => checkAttributionAtRisk(attribution, deps.ingress).layer,
          ),
        ]
      : []),
    safeLayer('dd', () => checkDd(deps.fs, deps.proc)),
    safeLayer('core-instructions', () => checkCoreInstructions()),
    safeLayer('commit-guidance', () => checkCommitGuidance(deps.fs, deps.proc)),
    safeLayer('record-types', () => checkRecordTypes(recordTypes)),
  ];
  // ALSO OUTSIDE THE ARRAY, and both found by fault injection rather than by
  // reading: with all fifteen layers wrapped, poisoning `git` or `env` STILL
  // killed the verb outright. These two reads are the reason.
  //
  // They are not layers, so they get no row and cannot use `safeLayer` — they
  // are report metadata. A repo whose git is unusable is exactly a machine
  // someone runs `doctor` on, so neither may be fatal. `null` branch and a
  // false `json_env` are the honest degraded values: absent, not asserted.
  let branch: string | null = null;
  try {
    branch = deps.git.isRepo() ? deps.git.currentBranch() : null;
  } catch {
    branch = null;
  }
  let json_env = false;
  try {
    json_env = deps.env.get('HARNESS_JSON') === '1';
  } catch {
    json_env = false;
  }
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
