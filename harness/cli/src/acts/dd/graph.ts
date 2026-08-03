import type { Command } from 'commander';
import { formatDegraded, formatError, formatOk } from '../../output/envelope.js';
import { ErrorCodes } from '../../output/error-codes.js';
import { exitWithEnvelope } from '../../output/exit.js';
import type { CliIo } from '../../output/output-port.js';
import { scanCorpus, toMermaid, traverseCorpus } from '../../services/dd/links/index.js';
import { codedLinkIssues, createLinkContext, type DdActDeps } from './shared.js';

export function registerGraphCommand(dd: Command, io: CliIo, deps: DdActDeps): void {
  dd.command('graph')
    .description('Emit a standalone mermaid view of the repository dd graph')
    .option('--path <dir>', 'scope the graph to a subtree (default: the repository root)')
    .action(async (opts: { path?: string }) => {
      const ctx = await createLinkContext(io, deps, { tracked: false });
      const root = opts.path ? resolveScope(opts.path, ctx.repoRoot) : ctx.repoRoot;

      const scan = scanCorpus(ctx.fs, root);
      const failed = scan.issues.find((issue) => issue.severity === 'ERROR');
      if (failed) {
        exitWithEnvelope(
          formatError('dd graph', ErrorCodes.DD_GRAPH_FAILED, failed.message, ctx.clock, {
            details: { root },
            next_action: 'Fix the unreadable directory, then re-run `harness dd graph`.',
          }),
          ctx.port,
        );
      }

      const graph = traverseCorpus(
        scan.paths,
        { schemaResolver: ctx.resolver, docLoader: ctx.loader },
        { repoRoot: ctx.repoRoot, mode: 'sweep' },
      );
      // Emitted directly, never through the render layer: `dd graph` is what
      // keeps Phase 3 and Phase 4 independent, and a renderer import is the one
      // dependency that would quietly re-couple them (Opus F1b, arch-enforced).
      const mermaid = toMermaid(graph, ctx.repoRoot);
      const issues = codedLinkIssues(graph.issues);
      const data = {
        root,
        mermaid,
        nodes: graph.nodes,
        edges: graph.edges,
        counts: { nodes: graph.nodes.length, edges: graph.edges.length },
        issues,
      };

      if (issues.length > 0) {
        exitWithEnvelope(
          formatDegraded(
            'dd graph',
            data,
            `${issues.length} document(s) could not be scanned — the graph may be incomplete.`,
            ctx.clock,
          ),
          ctx.port,
        );
      }
      exitWithEnvelope(
        formatOk('dd graph', data, ctx.clock, {
          next_action: 'Run `harness dd links <target>` to inspect one document\u2019s edges.',
        }),
        ctx.port,
      );
    });
}

function resolveScope(path: string, repoRoot: string): string {
  return path.startsWith('/') ? path : `${repoRoot}/${path}`.replace(/\/+$/, '');
}
