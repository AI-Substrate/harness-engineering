import type { Command } from 'commander';
import type { Clock } from '../adapters/clock/clock-port.js';
import { SystemClock } from '../adapters/clock/system-clock.js';
import { NodeEnv } from '../adapters/env/node-env.js';
import { NodeFs } from '../adapters/fs/node-fs.js';
import { ExecGitAttribution } from '../adapters/git/exec-git-attribution.js';
import { NodeSocketProbe } from '../adapters/net/node-socket-probe.js';
import { NodeProcess } from '../adapters/process/node-process.js';
import { formatDegraded, formatError, formatOk } from '../output/envelope.js';
import { ErrorCodes } from '../output/error-codes.js';
import { exitWithEnvelope } from '../output/exit.js';
import { type CliIo, createOutputPort, type OutputPort } from '../output/output-port.js';
import { type CommitOutcome, harnessCommit } from '../services/commit/commit-service.js';
import { readIngress } from '../services/doctor/collector/ingress.js';
import { toPosix } from '../services/shared/posix-path.js';

/**
 * Register the CORE `commit` verb (plan 074 · ac-0005, ac-0008).
 *
 * A CORE verb, not an extension, and the placement is a recorded decision: the
 * failure it guards against — a sandbox silently severing git-ai's only ingress
 * — is a property of the MACHINE the agent runs on, not of any repo's toolchain.
 * A repo-local extension would have to be authored once per consumer, and the
 * repos most exposed are exactly the ones least likely to have authored it.
 *
 * The verb is deliberately ONE simple command with no chaining, because the
 * whole discovery behind it is that compound command shapes are what fall into
 * an agent sandbox (dossier F-04/F-06).
 *
 * Everything real lives in `commit-service`; this act injects adapters and maps
 * the outcome onto the envelope. `ok` + verified → ok/0; committed but not
 * proven → DEGRADED/0 (warn, never block — a commit that happened is never
 * reported as a failure); git itself failed → error/1 with git's own exit code.
 */
export function registerCommitAct(program: Command, io: CliIo): void {
  program
    .command('commit')
    .description(
      'Commit through the harness: probe the collector ingress, commit, then VERIFY attribution landed (or buffer it and name the recovery command)',
    )
    .argument('<message>', 'the commit message (passed to git as one argument — never a shell)')
    .argument(
      '[pathspecs...]',
      'explicit paths to stage before committing; omit to commit what is already staged',
    )
    .action((message: string, pathspecs: string[]): Promise<void> => run(io, message, pathspecs));
}

async function run(io: CliIo, message: string, pathspecs: string[]): Promise<void> {
  const clock = new SystemClock();
  const proc = new NodeProcess();
  const fs = new NodeFs();
  const cwd = toPosix(proc.cwd());
  const git = new ExecGitAttribution(cwd);

  const ingress = await readIngress({
    git,
    probe: new NodeSocketProbe(),
    fs,
    env: new NodeEnv(),
  });

  const outcome = await harnessCommit({ git, ingress, fs, proc, clock }, message, pathspecs);
  exitWithEnvelope(envelopeFor(outcome, clock), port(io, outcome));
}

/**
 * Outcome → envelope. EXPORTED so the mapping is directly testable: the review's
 * F007 was a wrong exit code, and an exit code is a claim about whether the work
 * happened. That claim deserves its own test, not a live commit to observe it.
 */
export function envelopeFor(outcome: CommitOutcome, clock: Clock) {
  const evidence = [
    outcome.sha !== null
      ? { label: `commit ${outcome.sha.slice(0, 12)}` }
      : outcome.shaUnknown
        ? // The commit is REAL — only its identity is unknown. `none: true` here
          // would read as "no commit was made", which is the one thing it is not.
          { label: 'commit made, sha unreadable' }
        : { label: 'commit', none: true },
  ];
  if (!outcome.ok) {
    return formatError(
      'commit',
      ErrorCodes.DOCTOR_CHECK_FAILED,
      outcome.detail,
      clock,
      // git's own exit code travels with the error: a caller must be able to
      // tell a pathspec typo from a hook rejection.
      {
        next_action: outcome.next_action ?? 'Read the git error above.',
        details: { git_exit_code: outcome.gitCode, mode: outcome.mode, probe: outcome.probe },
      },
    );
  }
  const data = {
    mode: outcome.mode,
    probe: outcome.probe,
    sha: outcome.sha,
    sha_unknown: outcome.shaUnknown,
    staged: outcome.staged,
    verify: outcome.verify,
    buffer: outcome.buffer,
    detail: outcome.detail,
  };
  // A commit that HAPPENED is never an error. When attribution is unproven the
  // envelope degrades — visible, exit 0, never a block (073 ac-000c). A commit
  // whose sha could not be read back is DEGRADED too, never ok: it really
  // happened, and saying so quietly would invite a re-run and a double commit.
  const nothingToDo = outcome.sha === null && !outcome.shaUnknown;
  return outcome.verify === 'landed' || nothingToDo
    ? formatOk('commit', data, clock, { evidence })
    : formatDegraded(
        'commit',
        data,
        outcome.next_action ?? 'Read `harness instructions commit`.',
        clock,
        { evidence },
      );
}

function port(io: CliIo, outcome: CommitOutcome): OutputPort {
  return io.mode === 'json'
    ? createOutputPort('json', io.writers)
    : {
        emit: (envelope) => {
          io.writers.err(`${outcome.detail}\n`);
          if (outcome.next_action !== undefined) {
            io.writers.err(`→ ${outcome.next_action}\n`);
          }
          io.writers.out(`commit: ${envelope.status}\n`);
        },
      };
}
