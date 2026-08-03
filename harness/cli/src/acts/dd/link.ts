import type { Command } from 'commander';
import type { CliIo } from '../../output/output-port.js';
import { type DdActDeps, exitDdStub } from './shared.js';

export function registerLinkCommands(dd: Command, io: CliIo, deps: DdActDeps): void {
  const link = dd.command('link').description('Resolve links and inspect recorded basis freshness');
  link
    .command('resolve <address>')
    .description('Resolve an address to its document/section/instance target')
    .action(() => exitDdStub('dd link resolve', 'Phase 4: Links, ledger & doctor', io, deps));
  link
    .command('verify-basis <address>')
    .description('Compare a recorded sha with the current target document')
    .requiredOption('--sha <sha>', 'recorded target document sha')
    .action(() => exitDdStub('dd link verify-basis', 'Phase 4: Links, ledger & doctor', io, deps));
}
