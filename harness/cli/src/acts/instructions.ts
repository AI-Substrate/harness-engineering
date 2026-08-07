import type { Command } from 'commander';
import type { Clock } from '../adapters/clock/clock-port.js';
import type { FsPort } from '../adapters/fs/fs-port.js';
import { NodeProcess } from '../adapters/process/node-process.js';
import { type Envelope, formatError, formatOk, formatUnconfigured } from '../output/envelope.js';
import { ErrorCodes } from '../output/error-codes.js';
import { exitWithEnvelope } from '../output/exit.js';
import { type CliIo, createOutputPort, type OutputPort } from '../output/output-port.js';
import type { VerbRegistry } from '../services/extensions/registry.js';
import {
  CORE_INSTRUCTION_PAGES,
  injectAgentsBlock,
} from '../services/instructions/commit-guidance.js';
import {
  buildCoreInstructions,
  loadVerbInstructions,
} from '../services/instructions/instructions-service.js';
import { toPosix } from '../services/shared/posix-path.js';

/** The ports the `instructions` act injects (a subset of VerbActDeps). */
export interface InstructionsActDeps {
  fs: FsPort;
  clock: Clock;
}

/**
 * Register the `instructions` command — the calling agent's self-briefing
 * channel (plan 014 AC-1/2/3). A CORE act (reserved, like `help`/`doctor`):
 * bare → the baked core agent briefing + which verbs carry their own briefing;
 * `instructions <verb>` → that extension's `instructions.md`, read from disk at
 * THIS invocation (D4 — edit → next call, no rebuild). Outcome → envelope per
 * D3: ok → 0; unknown verb / missing file → unconfigured → 2 (gap semantics, no
 * error code); exists-but-unreadable → error E145 → 1. Never a crash, never a
 * silent empty.
 */
export function registerInstructionsAct(
  program: Command,
  io: CliIo,
  deps: InstructionsActDeps,
  registry: VerbRegistry,
): void {
  program
    .command('instructions')
    .description(
      "Print the harness's agent briefing, or one verb's instructions.md (the calling agent's role)",
    )
    .argument('[verb]', 'verb whose extension briefing to print; omit for the core briefing')
    .option(
      '--inject',
      'For `commit`: write or refresh the managed harness:commit-guidance block in AGENTS.md (idempotent; only ever touches the region between its own markers)',
    )
    .action((verb: string | undefined, opts: { inject?: boolean }) => {
      if (verb === undefined) {
        emitCore(io, deps, registry);
        return;
      }
      if (opts.inject === true) {
        emitInject(verb, io, deps);
        return;
      }
      emitVerb(verb, io, deps, registry);
    });
}

/**
 * `harness instructions commit --inject` (plan 074 · ac-0008, seam 2) — the
 * EXPLICIT write that puts the managed guidance block into `AGENTS.md`.
 *
 * A separate, opt-in invocation on purpose. `doctor` warns when the block is
 * absent and never edits the file; the edit happens only when a human or the
 * adopt flow's guidance step asks for it, with the user's consent. Idempotent by
 * construction — the fenced markers delimit exactly the region this owns.
 */
function emitInject(verb: string, io: CliIo, deps: InstructionsActDeps): void {
  const command = `instructions ${verb} --inject`;
  if (CORE_INSTRUCTION_PAGES[verb] === undefined) {
    exitWithEnvelope(
      formatUnconfigured(
        command,
        `\`--inject\` is only defined for core guidance pages; \`${verb}\` has none. Run \`harness instructions commit --inject\` (the pages that support it: ${Object.keys(CORE_INSTRUCTION_PAGES).join(', ')}).`,
        deps.clock,
      ),
      createOutputPort(io.mode === 'json' ? 'json' : 'human', io.writers),
    );
  }
  const cwd = toPosix(new NodeProcess().cwd());
  const outcome = injectAgentsBlock({ fs: deps.fs, cwd });
  if (!outcome.ok) {
    exitWithEnvelope(
      formatError(
        command,
        ErrorCodes.INSTRUCTIONS_UNREADABLE,
        `${outcome.path} exists but could not be read, so the managed block was not written.`,
        deps.clock,
        { next_action: `Check permissions on ${outcome.path} and re-run.` },
      ),
      createOutputPort(io.mode === 'json' ? 'json' : 'human', io.writers),
    );
  }
  const result = outcome as Extract<typeof outcome, { ok: true }>;
  const envelope = formatOk(command, { path: result.path, action: result.action }, deps.clock, {
    evidence: [{ label: 'AGENTS.md commit-guidance block', path: result.path }],
    next_action:
      result.action === 'unchanged'
        ? 'Nothing changed — the block was already current.'
        : 'Review the block and commit it with `harness commit "<message>" -- AGENTS.md`.',
  });
  const port: OutputPort =
    io.mode === 'json'
      ? createOutputPort('json', io.writers)
      : {
          emit: () => {
            io.writers.out(
              `${result.action} the harness:commit-guidance block in ${result.path}\n`,
            );
          },
        };
  exitWithEnvelope(envelope, port);
}

/** Bare `harness instructions` → the baked core briefing (always available). */
function emitCore(io: CliIo, deps: InstructionsActDeps, registry: VerbRegistry): void {
  const payload = buildCoreInstructions(registry, deps.fs);
  const envelope = formatOk('instructions', payload, deps.clock, {
    next_action: 'Run `harness instructions <verb>` to read a verb briefing before using it.',
  });
  const port: OutputPort =
    io.mode === 'json'
      ? createOutputPort('json', io.writers)
      : {
          emit: () => {
            io.writers.out(payload.instructions);
            io.writers.out(
              payload.verbs_with_instructions.length > 0
                ? `\nVerb briefings available: ${payload.verbs_with_instructions.join(', ')}\n`
                : '\nNo verb briefings authored yet (see `harness doctor`).\n',
            );
          },
        };
  exitWithEnvelope(envelope, port);
}

/** `harness instructions <verb>` → that verb's runtime-loaded briefing, or an honest gap/fault. */
function emitVerb(
  verb: string,
  io: CliIo,
  deps: InstructionsActDeps,
  registry: VerbRegistry,
): void {
  const outcome = loadVerbInstructions(verb, registry, deps.fs);

  if (outcome.kind === 'ok') {
    const envelope = formatOk(
      'instructions',
      { verb: outcome.verb, path: outcome.path, instructions: outcome.instructions },
      deps.clock,
      { next_action: `Apply the briefing, then run \`harness ${outcome.verb}\`.` },
    );
    const port: OutputPort =
      io.mode === 'json'
        ? createOutputPort('json', io.writers)
        : { emit: () => io.writers.out(outcome.instructions) };
    exitWithEnvelope(envelope, port);
    return;
  }

  const envelope: Envelope =
    outcome.kind === 'unreadable'
      ? formatError(
          'instructions',
          ErrorCodes.INSTRUCTIONS_UNREADABLE,
          `instructions.md at ${outcome.path} exists but could not be read`,
          deps.clock,
          { next_action: 'Check the path is a readable UTF-8 text file, then retry.' },
        )
      : outcome.kind === 'missing'
        ? formatUnconfigured(
            'instructions',
            `Author ${outcome.path} — the briefing for this verb's calling agent (see \`harness instructions\` for the pattern).`,
            deps.clock,
          )
        : formatUnconfigured(
            'instructions',
            `No verb '${verb}' is registered. Run \`harness help\` for the verb map.`,
            deps.clock,
          );

  const port: OutputPort =
    io.mode === 'json'
      ? createOutputPort('json', io.writers)
      : {
          emit: (e) => {
            io.writers.err(
              `harness instructions: ${e.error?.message ?? e.next_action ?? 'failed'}\n`,
            );
            if (e.next_action) io.writers.err(`  → ${e.next_action}\n`);
            io.writers.out(`instructions: ${e.status}\n`);
          },
        };
  exitWithEnvelope(envelope, port);
}
