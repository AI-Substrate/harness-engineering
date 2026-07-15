import type { Command } from 'commander';
import { ErrorCodes } from '../output/error-codes.js';
import { exitWithEnvelope } from '../output/exit.js';
import { type CliIo, createOutputPort } from '../output/output-port.js';
import type {
  CustomRegistryItem,
  HarnessVerb,
  VerbArg,
  VerbOption,
} from '../services/extensions/contract.js';
import type { NormalizedSubverb, NormalizedVerb } from '../services/extensions/v2/types.js';
import {
  buildV2VerbContext,
  finalizeVerbResult,
  runV2Verb,
} from '../services/extensions/verb-context.js';
import type { VerbActDeps } from './verb.js';

function addParameters(
  command: Command,
  args: readonly VerbArg[],
  options: readonly VerbOption[],
): void {
  for (const arg of args) command.argument(arg.name, arg.description);
  for (const option of options) {
    if (option.defaultValue !== undefined) {
      command.option(option.flags, option.description, option.defaultValue);
    } else {
      command.option(option.flags, option.description);
    }
  }
}

function argKey(name: string): string {
  return name.replace(/[<>[\].]/g, '').trim();
}

function buildArgMap(
  declarations: readonly VerbArg[],
  values: readonly unknown[],
): Record<string, string | string[] | undefined> {
  const result: Record<string, string | string[] | undefined> = {};
  declarations.forEach((arg, index) => {
    const value = values[index];
    result[argKey(arg.name)] =
      typeof value === 'string' || value === undefined
        ? value
        : Array.isArray(value)
          ? value.filter((entry): entry is string => typeof entry === 'string')
          : String(value);
  });
  return result;
}

function runtimeSubverb(parentName: string, subverb: NormalizedSubverb): HarnessVerb {
  return { ...subverb, name: parentName };
}

/**
 * Register a current-shape verb carrying structural subverbs. Known children are
 * real commander commands; the parent action owns bare/unknown handling, and
 * only this path constructs the wider v2 positional map.
 */
export function registerV2VerbAct(
  program: Command,
  verb: NormalizedVerb,
  deps: VerbActDeps,
  io: CliIo,
  customItems: readonly CustomRegistryItem[] = [],
): Command {
  const command = program.command(verb.name);
  command.description(verb.description ?? verb.summary);
  command.summary(verb.summary);
  command.helpGroup('Extensions:');

  // A parent without run() has no positional consumer. Do not register its
  // declarations: otherwise commander consumes an unknown child as a required
  // or variadic parent arg before the kernel can diagnose the unknown subverb.
  const parentArgs = verb.hasOwnRun === false ? [] : (verb.args ?? []);
  addParameters(command, parentArgs, verb.options ?? []);

  // A known first token still dispatches to a real child command; any other token
  // lands here so the kernel can emit an actionable envelope instead of a raw
  // commander unknown-command error. Commander only permits a variadic last arg.
  const hasVariadicParent = parentArgs.some((arg) => arg.name.includes('...'));
  if (!hasVariadicParent) command.argument('[__unknownSubverb]');

  for (const subverb of verb.subverbs ?? []) {
    const subcommand = command.command(subverb.name);
    subcommand.description(subverb.description ?? subverb.summary);
    subcommand.summary(subverb.summary);
    const subArgs = subverb.args ?? [];
    addParameters(subcommand, subArgs, subverb.options ?? []);
    subcommand.action(async (...callArgs: unknown[]) => {
      const cmd = callArgs.at(-1) as Command;
      const ctx = buildV2VerbContext(
        deps,
        {
          cwd: deps.proc.cwd(),
          args: buildArgMap(subArgs, callArgs.slice(0, subArgs.length)),
          options: { ...command.opts(), ...cmd.opts() },
        },
        customItems,
      );
      const envelope = await runV2Verb(runtimeSubverb(verb.name, subverb), ctx, deps.clock);
      exitWithEnvelope(envelope, createOutputPort(io.mode, io.writers));
    });
  }

  command.action(async (...callArgs: unknown[]) => {
    const cmd = callArgs.at(-1) as Command;
    const parentValues = callArgs.slice(0, parentArgs.length);
    const unknown = hasVariadicParent ? undefined : callArgs[parentArgs.length];
    const ctx = buildV2VerbContext(
      deps,
      {
        cwd: deps.proc.cwd(),
        args: buildArgMap(parentArgs, parentValues),
        options: cmd.opts(),
      },
      customItems,
    );

    if (typeof unknown === 'string' && unknown.length > 0) {
      const envelope = finalizeVerbResult(
        ctx.error(ErrorCodes.INVALID_ARGS, `Unknown subverb '${unknown}' for '${verb.name}'.`, {
          next_action: `Run \`harness ${verb.name} --help\` and choose a listed subverb.`,
        }),
        verb.name,
        deps.clock,
      );
      exitWithEnvelope(envelope, createOutputPort(io.mode, io.writers));
    }

    if (verb.hasOwnRun === false) {
      const envelope = finalizeVerbResult(
        ctx.unconfigured(
          `Pick a subverb for '${verb.name}'. Run \`harness ${verb.name} --help\` for choices.`,
        ),
        verb.name,
        deps.clock,
      );
      exitWithEnvelope(envelope, createOutputPort(io.mode, io.writers));
    }

    const envelope = await runV2Verb(verb, ctx, deps.clock);
    exitWithEnvelope(envelope, createOutputPort(io.mode, io.writers));
  });

  return command;
}
