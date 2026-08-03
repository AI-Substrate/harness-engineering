import type { Command } from 'commander';
import type { CliIo } from '../../output/output-port.js';
import { type DdActDeps, exitDdStub } from './shared.js';

export function registerGraphCommand(dd: Command, io: CliIo, deps: DdActDeps): void {
  dd.command('graph')
    .description('Emit a standalone mermaid view of the repository dd graph')
    .action(() => exitDdStub('dd graph', 'Phase 4: Links, ledger & doctor', io, deps));
}
