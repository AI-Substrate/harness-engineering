import type { Command } from 'commander';
import type { CliIo } from '../../output/output-port.js';
import { type DdActDeps, exitDdStub } from './shared.js';

export function registerDocsCommands(dd: Command, io: CliIo, deps: DdActDeps): void {
  const docs = dd.command('docs').description('Read baked deterministic-document guidance');
  docs
    .command('list')
    .description('List baked dd documentation entries')
    .action(() => exitDdStub('dd docs list', 'Phase 2: Schema layer & baked docs', io, deps));
  docs
    .command('get <id>')
    .description('Print one baked dd documentation entry')
    .action(() => exitDdStub('dd docs get', 'Phase 2: Schema layer & baked docs', io, deps));
}
