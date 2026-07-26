import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import type { Clock } from '../adapters/clock/clock-port.js';
import type { EnvPort } from '../adapters/env/env-port.js';
import type { FsPort } from '../adapters/fs/fs-port.js';
import type { GitPort } from '../adapters/git/git-port.js';
import type { ProcessPort } from '../adapters/process/process-port.js';
import { type Envelope, formatError, formatOk } from '../output/envelope.js';
import { ErrorCodes } from '../output/error-codes.js';
import { emitRawAndExit, exitWithEnvelope } from '../output/exit.js';
import { type CliIo, createOutputPort, type OutputPort } from '../output/output-port.js';
import {
  buildCustomEvent,
  buildManualEvent,
  type Chore,
  type FlowDoc,
} from '../services/flow/flow-events.js';
import {
  addComment,
  addNode,
  applyBatch,
  type ChoreRow,
  getMeta,
  insertNode,
  listChores,
  type MutationResult,
  mvNode,
  navShow,
  removeNode,
  setIntent,
  setMeta,
  setNext,
  setNode,
  setNow,
  setStatus,
} from '../services/flow/flow-mutations.js';
import {
  CHORE_RAIL_MODES,
  type ChoreRailMode,
  renderFlow,
  renderRailLine,
} from '../services/flow/flow-renderer.js';
import { resolveFlowSchema, validateFlowDoc } from '../services/flow/flow-schema.js';
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
import {
  isWithin,
  posixDirname,
  posixJoin,
  resolveInRepo,
  toPosix,
} from '../services/shared/posix-path.js';

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
    now: doc.nav?.now ?? null,
    next: doc.nav?.next ?? null,
    node_count: doc.nodes.length,
    event_count: doc.events.length,
  };
}

function autoRenderSibling(io: CliIo, fs: FsPort, path: string, doc: FlowDoc): void {
  const target = `${path.replace(/\.json$/, '')}.md`;
  try {
    fs.mkdirp(posixDirname(target));
    fs.writeText(target, renderFlow(doc));
  } catch (err) {
    io.writers.err(
      `warning: flow state saved but auto-render failed for ${target}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

/** Resolve a flow file path: `--path` › `.harness/flows/<slug>.json` (workshop 001 D4). */
function resolveFlowPath(
  opts: { path?: string; slug?: string },
  repoRoot: string,
): { ok: true; path: string } | { ok: false } {
  // A relative --path anchors to the repo root (so an explicit in-repo relative
  // path is accepted, not read as a `../` escape); an absolute path passes through.
  if (opts.path) return { ok: true, path: resolveInRepo(opts.path, repoRoot) };
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
    .option(
      '--agent <name>',
      'stamp provenance.agent (the rail-title source); the only source — no env fallback',
    )
    .option('--plan-id <id>', 'stamp provenance.plan_id; else $HARNESS_PLAN_ID')
    .option('--title <title>', 'an explicit rail-title label (preferred over the slug)')
    .action(
      (
        type: string,
        opts: {
          slug: string;
          path?: string;
          schema?: string;
          template?: string;
          bare?: boolean;
          agent?: string;
          planId?: string;
          title?: string;
        },
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
            agent: opts.agent,
            planId: opts.planId,
            title: opts.title,
          },
          svc,
        );
        if (!res.ok) return emit(io, failureEnvelope(res, deps.clock));
        autoRenderSibling(io, svc.fs, res.path, res.doc);
        emit(
          io,
          formatOk('flow', summary(res.doc, res.path), deps.clock, {
            evidence: [{ label: 'flow', path: res.path }],
            next_action: `Set position: \`harness flow nav set --path ${res.path} --now <node>\`.`,
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

  // --- nav (show / set / meta) -------------------------------------------
  // The cursor-spine position object (workshop 002) — supersedes the old `cursor`
  // verb (clean break, no alias). The CLI persists position; the LLM dispatches.
  const nav = flow
    .command('nav')
    .description('Position object: show / set (now/next/intent) / meta (the free-form bag)');

  nav
    .command('show')
    .description('Print the nav (now/next/intent/bag) + the now-node neighbours')
    .option('--path <path>', 'flow file path')
    .option('--slug <slug>', 'flow slug')
    .action((opts: { path?: string; slug?: string }) => {
      const resolved = resolveFlowPath(opts, repoRoot());
      if (!resolved.ok) return emit(io, failureEnvelope(needPath(), deps.clock));
      const read = readFlowDoc(resolved.path, svc);
      if (!read.ok) return emit(io, failureEnvelope(read, deps.clock));
      emit(
        io,
        formatOk('flow', navShow(read.doc) as unknown as Record<string, unknown>, deps.clock),
      );
    });

  nav
    .command('set')
    .description('Set position/intent: --now (move), --next/--clear-next (advisory), --intent')
    .option('--path <path>', 'flow file path')
    .option('--slug <slug>', 'flow slug')
    .option('--now <node>', 'move the position to this node')
    .option('--next <node>', 'set the advisory next node')
    .option('--clear-next', 'clear the advisory next (→ null)')
    .option('--intent <text>', 'set the leg intent')
    .action(
      (opts: {
        path?: string;
        slug?: string;
        now?: string;
        next?: string;
        clearNext?: boolean;
        intent?: string;
      }) => {
        if (
          opts.now === undefined &&
          opts.next === undefined &&
          opts.clearNext !== true &&
          opts.intent === undefined
        ) {
          return emit(
            io,
            failureEnvelope(
              {
                ok: false,
                status: 'error',
                code: ErrorCodes.INVALID_ARGS,
                message: 'nav set needs at least one of --now / --next / --clear-next / --intent.',
                next_action:
                  'Pass --now <node>, --next <node>, --clear-next, or --intent "<text>".',
              },
              deps.clock,
            ),
          );
        }
        const clk = { clock: deps.clock };
        runMutation(io, deps, opts, (doc) => {
          let r: MutationResult = { ok: true, doc };
          if (opts.now !== undefined) {
            r = setNow(r.doc, opts.now, clk);
            if (!r.ok) return r;
          }
          if (opts.clearNext === true) {
            r = setNext(r.doc, null, clk);
            if (!r.ok) return r;
          } else if (opts.next !== undefined) {
            r = setNext(r.doc, opts.next, clk);
            if (!r.ok) return r;
          }
          if (opts.intent !== undefined) {
            r = setIntent(r.doc, opts.intent, clk);
            if (!r.ok) return r;
          }
          return r;
        });
      },
    );

  const navMeta = nav
    .command('meta')
    .description('The free-form qualifier bag (shallow key/value, no schema)');

  navMeta
    .command('set <key> <value>')
    .description('Shallow-merge one key into the nav bag (other keys preserved)')
    .option('--path <path>', 'flow file path')
    .option('--slug <slug>', 'flow slug')
    .action((key: string, value: string, opts: { path?: string; slug?: string }) => {
      runMutation(io, deps, opts, (doc) => setMeta(doc, key, value, { clock: deps.clock }));
    });

  navMeta
    .command('get [key]')
    .description('Read one key (or the whole bag when no key is given)')
    .option('--path <path>', 'flow file path')
    .option('--slug <slug>', 'flow slug')
    .action((key: string | undefined, opts: { path?: string; slug?: string }) => {
      const resolved = resolveFlowPath(opts, repoRoot());
      if (!resolved.ok) return emit(io, failureEnvelope(needPath(), deps.clock));
      const read = readFlowDoc(resolved.path, svc);
      if (!read.ok) return emit(io, failureEnvelope(read, deps.clock));
      const value = getMeta(read.doc, key);
      emit(
        io,
        formatOk(
          'flow',
          key === undefined ? { bag: value } : { key, value: value ?? null },
          deps.clock,
        ),
      );
    });

  // --- rail --------------------------------------------------------------
  // The one-line progress view (Finding 05): `[title] pips  names`, banded
  // `pre ─ [ flight ] ─ post`. Shares the render's rail body — reusable by any flow.
  flow
    .command('rail')
    .description('Emit the one-line rail: [title] pips  names (banded pre ─ [ flight ] ─ post)')
    .option('--path <path>', 'flow file path')
    .option('--slug <slug>', 'flow slug')
    .option(
      '--chores <mode>',
      'chore name visibility: show | collapse | hide (default: collapse)',
      'collapse',
    )
    .action((opts: { path?: string; slug?: string; chores?: string }) => {
      const mode = opts.chores ?? 'collapse';
      if (!CHORE_RAIL_MODES.includes(mode as ChoreRailMode)) {
        return emit(
          io,
          failureEnvelope(
            {
              ok: false,
              status: 'error',
              code: ErrorCodes.INVALID_ARGS,
              message: `invalid --chores mode "${mode}".`,
              next_action: `Use --chores ${CHORE_RAIL_MODES.join(' | ')}.`,
            },
            deps.clock,
          ),
        );
      }
      const resolved = resolveFlowPath(opts, repoRoot());
      if (!resolved.ok) return emit(io, failureEnvelope(needPath(), deps.clock));
      const read = readFlowDoc(resolved.path, svc);
      if (!read.ok) return emit(io, failureEnvelope(read, deps.clock));
      const line = renderRailLine(read.doc, mode as ChoreRailMode);
      if (io.mode === 'json') {
        return emit(io, formatOk('flow', { path: resolved.path, rail: line }, deps.clock));
      }
      return emitRawAndExit(`${line}\n`, io.writers, 0);
    });

  // --- chores ------------------------------------------------------------
  // The pending-upkeep listing (Phase 4): every node carrying a chore marker,
  // with its kind/importance/status/anchor/ref. A READ — never mutates.
  flow
    .command('chores')
    .description('List the flow’s chore nodes (status · importance · kind · anchor · ref)')
    .option('--path <path>', 'flow file path')
    .option('--slug <slug>', 'flow slug')
    .option(
      '--at <node>',
      'only chores anchored at this node (the position-aware "due at <node>" read)',
    )
    .option('--list', 'list chores (the default action)')
    .action((opts: { path?: string; slug?: string; at?: string; list?: boolean }) => {
      const resolved = resolveFlowPath(opts, repoRoot());
      if (!resolved.ok) return emit(io, failureEnvelope(needPath(), deps.clock));
      const read = readFlowDoc(resolved.path, svc);
      if (!read.ok) return emit(io, failureEnvelope(read, deps.clock));
      const chores = listChores(read.doc, opts.at);
      if (io.mode === 'json') {
        return emit(
          io,
          formatOk(
            'flow',
            { path: resolved.path, at: opts.at ?? null, chores, count: chores.length },
            deps.clock,
          ),
        );
      }
      return emitRawAndExit(`${renderChoresTable(chores)}\n`, io.writers, 0);
    });

  // --- orient ------------------------------------------------------------
  // The "where am I / what do I do next" read (plan 040 Phase 2): in ONE command,
  // the rail + the `nav.now` node's label/command/full instructions[] text + the
  // chores anchored here, each with a status pip — so a weak model READS its next
  // step instead of inferring it. A READ — never mutates. Reuses `renderRailLine`
  // (no reimplementation) + `listChores` (ALL statuses, so completed checks show
  // ticked — `dueChores` would hide them; D6). The DEFAULT is the human text (D2 is
  // for a weak model); `--json` opts into the structured envelope.
  flow
    .command('orient')
    .description(
      'Print where the flow is: rail + the nav.now node (label/command/instructions) + its chores (default: human text; --json for the envelope)',
    )
    .option('--path <path>', 'flow file path')
    .option('--slug <slug>', 'flow slug')
    .option('--json', 'emit the structured envelope instead of the human text')
    .action((opts: { path?: string; slug?: string }) => {
      // D2: orient is a weak-model read, so the DEFAULT is the human block and the
      // structured envelope is an EXPLICIT `--json` opt-in — INDEPENDENT of the
      // ambient TTY-derived io.mode (which defaults a piped/non-TTY orient to json).
      // The root's `--json`/`--no-json` collapse to ONE commander boolean that can't
      // tell an explicit flag from the non-TTY default, so read the tri-state from
      // raw argv exactly as the entrypoint's `jsonFlag` does (the local `--json`
      // option above is for `--help` discoverability; the argv read is the decision).
      // `rawArgs` is a real commander field (the full argv) but isn't in its public
      // typings — narrow-cast to read it (no value-taking global flag precedes the
      // verb, so a flat scan is safe; same caveat the entrypoint's argv scans carry).
      const rawArgs = (program as unknown as { rawArgs?: readonly string[] }).rawArgs ?? [];
      const wantJson = orientWantsJson(rawArgs);
      const orientIo: CliIo = { mode: wantJson ? 'json' : 'human', writers: io.writers };
      const resolved = resolveFlowPath(opts, repoRoot());
      if (!resolved.ok) return emit(orientIo, failureEnvelope(needPath(), deps.clock));
      const read = readFlowDoc(resolved.path, svc);
      if (!read.ok) return emit(orientIo, failureEnvelope(read, deps.clock));
      const view = orientView(read.doc);
      // Robustness: a SET nav.now that doesn't resolve to a node in nodes[] is a
      // corrupt/inconsistent flow — error (E305, the missing-NODE case; the
      // missing-FILE case is E301) rather than silently returning ok + node:null. A
      // null/empty nav.now (no position) stays graceful (rail + "no current node").
      if (view.now !== null && view.node === null) {
        return emit(orientIo, failureEnvelope(danglingNow(view.now), deps.clock));
      }
      if (wantJson) {
        return emit(
          orientIo,
          formatOk(
            'flow',
            { path: resolved.path, ...view } as unknown as Record<string, unknown>,
            deps.clock,
          ),
        );
      }
      return emitRawAndExit(`${renderOrient(view)}\n`, orientIo.writers, 0);
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
    .option('--artifacts <list>', 'comma-separated artifact paths produced at this node')
    .option('--zone <band>', 'rail band: preflight | flight | postflight (default: by node type)')
    .option('--command <cmd>', 'the command/ref this node runs (e.g. a slash-command)')
    .option('--chore-kind <kind>', 'mark a chore: skill | command | builtin | manual')
    .option(
      '--importance <level>',
      'chore strength: strongly-recommended | recommended | optional | informational',
    )
    .action(
      (opts: {
        path?: string;
        slug?: string;
        id: string;
        type: string;
        label: string;
        status: string;
        next?: string;
        artifacts?: string;
        zone?: string;
        command?: string;
        choreKind?: string;
        importance?: string;
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
              artifacts: splitIds(opts.artifacts),
              zone: opts.zone,
              command: opts.command,
              chore: choreFromFlags(opts.choreKind, opts.importance),
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
    .option('--artifacts <list>', 'comma-separated artifact paths (replaces the node list)')
    .option('--add-instruction <text>', 'append one instruction to the node instructions[]')
    .option('--instructions <a||b>', 'replace the node instructions[] (|| -separated)')
    .option('--clear-instructions', 'empty the node instructions[]')
    .option('--command <cmd>', 'set the command/ref this node runs (e.g. a slash-command)')
    .option('--zone <band>', 'rail band: preflight | flight | postflight')
    .option(
      '--chore-kind <kind>',
      'flag this node a chore: skill | command | builtin | manual (R-1: turn an existing seam node into a chore)',
    )
    .option(
      '--importance <level>',
      'chore strength: strongly-recommended | recommended | optional | informational',
    )
    .action(
      (opts: {
        path?: string;
        slug?: string;
        node: string;
        label?: string;
        note?: string;
        userInput?: string;
        artifacts?: string;
        addInstruction?: string;
        instructions?: string;
        clearInstructions?: boolean;
        command?: string;
        zone?: string;
        choreKind?: string;
        importance?: string;
      }) => {
        const fields: Record<string, unknown> = {};
        if (opts.label !== undefined) fields.label = opts.label;
        if (opts.note !== undefined) fields.note = opts.note;
        if (opts.userInput !== undefined) fields.user_input = opts.userInput;
        if (opts.artifacts !== undefined) fields.artifacts = splitIds(opts.artifacts);
        if (opts.command !== undefined) fields.command = opts.command;
        if (opts.zone !== undefined) fields.zone = opts.zone;
        const chore = choreFromFlags(opts.choreKind, opts.importance);
        if (chore !== undefined) fields.chore = chore;
        runMutation(io, deps, opts, (doc) => {
          // `--add-instruction` appends, so the new list is resolved against the
          // node's CURRENT instructions[] (read from the doc here, not pre-parse).
          const current = doc.nodes.find((n) => n.id === opts.node)?.instructions;
          const resolved = resolveInstructions(Array.isArray(current) ? current : [], opts);
          if (resolved !== undefined) fields.instructions = resolved;
          return setNode(doc, opts.node, fields, { clock: deps.clock });
        });
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
    .option('--zone <band>', 'rail band: preflight | flight | postflight (default: by node type)')
    .option('--command <cmd>', 'the command/ref this node runs (e.g. a slash-command)')
    .option('--chore-kind <kind>', 'mark a chore: skill | command | builtin | manual')
    .option(
      '--importance <level>',
      'chore strength: strongly-recommended | recommended | optional | informational',
    )
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
        zone?: string;
        command?: string;
        choreKind?: string;
        importance?: string;
      }) => {
        runMutation(io, deps, opts, (doc) =>
          insertNode(
            doc,
            {
              id: opts.id,
              type: opts.type,
              label: opts.label,
              status: opts.status,
              zone: opts.zone,
              command: opts.command,
              chore: choreFromFlags(opts.choreKind, opts.importance),
            },
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

  // --- apply -------------------------------------------------------------
  // The transactional batch (plan 039): a JSON array of generic node ops from
  // --ops <file | -> (stdin). Two-phase (materialize creates → position edges),
  // one final DAG-check, one atomic write or none; forward refs resolve at the end;
  // a fully-no-op batch is byte-identical. The CLI stays roster-blind — the caller
  // computes the ops.
  flow
    .command('apply')
    .description(
      'Apply a transactional batch of node ops (--ops <file | ->): one DAG-check, one atomic write or none',
    )
    .option('--path <path>', 'flow file path')
    .option('--slug <slug>', 'flow slug')
    .requiredOption('--ops <src>', 'a JSON array of ops from a file path, or "-" for stdin')
    .action((opts: { path?: string; slug?: string; ops: string }) => {
      const raw = opts.ops === '-' ? readStdin() : svc.fs.readText(toPosix(opts.ops));
      if (raw === null) {
        return emit(
          io,
          failureEnvelope(
            {
              ok: false,
              status: 'error',
              code: ErrorCodes.FLOW_NOT_FOUND,
              message: `--ops file not found or unreadable: ${opts.ops}`,
              next_action: 'Pass --ops <file> or --ops - to read the ops JSON from stdin.',
            },
            deps.clock,
          ),
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return emit(
          io,
          failureEnvelope(
            {
              ok: false,
              status: 'error',
              code: ErrorCodes.INVALID_ARGS,
              message: '--ops is not valid JSON.',
              next_action:
                'Pass a JSON array of ops, e.g. [{"op":"add","id":"x","type":"phase","label":"X"}].',
            },
            deps.clock,
          ),
        );
      }
      runMutation(io, deps, opts, (doc) => applyBatch(doc, parsed, { clock: deps.clock }));
    });

  // --- remove-node -------------------------------------------------------
  flow
    .command('remove-node')
    .description(
      'Remove a node + rewire predecessors→successors (DAG-rechecked; --force for a terminal node)',
    )
    .option('--path <path>', 'flow file path')
    .option('--slug <slug>', 'flow slug')
    .requiredOption('--id <id>', 'node id to remove')
    .option('--force', 'allow removing a terminal (done/skipped) node (D5)')
    .action((opts: { path?: string; slug?: string; id: string; force?: boolean }) => {
      runMutation(io, deps, opts, (doc) =>
        removeNode(doc, opts.id, { force: opts.force }, { clock: deps.clock }),
      );
    });

  // --- mv-node -----------------------------------------------------------
  flow
    .command('mv-node')
    .description(
      'Re-parent a node (--after/--before/--branch-of [+ --rejoin]); DAG-rechecked; --force for a terminal',
    )
    .option('--path <path>', 'flow file path')
    .option('--slug <slug>', 'flow slug')
    .requiredOption('--id <id>', 'node id to move')
    .option('--after <node>', 'move to after this node')
    .option('--before <node>', 'move to before this node')
    .option('--branch-of <node>', 'move to an excursion of this node')
    .option('--rejoin <node>', 'branch rejoin target (default: the branch-of node)')
    .option('--force', 'allow moving a terminal (done/skipped) node (D5)')
    .action(
      (opts: {
        path?: string;
        slug?: string;
        id: string;
        after?: string;
        before?: string;
        branchOf?: string;
        rejoin?: string;
        force?: boolean;
      }) => {
        runMutation(io, deps, opts, (doc) =>
          mvNode(
            doc,
            opts.id,
            {
              after: opts.after,
              before: opts.before,
              branchOf: opts.branchOf,
              rejoin: opts.rejoin,
            },
            { force: opts.force },
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
    .option('--text <text>', 'comment text')
    .option('--message <text>', 'alias for --text')
    .option('--source <source>', 'user | agent | system')
    .option('--kind <kind>', 'note | decision | warning | validation | …')
    .option('--refs <refs>', 'comma-separated commit/artifact refs')
    .action(
      (opts: {
        path?: string;
        slug?: string;
        node: string;
        text?: string;
        message?: string;
        source?: string;
        kind?: string;
        refs?: string;
      }) => {
        const text = opts.text ?? opts.message;
        if (text === undefined) {
          return emit(
            io,
            failureEnvelope(
              {
                ok: false,
                status: 'error',
                code: ErrorCodes.INVALID_ARGS,
                message: 'comment needs --text (alias: --message) "<comment text>".',
                next_action: 'Pass --text "<comment text>" (or its alias --message).',
              },
              deps.clock,
            ),
          );
        }
        runMutation(io, deps, opts, (doc) =>
          addComment(
            doc,
            opts.node,
            text,
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
        autoRenderSibling(io, svc.fs, written.path, doc);
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

  // --- render ------------------------------------------------------------
  flow
    .command('render')
    .description(
      'Render a flow to deterministic markdown (mermaid diagram + node log); --check guards drift',
    )
    .option('--path <path>', 'flow file path')
    .option('--input <path>', 'alias for --path')
    .option('--slug <slug>', 'flow slug (resolves .harness/flows/<slug>.json)')
    .option('--output <file>', 'write the render to this file (default: stdout)')
    .option('--check', 're-render and diff the committed sibling .md (non-zero on drift)')
    .option(
      '--against <path>',
      'the .md --check compares against (default: the input path, .json→.md)',
    )
    .action(
      (opts: {
        path?: string;
        input?: string;
        slug?: string;
        output?: string;
        check?: boolean;
        against?: string;
      }) => {
        const root = repoRoot();
        const resolved = resolveFlowPath({ path: opts.path ?? opts.input, slug: opts.slug }, root);
        if (!resolved.ok) return emit(io, failureEnvelope(needPath(), deps.clock));
        const read = readFlowDoc(resolved.path, svc);
        if (!read.ok) return emit(io, failureEnvelope(read, deps.clock));
        const rendered = renderFlow(read.doc);

        // --check: compare to the committed sibling .md; NEVER writes (CI drift guard).
        if (opts.check) {
          const target = opts.against
            ? toPosix(opts.against)
            : `${resolved.path.replace(/\.json$/, '')}.md`;
          const committed = svc.fs.readText(target);
          if (committed === rendered) {
            return emit(
              io,
              formatOk('flow', { path: resolved.path, against: target, drift: false }, deps.clock),
            );
          }
          return emit(
            io,
            failureEnvelope(
              {
                ok: false,
                status: 'error',
                code: ErrorCodes.FLOW_RENDER_DRIFT,
                message:
                  committed === null
                    ? `no committed render to check against: ${target}`
                    : `rendered output drifted from the committed ${target}`,
                next_action:
                  'Regenerate with `npm run gen:flow-fixtures` (or `harness flow render --output <file>`) and commit the result.',
              },
              deps.clock,
            ),
          );
        }

        // --output: write the render inside the repo (containment guard).
        if (opts.output) {
          // Same relative-anchoring as --path: a relative --output resolves
          // against the repo root before containment, not into a `../` escape.
          const outPath = resolveInRepo(opts.output, root);
          if (!isWithin(root, outPath)) {
            return emit(
              io,
              failureEnvelope(
                {
                  ok: false,
                  status: 'error',
                  code: ErrorCodes.FLOW_PATH_ESCAPE,
                  message: `render output path escapes the repo root: ${outPath}`,
                  next_action: 'Write the render inside the repository.',
                },
                deps.clock,
              ),
            );
          }
          try {
            svc.fs.mkdirp(posixDirname(outPath));
            svc.fs.writeText(outPath, rendered);
          } catch (err) {
            return emit(
              io,
              failureEnvelope(
                {
                  ok: false,
                  status: 'error',
                  code: ErrorCodes.FLOW_WRITE_FAILED,
                  message: `failed to write render ${outPath}: ${err instanceof Error ? err.message : String(err)}`,
                  next_action: 'Check directory permissions and disk space, then retry.',
                },
                deps.clock,
              ),
            );
          }
          return emit(
            io,
            formatOk('flow', { path: outPath, bytes: rendered.length }, deps.clock, {
              evidence: [{ label: 'render', path: outPath }],
            }),
          );
        }

        // default → stdout. JSON: the markdown rides in `data.rendered`; human: raw passthrough.
        if (io.mode === 'json') {
          return emit(io, formatOk('flow', { path: resolved.path, rendered }, deps.clock));
        }
        return emitRawAndExit(rendered, io.writers, 0);
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

/**
 * Whether `harness flow orient` was EXPLICITLY asked for the JSON envelope (plan 040
 * P2-fix). orient defaults to the HUMAN block (D2 is a weak-model read), so — unlike
 * every other command — it must NOT inherit the ambient mode, which defaults a
 * non-TTY orient to json. The root's `--json`/`--no-json` collapse to one commander
 * boolean that loses the "absent" state, so (as the entrypoint's `jsonFlag` does) we
 * read the tri-state straight from raw argv: explicit `--json` wins, `--no-json`
 * forces human, absent ⇒ human. This is the ONE sanctioned act-level argv read.
 */
function orientWantsJson(argv: readonly string[]): boolean {
  return argv.includes('--json') && !argv.includes('--no-json');
}

/**
 * The orient robustness failure: a SET `nav.now` that doesn't resolve to any node
 * in `nodes[]` — a corrupt/inconsistent flow. Reuses `E305 FLOW_NODE_INVALID` (the
 * "a node that does not exist" code), the missing-NODE analogue of the missing-FILE
 * `E301`. (plan 040 P2-fix.)
 */
function danglingNow(now: string): FlowFailure {
  return {
    ok: false,
    status: 'error',
    code: ErrorCodes.FLOW_NODE_INVALID,
    message: `nav.now points at "${now}", which is not a node in this flow.`,
    next_action: 'Set the position to an existing node: `harness flow nav set --now <node>`.',
  };
}

/** Read the ops payload from stdin (`harness flow apply --ops -`). Synchronous fd-0
 *  read; returns '' on EOF / no stdin (an empty payload then fails JSON.parse cleanly). */
function readStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
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
 * Split a `--instructions "a||b"` value on `||` into trimmed, non-empty entries.
 * Instructions are free prose (commas are common), so the delimiter is `||`, not a
 * comma — unlike `splitIds`. (plan 040 D4.)
 */
function splitInstructions(raw: string): string[] {
  return raw
    .split('||')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Resolve the node's new `instructions[]` from the set-node flags, composing them in
 * a deterministic order against the node's CURRENT list: `--clear-instructions`
 * empties, `--instructions "a||b"` replaces (`||`-split), `--add-instruction <t>`
 * appends. Returns `undefined` when no instruction flag is present (leave the field
 * untouched). (plan 040 D4 / AC-01.)
 */
function resolveInstructions(
  current: string[],
  opts: { addInstruction?: string; instructions?: string; clearInstructions?: boolean },
): string[] | undefined {
  if (
    opts.clearInstructions !== true &&
    opts.instructions === undefined &&
    opts.addInstruction === undefined
  ) {
    return undefined;
  }
  let list = [...current];
  if (opts.clearInstructions === true) list = [];
  if (opts.instructions !== undefined) list = splitInstructions(opts.instructions);
  if (opts.addInstruction !== undefined) {
    const t = opts.addInstruction.trim();
    if (t.length > 0) list = [...list, t];
  }
  return list;
}

/**
 * Assemble the nested `chore: {kind, importance}` object from the flat
 * `--chore-kind`/`--importance` flags (Phase 4; Q2 = nested encoding, written by
 * flat flags). Either flag present ⇒ a chore is intended; an empty string for the
 * absent half is rejected by the pre-write `badChore` guard (so a half-specified
 * chore fails cleanly with `E108`). Neither flag ⇒ no chore.
 */
function choreFromFlags(kind?: string, importance?: string): Chore | undefined {
  if (kind === undefined && importance === undefined) return undefined;
  return { kind: kind ?? '', importance: importance ?? '' };
}

/**
 * The chore status pip for `orient` (D6): `■` done · `▨` skipped · else outstanding
 * — `▣` when a still-open chore is `strongly-recommended` (the one importance with
 * teeth), `□` otherwise. The `🧰` glyph + importance marker is a P3 render concern —
 * NOT added here; once P3 lands, the shared render inherits it.
 */
function chorePip(row: ChoreRow): string {
  if (row.status === 'done') return '■';
  if (row.status === 'skipped') return '▨';
  return row.importance === 'strongly-recommended' ? '▣' : '□';
}

/** One chore line in the `orient` read — a `ChoreRow` plus its status pip. */
interface OrientChore extends ChoreRow {
  pip: string;
}

/** The structured `harness flow orient` read: rail + the nav.now node + chores-with-pips. */
interface OrientView {
  now: string | null;
  rail: string;
  node: { id: string; label: string; command: string | null; instructions: string[] } | null;
  chores: OrientChore[];
}

/**
 * Compose the `orient` read for `nav.now` (plan 040 Phase 2 / AC-03): the shared
 * rail line, the current node's label/command/full `instructions[]` text, and the
 * chores anchored here — `listChores` (ALL statuses, so a completed check shows
 * ticked), NOT `dueChores` (which would hide done/skipped; D6) — each tagged with
 * its status pip. A READ — never mutates. No position (empty `nav.now`) → `node:
 * null`, `chores: []`, and the rail still renders (graceful). A SET-but-dangling
 * `nav.now` ALSO yields `node: null` HERE, but the orient ACTION treats that as a
 * corrupt flow and errors (E305) — it does NOT degrade to `node: null` downstream.
 */
function orientView(doc: FlowDoc): OrientView {
  const now = doc.nav?.now;
  const nowId = typeof now === 'string' && now.length > 0 ? now : null;
  const node = nowId !== null ? doc.nodes.find((n) => n.id === nowId) : undefined;
  const chores = nowId !== null ? listChores(doc, nowId) : [];
  return {
    now: nowId,
    rail: renderRailLine(doc),
    node:
      node === undefined
        ? null
        : {
            id: node.id,
            label: node.label ?? node.id,
            command: typeof node.command === 'string' ? node.command : null,
            instructions: Array.isArray(node.instructions) ? node.instructions : [],
          },
    chores: chores.map((c) => ({ ...c, pip: chorePip(c) })),
  };
}

/**
 * Human-readable `harness flow orient` block (JSON mode rides the envelope instead):
 * the rail line, then the `nav.now` node (label/command + its `instructions[]`
 * verbatim — the ONE surface that prints instruction text), then the anchored chores
 * each with a status pip. Empty sections are simply omitted.
 */
function renderOrient(view: OrientView): string {
  const lines: string[] = [view.rail];
  if (view.node === null) {
    lines.push('', '(no current node — set one with `harness flow nav set --now <node>`)');
    return lines.join('\n');
  }
  const cmd = view.node.command ? `  ${view.node.command}` : '';
  lines.push('', `▶ ${view.node.label} (${view.node.id})${cmd}`);
  if (view.node.instructions.length > 0) {
    lines.push('  Instructions:');
    for (const t of view.node.instructions) lines.push(`    • ${t}`);
  }
  if (view.chores.length > 0) {
    lines.push('  Chores:');
    for (const c of view.chores) lines.push(`    ${c.pip} ${c.label}`);
  }
  return lines.join('\n');
}

/** Human-readable `harness flow chores` table (JSON mode rides the envelope instead). */
function renderChoresTable(rows: ChoreRow[]): string {
  if (rows.length === 0) return 'No chores in this flow.';
  const lines = [`Chores (${rows.length}):`];
  for (const c of rows) {
    const where = c.anchor ? `after ${c.anchor}` : 'unanchored';
    const ref = c.runnable
      ? (c.command ?? '(no command)')
      : `${c.command ?? '—'}  (agent can’t run — ${c.kind})`;
    lines.push(`  • ${c.id} [${c.status}]  ${c.kind}/${c.importance}  ${where}  ${ref}`);
  }
  return lines.join('\n');
}

/**
 * Re-resolve the overlay by the doc's `kind` and validate the mutated doc against
 * it — returns a `FlowFailure` (E300) on schema issues, else `null`. If the
 * overlay can't be resolved (e.g. a flow created from an out-of-repo `--schema`
 * not re-passed on this mutation), validation is SKIPPED (tolerant): the create
 * already validated, and we won't block a mutation we can't re-verify.
 */
function validateMutatedDoc(
  doc: FlowDoc,
  repoRoot: string,
  svc: FlowServiceDeps,
): FlowFailure | null {
  const resolved = resolveFlowSchema({ type: doc.kind, repoRoot }, { fs: svc.fs });
  if (!resolved.ok) return null; // can't re-resolve → tolerant skip
  const issues = validateFlowDoc(doc, resolved.schema);
  if (issues.length === 0) return null;
  return {
    ok: false,
    status: 'error',
    code: ErrorCodes.FLOW_SCHEMA_INVALID,
    message: `the mutation would make the flow invalid: ${issues.join('; ')}`,
    next_action:
      'Fix the argument (status/type/next) to satisfy the flow schema — nothing was written.',
  };
}

/**
 * The read → mutate → write pipeline shared by every mutation subcommand: resolve
 * the flow path, read it (E301/E300/E308), apply the mutation (E305/E108/E309),
 * validate the result against the overlay (E300), write atomically (E303/E302),
 * and emit the node summary envelope.
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
  // Post-mutation schema validation (companion HIGH): the mechanical mutation
  // preserves shape, but a bad --status/--type/--next could still violate the
  // resolved overlay. Re-resolve by kind + validate; refuse the write on issues.
  // If the overlay can't be re-resolved (e.g. a flow created from an out-of-repo
  // --schema not re-passed here), skip validation — the create already validated.
  const invalid = validateMutatedDoc(result.doc, root, svc);
  if (invalid !== null) return emit(io, failureEnvelope(invalid, deps.clock));
  const written = writeFlowAtomic(resolved.path, root, result.doc, svc);
  if (!written.ok) return emit(io, failureEnvelope(written, deps.clock));
  autoRenderSibling(io, svc.fs, written.path, result.doc);
  // Plan 057 (D1/AC-02): `--quiet` slims the repeated per-mutation summary echo
  // to `{path}` — mutation verbs only; create/show/read verbs keep the frozen
  // full shape, and the default (no flag) stays byte-identical.
  const data = io.quiet === true ? { path: written.path } : summary(result.doc, written.path);
  emit(io, formatOk('flow', data, deps.clock));
}
