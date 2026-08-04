import type { Command } from 'commander';
import { formatDegraded, formatError, formatOk } from '../../output/envelope.js';
import { ErrorCodes } from '../../output/error-codes.js';
import { exitWithEnvelope } from '../../output/exit.js';
import type { CliIo } from '../../output/output-port.js';
import {
  linksFor,
  resolveLinksTarget,
  scanCorpus,
  traverseCorpus,
} from '../../services/dd/links/index.js';
import { codedLinkIssues, createLinkContext, type DdActDeps } from './shared.js';

export function registerLinksCommand(dd: Command, io: CliIo, deps: DdActDeps): void {
  dd.command('links <target>')
    .description('Report inbound and outbound links for one address or document')
    .action(async (target: string) => {
      const ctx = await createLinkContext(io, deps);
      const path = resolveLinksTarget(target, ctx.repoRoot);

      // Nothing is stored and nothing is indexed (D11): the corpus is scanned on
      // every call and the answer is a filter over the result. An edge that was
      // deleted upstream stops being reported the moment it is deleted, because
      // there is no cached edge left to go stale.
      const scan = scanCorpus(ctx.fs, ctx.repoRoot);
      const failed = scan.issues.find((issue) => issue.severity === 'ERROR');
      if (failed) {
        exitWithEnvelope(
          formatError('dd links', ErrorCodes.DD_LINK_SCAN_FAILED, failed.message, ctx.clock, {
            details: { target, path },
            next_action: 'Fix the unreadable directory, then re-run `harness dd links <target>`.',
          }),
          ctx.port,
        );
      }

      const graph = traverseCorpus(
        scan.paths,
        { schemaResolver: ctx.resolver, docLoader: ctx.loader },
        { repoRoot: ctx.repoRoot, mode: 'sweep' },
      );
      // OD-1 applies to both halves, in opposite directions. The *scan* for
      // inbound edges is a sweep, so it honours the exclusions. The *target* was
      // named on the command line, which is a direct invocation and is never
      // skipped — otherwise pointing this verb at an excluded document would
      // answer "no links" when the truth is "I refused to look".
      const swept = graph.nodes.some((node) => node.path === path);
      const edges = swept
        ? graph.edges
        : [
            ...graph.edges,
            ...traverseCorpus(
              [path],
              { schemaResolver: ctx.resolver, docLoader: ctx.loader },
              { repoRoot: ctx.repoRoot, mode: 'direct', follow: false },
            ).edges,
          ];
      const report = linksFor(path, { ...graph, edges }, target);
      const issues = codedLinkIssues(graph.issues);
      const data = {
        ...report,
        counts: { inbound: report.inbound.length, outbound: report.outbound.length },
        scanned: scan.paths.length,
        issues,
      };

      if (issues.length > 0) {
        exitWithEnvelope(
          formatDegraded(
            'dd links',
            data,
            `${issues.length} document(s) could not be scanned for links — the report may be incomplete.`,
            ctx.clock,
          ),
          ctx.port,
        );
      }
      exitWithEnvelope(
        formatOk('dd links', data, ctx.clock, {
          next_action: 'Run `harness dd graph` to see the same edges as a mermaid view.',
        }),
        ctx.port,
      );
    });
}
