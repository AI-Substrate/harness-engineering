import type { Command } from 'commander';
import type { Clock } from '../adapters/clock/clock-port.js';
import type { EnvPort } from '../adapters/env/env-port.js';
import type { FsPort } from '../adapters/fs/fs-port.js';
import type { GitPort } from '../adapters/git/git-port.js';
import type { ProcessPort } from '../adapters/process/process-port.js';
import { type Envelope, formatError, formatOk } from '../output/envelope.js';
import { ErrorCodes } from '../output/error-codes.js';
import { exitWithEnvelope } from '../output/exit.js';
import { type CliIo, createOutputPort, type OutputPort } from '../output/output-port.js';
import { buildCustomEvent, buildManualEvent, type FlowDoc } from '../services/flow/flow-events.js';
import {
  addComment,
  addNode,
  insertNode,
  type MutationResult,
  moveCursor,
  recommendNext,
  setNode,
  setStatus,
} from '../services/flow/flow-mutations.js';
import {
  createFlow,
  FLOWS_DIR,
  type FlowFailure,
  type FlowServiceDeps,
  listFlows,
  newFlowSchema,
  readFlowDoc,
  showFlow,
  writeFlowAtomic,
} from '../services/flow/flow-service.js';
import { posixJoin, toPosix } from '../services/shared/posix-path.js';

/** The ports the `flow` act injects into the flow service (a subset of VerbActDeps). */
export interface FlowActDeps {
  fs: FsPort;
  proc: ProcessPort;
  clock: Clock;
  git: GitPort;
  env: EnvPort;
}

/** Map a service/mutation failure onto the canonical error envelope (both share FlowFailure). */
function failureEnvelope(outcome: FlowFailure, clock: Clock): Envelope {
  return formatError('flow', outcome.code, outcome.message, clock, {
    next_action: outcome.next_action,
  });
}

/**
 * Emit an envelope (json → standard port; human → one terse stdout line + stderr
 * next_action). Returns `never` — `exitWithEnvelope` is the single process exit,
 * so `return emit(...)` is a legitimate early-out in every action handler.
 */
function emit(io: CliIo, envelope: Envelope): never {
  const port: OutputPort =
    io.mode === 'json'
      ? createOutputPort('json', io.writers)
      : {
          emit: (e) => {
            if (e.status !== 'ok' && e.error) {
              io.writers.err(`harness flow: ${e.error.message}\n`);
            }
            if (e.next_action) io.writers.err(`  → ${e.next_action}\n`);
            io.writers.out(`flow: ${e.status}\n`);
          },
        };
  exitWithEnvelope(envelope, port);
}

/** Stable summary `data` for a flow doc — the frozen create/show envelope shape (T001 ckpt 2). */
function summary(doc: FlowDoc, path: string): Record<string, unknown> {
  return {
    path,
    slug: doc.slug,
    kind: doc.kind,
    cursor: doc.cursor,
    recommended_next: doc.recommended_next ?? null,
    node_count: doc.nodes.length,
    event_count: doc.events.length,
  };
}

/** Resolve a flow file path: `--path` › `.harness/flows/<slug>.json` (workshop 001 D4). */
function resolveFlowPath(
  opts: { path?: string; slug?: string },
  repoRoot: string,
): { ok: true; path: string } | { ok: false } {
  if (opts.path) return { ok: true, path: toPosix(opts.path) };
  if (opts.slug) return { ok: true, path: posixJoin(repoRoot, FLOWS_DIR, `${opts.slug}.json`) };
  return { ok: false };
}

/**
 * Register the `flow` command — the first NESTED subcommand group (workshop 001
 * D1): a single core `flow` act with `create`/`new`/`show`/`list` + the
 * fine-grained mutations (`cursor`/`status`/`add-node`/`set-node`/`insert-node`/
 * `comment`/`event`). A CORE reserved command. It owns no logic — `flow-service`
 * + `flow-mutations` do the work; this act wires Commander → service and maps the
 * outcome onto the Envelope + exit code (ok → 0, error → 1).
 */
export function registerFlowAct(
  program: Command,
  io: CliIo,
  deps: FlowActDeps,
  version: string,
): void {
  const svc: FlowServiceDeps = { fs: deps.fs, clock: deps.clock, git: deps.git, env: deps.env };
  const repoRoot = () => toPosix(deps.proc.cwd());

  const flow = program
    .command('flow')
    .description('Deterministic flow mechanics — create/mutate/inspect a cursor-spine flow DAG');

  // --- create ------------------------------------------------------------
  flow
    .command('create <type>')
    .description(
      'Instantiate a flow of <type> from its template (root identity + provenance stamped)',
    )
    .requiredOption('--slug <slug>', 'instance slug')
    .option('--path <path>', 'write target (default: .harness/flows/<slug>.json; must be in-repo)')
    .option('--schema <path>', 'overlay schema override (may be out-of-repo)')
    .option('--template <path>', 'create-seed override (may be out-of-repo)')
    .option('--bare', 'root-only — copy no template nodes')
    .action(
      (
        type: string,
        opts: { slug: string; path?: string; schema?: string; template?: string; bare?: boolean },
      ) => {
        const res = createFlow(
          {
            type,
            slug: opts.slug,
            repoRoot: repoRoot(),
            harnessVersion: version,
            path: opts.path,
            schemaPath: opts.schema,
            templatePath: opts.template,
            bare: opts.bare,
          },
          svc,
        );
        if (!res.ok) return emit(io, failureEnvelope(res, deps.clock));
        emit(
          io,
          formatOk('flow', summary(res.doc, res.path), deps.clock, {
            evidence: [{ label: 'flow', path: res.path }],
            next_action: `Mutate it: \`harness flow cursor --path ${res.path} --to <node>\`.`,
          }),
        );
      },
    );

  // --- new ---------------------------------------------------------------
  flow
    .command('new <type>')
    .description('Scaffold a custom flow-type schema overlay into .harness/schemas/flows/')
    .option('--force', 'overwrite an existing schema')
    .action((type: string, opts: { force?: boolean }) => {
      const res = newFlowSchema({ type, repoRoot: repoRoot(), force: opts.force }, svc);
      if (!res.ok) return emit(io, failureEnvelope(res, deps.clock));
      emit(
        io,
        formatOk('flow', { path: res.path, type }, deps.clock, {
          evidence: [{ label: 'flow schema', path: res.path }],
          next_action: `Edit the statuses/nodeTypes in ${res.path}, then \`harness flow create ${type} --slug <slug>\`.`,
        }),
      );
    });

  // --- show --------------------------------------------------------------
  flow
    .command('show')
    .description('Read a flow and print its summary')
    .option('--path <path>', 'flow file path')
    .option('--slug <slug>', 'flow slug (resolves .harness/flows/<slug>.json)')
    .action((opts: { path?: string; slug?: string }) => {
      const resolved = resolveFlowPath(opts, repoRoot());
      if (!resolved.ok) return emit(io, failureEnvelope(needPath(), deps.clock));
      const res = showFlow(resolved.path, svc);
      if (!res.ok) return emit(io, failureEnvelope(res, deps.clock));
      emit(io, formatOk('flow', summary(res.doc, res.path), deps.clock));
    });

  // --- list --------------------------------------------------------------
  flow
    .command('list')
    .description('Discover flows under .harness/flows/ (or --dir)')
    .option('--dir <dir>', 'directory to scan (default: .harness/flows/)')
    .action((opts: { dir?: string }) => {
      const res = listFlows({ repoRoot: repoRoot(), dir: opts.dir }, svc);
      emit(io, formatOk('flow', { flows: res.flows, count: res.flows.length }, deps.clock));
    });

  // --- cursor ------------------------------------------------------------
  flow
    .command('cursor')
    .description('Move the cursor (--to) or set the recommended next node (--recommend)')
    .option('--path <path>', 'flow file path')
    .option('--slug <slug>', 'flow slug')
    .option('--to <node>', 'move the cursor to this node')
    .option('--recommend <node>', 'set recommended_next without moving the cursor')
    .action((opts: { path?: string; slug?: string; to?: string; recommend?: string }) => {
      if (opts.to === undefined && opts.recommend === undefined) {
        return emit(
          io,
          failureEnvelope(
            {
              ok: false,
              status: 'error',
              code: ErrorCodes.INVALID_ARGS,
              message: 'cursor needs --to or --recommend.',
              next_action: 'Pass --to <node> or --recommend <node>.',
            },
            deps.clock,
          ),
        );
      }
      runMutation(io, deps, opts, (doc) =>
        opts.to !== undefined
          ? moveCursor(doc, opts.to, { clock: deps.clock })
          : recommendNext(doc, opts.recommend as string, { clock: deps.clock }),
      );
    });

  // --- status ------------------------------------------------------------
  flow
    .command('status')
    .description('Set a node status (fires status-changed; stamps ran_at on done/blocked)')
    .option('--path <path>', 'flow file path')
    .option('--slug <slug>', 'flow slug')
    .requiredOption('--node <id>', 'node id')
    .requiredOption('--to <status>', 'target status')
    .action((opts: { path?: string; slug?: string; node: string; to: string }) => {
      runMutation(io, deps, opts, (doc) =>
        setStatus(doc, opts.node, opts.to, { clock: deps.clock }),
      );
    });

  // --- add-node ----------------------------------------------------------
  flow
    .command('add-node')
    .description('Append a new node')
    .option('--path <path>', 'flow file path')
    .option('--slug <slug>', 'flow slug')
    .requiredOption('--id <id>', 'new node id')
    .requiredOption('--type <type>', 'node type')
    .requiredOption('--label <label>', 'node label')
    .option('--status <status>', 'node status', 'known')
    .option('--next <ids>', 'comma-separated successor node ids')
    .action(
      (opts: {
        path?: string;
        slug?: string;
        id: string;
        type: string;
        label: string;
        status: string;
        next?: string;
      }) => {
        runMutation(io, deps, opts, (doc) =>
          addNode(
            doc,
            {
              id: opts.id,
              type: opts.type,
              label: opts.label,
              status: opts.status,
              next: splitIds(opts.next),
            },
            { clock: deps.clock },
          ),
        );
      },
    );

  // --- set-node ----------------------------------------------------------
  flow
    .command('set-node')
    .description('Merge fields into an existing node (fires node-updated)')
    .option('--path <path>', 'flow file path')
    .option('--slug <slug>', 'flow slug')
    .requiredOption('--node <id>', 'node id')
    .option('--label <label>', 'new label')
    .option('--note <note>', 'set the node note')
    .option('--user-input <text>', 'set the genesis user_input')
    .action(
      (opts: {
        path?: string;
        slug?: string;
        node: string;
        label?: string;
        note?: string;
        userInput?: string;
      }) => {
        const fields: Record<string, unknown> = {};
        if (opts.label !== undefined) fields.label = opts.label;
        if (opts.note !== undefined) fields.note = opts.note;
        if (opts.userInput !== undefined) fields.user_input = opts.userInput;
        runMutation(io, deps, opts, (doc) =>
          setNode(doc, opts.node, fields, { clock: deps.clock }),
        );
      },
    );

  // --- insert-node -------------------------------------------------------
  flow
    .command('insert-node')
    .description(
      'Insert a node + splice edges (--after/--before/--branch-of); DAG-rechecked before write',
    )
    .option('--path <path>', 'flow file path')
    .option('--slug <slug>', 'flow slug')
    .requiredOption('--id <id>', 'new node id')
    .requiredOption('--type <type>', 'node type')
    .requiredOption('--label <label>', 'node label')
    .option('--status <status>', 'node status', 'known')
    .option('--after <node>', 'splice after this node')
    .option('--before <node>', 'splice before this node')
    .option('--branch-of <node>', 'attach as an excursion of this node')
    .option('--rejoin <node>', 'branch rejoin target (default: the branch-of node)')
    .action(
      (opts: {
        path?: string;
        slug?: string;
        id: string;
        type: string;
        label: string;
        status: string;
        after?: string;
        before?: string;
        branchOf?: string;
        rejoin?: string;
      }) => {
        runMutation(io, deps, opts, (doc) =>
          insertNode(
            doc,
            { id: opts.id, type: opts.type, label: opts.label, status: opts.status },
            {
              after: opts.after,
              before: opts.before,
              branchOf: opts.branchOf,
              rejoin: opts.rejoin,
            },
            { clock: deps.clock },
          ),
        );
      },
    );

  // --- comment -----------------------------------------------------------
  flow
    .command('comment')
    .description('Append a timestamped comment to a node (fires node-updated)')
    .option('--path <path>', 'flow file path')
    .option('--slug <slug>', 'flow slug')
    .requiredOption('--node <id>', 'node id')
    .requiredOption('--text <text>', 'comment text')
    .option('--source <source>', 'user | agent | system')
    .option('--kind <kind>', 'note | decision | warning | validation | …')
    .option('--refs <refs>', 'comma-separated commit/artifact refs')
    .action(
      (opts: {
        path?: string;
        slug?: string;
        node: string;
        text: string;
        source?: string;
        kind?: string;
        refs?: string;
      }) => {
        runMutation(io, deps, opts, (doc) =>
          addComment(
            doc,
            opts.node,
            opts.text,
            { clock: deps.clock },
            {
              source: opts.source,
              kind: opts.kind,
              refs: splitIds(opts.refs),
            },
          ),
        );
      },
    );

  // --- event -------------------------------------------------------------
  flow
    .command('event <name>')
    .description('Append a manual or custom (duck-typed) event to the flow log')
    .option('--path <path>', 'flow file path')
    .option('--slug <slug>', 'flow slug')
    .option('--value <value>', 'custom telemetry value (duck-typed; presence ⇒ custom event)')
    .option('--type <type>', 'force the value type: bool | int | float | date | string')
    .option('--kind <kind>', 'manual kind (build-run | test-run | deploy | …)')
    .option('--description <text>', 'manual-event description')
    .action(
      (
        name: string,
        opts: {
          path?: string;
          slug?: string;
          value?: string;
          type?: string;
          kind?: string;
          description?: string;
        },
      ) => {
        const resolved = resolveFlowPath(opts, repoRoot());
        if (!resolved.ok) return emit(io, failureEnvelope(needPath(), deps.clock));
        const read = readFlowDoc(resolved.path, svc);
        if (!read.ok) return emit(io, failureEnvelope(read, deps.clock));
        const doc = read.doc;
        const event =
          opts.value !== undefined
            ? buildCustomEvent(name, opts.value, doc.events, deps.clock, opts.type)
            : buildManualEvent(opts.kind ?? name, doc.events, deps.clock, {
                description: opts.description,
              });
        doc.events.push(event);
        const written = writeFlowAtomic(resolved.path, repoRoot(), doc, svc);
        if (!written.ok) return emit(io, failureEnvelope(written, deps.clock));
        emit(
          io,
          formatOk(
            'flow',
            { path: written.path, event: { id: event.id, kind: event.kind, origin: event.origin } },
            deps.clock,
          ),
        );
      },
    );
}

/** The "missing flow path" failure (shared by show/event/mutations). */
function needPath(): FlowFailure {
  return {
    ok: false,
    status: 'error',
    code: ErrorCodes.FLOW_NOT_FOUND,
    message: 'no flow file specified.',
    next_action: 'Pass --path <file> or --slug <slug>.',
  };
}

/** Split a comma list into trimmed ids (undefined → undefined). */
function splitIds(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * The read → mutate → write pipeline shared by every mutation subcommand: resolve
 * the flow path, read it (E301/E300/E308), apply the mutation (E305/E108/E309),
 * write atomically (E303/E302), and emit the node summary envelope.
 */
function runMutation(
  io: CliIo,
  deps: FlowActDeps,
  opts: { path?: string; slug?: string },
  mutate: (doc: FlowDoc) => MutationResult,
): never {
  const svc: FlowServiceDeps = { fs: deps.fs, clock: deps.clock, git: deps.git, env: deps.env };
  const root = toPosix(deps.proc.cwd());
  const resolved = resolveFlowPath(opts, root);
  if (!resolved.ok) return emit(io, failureEnvelope(needPath(), deps.clock));
  const read = readFlowDoc(resolved.path, svc);
  if (!read.ok) return emit(io, failureEnvelope(read, deps.clock));
  const result = mutate(read.doc);
  if (!result.ok) return emit(io, failureEnvelope(result, deps.clock));
  const written = writeFlowAtomic(resolved.path, root, result.doc, svc);
  if (!written.ok) return emit(io, failureEnvelope(written, deps.clock));
  emit(io, formatOk('flow', summary(result.doc, written.path), deps.clock));
}
