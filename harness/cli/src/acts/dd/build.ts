import type { Command } from 'commander';
import type { CliIo } from '../../output/output-port.js';
import { type DdActDeps, exitDdStub } from './shared.js';

export function registerBuildCommand(dd: Command, io: CliIo, deps: DdActDeps): void {
  dd.command('build <path>')
    .description('Render one .dd.json file to its deterministic .dd.md sibling')
    .option('--check', 'report byte drift without writing')
    .action(() => exitDdStub('dd build', 'Phase 3: Render, adapters & freshness', io, deps));
}
