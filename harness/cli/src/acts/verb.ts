import type { Command } from 'commander';
import type { Clock } from '../adapters/clock/clock-port.js';
import type { EnvPort } from '../adapters/env/env-port.js';
import type { BackgroundProcessPort } from '../adapters/exec/background-port.js';
import type { ExecPort } from '../adapters/exec/exec-port.js';
import type { FileSystemWritePort, FsPort } from '../adapters/fs/fs-port.js';
import type { GitPort } from '../adapters/git/git-port.js';
import type { ProcessPort } from '../adapters/process/process-port.js';
import { exitWithEnvelope } from '../output/exit.js';
import { type CliIo, createOutputPort } from '../output/output-port.js';
import type { HarnessVerb } from '../services/extensions/contract.js';
import { buildVerbContext, runVerb } from '../services/extensions/verb-context.js';

/** The ports a verb act needs: the ctx ports + the process port for cwd. */
export interface VerbActDeps {
  exec: ExecPort;
  fs: FsPort;
  env: EnvPort;
  git: GitPort;
  clock: Clock;
  proc: ProcessPort;
  /** OPTIONAL write-side FS capability surfaced as `ctx.fsWrite` (plan 031). */
  fsWrite?: FileSystemWritePort;
  /** OPTIONAL detached-spawn capability surfaced as `ctx.background` (plan 031). */
  background?: BackgroundProcessPort;
}

/**
 * Register ONE extension verb as a top-level `harness <verb>` subcommand. Thin:
 * it maps the declarative `HarnessVerb` onto commander (name, description,
 * options, args), and its action parses opts/args → builds the `VerbContext`
 * (cwd from the process port) → `await runVerb` → exits via the kernel (so the
 * status→exit mapping + `process.exit` confinement are unchanged). No business
 * logic lives here. Returns the created Command (usage is inspectable).
 */
export function registerVerbAct(
  program: Command,
  verb: HarnessVerb,
  deps: VerbActDeps,
  io: CliIo,
): Command {
  const command = program.command(verb.name);
  command.description(verb.description ?? verb.summary);
  command.summary(verb.summary);
  // Group every contributed verb under its own `--help` heading so the dynamic,
  // extension-owned surface reads separately from the fixed core commands.
  command.helpGroup('Extensions:');

  const args = verb.args ?? [];
  for (const arg of args) {
    command.argument(arg.name, arg.description);
  }
  for (const option of verb.options ?? []) {
    if (option.defaultValue !== undefined) {
      command.option(option.flags, option.description, option.defaultValue);
    } else {
      command.option(option.flags, option.description);
    }
  }

  command.action(async (...callArgs: unknown[]) => {
    const cmd = callArgs[callArgs.length - 1] as Command;
    const positionals = callArgs.slice(0, args.length) as (string | undefined)[];
    const ctx = buildVerbContext(deps, {
      cwd: deps.proc.cwd(),
      args: buildArgMap(args, positionals),
      options: cmd.opts(),
    });
    const envelope = await runVerb(verb, ctx, deps.clock);
    exitWithEnvelope(envelope, createOutputPort(io.mode, io.writers));
  });

  return command;
}

/** Map declared args (`<name>`, `[env]`, `<files...>`) to a `{argKey: value}` record. */
function buildArgMap(
  args: { name: string }[],
  positionals: (string | undefined)[],
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  args.forEach((arg, index) => {
    result[argKey(arg.name)] = positionals[index];
  });
  return result;
}

/** Strip commander placeholder punctuation: `<files...>` → `files`. */
function argKey(name: string): string {
  return name.replace(/[<>[\].]/g, '').trim();
}
