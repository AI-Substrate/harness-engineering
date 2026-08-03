import type { Command } from 'commander';
import type { CliIo } from '../../output/output-port.js';
import { type DdActDeps, exitDdStub } from './shared.js';

export function registerValidateCommand(dd: Command, io: CliIo, deps: DdActDeps): void {
  dd.command('validate <path>')
    .description('Validate one deterministic document and its outbound neighbourhood')
    .option('--depth <n>', 'outbound traversal depth (0 = this document only)', '3')
    .action(() => exitDdStub('dd validate', 'Phase 2: Schema layer & baked docs', io, deps));
}
