import type { Command } from 'commander';
import type { CliIo } from '../../output/output-port.js';
import { registerAddressCommands } from './address.js';
import { registerBuildCommand } from './build.js';
import { registerDocsCommands } from './docs.js';
import { registerDoctorCommand } from './doctor.js';
import { registerGraphCommand } from './graph.js';
import { registerLinkCommands } from './link.js';
import { registerLinksCommand } from './links.js';
import { registerSchemaCommands } from './schema.js';
import type { DdActDeps } from './shared.js';
import { registerValidateCommand } from './validate.js';
import { registerWriterCommands } from './write.js';

export function registerDdAct(program: Command, io: CliIo, deps: DdActDeps): void {
  const dd = program
    .command('dd')
    .description('Validate, render, address, and inspect deterministic documents');
  registerValidateCommand(dd, io, deps);
  registerSchemaCommands(dd, io, deps);
  registerDocsCommands(dd, io, deps);
  registerBuildCommand(dd, io, deps);
  registerAddressCommands(dd, io, deps);
  registerLinkCommands(dd, io, deps);
  registerLinksCommand(dd, io, deps);
  registerGraphCommand(dd, io, deps);
  registerDoctorCommand(dd, io, deps);
  registerWriterCommands(dd, io, deps);
}
