import type { Command } from 'commander';
import { formatError, formatOk } from '../../output/envelope.js';
import { ErrorCodes } from '../../output/error-codes.js';
import { emitRawAndExit, exitWithEnvelope } from '../../output/exit.js';
import type { CliIo } from '../../output/output-port.js';
import { isAddressFailure, parseAddress } from '../../services/dd/core/address.js';
import type { DdDoc } from '../../services/dd/core/model.js';
import { parse } from '../../services/dd/core/parse.js';
import { isPathWithinRepo } from '../../services/dd/core/validate.js';
import {
  type DdMutationDeps,
  type DdMutationFailure,
  type DdMutationOutcome,
  ddAdd,
  ddGet,
  ddRemove,
  ddSet,
  serializeDoc,
} from '../../services/dd/mutate/index.js';
import type { SchemaRecord } from '../../services/dd/schema/model.js';
import { resolveInRepo } from '../../services/shared/posix-path.js';
import { writeDocumentWithSibling } from './build.js';
import { createLinkContext, type DdActDeps, type DdLinkContext } from './shared.js';

/**
 * Refusal reason → frozen E-code, exhaustively.
 *
 * Same doctrine as `DD_ISSUE_CODES`: the mutate layer stays free of `output/`, so
 * the act is where a structured refusal becomes the CLI's error vocabulary, and
 * the `Record` is what stops a new reason shipping without a code.
 */
const MUTATION_CODES: Record<DdMutationFailure['reason'], string> = {
  'address-malformed': ErrorCodes.DD_ADDRESS_INVALID,
  'container-invalid': ErrorCodes.DD_MUTATION_TARGET_INVALID,
  'id-conflict': ErrorCodes.DD_ID_MINT_FAILED,
  'id-exhausted': ErrorCodes.DD_ID_MINT_FAILED,
  'mint-prefix-unregistered': ErrorCodes.DD_ID_MINT_FAILED,
  'schema-refused': ErrorCodes.DD_MUTATION_SCHEMA_REFUSED,
  'section-unknown': ErrorCodes.DD_MUTATION_TARGET_INVALID,
  'target-exists': ErrorCodes.DD_MUTATION_TARGET_INVALID,
  'target-unknown': ErrorCodes.DD_MUTATION_TARGET_INVALID,
  'value-invalid': ErrorCodes.DD_MUTATION_VALUE_INVALID,
};

const NEXT_ACTIONS: Record<DdMutationFailure['reason'], string> = {
  'address-malformed':
    'Generate the address instead of writing it: `harness dd address generate "<interior>" --path <file>`.',
  'container-invalid':
    'Inspect the shape with `harness dd schema show <name>`, then address a container the verb can act on.',
  'id-conflict': 'Drop `--mint`, or remove the `id` from the item and let the CLI mint it.',
  'id-exhausted': 'Use a different registered prefix, or split the document.',
  'mint-prefix-unregistered':
    'Mint under a registered prefix — run `harness dd schema show <name>` to see the shapes that carry ids.',
  'schema-refused': 'Fix the reported location in the value you supplied, then re-run.',
  'section-unknown':
    'Run `harness dd schema show <name>` to see the sections this schema declares.',
  'target-exists': 'Use `harness dd set` to replace a value that is not a list.',
  'target-unknown':
    'Resolve the address first with `harness dd link resolve <address>` to see where it stops.',
  'value-invalid':
    'Supply a value of the declared type, or pass `--value-json` for a structural one.',
};

interface WriterTarget {
  path: string;
  text: string;
  doc: DdDoc;
  record: SchemaRecord;
  segments: string[];
}

/**
 * Resolve `<address>` to the document it names and the schema that governs it.
 *
 * The address is anchored at the REPOSITORY ROOT, exactly as it is for
 * `dd link resolve` and `dd address validate` — an address typed on a command
 * line means the same thing whatever verb is on the line with it.
 */
function readTarget(ctx: DdLinkContext, command: string, address: string): WriterTarget {
  const fail = (
    code: string,
    message: string,
    next_action: string,
    details: Record<string, unknown> = {},
  ): never =>
    exitWithEnvelope(
      formatError(command, code, message, ctx.clock, {
        details: { address, ...details },
        next_action,
      }),
      ctx.port,
    );

  const parsed = parseAddress(address);
  if (isAddressFailure(parsed)) {
    return fail(ErrorCodes.DD_ADDRESS_INVALID, parsed.message, NEXT_ACTIONS['address-malformed']);
  }
  const file = parsed.file;
  if (file === null) {
    return fail(
      ErrorCodes.DD_ADDRESS_INVALID,
      'a bare-"#" address has no document to act on; supply "<path>#<interior>"',
      'Write the address as `<path>#<interior>` — the writer verbs act on a named document.',
    );
  }
  const path = resolveInRepo(file, ctx.repoRoot);
  if (!isPathWithinRepo(path, ctx.repoRoot)) {
    return fail(
      ErrorCodes.DD_LINK_PATH_ESCAPE,
      `address resolves outside the repository: ${path}`,
      'Point the address at a document inside this repository.',
    );
  }

  const text = ctx.fs.readText(path);
  if (text === null) {
    return fail(
      ErrorCodes.DD_DOCUMENT_INVALID,
      `document is missing or unreadable: ${path}`,
      'Check the path, then re-run.',
    );
  }
  const doc = parse(text);
  if (Array.isArray(doc)) {
    return fail(
      ErrorCodes.DD_DOCUMENT_INVALID,
      `${path} is not a dd document`,
      'Fix the reported location, then re-run.',
      { path, failures: doc },
    );
  }
  const resolution = ctx.resolver.resolveDetailed(doc.dd.schema, path);
  const record = resolution.record;
  if (!record) {
    return fail(
      ErrorCodes.DD_SCHEMA_UNRESOLVABLE,
      resolution.issues.find((issue) => issue.severity === 'ERROR')?.message ??
        `schema not found: ${doc.dd.schema}`,
      'Run `harness dd schema list` to see which schemas resolve from here.',
      { path, schema: doc.dd.schema, issues: resolution.issues },
    );
  }
  return { path, text, doc, record, segments: parsed.segments.map((segment) => segment.value) };
}

function refuseMutation(
  ctx: DdLinkContext,
  command: string,
  address: string,
  failure: DdMutationFailure,
): never {
  return exitWithEnvelope(
    formatError(command, MUTATION_CODES[failure.reason], failure.message, ctx.clock, {
      details: {
        address,
        reason: failure.reason,
        written: false,
        ...(failure.introduced && { issues: failure.introduced }),
      },
      next_action: NEXT_ACTIONS[failure.reason],
    }),
    ctx.port,
  );
}

/**
 * Persist a successful mutation and its sibling as ONE operation, or persist
 * neither.
 *
 * The regeneration is not a courtesy. A dd document's `.dd.md` is a derived
 * artifact with a drift gate pointed at it, so a writer that changed the source
 * and left the sibling behind would be manufacturing exactly the failure
 * `dd build --check` exists to catch — and the agent who ran the verb would be
 * blamed for a hand-edit it never made. Best-effort regeneration has the same
 * defect wearing a warning: the envelope still says `written: true`. So a
 * sibling failure is a MUTATION failure here, the source is rolled back, and the
 * caller is told nothing moved.
 */
async function persist(
  ctx: DdLinkContext,
  command: string,
  address: string,
  target: WriterTarget,
  outcome: Extract<DdMutationOutcome, { ok: true }>,
): Promise<never> {
  const text = serializeDoc(outcome.doc, target.text);
  const write = await writeDocumentWithSibling({
    documentPath: target.path,
    text,
    previousText: target.text,
    repoRoot: ctx.repoRoot,
  });
  if (!write.ok) {
    exitWithEnvelope(
      formatError(command, write.code, write.message, ctx.clock, {
        details: {
          address,
          path: target.path,
          stage: write.stage,
          written: false,
          source_restored: write.restored,
          ...(write.details !== undefined && { cause: write.details }),
        },
        next_action: write.restored
          ? write.next_action
          : `The document could not be restored after a failed ${write.stage} write — recover ${target.path} from git before retrying.`,
      }),
      ctx.port,
    );
  }

  return exitWithEnvelope(
    formatOk(
      command,
      {
        address,
        path: target.path,
        trail: outcome.trail,
        kind: outcome.kind,
        value: outcome.value,
        ...(outcome.minted !== undefined && { minted: outcome.minted }),
        written: true,
        sibling_regenerated: true,
      },
      ctx.clock,
      {
        evidence: [{ label: 'document', path: target.path }],
        next_action: `Commit ${target.path} and its regenerated sibling together.`,
      },
    ),
    ctx.port,
  );
}

function mutationDeps(ctx: DdLinkContext, target: WriterTarget): DdMutationDeps {
  return {
    schema: target.record.schema,
    schemaResolver: ctx.resolver,
    repoRoot: ctx.repoRoot,
    path: target.path,
  };
}

/**
 * `dd get | set | add | rm` — the writer family (ac-7019, tk-7028).
 *
 * Ruled FIRST of plan 070's phase 1 so that everything after it, including the
 * journey authoring the plan, mutates documents through the CLI. Three properties
 * are the reason the family exists at all, and each is pinned by a test:
 * validation happens BEFORE the write, the sibling is rebuilt in the same
 * operation, and ids are minted by the CLI so a collision is unrepresentable.
 */
export function registerWriterCommands(dd: Command, io: CliIo, deps: DdActDeps): void {
  dd.command('get <address>')
    .description('Read the value a dd address names')
    .action(async (address: string) => {
      const ctx = await createLinkContext(io, deps, { tracked: false });
      const target = readTarget(ctx, 'dd get', address);
      const outcome = ddGet(target.doc, target.record.schema, target.segments);
      if (!outcome.ok) refuseMutation(ctx, 'dd get', address, outcome);
      const data = {
        address,
        path: target.path,
        trail: outcome.trail,
        kind: outcome.kind,
        value: outcome.value,
      };
      if (io.mode !== 'json') {
        // Human mode prints the VALUE, not a status word. A read verb whose human
        // output is `dd get: ok` has answered a question nobody asked — and the
        // `dd docs get` precedent already rules that a read exits naturally so a
        // large piped payload is never truncated by a hard exit.
        emitRawAndExit(
          `${typeof outcome.value === 'string' ? outcome.value : JSON.stringify(outcome.value, null, 2)}\n`,
          io.writers,
        );
        return;
      }
      exitWithEnvelope(
        formatOk('dd get', data, ctx.clock, {
          next_action: `Change it with \`harness dd set ${address} <value>\`.`,
        }),
        ctx.port,
      );
    });

  dd.command('set <address> <value>')
    .description('Replace the value a dd address names, validating before the write')
    .option('--value-json', 'read <value> as JSON rather than as the declared type')
    .action(async (address: string, value: string, opts: { valueJson?: boolean }) => {
      const ctx = await createLinkContext(io, deps, { tracked: false });
      const target = readTarget(ctx, 'dd set', address);
      const outcome = ddSet(target.doc, target.segments, value, {
        ...mutationDeps(ctx, target),
        asJson: opts.valueJson === true,
      });
      if (!outcome.ok) refuseMutation(ctx, 'dd set', address, outcome);
      await persist(ctx, 'dd set', address, target, outcome);
    });

  dd.command('add <address> <json>')
    .description('Append an item to an addressed list, or create an addressed map entry')
    .option('--mint <prefix>', 'let the CLI mint the item id under a registered prefix')
    .action(async (address: string, json: string, opts: { mint?: string }) => {
      const ctx = await createLinkContext(io, deps, { tracked: false });
      const target = readTarget(ctx, 'dd add', address);
      const outcome = ddAdd(target.doc, target.segments, json, {
        ...mutationDeps(ctx, target),
        ...(opts.mint !== undefined && { mint: opts.mint }),
      });
      if (!outcome.ok) refuseMutation(ctx, 'dd add', address, outcome);
      await persist(ctx, 'dd add', address, target, outcome);
    });

  dd.command('rm <address>')
    .description('Remove the item, entry, field or section a dd address names')
    .action(async (address: string) => {
      const ctx = await createLinkContext(io, deps, { tracked: false });
      const target = readTarget(ctx, 'dd rm', address);
      const outcome = ddRemove(target.doc, target.segments, mutationDeps(ctx, target));
      if (!outcome.ok) refuseMutation(ctx, 'dd rm', address, outcome);
      await persist(ctx, 'dd rm', address, target, outcome);
    });
}
