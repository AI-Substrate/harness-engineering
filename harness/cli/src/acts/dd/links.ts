import type { Command } from 'commander';
import type { CliIo } from '../../output/output-port.js';
import { type DdActDeps, exitDdStub } from './shared.js';

export function registerLinksCommand(dd: Command, io: CliIo, deps: DdActDeps): void {
  dd.command('links <target>')
    .description('Report inbound and outbound links for one address or document')
    .action(() => exitDdStub('dd links', 'Phase 4: Links, ledger & doctor', io, deps));
}
