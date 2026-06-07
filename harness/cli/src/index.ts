#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { SystemClock } from './adapters/clock/system-clock.js';
import { type Envelope, formatOk } from './output/envelope.js';
import { exitWithEnvelope } from './output/exit.js';
import { createOutputPort, selectMode } from './output/output-port.js';

interface PackageManifest {
  version: string;
}

/**
 * Read the version from the repo-root `package.json`. npm always ships
 * `package.json` in the tarball; from `harness/cli/dist/index.js` it is three
 * levels up — a path that holds both in-repo and when installed via npx.
 */
function readVersion(): string {
  const manifestUrl = new URL('../../../package.json', import.meta.url);
  const manifest = JSON.parse(readFileSync(fileURLToPath(manifestUrl), 'utf8')) as PackageManifest;
  return manifest.version;
}

function orientationEnvelope(version: string): Envelope {
  return formatOk(
    'harness',
    {
      version,
      purpose: "Front door to this repo's engineering harness.",
      next_steps: ['harness help', 'harness doctor'],
    },
    new SystemClock(),
    { next_action: 'Run `harness help` for the command surface (coming in Phase 2).' },
  );
}

export function buildProgram(version: string): Command {
  return new Command()
    .name('harness')
    .description("The agent-friendly front door to this repo's engineering harness.")
    .version(version, '-v, --version')
    .option('--json', 'force JSON output')
    .option('--no-json', 'force human output');
}

/** Tri-state read of the output flag from argv (so env/TTY can decide when absent). */
export function jsonFlag(argv: string[]): boolean | undefined {
  if (argv.includes('--no-json')) {
    return false;
  }
  if (argv.includes('--json')) {
    return true;
  }
  return undefined;
}

export function main(argv: string[] = process.argv): void {
  const version = readVersion();
  const program = buildProgram(version);
  // Command surface (help/doctor/slots) lands in Phase 2. Until then the root
  // action prints an orientation envelope (for `harness`, `harness --json`, etc.),
  // while commander still handles --version / --help and exits.
  program.action(() => {
    const mode = selectMode({ json: jsonFlag(argv) }, process.env, Boolean(process.stdout.isTTY));
    exitWithEnvelope(orientationEnvelope(version), createOutputPort(mode));
  });
  program.parse(argv);
}

main();
