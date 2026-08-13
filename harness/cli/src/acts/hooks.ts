import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import type { Clock } from '../adapters/clock/clock-port.js';
import type { EnvPort } from '../adapters/env/env-port.js';
import { HOOK_SELF_TEST_MARKER } from '../adapters/exec/invocation-probe-port.js';
import { spawnInvocationProbe } from '../adapters/exec/spawn-invocation-probe.js';
import { spawnWrapperCheck } from '../adapters/exec/spawn-wrapper-check.js';
import type { FsPort } from '../adapters/fs/fs-port.js';
import { ExecGit } from '../adapters/git/exec-git.js';
import { ExecGitAttribution } from '../adapters/git/exec-git-attribution.js';
import { NodeHash } from '../adapters/hash/node-hash.js';
import { NodeSocketProbe } from '../adapters/net/node-socket-probe.js';
import { embedBinaryPath, embedInvocation } from '../services/hooks/binary-path.js';
import {
  CommitIntercept,
  type HookJournal,
  type HookPhase,
} from '../services/hooks/commit-intercept.js';
import { FIRE_OPTIONS } from '../services/hooks/fire-options.js';
import { FileHookJournal } from '../services/hooks/hook-journal.js';
import {
  couldBeCommitBearing,
  hookJournalPath,
  hookStateDir,
  looksLikeRepo,
  parseHookPayload,
} from '../services/hooks/hook-payload.js';
import { HookStateStore } from '../services/hooks/hook-state.js';
import {
  fireSummary,
  type HooksDeps,
  installHooks,
  listAgents,
  type RestoreReport,
  restoreHooks,
  statusHooks,
  uninstallHooks,
} from '../services/hooks/hooks-verbs.js';
import { Trace2Tickler } from '../services/hooks/trace2-tickler.js';

/** The ports the `hooks` act injects. A subset of VerbActDeps. */
export interface HooksActDeps {
  fs: FsPort;
  clock: Clock;
  env: EnvPort;
}

interface FireOpts {
  phase?: string;
  hookInput?: string;
  /**
   * A byte-exact spill of the payload, written by the Windows wrapper because
   * PowerShell 5.1 does not carry stdin across the `.ps1 -> node` hop. Takes
   * precedence over {@link hookInput}; see `fire-options.ts` for the measurement.
   */
  hookInputFile?: string;
  /**
   * PROVENANCE, NOT BEHAVIOUR. The marker the installer embeds so uninstall can
   * recognise its own entry. `fire` accepts it and does nothing with it, and a
   * test pins that: if it ever started changing what `fire` does, the installed
   * command and every hand-typed reproduction of it would diverge again.
   */
  hookOwner?: string | boolean;
}

/**
 * Register `harness hooks fire <agent> --phase pre|post --hook-input stdin`
 * (plan 082 tk-0009).
 *
 * A CORE verb, not a repo extension, for the same reason `commit` and `doctor`
 * are: the thing it guards is a property of the MACHINE — an agent's hook config
 * and the collector daemon — not of any repository's toolchain. It is added to
 * `RESERVED_NAMES` so a repo extension cannot shadow it; a shadowed hook verb
 * would silently change what runs on every tool call of every agent session.
 *
 * **EXIT 0, ALWAYS, AND SILENT.** This runs inside an agent's tool loop. A non-zero
 * exit or a line of output could abort or corrupt the agent's own turn, so every
 * path — success, refusal, malformed payload, missing repo, thrown exception —
 * exits 0 and writes nothing the agent can see. The consequence is that **the exit
 * code carries no information**, so nothing may assert on it; the journal
 * (`~/.harness/hooks/fires.jsonl`) is the observable.
 */
export function registerHooksAct(program: Command, deps: HooksActDeps): void {
  const hooks = program
    .command('hooks')
    .description('Agent hook runtime: relay commit attribution the agent sandbox would lose');

  const fireCommand = hooks
    .command('fire')
    .description('Handle one agent hook fire. Always exits 0 and prints nothing (by design).')
    .argument('<agent>', 'the agent client firing the hook (cursor, claude, copilot, …)')
    /*
     * TOLERANT PARSING IS PART OF THE EXIT-0 CONTRACT (F004).
     *
     * The contract above says every path exits 0. Argument parsing was not one of
     * those paths: an option commander did not recognise printed an error and
     * exited 1, BEFORE the action and its try/catch ran. That is how a flag the
     * installer emitted killed every hook fire on every machine.
     *
     * Registering the flag fixes that instance. This fixes the CLASS: a config
     * written by a different version of this binary, or hand-edited, names a word
     * we do not know, and the hook goes on working rather than aborting an agent's
     * turn. Tolerating is the safe direction — an ignored flag is inert, a
     * rejected one is fatal.
     *
     * IT MUST NOT MASK OUR OWN DRIFT, so two other mechanisms stand beside it:
     * `statusHooks` reports any option in an installed command that this binary
     * does not declare, and `composed-command.int.test.ts` fails if the installer
     * emits one. Without those, tolerance would let the installer and the verb
     * drift apart silently — the same defect, quieter.
     */
    .allowUnknownOption()
    .allowExcessArguments()
    .action(async (agent: string, opts: FireOpts): Promise<void> => {
      await fire(deps, agent, opts);
    });
  // Registered FROM the shared declaration, so the verb cannot accept an option
  // the installer does not know about, nor omit one the installer emits.
  for (const option of FIRE_OPTIONS) fireCommand.option(option.flags, option.description);

  /*
   * THE READ/WRITE VERBS.
   *
   * Unlike `fire`, these are operator-facing: they run at a terminal, not inside an
   * agent's tool loop, so the exit-0-and-silent contract does NOT apply to them and
   * they may print and may exit non-zero. `fire` remains the only verb bound by it.
   */
  hooks
    .command('list')
    .description('Every known agent: detected, supported, installed.')
    .option('--json', 'machine-readable output')
    .action((opts: { json?: boolean }) => {
      emit(deps, opts.json, (d) => listAgents(d));
    });

  hooks
    .command('status')
    .description(
      'Per-agent install state, whether the configured binary resolves, and recent fires.',
    )
    .option('--json', 'machine-readable output')
    .option(
      '--probe',
      'EXECUTE each configured command and report whether OUR code ran (spawns a child)',
    )
    .action((opts: { json?: boolean; probe?: boolean }) => {
      emit(deps, opts.json, (d) => ({
        agents: statusHooks(opts.probe === true ? { ...d, probe: spawnInvocationProbe } : d),
        fires: fireSummary(d),
      }));
    });

  /*
   * THE SELF-TEST — the evidence `executionState` needs (plan 082, F008).
   *
   * It prints a sentinel and exits 0. That is the entire contract, and the
   * smallness is the point: the question it answers is not "does the CLI work"
   * but "did THIS interpreter, given THIS script path, get as far as running our
   * code at all". On the Windows guest measured on 2026-08-10 the answer was no
   * — Windows Script Host opened the file, could not execute an ES module, and
   * exited 0 without printing anything. Exit 0 is therefore not the signal; the
   * sentinel on stdout is.
   */
  hooks
    .command('self-test')
    .description('Print a sentinel proving this invocation reached our code. Exits 0.')
    .action(() => {
      process.stdout.write(`${HOOK_SELF_TEST_MARKER}\n`);
    });

  hooks
    .command('install')
    .description('Install the hook into every detected, supported agent.')
    .option('--json', 'machine-readable output')
    .action((opts: { json?: boolean }) => {
      emit(deps, opts.json, (d) => installHooks(d));
    });

  hooks
    .command('uninstall')
    .description('Remove our hook from every detected, supported agent.')
    .option('--json', 'machine-readable output')
    .action((opts: { json?: boolean }) => {
      emit(deps, opts.json, (d) => uninstallHooks(d));
    });

  hooks
    .command('restore')
    .description('Put agent configs back from a backup taken before an install.')
    .option('--from <dir>', 'the backup directory to restore from; defaults to the newest')
    .option('--json', 'machine-readable output')
    .action((opts: { from?: string; json?: boolean }) => {
      // The ONE verb here that sets an exit code, and the reason is the audience:
      // everyone running it already has a problem. A refusal reported as a clean
      // restore of zero files would send them away believing their configs are
      // back. `fire`'s exit-0 contract does not reach this — see the note above.
      const report = emit(deps, opts.json, (d) => restoreHooks(d, opts.from)) as
        | RestoreReport
        | undefined;
      if (report === undefined || !report.ok) process.exitCode = 1;
    });
}

/**
 * Build the verb deps from the act deps, or `null` when there is no home.
 *
 * EXPORTED so `harness doctor` composes hooks the SAME way this act does (plan 082
 * tk-0002). Doctor building its own would be free to resolve a different binary
 * path or a different home, and the config it wrote on first run would then differ
 * from the one `harness hooks status` reads back — a divergence between two answers
 * to the same question, which is the class that produced `detectId` and
 * `configPathsFor`.
 */
export function hooksDeps(deps: HooksActDeps): HooksDeps | null {
  const home = deps.env.home();
  if (home === undefined || home.trim() === '') return null;
  return hooksDepsFor(deps.fs, home, deps.env);
}

/**
 * The same composition, from an EXPLICITLY SUPPLIED fs and home.
 *
 * WHY THE HOME IS A PARAMETER AND NOT READ HERE. `harness doctor` installs hooks
 * too, and it must resolve them through the deps a caller INJECTED — otherwise an
 * injected fence moves the collector's installer and not ours. That is not
 * hypothetical: the doctor call site read the composition root's own adapters for
 * one commit, and the test that opts the auto-install in — written for plan 077
 * after the identical bug — ran the real installer against a real developer's
 * editor configs on every gate run.
 *
 * So the escapable inputs are arguments. `binary` stays derived from the running
 * process, because the path written into a user's config IS the running binary and
 * no caller can supply a truthful substitute; `env` only reads variables. Neither
 * can write outside a fence; `fs` and `home` can.
 *
 * F008 MADE THAT PAIR TRUTHFUL ON BOTH PLATFORMS. `process.argv[1]` alone is a
 * SCRIPT PATH, and on Windows a bare `.js` first token is dispatched by file
 * association to `WScript.exe` — measured on a Windows 11 guest 2026-08-10, exit
 * 0, our journal unmoved across ~58 real hook invocations. The rationale above
 * was right and its conclusion was POSIX-only: on macOS the shebang makes that
 * path executable, on Windows it is a document. `process.execPath` is the same
 * kind of fact about the same running process — no PATH lookup, no guess at a
 * `.cmd` shim npm may or may not have written — so the invocation names both.
 */
export function hooksDepsFor(
  fs: FsPort,
  home: string,
  env: Pick<EnvPort, 'get'>,
): HooksDeps | null {
  if (home.trim() === '') return null;
  return {
    fs,
    home: home.replace(/\\/g, '/').replace(/\/+$/, ''),
    env: (name) => env.get(name),
    binary: hookInvocation(fs),
    // Injected, not imported by the service: statting a wrapper reports healthy for
    // one that cannot find an interpreter, so status INVOKES it (plan 085).
    checkWrapper: spawnWrapperCheck,
  };
}

/**
 * WHAT THE HOOK ENTRY WILL NAME — the shipped wrapper when it is there, and the raw
 * interpreter+script pair when it is not.
 *
 * THE WRAPPER IS PREFERRED BECAUSE THE INTERPRETER PATH IS THE THING THAT MOVES.
 * Naming `<node> <script>` bakes an absolute interpreter captured at install time,
 * and that is the measured defect: a devcontainer entry named `/usr/local/bin/node`
 * while node was nvm-managed elsewhere, and every fire died in silence. The wrapper
 * resolves the interpreter when the hook FIRES, so the entry survives a toolchain
 * that moves under it.
 *
 * IT IS PROBED, NEVER ASSUMED. `harness/cli/bin` is in `package.json#files`, so an
 * installed copy has it — but a hand-assembled tree, a partial copy, or a future
 * packaging change might not, and an entry naming a wrapper that is not there is
 * exactly the class being removed. If it is absent we fall back to the pair, which
 * still works; the fallback is a lesser install, not a broken one.
 */
function hookInvocation(fs: FsPort): string {
  const script = process.argv[1] ?? 'harness';
  /*
   * DERIVED FROM THIS MODULE'S OWN LOCATION, NOT FROM `process.argv[1]`.
   *
   * argv[1] is whatever the user INVOKED, and in a real install that is the npm bin
   * shim — `<prefix>/bin/harness` — not `<pkg>/harness/cli/bin/harness.js`. A first
   * version swapped `harness.js` for `harness-hook.sh` in argv[1]; the pattern never
   * matched a shim, so every real install silently fell back to the old
   * interpreter+script pair while emitting no error at all.
   *
   * IT PASSED LOCALLY BECAUSE I TESTED IT WRONG. Running `node harness/cli/bin/
   * harness.js` from a checkout gives an argv[1] that DOES end in `harness.js`, so
   * the swap worked on my machine and nowhere else. Caught by a peer installing the
   * real tarball and reading the emitted entry — the install shape I never used.
   *
   * This module sits at `harness/cli/{src,dist}/acts/hooks.*`, so `../../bin/` is the
   * wrapper directory from either build, independent of how the CLI was entered.
   */
  const wrapper = fileURLToPath(new URL('../../bin/harness-hook.sh', import.meta.url));
  if (fs.exists(wrapper)) return embedBinaryPath(wrapper);
  // The interpreter and the script, both quoted — one form on every platform, so the
  // string shipped to Windows users is the string every macOS gate run exercises.
  return embedInvocation(process.execPath, script);
}

/** Run one read/write verb and print it. Never throws out of the action. */
function emit(
  deps: HooksActDeps,
  json: boolean | undefined,
  run: (d: HooksDeps) => unknown,
): unknown {
  const resolved = hooksDeps(deps);
  if (resolved === null) {
    process.stdout.write(`${JSON.stringify({ error: 'no home directory' })}\n`);
    return undefined;
  }
  const result = run(resolved);
  // JSON is the only shaped output for now; a human renderer is Phase 3's problem.
  void json;
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

async function fire(deps: HooksActDeps, agent: string, opts: FireOpts): Promise<void> {
  try {
    const phase: HookPhase = opts.phase?.toLowerCase() === 'pre' ? 'pre' : 'post';
    // PROVENANCE ONLY. Read, and deliberately not acted on — see FireOpts.
    void opts.hookOwner;
    const home = deps.env.home();
    if (home === undefined) return;

    /*
     * The spill file takes precedence over stdin, because a wrapper that wrote one
     * has ALREADY consumed stdin to produce it — falling back would read an empty
     * pipe and call it "no payload".
     *
     * Read as BYTES and no-follow: the parser's whole diagnostic value is that it
     * describes the wire bytes rather than a decoding of them, and the path comes
     * from a world-writable temp directory, so following a symlink out of it is a
     * capability we simply never need.
     */
    const spill = opts.hookInputFile ?? null;
    const spilled = spill === null ? null : deps.fs.readBytesNoFollow(spill);
    const raw =
      spill !== null
        ? spilled === null
          ? null
          : Buffer.from(spilled)
        : opts.hookInput === 'stdin'
          ? await readStdin()
          : null;
    const payload = parseHookPayload(raw);

    const dir = hookStateDir(home);
    const file = new FileHookJournal(deps.fs, hookJournalPath(home), dir);

    /*
     * A NAMED SPILL THAT CANNOT BE READ IS THE ONE THING WE MUST NOT PASS OVER.
     *
     * Everything else that yields an empty payload is a legitimate quiet skip. This
     * is not: the wrapper wrote a file, said so on the command line, and it is gone
     * or unreadable by the time we look. Treated as "no payload" it would return at
     * the repo guard and reproduce EXACTLY the silent zero that cost this plan a
     * day on Windows — one layer further in, and this time in code that knew better.
     */
    if (spill !== null && spilled === null) {
      file.record({
        at: deps.clock.nowIso(),
        phase,
        agent,
        repoRoot: null,
        outcome: { kind: 'failed', cause: 'payload-file-unreadable' },
      });
      return;
    }

    /*
     * THE JOURNAL IS CONSTRUCTED BEFORE THE GUARDS BELOW, AND THAT ORDER IS THE FIX.
     *
     * It used to be built after them, so a payload we could not parse returned at
     * the repo guard — `repoRoot` is null, `looksLikeRepo` is false — and exited 0
     * having written nothing. The verb's contract is exit-0-always-and-silent
     * precisely BECAUSE it runs inside an agent's tool loop, and that contract is
     * paid for by a single promise: the journal is the observable. The one failure
     * the journal could not record was its own, which is why a UTF-8 BOM on
     * Cursor's Windows stdin cost three sessions and ~58 invocations to find. Fix
     * the BOM and this blind spot is still here, waiting for the next malformed
     * payload on any agent, on any platform.
     *
     * ONLY the parse failure is journalled here. Not every skipped read: the hook
     * fires on EVERY tool call (~38 across a 19-tool-call run) and Node starts
     * slowly, so a line per skip would trade a blind journal for an unusable one —
     * the same loss by a different route. A parse failure is rare and actionable.
     *
     * The PAYLOAD BODY IS NEVER WRITTEN. It carries `user_email` and
     * `transcript_path`; the record names the failure's shape, its size and a
     * bounded hex head, and nothing else.
     */
    if (payload.unparseable !== null) {
      file.record({
        at: deps.clock.nowIso(),
        agent,
        phase,
        repoRoot: null,
        outcome: { kind: 'unparseable', ...payload.unparseable },
      });
      return;
    }

    // Exit before ANY git work on a tool that cannot have committed. The hook
    // fires on every tool call and Node starts slowly; this is the mitigation for
    // the plan's Node-startup watch-item.
    if (!couldBeCommitBearing(payload.toolName)) return;
    if (!looksLikeRepo(deps.fs, payload.repoRoot)) return;
    const repoRoot = payload.repoRoot as string;

    // A stripped BOM leaves a trace on the entries this fire was going to write
    // anyway, so a CHANGE in what arrives on the wire is visible on the first fire
    // rather than the fiftieth — at the cost of zero extra journal lines.
    const journal: HookJournal = payload.strippedBom
      ? { record: (entry) => file.record({ ...entry, strippedBom: true }) }
      : file;
    const attribution = new ExecGitAttribution(repoRoot);
    const intercept = new CommitIntercept({
      git: new ExecGit(repoRoot),
      state: new HookStateStore(deps.fs, new NodeHash(), dir, () => `${process.pid}-${Date.now()}`),
      clock: deps.clock,
      emitter: new Trace2Tickler(
        new NodeSocketProbe(),
        () => attribution.globalTrace2Target(),
        () => deps.clock.nowIso(),
        process.pid,
      ),
      journal,
      // The agent slug the verb was invoked with. It was ALWAYS in scope here and
      // was discarded on this exact line (`void agent;`), which is why 1,578
      // journal records on this host name no agent and cannot answer the one
      // question the journal exists to answer: did THIS agent's hook ever fire?
      agent,
    });

    await intercept.fire(phase, repoRoot, payload.command);
  } catch {
    // The last line of defence. Nothing may escape into the agent's tool call —
    // see the exit-0 contract on registerHooksAct.
  }
}

/** Read stdin to end. A stdin that never arrives resolves empty rather than hanging forever. */
/**
 * Read stdin to end AS BYTES. A stdin that never arrives resolves empty rather
 * than hanging forever.
 *
 * NO `setEncoding`, AND THAT IS THE POINT. It used to decode to UTF-8 here, which
 * is lossy for anything that is not UTF-8 and destroys the evidence before the
 * parser can describe it: a UTF-16LE payload becomes U+FFFD, and the journal would
 * then report `ef bf bd` — the replacement character, identical for every unknown
 * encoding — instead of the `ff fe` that names it. That is the exact error that
 * cost this defect two hours in the first place, a text-mode instrument reporting
 * bytes it had already mangled. The decode still happens, one layer in, where the
 * original bytes survive beside it.
 */
function readStdin(): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let done = false;
    const settle = (value: Buffer | null) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    // Bounded: an agent that opens the pipe and never writes must not stall the
    // tool call it is bracketing.
    const timer = setTimeout(() => settle(null), 2_000);
    timer.unref?.();
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
    });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      settle(Buffer.concat(chunks));
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      settle(null);
    });
  });
}
