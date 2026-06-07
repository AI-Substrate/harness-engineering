import type { Clock } from '../../adapters/clock/clock-port.js';
import type { EnvPort } from '../../adapters/env/env-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { GitPort } from '../../adapters/git/git-port.js';
import type { ProcessPort } from '../../adapters/process/process-port.js';
import { type Envelope, formatDegraded, formatOk } from '../../output/envelope.js';
import type { SlotRegistry } from '../slots/slot-registry.js';

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

/** The full doctor report (the envelope `data`). */
export interface DoctorReport {
  layers: LayerReport[];
  branch: string | null;
  /** Whether HARNESS_JSON forces JSON output (read via the env port). */
  json_env: boolean;
}

const REQUIRED_TOOLS = ['node', 'just', 'biome'];
/** Relative to cwd — the dev-repo build check; installed/loop behaviour is out of scope. */
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
  const built = fs.exists(CLI_BUILD_PATH);
  return {
    name: 'cli-build',
    ok: built,
    detail: built ? `${CLI_BUILD_PATH} present` : `${CLI_BUILD_PATH} not built`,
    ...(built ? {} : { next_action: 'Run `npm run build` to compile the CLI.' }),
  };
}

function checkCommandSlots(slots: SlotRegistry): LayerReport {
  const configured = slots.filter((slot) => slot.status === 'configured').length;
  const unconfigured = slots.length - configured;
  const ok = unconfigured === 0;
  return {
    name: 'command-slots',
    ok,
    detail: `${configured} configured, ${unconfigured} unconfigured (of ${slots.length})`,
    ...(ok
      ? {}
      : {
          next_action:
            'Slots are honest stubs in this slice; an extension configures them. Run `harness help`.',
        }),
  };
}

/**
 * Gather the doctor report via the injected adapters. Pure of `process.exit`
 * and direct Node I/O — all side effects go through the ports, so the whole
 * thing is unit-testable with fakes.
 */
export function buildDoctorReport(deps: DoctorDeps, slots: SlotRegistry): DoctorReport {
  const layers = [checkToolchain(deps.proc), checkCliBuild(deps.fs), checkCommandSlots(slots)];
  const branch = deps.git.isRepo() ? deps.git.currentBranch() : null;
  const json_env = deps.env.get('HARNESS_JSON') === '1';
  return { layers, branch, json_env };
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
        'Resolve the unconfigured/missing layers below; run `harness help` for the slot map.',
        clock,
        { evidence },
      )
    : formatOk('doctor', report, clock, { evidence });
}

/** Convenience: gather + envelope in one call. */
export function runDoctor(deps: DoctorDeps, slots: SlotRegistry): Envelope {
  return doctorEnvelope(buildDoctorReport(deps, slots), deps.clock);
}

/** Render the report as human diagnostics text (each layer + its next_action). */
export function renderDoctorText(report: DoctorReport): string {
  const lines: string[] = ['harness doctor — readiness report', ''];
  for (const layer of report.layers) {
    lines.push(`${layer.ok ? '✓' : '✗'} ${layer.name}: ${layer.detail}`);
    if (layer.next_action) {
      lines.push(`    → ${layer.next_action}`);
    }
  }
  lines.push('', `branch: ${report.branch ?? '(detached or not a repo)'}`);
  lines.push(`output: ${report.json_env ? 'JSON forced via HARNESS_JSON' : 'auto (TTY/flag)'}`);
  return `${lines.join('\n')}\n`;
}
