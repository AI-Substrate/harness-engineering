import type { SkillsInstallOptions } from './contract.js';

/**
 * Pure `npx skills add …` argv builder — the one place the Vercel `skills` flag
 * surface is encoded (Principle 8: wrap, don't rebuild). No I/O, no child spawn:
 * the act feeds the returned argv to the injected `ExecPort`, and tests assert
 * the exact array (Principle 3). The returned array is the args AFTER `npx`, i.e.
 * `['skills@latest', 'add', <source>, '-a', <t>, …, '-g'?, '-s', <slug>, …, '-y']`.
 *
 * Invariants (AC3/AC4):
 *   - always pins `skills@latest` and always appends `-y` (unless `yes === false`)
 *     so the blocking interactive picker never appears;
 *   - each target fans out as a repeated `-a <target>`;
 *   - `-g` is present iff `global` is true.
 */
export function buildInstallArgv(opts: SkillsInstallOptions): string[] {
  const argv: string[] = ['skills@latest', 'add', opts.source];
  for (const target of opts.targets) {
    argv.push('-a', target);
  }
  if (opts.global) {
    argv.push('-g');
  }
  for (const slug of opts.skills ?? []) {
    argv.push('-s', slug);
  }
  if (opts.yes !== false) {
    argv.push('-y');
  }
  return argv;
}

/** The human-readable command line we announce before running (and echo in the JSON envelope). */
export function formatInstallCommand(argv: string[]): string {
  return `npx ${argv.join(' ')}`;
}
