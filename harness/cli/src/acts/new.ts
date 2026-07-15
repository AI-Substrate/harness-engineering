import type { Command } from 'commander';
import type { Clock } from '../adapters/clock/clock-port.js';
import type { FsPort } from '../adapters/fs/fs-port.js';
import type { ProcessPort } from '../adapters/process/process-port.js';
import { formatError, formatOk } from '../output/envelope.js';
import { exitWithEnvelope } from '../output/exit.js';
import { type CliIo, createOutputPort, type OutputPort } from '../output/output-port.js';
import { scaffoldExtension } from '../services/scaffold/scaffold-service.js';

/** The ports the `new` act injects into the scaffold service (a subset of VerbActDeps). */
export interface NewActDeps {
  fs: FsPort;
  proc: ProcessPort;
  clock: Clock;
}

/**
 * Variant-aware "what next". A `--wrap` scaffold already has a working `run()`,
 * so telling the author to "implement run()" is misleading (MH-003) — point them
 * at running/reviewing it instead. A minimal stub genuinely needs implementing.
 */
function nextActionFor(variant: string, path: string, verb: string): string {
  if (variant === 'v2-wrap-ts') {
    return `Run \`harness ${verb}\` to try it (run() already wraps your command); edit ${path} to tweak. \`harness doctor\` confirms it loaded.`;
  }
  if (variant === 'v2-sub-ts') {
    return `Edit the subverb run() stubs in ${path}, then run \`harness ${verb} --help\`. \`harness doctor\` confirms it loaded.`;
  }
  if (variant === 'v2-sensor-ts') {
    return `Run \`harness sensors run ${verb}\` to try it; edit ${path} to set the command, watch globs, and guidance. \`harness doctor\` confirms it loaded.`;
  }
  return `Edit ${path} to implement run(), then run \`harness ${verb}\`. \`harness doctor\` confirms it loaded.`;
}

/**
 * Register the `new` command — scaffolds a fresh, loadable extension into the
 * repo's `.harness/extensions/`. A CORE command (reserved, like `help`/`doctor`,
 * runs even in `--no-extensions` mode); it owns no business logic — the
 * `scaffold-service` validates + writes, and this act maps the outcome onto the
 * Envelope + exit code (ok → 0, error → 1).
 */
export function registerNewAct(program: Command, io: CliIo, deps: NewActDeps): void {
  program
    .command('new')
    .description(
      'Scaffold a new extension package into .harness/extensions/<name>/ (entry + instructions.md)',
    )
    .argument('<name>', 'extension item name (lowercase, hyphenated)')
    .option('--sub <names>', 'comma-separated nested subverbs, e.g. --sub reset,seed')
    .option('--wrap <command>', 'wrap a real repo command, e.g. --wrap "npm test"')
    .option('--js', 'emit a plain .js bare-literal starter (no runtime import)')
    .option('--sensor', 'emit a typed command-wrapper sensor starter')
    .option('--force', 'overwrite an existing extension file')
    .action(
      (
        name: string,
        opts: { sub?: string; wrap?: string; js?: boolean; sensor?: boolean; force?: boolean },
      ) => {
        const outcome = scaffoldExtension(
          {
            name,
            sub: opts.sub?.split(',').map((subverb) => subverb.trim()),
            wrap: opts.wrap,
            js: opts.js,
            sensor: opts.sensor,
            force: opts.force,
          },
          { fs: deps.fs, proc: deps.proc },
        );
        const envelope = outcome.ok
          ? formatOk(
              'new',
              {
                path: outcome.path,
                instructionsPath: outcome.instructionsPath,
                verb: outcome.verb,
                variant: outcome.variant,
              },
              deps.clock,
              { next_action: nextActionFor(outcome.variant, outcome.path, outcome.verb) },
            )
          : formatError('new', outcome.code, outcome.message, deps.clock, {
              next_action: outcome.next_action,
            });
        const port: OutputPort =
          io.mode === 'json'
            ? createOutputPort('json', io.writers)
            : {
                emit: (e) => {
                  if (e.status === 'ok' && outcome.ok) {
                    io.writers.out(`Created ${outcome.path}\n`);
                    io.writers.out(
                      `Created ${outcome.instructionsPath} (author the agent briefing)\n`,
                    );
                  } else {
                    io.writers.err(`harness new: ${e.error?.message ?? 'failed'}\n`);
                    if (e.next_action) io.writers.err(`  → ${e.next_action}\n`);
                  }
                  io.writers.out(`new: ${e.status}\n`);
                },
              };
        exitWithEnvelope(envelope, port);
      },
    );
}
