import type { Command } from 'commander';
import { formatDegraded, formatError, formatOk } from '../../output/envelope.js';
import { ErrorCodes } from '../../output/error-codes.js';
import { exitWithEnvelope } from '../../output/exit.js';
import type { CliIo } from '../../output/output-port.js';
import type { DdIssueClass } from '../../services/dd/core/validate.js';
import type { DdAdapterGap, DdDoctorFinding } from '../../services/dd/links/index.js';
import { runDoctor } from '../../services/dd/links/index.js';
import type { DdLinkIssueClass } from '../../services/dd/links/model.js';
import { createLinkContext } from './link.js';
import type { DdActDeps } from './shared.js';

/**
 * Finding class → frozen E-code, for every class the sweep can produce.
 *
 * The dd-core half repeats `acts/dd/validate.ts`'s allocation because that map is
 * private to its own act and the two phases may not edit each other's files.
 * TypeScript's exhaustive `Record` is the guard that matters: a new issue class
 * cannot be added to dd-core without this map failing to compile.
 */
const FINDING_CODES: Record<DdIssueClass | DdLinkIssueClass, string> = {
  'address-malformed': ErrorCodes.DD_ADDRESS_INVALID,
  'address-path-absolute': ErrorCodes.DD_ADDRESS_INVALID,
  'address-path-escape': ErrorCodes.DD_LINK_PATH_ESCAPE,
  'address-path-non-posix': ErrorCodes.DD_ADDRESS_INVALID,
  'address-target-missing': ErrorCodes.DD_LINK_TARGET_MISSING,
  'address-target-untracked': ErrorCodes.DD_LINK_TARGET_UNTRACKED,
  'adapter-gap': ErrorCodes.DD_ADAPTER_NOT_FOUND,
  'basis-stale': ErrorCodes.DD_BASIS_STALE,
  'duplicate-id': ErrorCodes.DD_ID_DUPLICATE,
  'enum-invalid': ErrorCodes.DD_ENUM_INVALID,
  'human-skipped-receipt-required': ErrorCodes.DD_HUMAN_SKIP_RECEIPT_REQUIRED,
  'id-invalid': ErrorCodes.DD_ID_INVALID,
  'link-scan-failed': ErrorCodes.DD_DOCTOR_SCAN_FAILED,
  'link-scan-incomplete': ErrorCodes.DD_LINK_SCAN_FAILED,
  'link-type-mismatch': ErrorCodes.DD_LINK_TYPE_MISMATCH,
  'link-unresolved': ErrorCodes.DD_LINK_UNRESOLVED,
  'schema-shape': ErrorCodes.DD_SCHEMA_SHAPE_INVALID,
  'schema-unresolvable': ErrorCodes.DD_SCHEMA_UNRESOLVABLE,
  'state-note-required': ErrorCodes.DD_STATE_NOTE_REQUIRED,
};

/** An adapter gap keeps the render layer's own code (AC-04 repeats it, it does not rename it). */
const ADAPTER_CODES: Record<DdAdapterGap['kind'], string> = {
  'load-failed': ErrorCodes.DD_ADAPTER_LOAD_FAILED,
  'not-found': ErrorCodes.DD_ADAPTER_NOT_FOUND,
  'output-invalid': ErrorCodes.DD_ADAPTER_OUTPUT_INVALID,
  'runtime-failed': ErrorCodes.DD_ADAPTER_RUNTIME_FAILED,
};

function codeFor(finding: DdDoctorFinding): string {
  return finding.adapterKind
    ? ADAPTER_CODES[finding.adapterKind]
    : FINDING_CODES[finding.class as DdIssueClass | DdLinkIssueClass];
}

export function registerDoctorCommand(dd: Command, io: CliIo, deps: DdActDeps): void {
  dd.command('doctor')
    .description('Sweep deterministic documents at infinite validation radius')
    .option('--path <dir>', 'scope the sweep to a subtree (default: the repository root)')
    .action(async (opts: { path?: string }) => {
      const ctx = await createLinkContext(io, deps);
      const root = opts.path ? resolveScope(opts.path, ctx.repoRoot) : ctx.repoRoot;

      // Phase 3's adapter aggregation is injected at Phase 5; until then the
      // source is simply absent, which means no adapter findings — never a
      // silently missing check pretending to be a clean one.
      const report = runDoctor(
        ctx.fs,
        { schemaResolver: ctx.resolver, docLoader: ctx.loader },
        { repoRoot: ctx.repoRoot, root },
      );
      const findings = report.findings.map((finding) => ({ ...finding, code: codeFor(finding) }));
      const data = {
        root,
        discovered: report.discovered.length,
        swept: report.swept.length,
        counts: report.counts,
        findings,
      };

      const scanFailure = findings.find((finding) => finding.class === 'link-scan-failed');
      if (scanFailure) {
        exitWithEnvelope(
          formatError(
            'dd doctor',
            ErrorCodes.DD_DOCTOR_SCAN_FAILED,
            scanFailure.message,
            ctx.clock,
            {
              details: data,
              next_action:
                'The sweep could not enumerate the corpus — fix the reported path, then re-run `harness dd doctor`.',
            },
          ),
          ctx.port,
        );
      }

      // This mapping IS the checks-gate severity: `runVerbGate` takes no severity
      // parameter, so the envelope status is the whole signal (Opus F3/F7).
      // WARN-class findings are real and reported, but they do not fail a gate.
      const blocking = findings.find((finding) => finding.severity === 'ERROR');
      if (blocking) {
        exitWithEnvelope(
          formatError(
            'dd doctor',
            ErrorCodes.DD_DOCTOR_FINDINGS,
            `${report.counts.error} ERROR-class finding(s) across ${report.swept.length} document(s)`,
            ctx.clock,
            {
              details: data,
              next_action: `Fix ${blocking.owner} at ${blocking.location}, then re-run \`harness dd doctor\`.`,
            },
          ),
          ctx.port,
        );
      }
      if (findings.length > 0) {
        exitWithEnvelope(
          formatDegraded(
            'dd doctor',
            data,
            `${report.counts.warn} WARN-class finding(s) — review them; none of them fails a gate.`,
            ctx.clock,
          ),
          ctx.port,
        );
      }
      exitWithEnvelope(
        formatOk('dd doctor', data, ctx.clock, {
          next_action: `${report.swept.length} document(s) swept clean at infinite radius.`,
        }),
        ctx.port,
      );
    });
}

function resolveScope(path: string, repoRoot: string): string {
  return path.startsWith('/') ? path : `${repoRoot}/${path}`.replace(/\/+$/, '');
}
