import type { Command } from 'commander';
import { SystemClock } from '../../adapters/clock/system-clock.js';
import { NodeEnv } from '../../adapters/env/node-env.js';
import { NodeProcess } from '../../adapters/process/node-process.js';
import { type Envelope, formatDegraded, formatError, formatOk } from '../../output/envelope.js';
import { ErrorCodes } from '../../output/error-codes.js';
import { exitWithEnvelope } from '../../output/exit.js';
import { type CliIo, createOutputPort, type OutputPort } from '../../output/output-port.js';
import { BUILTIN_RELS } from '../../services/dd/core/constants.js';
import { collectDeclaredRels } from '../../services/dd/core/rel.js';
import { BUILTIN_COMPLETION_ENUM } from '../../services/dd/schema/declarations.js';
import type {
  SchemaIssue,
  SchemaIssueClass,
  SchemaRecord,
} from '../../services/dd/schema/model.js';
import { ConventionSchemaResolver } from '../../services/dd/schema/resolve.js';
import { toPosix } from '../../services/shared/posix-path.js';
import { NodeSchemaFs } from './schema-fs.js';
import type { DdActDeps } from './shared.js';

/** Schema-layer issue class → frozen E-code (P1 allocation; Phase 2 adds none). */
const SCHEMA_ISSUE_CODES: Record<SchemaIssueClass, string> = {
  'enum-invalid': ErrorCodes.DD_SCHEMA_ENUM_INVALID,
  'name-conflict': ErrorCodes.DD_SCHEMA_NAME_CONFLICT,
  'package-invalid': ErrorCodes.DD_SCHEMA_PACKAGE_INVALID,
  'path-escape': ErrorCodes.DD_SCHEMA_PATH_ESCAPE,
  'rel-invalid': ErrorCodes.DD_REL_INVALID,
  'scan-failed': ErrorCodes.DD_SCHEMA_SCAN_FAILED,
  'schema-not-found': ErrorCodes.DD_SCHEMA_NOT_FOUND,
  shadowed: ErrorCodes.DD_SCHEMA_SHADOWED,
  'version-unsupported': ErrorCodes.DD_SCHEMA_VERSION_UNSUPPORTED,
};

function coded(issues: readonly SchemaIssue[]) {
  return issues.map((issue) => ({ ...issue, code: SCHEMA_ISSUE_CODES[issue.class] }));
}

/** Paths are ALWAYS shown — a schema you cannot locate is a schema you cannot trust. */
function summarise(record: SchemaRecord) {
  return {
    name: record.name,
    description: record.description,
    version: record.version,
    path: record.path,
    root: record.root,
    shadows: record.shadows.map((shadow) => ({ root: shadow.root, path: shadow.path })),
  };
}

function describe(record: SchemaRecord) {
  return {
    ...summarise(record),
    gate_terminal: [...record.gateTerminal],
    sections: Object.entries(record.schema.sections).map(([name, section]) => ({
      name,
      required: section.required === true,
      type: section.shape.type,
    })),
    enums: Object.entries(record.schema.enums ?? {}).map(([name, declared]) => ({
      name,
      values: [...declared.values],
      ...(declared.gate_terminal && { gate_terminal: [...declared.gate_terminal] }),
    })),
    relations: collectDeclaredRels(record.schema),
    builtin_rels: [...BUILTIN_RELS],
    builtin_completion_enum: {
      values: [...BUILTIN_COMPLETION_ENUM.values],
      gate_terminal: [...(BUILTIN_COMPLETION_ENUM.gate_terminal ?? [])],
    },
  };
}

type ShowData = ReturnType<typeof describe>;

interface ListData {
  roots: { kind: string; path: string }[];
  schemas: ReturnType<typeof summarise>[];
  issues: ReturnType<typeof coded>;
}

function buildResolver(): ConventionSchemaResolver {
  const home = new NodeEnv().home();
  return new ConventionSchemaResolver({
    fs: new NodeSchemaFs(),
    repoRoot: toPosix(new NodeProcess().cwd()),
    ...(home !== undefined && { home: toPosix(home) }),
  });
}

/** JSON mode is the envelope; human mode gets a real listing instead of `status: ok`. */
function schemaPort(io: CliIo, render: (envelope: Envelope) => string): OutputPort {
  if (io.mode === 'json') return createOutputPort('json', io.writers);
  return {
    emit: (envelope) => {
      if (envelope.status === 'error') {
        io.writers.err(`${envelope.command}: ${envelope.error?.message ?? 'failed'}\n`);
        if (envelope.next_action) io.writers.err(`  → ${envelope.next_action}\n`);
        return;
      }
      io.writers.out(render(envelope));
    },
  };
}

function renderList(data: ListData): string {
  const lines = ['harness dd schema — resolved schemas', ''];
  if (data.schemas.length === 0) lines.push('  (none found)');
  for (const schema of data.schemas) {
    lines.push(`  ${schema.name}  [${schema.root}]`);
    lines.push(`    ${schema.description || '(no description)'}`);
    lines.push(`    ${schema.path}`);
    for (const shadow of schema.shadows) {
      lines.push(`    shadowed: ${shadow.path} [${shadow.root}]`);
    }
  }
  for (const issue of data.issues) {
    lines.push(`  ! ${issue.code} ${issue.message}`);
  }
  lines.push('', 'Roots searched (precedence order):');
  for (const root of data.roots) lines.push(`  ${root.kind}: ${root.path}`);
  return `${lines.join('\n')}\n`;
}

function renderShow(data: ShowData): string {
  const lines = [
    `${data.name}  [${data.root}]`,
    data.description || '(no description)',
    data.path,
    '',
    `dd_schema: ${data.version}`,
    `gate_terminal: ${data.gate_terminal.join(', ')}`,
    '',
    'Sections:',
  ];
  for (const section of data.sections) {
    lines.push(`  ${section.name}${section.required ? ' (required)' : ''}: ${section.type}`);
  }
  if (data.enums.length > 0) {
    lines.push('', 'Enums:');
    for (const declared of data.enums) {
      const terminal = declared.gate_terminal
        ? ` — gate_terminal: ${declared.gate_terminal.join(', ')}`
        : '';
      lines.push(`  ${declared.name}: ${declared.values.join(', ')}${terminal}`);
    }
  }
  if (data.relations.length > 0) {
    lines.push('', `Link relations (built-in set: ${data.builtin_rels.join(', ')}):`);
    for (const relation of data.relations) {
      const target = relation.target ? ` -> ${relation.target}` : '';
      lines.push(
        `  ${relation.field}: ${relation.rel}${relation.builtin ? '' : ' (unknown — behaves as ref)'}${target}`,
      );
    }
  }
  if (data.shadows.length > 0) {
    lines.push('', 'Shadowed duplicates (lower precedence):');
    for (const shadow of data.shadows) lines.push(`  ${shadow.path} [${shadow.root}]`);
  }
  return `${lines.join('\n')}\n`;
}

export function registerSchemaCommands(dd: Command, io: CliIo, deps: DdActDeps): void {
  const schema = dd
    .command('schema')
    .description('Inspect resolved deterministic-document schemas');
  schema
    .command('list')
    .description('List resolved schemas and shadowed duplicates')
    .action(() => {
      const clock = deps.clock ?? new SystemClock();
      const listing = buildResolver().list();
      const records = listing.entries.flatMap((entry) => (entry.record ? [entry.record] : []));
      const issues = coded([
        ...listing.issues,
        ...listing.entries.flatMap((entry) => (entry.record ? [] : entry.issues)),
      ]);
      const data: ListData = {
        roots: listing.roots.map((root) => ({ kind: root.kind, path: root.path })),
        schemas: records.map(summarise),
        issues,
      };
      const port = schemaPort(io, (envelope) => renderList(envelope.data as ListData));

      const fatal = issues.find((issue) => issue.class === 'scan-failed');
      if (fatal) {
        exitWithEnvelope(
          formatError('dd schema list', fatal.code, fatal.message, clock, {
            details: data,
            next_action: 'Fix the unreadable discovery root, then re-run `harness dd schema list`.',
          }),
          port,
        );
      }
      const shadowing = records.filter((record) => record.shadows.length > 0);
      if (issues.length > 0 || shadowing.length > 0) {
        exitWithEnvelope(
          formatDegraded(
            'dd schema list',
            data,
            issues.length > 0
              ? `${issues.length} schema package(s) could not be loaded — see data.issues.`
              : `${shadowing.length} schema(s) shadow a lower-precedence copy; run \`harness dd schema show <name>\` for the chain.`,
            clock,
          ),
          port,
        );
      }
      exitWithEnvelope(
        formatOk('dd schema list', data, clock, {
          next_action: 'Run `harness dd schema show <name>` for one schema in full.',
        }),
        port,
      );
    });
  schema
    .command('show <name>')
    .description('Show one qualified schema and its resolved path')
    .action((name: string) => {
      const clock = deps.clock ?? new SystemClock();
      const resolution = buildResolver().resolveDetailed(name);
      const issues = coded(resolution.issues);
      const port = schemaPort(io, (envelope) => renderShow(envelope.data as ShowData));

      if (!resolution.record) {
        const blocking = issues.find((issue) => issue.severity === 'ERROR');
        exitWithEnvelope(
          formatError(
            'dd schema show',
            blocking?.code ?? ErrorCodes.DD_SCHEMA_NOT_FOUND,
            blocking?.message ?? `schema "${name}" was not found`,
            clock,
            {
              details: { name, issues },
              next_action: 'Run `harness dd schema list` to see every resolvable schema.',
            },
          ),
          port,
        );
      }

      const data = { ...describe(resolution.record), issues };
      if (issues.length > 0) {
        exitWithEnvelope(
          formatDegraded(
            'dd schema show',
            data,
            `${issues.length} lower-precedence copy/copies are shadowed — confirm the winning path is the one you meant.`,
            clock,
          ),
          port,
        );
      }
      exitWithEnvelope(
        formatOk('dd schema show', data, clock, {
          next_action: 'Run `harness dd validate <path>` against a document using this schema.',
        }),
        port,
      );
    });
}
