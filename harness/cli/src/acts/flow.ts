import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import type { Clock } from '../adapters/clock/clock-port.js';
import type { EnvPort } from '../adapters/env/env-port.js';
import type { FsPort } from '../adapters/fs/fs-port.js';
import type { GitPort } from '../adapters/git/git-port.js';
import { NodeHash } from '../adapters/hash/node-hash.js';
import type { ProcessPort } from '../adapters/process/process-port.js';
import { type Envelope, formatDegraded, formatError, formatOk } from '../output/envelope.js';
import { ErrorCodes } from '../output/error-codes.js';
import { emitRawAndExit, exitWithEnvelope } from '../output/exit.js';
import { type CliIo, createOutputPort, type OutputPort } from '../output/output-port.js';
import { MemoizingDocLoader } from '../services/dd/links/index.js';
import { ConventionSchemaResolver } from '../services/dd/schema/index.js';
import {
  type DdGateDeps,
  type DdGateDrift,
  type DdGateFinding,
  type DdGateResult,
  ddGateDrift,
  evaluateDdGate,
} from '../services/flow/flow-dd-gate.js';
import {
  buildCustomEvent,
  buildManualEvent,
  type Chore,
  type DdLink,
  ddLinkOf,
  type FlowDoc,
  type FlowNode,
} from '../services/flow/flow-events.js';
import {
  addComment,
  addNode,
  applyBatch,
  type ChoreRow,
  getMeta,
  insertNode,
  listChores,
  type MutationNotice,
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
import { FsDocLoader } from './dd/shared.js';

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
 * Compose the dd adapters the gate needs (plan 065 P6).
 *
 * This is the act layer doing its one job — being the composition root — and it
 * deliberately reuses `dd`'s own `FsDocLoader`/`ConventionSchemaResolver` rather
 * than growing a flow-shaped copy of each. A second document loader would be a
 * second answer to "what is a readable dd document", and the two would drift.
 *
 * Everything filesystem-shaped comes from the INJECTED `FsPort`, which satisfies
 * dd's `SchemaFs` structurally. The dd verbs wire `NodeSchemaFs` instead, because
 * they must tell "I could not look" from "I found nothing" and report `E416`; this
 * path need not, because both answers end the same way — a gate that cannot resolve
 * its schema REFUSES (`E442`) rather than guessing a verdict. Taking the port back
 * buys the flow act something worth more here: it is drivable with fakes.
 *
 * `tracked` is `null` on purpose: dd's link layer uses it to WARN about targets
 * outside version control, which is a repository-hygiene question the doctor
 * already asks. A gate refuses on completion, not on tracking, and buying that
 * answer would cost a `git ls-files` on every nav move.
 */
function ddGateDeps(repoRoot: string, deps: FlowActDeps): DdGateDeps {
  const home = deps.env.home();
  return {
    schemaResolver: new ConventionSchemaResolver({
      fs: deps.fs,
      repoRoot,
      ...(home !== undefined && { home: toPosix(home) }),
    }),
    docLoader: new MemoizingDocLoader(new FsDocLoader(deps.fs, new NodeHash(), null)),
  };
}

/**
 * The repository root of the DOCUMENT, derived from the flow file's own location
 * (P6 review F005) — not from wherever the process happens to be standing.
 *
 * A `dd_link.address` is repo-relative and PERSISTED: it was written against the
 * repository the flow lives in, and it means the same thing forever. Anchoring it
 * at `process.cwd()` silently makes it mean something different per caller — the
 * identical `harness flow orient --path /abs/the-flow.json` reports a healthy gate
 * from the repo root and a missing target (`E441`) one directory down. That is
 * worse than an error: it is a refusal the reader can only clear with `--force`,
 * for a document that was never incomplete.
 *
 * So the anchor travels with the document. Walk up from the flow file to the
 * nearest ancestor carrying a `.git` (a FILE in a worktree, a directory in a normal
 * clone — `exists` covers both), and fall back to `cwd` when there is none, which
 * is exactly the old behaviour for the un-versioned case.
 *
 * Scope is deliberate: this anchors dd ADDRESS RESOLUTION only. The write-path
 * containment root (`E303`) is a separate, older contract and is untouched here.
 */
function docRepoRoot(flowPath: string, deps: FlowActDeps): string {
  const fallback = toPosix(deps.proc.cwd());
  let dir = posixDirname(toPosix(flowPath));
  for (let hops = 0; hops < 64; hops += 1) {
    if (deps.fs.exists(posixJoin(dir, '.git'))) return dir;
    const parent = posixDirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return fallback;
}

/** The `GateEvaluator` seam `setNow` consumes — one live evaluation per link. */
function gateEvaluator(
  repoRoot: string,
  deps: FlowActDeps,
): { evaluate: (link: DdLink) => DdGateResult } {
  const gateDeps = ddGateDeps(repoRoot, deps);
  return {
    evaluate: (link: DdLink) => evaluateDdGate(link, gateDeps, { repoRoot, fromPath: null }),
  };
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
    .option(
      '--force',
      'depart a node whose dd gate is unsatisfied — a DEFENDED override, recorded in the event log (an agent may not pass this on its own judgment)',
    )
    .action(
      (opts: {
        path?: string;
        slug?: string;
        now?: string;
        next?: string;
        clearNext?: boolean;
        intent?: string;
        force?: boolean;
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
        runMutation(io, deps, opts, (doc, flowPath) => {
          const clk = {
            clock: deps.clock,
            gate: gateEvaluator(docRepoRoot(flowPath, deps), deps),
          };
          let r: MutationResult = { ok: true, doc };
          // The gate notice must survive the later setters: a forced departure is
          // still a forced departure when the same command also set --intent.
          let notice: MutationNotice | undefined;
          if (opts.now !== undefined) {
            r = setNow(r.doc, opts.now, clk, { force: opts.force === true });
            if (!r.ok) return r;
            notice = r.notice;
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
          return notice === undefined ? r : { ...r, notice };
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
      const gateRoot = docRepoRoot(resolved.path, deps);
      const view = orientView(read.doc, {
        deps: ddGateDeps(gateRoot, deps),
        repoRoot: gateRoot,
      });
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
  /** The dd gate at `nav.now`, when the node carries a `dd_link` (plan 065 P6). */
  dd_gate?: OrientGate;
}

/** One gate item in the `orient` read — an item id plus its per-item pip. */
interface OrientGateItem {
  id: string;
  state: string;
  pip: string;
}

/** The `orient` dd-gate block: what is linked, whether it gates, and every item. */
interface OrientGate {
  address: string;
  /** Whether departure from this node is actually gated on it. */
  gates: boolean;
  /** Which question the gate asks — absent for the completion kind. */
  check?: string;
  status: 'complete' | 'incomplete' | 'unevaluable';
  terminal: number;
  total: number;
  /** Absolute path of the resolved target, or `null` when it did not resolve. */
  path: string | null;
  /** Every item, in document order — complete AND incomplete (see below). */
  items: OrientGateItem[];
  /** Check-kind only: what the validator said, verbatim. Empty when green. */
  findings?: DdGateFinding[];
  /** Why the gate could not be evaluated; absent when it could. */
  problem?: string;
  /** A stale recorded basis — INFORMATION, never a refusal (workshop-001). */
  drift?: DdGateDrift;
}

/**
 * The per-item pip for the orient gate block (T005): `■` gate-terminal · `□` not.
 *
 * It mirrors the chore pips deliberately — a reader who has learned one square
 * alphabet on this surface has learned the other. `orient` shows ALL items rather
 * than only the outstanding ones for the same reason it shows completed chores:
 * "3 of 7" with four visible ticks is a progress read; four bare names is a
 * to-do list that has lost its denominator.
 */
function gatePip(terminal: boolean): string {
  return terminal ? '■' : '□';
}

/**
 * Compose the `orient` dd-gate block by evaluating the link LIVE.
 *
 * `orient` is a read, so it could have shown the recorded reading for free. It
 * does not: `orient` is the surface a weak model consults to decide what to do
 * next, and answering that question from a cache is how an agent ends up working
 * against a document that moved half an hour ago. The recorded reading exists for
 * the pure renderer, which genuinely cannot resolve anything; `orient` can, so it
 * does — and it separately reports basis drift, which is the honest signal that
 * the RECORDED half has gone stale.
 */
function orientGate(node: FlowNode, deps: DdGateDeps, repoRoot: string): OrientGate | undefined {
  const link = ddLinkOf(node);
  if (link === undefined || typeof link.address !== 'string' || link.address.length === 0) {
    return undefined;
  }
  const options = { repoRoot, fromPath: null };
  const result = evaluateDdGate(link, deps, options);
  const drift = ddGateDrift(link, deps, options);
  const gates = link.gate !== false;
  if (!result.ok) {
    return {
      address: link.address,
      gates,
      status: 'unevaluable',
      terminal: 0,
      total: 0,
      path: null,
      items: [],
      problem: result.message,
      ...(drift !== null && { drift }),
    };
  }
  const items: OrientGateItem[] = result.items.map((item) => ({
    id: item.id,
    state: item.state,
    pip: gatePip(item.terminal),
  }));
  return {
    address: result.address,
    gates,
    ...(result.kind === 'check' && result.check !== undefined && { check: result.check }),
    status: result.complete ? 'complete' : 'incomplete',
    terminal: result.terminal,
    total: result.total,
    path: result.path,
    items,
    ...(result.kind === 'check' && { findings: result.findings }),
    ...(drift !== null && { drift }),
  };
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
function orientView(doc: FlowDoc, gate?: { deps: DdGateDeps; repoRoot: string }): OrientView {
  const now = doc.nav?.now;
  const nowId = typeof now === 'string' && now.length > 0 ? now : null;
  const node = nowId !== null ? doc.nodes.find((n) => n.id === nowId) : undefined;
  const chores = nowId !== null ? listChores(doc, nowId) : [];
  const ddGate =
    node !== undefined && gate !== undefined
      ? orientGate(node, gate.deps, gate.repoRoot)
      : undefined;
  return {
    now: nowId,
    rail: renderRailLine(railDoc(doc, node, ddGate)),
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
    ...(ddGate !== undefined && { dd_gate: ddGate }),
  };
}

/**
 * The document `orient` rails from — the real one, with the CURRENT node's gate
 * reading replaced by what orient just computed live.
 *
 * Without this, one `orient` prints two answers to the same question: the rail
 * reports the RECORDED reading (`⛨ not yet evaluated` on a link nobody has
 * departed through yet) directly above a block that has just resolved the address
 * and found `1/3 ✕ holds`. Both halves are individually correct and the pair is
 * unreadable. The renderer stays pure and stays the single owner of the rail's
 * shape; it is simply handed the fresher document — which is what the reader
 * already believed they were looking at.
 *
 * **The UNEVALUABLE branch is the one that bites** (P6 review F002). Returning the
 * stored document there resurrected the exact contradiction this function exists to
 * kill, in its worst form: a previously-recorded `complete` rendered an open
 * `⚑ gate: … ⛨ 2/2 ✓` immediately above `! could not evaluate`. A rail asserting
 * a gate is OPEN while the block says the gate cannot be read is not a cosmetic
 * mismatch — it is the surface telling a reader they may depart. So the stored
 * reading is CLEARED instead: `not yet evaluated` is the only honest thing the rail
 * can say about a reading nothing can currently confirm, and it agrees with the
 * block underneath it.
 */
function railDoc(doc: FlowDoc, node: FlowNode | undefined, gate: OrientGate | undefined): FlowDoc {
  if (node === undefined || gate === undefined) return doc;
  const link = ddLinkOf(node);
  if (link === undefined) return doc;
  const { reading: _cleared, ...withoutReading } = link;
  const live: FlowNode =
    gate.status === 'unevaluable'
      ? { ...node, dd_link: withoutReading }
      : {
          ...node,
          dd_link: {
            ...link,
            reading: {
              status: gate.status,
              terminal: gate.terminal,
              total: gate.total,
              incomplete: gate.items.filter((i) => i.pip !== '■').map((i) => i.id),
              at: '',
            },
          },
        };
  return { ...doc, nodes: doc.nodes.map((n) => (n.id === node.id ? live : n)) };
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
  if (view.dd_gate !== undefined) lines.push(...renderOrientGate(view.dd_gate));
  return lines.join('\n');
}

/**
 * The human `orient` dd-gate block (T005 / AC-11).
 *
 * Ordered by what a reader needs first: the verdict, then the items that produced
 * it, then the drift warning. Drift is printed LAST and as a warning rather than
 * an error because it changes what you should trust, not what you are allowed to
 * do — the gate above it has already been computed live against the current file.
 */
function renderOrientGate(gate: OrientGate): string[] {
  const lines: string[] = [];
  const verb = gate.gates ? 'gate' : 'link (not gating)';
  if (gate.status === 'unevaluable') {
    lines.push(`  dd ${verb}: ${gate.address}`, `    ! could not evaluate — ${gate.problem ?? ''}`);
  } else if (gate.check !== undefined) {
    // The check block prints FINDINGS, not pips. Its one item would render as a
    // single square saying nothing a reader could act on, whereas the findings are
    // exactly the work standing between them and departure — the same list the
    // refusal would print, shown BEFORE they hit it.
    const mark = gate.status === 'complete' ? '✓ open' : '✕ holds';
    lines.push(`  dd ${verb} (${gate.check}): ${gate.address}  ${mark}`);
    for (const finding of gate.findings ?? []) {
      lines.push(`    □ ${finding.severity} ${finding.class} ${finding.address}`);
      lines.push(`      ${finding.message}`);
    }
  } else {
    const mark = gate.status === 'complete' ? '✓ open' : '✕ holds';
    lines.push(`  dd ${verb}: ${gate.address}  ${gate.terminal}/${gate.total} ${mark}`);
    for (const item of gate.items) lines.push(`    ${item.pip} ${item.id} (${item.state})`);
  }
  if (gate.drift !== undefined) {
    // Short shas for the human line, full ones in `--json`. Two 64-character
    // digests on one terminal row is a wall a reader skips; the first twelve
    // characters are what anyone actually compares, and the exact values are one
    // `--json` away for anything that needs them.
    lines.push(
      `    ⚠ basis drift: ${gate.drift.path} moved since this gate was last recorded`,
      `      recorded ${short(gate.drift.recorded)} → actual ${short(gate.drift.actual)}`,
    );
  }
  return lines;
}

/** First twelve characters of a digest — enough to compare, short enough to read. */
function short(sha: string): string {
  return sha.length > 12 ? `${sha.slice(0, 12)}…` : sha;
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
  mutate: (doc: FlowDoc, flowPath: string) => MutationResult,
): never {
  const svc: FlowServiceDeps = { fs: deps.fs, clock: deps.clock, git: deps.git, env: deps.env };
  const root = toPosix(deps.proc.cwd());
  const resolved = resolveFlowPath(opts, root);
  if (!resolved.ok) return emit(io, failureEnvelope(needPath(), deps.clock));
  const read = readFlowDoc(resolved.path, svc);
  if (!read.ok) return emit(io, failureEnvelope(read, deps.clock));
  // The resolved path is handed to the mutator so a gate can anchor its dd address
  // at the DOCUMENT's repo root rather than the process cwd (F005).
  const result = mutate(read.doc, resolved.path);
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
  // A forced dd-gate override succeeded, but never as a clean `ok` (workshop-002):
  // the degraded envelope's REQUIRED next_action is what states whose decision the
  // override had to be.
  if (result.notice !== undefined) {
    return emit(
      io,
      formatDegraded(
        'flow',
        { ...data, ...result.notice.data },
        result.notice.next_action,
        deps.clock,
      ),
    );
  }
  emit(io, formatOk('flow', data, deps.clock));
}
