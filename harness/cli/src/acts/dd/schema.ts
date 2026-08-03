import type { Command } from 'commander';
import type { CliIo } from '../../output/output-port.js';
import { type DdActDeps, exitDdStub } from './shared.js';

export function registerSchemaCommands(dd: Command, io: CliIo, deps: DdActDeps): void {
  const schema = dd
    .command('schema')
    .description('Inspect resolved deterministic-document schemas');
  schema
    .command('list')
    .description('List resolved schemas and shadowed duplicates')
    .action(() => exitDdStub('dd schema list', 'Phase 2: Schema layer & baked docs', io, deps));
  schema
    .command('show <name>')
    .description('Show one qualified schema and its resolved path')
    .action(() => exitDdStub('dd schema show', 'Phase 2: Schema layer & baked docs', io, deps));
}
