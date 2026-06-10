import { dirname, join } from 'node:path';
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

/** Adapters the doctor service depends on (injected — never constructed here). */
export interface DoctorDeps {
  fs: FsPort;
  proc: ProcessPort;
  git: GitPort;
  env: EnvPort;
  clock: Clock;
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

const REQUIRED_TOOLS = ['node', 'just', 'biome'];
/**
 * Relative to cwd. Two modes (FX001 / plan-013 FIND-2):
 * - Dev (this repo, the harness's home): `CLI_DEV_MARKER` present → check the build output.
 * - Consumer (installed clone): marker absent → the dev build check does not apply; the
 *   layer reports ok with a `consumer` detail instead of falsely degrading the envelope.
 * The marker is a FILE (not the `harness/cli/` dir) so both NodeFs and FakeFs resolve it
 * with plain exists(); there is no `harness/cli/package.json` — the CLI builds from the
 * root package, so its tsconfig is the stable dev-tree marker.
 */
const CLI_DEV_MARKER = 'harness/cli/tsconfig.json';
const CLI_BUILD_PATH = 'harness/cli/dist/index.js';

function checkToolchain(proc: ProcessPort): LayerReport {
  const missing = REQUIRED_TOOLS.filter((tool) => proc.which(tool) === null);
  const ok = missing.length === 0;
  return {
    name: 'toolchain',
    ok,
    detail: ok
      ? `all required tools present (${REQUIRED_TOOLS.join(', ')})`
      : `missing tools: ${missing.join(', ')}`,
    ...(ok ? {} : { next_action: `Install the missing tools: ${missing.join(', ')}.` }),
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
 * about missing convention files but the verb keeps running, AC-9).
 */
function checkConventions(fs: FsPort, registry: VerbRegistry): ConventionComplaint[] {
  const complaints: ConventionComplaint[] = [];
  for (const record of registry.records) {
    if (record.status !== 'loaded') {
      continue;
    }
    const folder = dirname(record.entryPath);
    if (!fs.exists(join(folder, 'instructions.md'))) {
      complaints.push({
        folder,
        detail: `${ErrorCodes.EXTENSION_INSTRUCTIONS_MISSING}: missing instructions.md (the agent briefing for this extension's verbs)`,
        next_action: `author ${folder}/instructions.md — see \`harness instructions\` for the pattern`,
      });
    }
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

  if (registry.records.length === 0) {
    return {
      name: 'extensions',
      ok: true,
      detail: 'no extensions installed (from ./.harness/extensions)',
      next_action:
        'Add a verb with `harness new <name>` (a package at `./.harness/extensions/<name>/`).',
    };
  }

  const broken = failed > 0 || conflicts > 0;
  const ok = !broken && conventions.length === 0;
  const conventionSuffix =
    conventions.length > 0 ? `, ${conventions.length} missing instructions.md` : '';
  return {
    name: 'extensions',
    ok,
    detail: `${loaded} loaded, ${failed} failed, ${conflicts} conflict(s)${conventionSuffix} (from ./.harness/extensions)`,
    ...(ok
      ? {}
      : {
          next_action: broken
            ? 'Fix or remove the failed/conflicting extensions listed below; run `harness doctor` again.'
            : 'Author the missing instructions.md briefings listed below — see `harness instructions`.',
        }),
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
  const conventions = checkConventions(deps.fs, registry);
  const layers = [
    checkToolchain(deps.proc),
    checkCliBuild(deps.fs),
    checkExtensions(registry, conventions),
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
        const complaint = report.conventions.find((c) => dirname(ext.entryPath) === c.folder);
        if (complaint && ext.status === 'loaded') {
          lines.push(`      ✗ ${complaint.detail}`);
          lines.push(`        → ${complaint.next_action}`);
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
