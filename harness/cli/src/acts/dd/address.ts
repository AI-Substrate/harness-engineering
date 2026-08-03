import type { Command } from 'commander';
import type { CliIo } from '../../output/output-port.js';
import { type DdActDeps, exitDdStub } from './shared.js';

export function registerAddressCommands(dd: Command, io: CliIo, deps: DdActDeps): void {
  const address = dd.command('address').description('Generate and validate canonical dd addresses');
  address
    .command('generate <interior>')
    .description('Generate an address from an alternating name/id interior')
    .option('--path <path>', 'target .dd.json path (omit for bare-# same-document form)')
    .action(() => exitDdStub('dd address generate', 'Phase 4: Links, ledger & doctor', io, deps));
  address
    .command('validate <address>')
    .description('Validate address syntax and optionally resolve its target')
    .option('--resolve', 'also resolve the target against the repository')
    .action(() => exitDdStub('dd address validate', 'Phase 4: Links, ledger & doctor', io, deps));
}
