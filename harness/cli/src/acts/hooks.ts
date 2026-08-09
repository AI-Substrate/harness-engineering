import type { Command } from 'commander';
import type { Clock } from '../adapters/clock/clock-port.js';
import type { EnvPort } from '../adapters/env/env-port.js';
import type { FsPort } from '../adapters/fs/fs-port.js';
import { ExecGit } from '../adapters/git/exec-git.js';
import { ExecGitAttribution } from '../adapters/git/exec-git-attribution.js';
import { NodeHash } from '../adapters/hash/node-hash.js';
import { NodeSocketProbe } from '../adapters/net/node-socket-probe.js';
import { embedBinaryPath } from '../services/hooks/binary-path.js';
import { CommitIntercept, type HookPhase } from '../services/hooks/commit-intercept.js';
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

  hooks
    .command('fire')
    .description('Handle one agent hook fire. Always exits 0 and prints nothing (by design).')
    .argument('<agent>', 'the agent client firing the hook (cursor, claude, copilot, …)')
    .option('--phase <phase>', 'pre or post')
    .option('--hook-input <source>', 'where the payload comes from; only `stdin` is supported')
    .action(async (agent: string, opts: FireOpts): Promise<void> => {
      await fire(deps, agent, opts);
    });

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
    .action((opts: { json?: boolean }) => {
      emit(deps, opts.json, (d) => ({ agents: statusHooks(d), fires: fireSummary(d) }));
    });

  hooks
    .command('install')
    .description('Install the hook into every detected, supported agent.')
    .option('--json', 'machine-readable output')
    .action((opts: { json?: boolean }) => {
      emit(deps, opts.json, (d) => installHooks(d));
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

/** Build the verb deps from the act deps, or `null` when there is no home. */
function hooksDeps(deps: HooksActDeps): HooksDeps | null {
  const home = deps.env.home();
  if (home === undefined || home.trim() === '') return null;
  return {
    fs: deps.fs,
    home: home.replace(/\\/g, '/').replace(/\/+$/, ''),
    env: (name) => deps.env.get(name),
    // The binary the hook command names — resolved, normalised and ALWAYS quoted.
    binary: embedBinaryPath(process.argv[1] ?? 'harness'),
  };
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
    const home = deps.env.home();
    if (home === undefined) return;

    const raw = opts.hookInput === 'stdin' ? await readStdin() : null;
    const payload = parseHookPayload(raw);

    // Exit before ANY git work on a tool that cannot have committed. The hook
    // fires on every tool call and Node starts slowly; this is the mitigation for
    // the plan's Node-startup watch-item.
    if (!couldBeCommitBearing(payload.toolName)) return;
    if (!looksLikeRepo(deps.fs, payload.repoRoot)) return;
    const repoRoot = payload.repoRoot as string;

    const dir = hookStateDir(home);
    const journal = new FileHookJournal(deps.fs, hookJournalPath(home), dir);
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
    });

    void agent;
    await intercept.fire(phase, repoRoot, payload.command);
  } catch {
    // The last line of defence. Nothing may escape into the agent's tool call —
    // see the exit-0 contract on registerHooksAct.
  }
}

/** Read stdin to end. A stdin that never arrives resolves empty rather than hanging forever. */
function readStdin(): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const settle = (value: string | null) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    // Bounded: an agent that opens the pipe and never writes must not stall the
    // tool call it is bracketing.
    const timer = setTimeout(() => settle(null), 2_000);
    timer.unref?.();
    let buffer = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buffer += chunk;
    });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      settle(buffer);
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      settle(null);
    });
  });
}
