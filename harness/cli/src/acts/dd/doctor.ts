import type { Command } from 'commander';
import { JitiLoader } from '../../adapters/loader/jiti-loader.js';
import { formatDegraded, formatError, formatOk } from '../../output/envelope.js';
import { ErrorCodes } from '../../output/error-codes.js';
import { exitWithEnvelope } from '../../output/exit.js';
import type { CliIo } from '../../output/output-port.js';
import { shouldExcludeFromSweep } from '../../services/dd/core/walk.js';
import type { DdAdapterGap, DdDoctorFinding } from '../../services/dd/links/index.js';
import { runDoctor, scanCorpus } from '../../services/dd/links/index.js';
import { adapterGapSource, collectAdapterGaps } from '../../services/dd/render/gaps.js';
import { createLinkContext, DD_ISSUE_CODES, type DdActDeps } from './shared.js';

/** An adapter gap keeps the render layer's own code (AC-04 repeats it, it does not rename it). */
const ADAPTER_CODES: Record<DdAdapterGap['kind'], string> = {
  'load-failed': ErrorCodes.DD_ADAPTER_LOAD_FAILED,
  'not-found': ErrorCodes.DD_ADAPTER_NOT_FOUND,
  'output-invalid': ErrorCodes.DD_ADAPTER_OUTPUT_INVALID,
  'runtime-failed': ErrorCodes.DD_ADAPTER_RUNTIME_FAILED,
};

function codeFor(finding: DdDoctorFinding): string {
  return finding.adapterKind ? ADAPTER_CODES[finding.adapterKind] : DD_ISSUE_CODES[finding.class];
}

export function registerDoctorCommand(dd: Command, io: CliIo, deps: DdActDeps): void {
  dd.command('doctor')
    .description('Sweep deterministic documents at infinite validation radius')
    .option('--path <dir>', 'scope the sweep to a subtree (default: the repository root)')
    .action(async (opts: { path?: string }) => {
      const ctx = await createLinkContext(io, deps);
      const root = opts.path ? resolveScope(opts.path, ctx.repoRoot) : ctx.repoRoot;

      // Phase 3's adapter aggregation, injected for real (P5 T004 seam 1).
      //
      // The sweep is synchronous and adapter loading is not, so the gaps are
      // collected first and the sweep then filters them by the documents it
      // actually reached. Sweep-excluded documents are dropped BEFORE collection:
      // a known-bad fixture's deliberately broken adapter is not a finding about
      // this repository, and loading it would be work done only to throw away.
      const scan = scanCorpus(ctx.fs, root);
      const inspectable = scan.paths.filter((path) => {
        const loaded = ctx.loader.load(path);
        return loaded.ok && !shouldExcludeFromSweep(path, loaded.doc);
      });
      const gaps = await collectAdapterGaps({
        paths: inspectable,
        fs: ctx.fs,
        loader: new JitiLoader(),
        resolveSchema: (schemaRef, fromPath) =>
          ctx.resolver.resolveDetailed(schemaRef, fromPath).record ?? null,
      });

      const report = runDoctor(
        ctx.fs,
        {
          schemaResolver: ctx.resolver,
          docLoader: ctx.loader,
          adapterGaps: adapterGapSource(gaps),
        },
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
