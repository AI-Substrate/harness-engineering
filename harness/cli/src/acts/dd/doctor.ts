import type { Command } from 'commander';
import type { CliIo } from '../../output/output-port.js';
import { type DdActDeps, exitDdStub } from './shared.js';

export function registerDoctorCommand(dd: Command, io: CliIo, deps: DdActDeps): void {
  dd.command('doctor')
    .description('Sweep deterministic documents at infinite validation radius')
    .action(() => exitDdStub('dd doctor', 'Phase 4: Links, ledger & doctor', io, deps));
}
