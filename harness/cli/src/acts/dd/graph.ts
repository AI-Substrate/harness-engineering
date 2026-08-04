import type { Command } from 'commander';
import { type Envelope, formatDegraded, formatError, formatOk } from '../../output/envelope.js';
import { ErrorCodes } from '../../output/error-codes.js';
import { exitWithEnvelope } from '../../output/exit.js';
import type { CliIo, OutputPort } from '../../output/output-port.js';
import { bold, cyan, dim, green, magenta, red, yellow } from '../../output/style.js';
import {
  type DdMapDirection,
  type DdMapPalette,
  type DdMapResult,
  mapAddress,
  PLAIN_MAP_PALETTE,
  renderMapTree,
  resolveMapSeed,
  scanCorpus,
  toMermaid,
  traverseCorpus,
  wrapPlain,
} from '../../services/dd/links/index.js';
import { codedLinkIssues, createLinkContext, type DdActDeps, nextActionFor } from './shared.js';

export function registerGraphCommand(dd: Command, io: CliIo, deps: DdActDeps): void {
  const graph = dd
    .command('graph')
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

      const graphed = traverseCorpus(
        scan.paths,
        { schemaResolver: ctx.resolver, docLoader: ctx.loader },
        { repoRoot: ctx.repoRoot, mode: 'sweep' },
      );
      // Emitted directly, never through the render layer: `dd graph` is what
      // keeps Phase 3 and Phase 4 independent, and a renderer import is the one
      // dependency that would quietly re-couple them (Opus F1b, arch-enforced).
      const mermaid = toMermaid(graphed, ctx.repoRoot);
      const issues = codedLinkIssues(graphed.issues);
      const data = {
        root,
        mermaid,
        nodes: graphed.nodes,
        edges: graphed.edges,
        counts: { nodes: graphed.nodes.length, edges: graphed.edges.length },
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

  registerGraphMapCommand(graph, io, deps);
}

/**
 * `dd graph map <address>` — what does this row reach, and what reaches it?
 *
 * A NAMED SUBCOMMAND under `graph`, never a positional on it. The P4 surface
 * freeze pins bare `dd graph` at zero positionals and byte-identical output, so
 * `map` is a sibling verb under the same noun rather than an amendment to a
 * frozen surface (surface grant, `dd-surface.md`, P7 T001).
 *
 * It introduces no E-code. A seed that will not resolve is `E430
 * DD_LINK_UNRESOLVED` — the same failure `dd link resolve` reports for the same
 * address, from the same resolver — and a corpus that cannot be enumerated is
 * `E436 DD_LINK_SCAN_FAILED`. E430-E439 is full, and opening a block for a verb
 * whose failures already have names would buy nothing.
 */
function registerGraphMapCommand(graph: Command, io: CliIo, deps: DdActDeps): void {
  graph
    .command('map <address>')
    .description('Map what one address reaches, and what reaches it, in both directions')
    .option('--depth <n>', 'how many hops to follow from the seed', '3')
    .option('--max-nodes <n>', 'greatest number of nodes the answer may contain', '20')
    .option('--direction <way>', 'in, out, or both', 'both')
    .action(
      async (address: string, opts: { depth: string; maxNodes: string; direction: string }) => {
        const ctx = await createLinkContext(io, deps);
        const port = mapPort(io, ctx.port);
        const linkDeps = { schemaResolver: ctx.resolver, docLoader: ctx.loader };

        const depth = Number(opts.depth);
        if (!Number.isInteger(depth) || depth < 0) {
          exitWithEnvelope(
            formatError(
              'dd graph map',
              ErrorCodes.INVALID_ARGS,
              `--depth must be a non-negative integer, got "${opts.depth}"`,
              ctx.clock,
              { next_action: 'Re-run with `--depth 1` for the immediate neighbours.' },
            ),
            port,
          );
        }
        const maxNodes = Number(opts.maxNodes);
        if (!Number.isInteger(maxNodes) || maxNodes < 1) {
          exitWithEnvelope(
            formatError(
              'dd graph map',
              ErrorCodes.INVALID_ARGS,
              `--max-nodes must be a positive integer, got "${opts.maxNodes}"`,
              ctx.clock,
              { next_action: 'Re-run with `--max-nodes 20`, the default bound.' },
            ),
            port,
          );
        }
        if (!isDirection(opts.direction)) {
          exitWithEnvelope(
            formatError(
              'dd graph map',
              ErrorCodes.INVALID_ARGS,
              `--direction must be in, out or both, got "${opts.direction}"`,
              ctx.clock,
              { next_action: 'Re-run with `--direction both`, the default.' },
            ),
            port,
          );
        }
        const direction = opts.direction as DdMapDirection;

        const seed = resolveMapSeed(address, linkDeps, { repoRoot: ctx.repoRoot });
        if (!seed.ok) {
          const coded = codedLinkIssues(seed.issues);
          exitWithEnvelope(
            formatError(
              'dd graph map',
              coded[0]?.code ?? ErrorCodes.DD_LINK_UNRESOLVED,
              coded[0]?.message ?? `address did not resolve: ${address}`,
              ctx.clock,
              {
                details: { address, issues: coded },
                next_action: nextActionFor(seed.issues, address),
              },
            ),
            port,
          );
          return;
        }

        // Nothing is stored and nothing is indexed (D11): the corpus is scanned
        // on every call and the map is a reading of the result, so a link deleted
        // upstream stops appearing the moment it is deleted.
        const scan = scanCorpus(ctx.fs, ctx.repoRoot);
        const failed = scan.issues.find((issue) => issue.severity === 'ERROR');
        if (failed) {
          exitWithEnvelope(
            formatError('dd graph map', ErrorCodes.DD_LINK_SCAN_FAILED, failed.message, ctx.clock, {
              details: { address },
              next_action:
                'Fix the unreadable directory, then re-run `harness dd graph map <address>`.',
            }),
            port,
          );
        }

        const corpus = traverseCorpus(
          scan.paths,
          { schemaResolver: ctx.resolver, docLoader: ctx.loader },
          { repoRoot: ctx.repoRoot, mode: 'sweep' },
        );
        // OD-1, exactly as `dd links` applies it: the inbound half is a SWEEP and
        // honours the exclusions, while the seed was named on the command line and
        // is therefore direct — never skipped, or the answer would read "nothing
        // here" when the truth is "I refused to look".
        const swept = corpus.nodes.some((node) => node.path === seed.path);
        const edges = swept
          ? corpus.edges
          : [
              ...corpus.edges,
              ...traverseCorpus(
                [seed.path],
                { schemaResolver: ctx.resolver, docLoader: ctx.loader },
                { repoRoot: ctx.repoRoot, mode: 'direct', follow: false },
              ).edges,
            ];

        const result = mapAddress(seed, edges, linkDeps, {
          repoRoot: ctx.repoRoot,
          depth,
          maxNodes,
          direction,
        });
        const issues = codedLinkIssues([...corpus.issues, ...result.issues]);
        const data = {
          ...result,
          counts: {
            nodes: result.nodes.length,
            edges: result.edges.length,
            inbound: result.nodes.filter((node) => node.arm === 'in').length,
            outbound: result.nodes.filter((node) => node.arm === 'out').length,
          },
          scanned: scan.paths.length,
          issues,
        };

        if (issues.length > 0) {
          exitWithEnvelope(
            formatDegraded(
              'dd graph map',
              data,
              `${issues.length} document(s) could not be scanned — the map may be incomplete.`,
              ctx.clock,
            ),
            port,
          );
        }
        exitWithEnvelope(
          formatOk('dd graph map', data, ctx.clock, {
            next_action: result.truncated.cut
              ? 'The walk hit a bound \u2014 re-run with a larger `--depth` or `--max-nodes` to see the rest.'
              : 'Run `harness dd links <target>` for one document\u2019s raw edges.',
          }),
          port,
        );
      },
    );
}

/**
 * The human port for `dd graph map`: the tree goes to stdout, JSON is untouched.
 *
 * A `--json` run never reaches the renderer at all, so "not one escape byte in
 * JSON" is structural rather than a filter someone has to remember to apply.
 */
function mapPort(io: CliIo, jsonPort: OutputPort): OutputPort {
  if (io.mode === 'json') return jsonPort;
  const palette = mapPalette(io.useColor === true);
  return {
    emit: (envelope: Envelope) => {
      // The 80-column contract covers every line this command puts on a
      // terminal, not only the tree — status lines wrap through the same helper.
      const status = (text: string, indent: string): void => {
        for (const line of wrapPlain(text, '', indent)) io.writers.err(`${line}\n`);
      };
      if (envelope.status === 'error') {
        status(`${envelope.command}: ${envelope.error?.message ?? 'failed'}`, '  ');
        if (envelope.next_action) status(`  \u2192 ${envelope.next_action}`, '     ');
        return;
      }
      io.writers.out(renderMapTree(envelope.data as unknown as DdMapResult, palette));
      if (envelope.next_action) status(`  \u2192 ${envelope.next_action}`, '     ');
    },
  };
}

/**
 * Colour that carries meaning, composed from `output/style.ts` and nothing else.
 *
 * Zero new dependencies: the CLI ships `commander` + `jiti`, and a colour library
 * for terminal decoration would buy nothing these SGR wrappers do not already
 * give. Gating is not re-invented either — `io.useColor` is `resolveUseColor()`'s
 * answer, resolved once by the entrypoint, so `NO_COLOR`, `FORCE_COLOR` and a
 * pipe all behave here exactly as they do on every other surface.
 *
 * Every choice has to read as information rather than decoration. The state
 * marks are where it does real work — a proof chain green to its leaves says
 * "sound" before a word of it is read — and truncation is bold red because a map
 * that looks complete when it is not is this command's worst failure.
 */
function mapPalette(enabled: boolean): DdMapPalette {
  if (!enabled) return PLAIN_MAP_PALETTE;
  const identity = (text: string): string => text;
  const marks: Record<string, (text: string) => string> = {
    '[x]': green,
    '[-]': red,
    '[~]': yellow,
    '[ ]': dim,
  };
  return {
    seed: bold,
    inbound: (text) => bold(magenta(text)),
    outbound: (text) => bold(cyan(text)),
    path: dim,
    id: cyan,
    label: dim,
    faint: dim,
    alarm: (text) => bold(red(text)),
    mark: (mark) => marks[mark] ?? identity,
  };
}

function isDirection(value: string): value is DdMapDirection {
  return value === 'in' || value === 'out' || value === 'both';
}

function resolveScope(path: string, repoRoot: string): string {
  return path.startsWith('/') ? path : `${repoRoot}/${path}`.replace(/\/+$/, '');
}
