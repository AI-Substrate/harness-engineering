import type { SkillsInstallOptions } from './contract.js';

/**
 * Pure `npx skills add …` argv builder — the one place the Vercel `skills` flag
 * surface is encoded (Principle 8: wrap, don't rebuild). No I/O, no child spawn:
 * the act feeds the returned argv to the injected `ExecPort`, and tests assert
 * the exact array (Principle 3). The returned array is the args AFTER `npx`, i.e.
 * `['skills@latest', 'add', <source>, '-a', <t>, …, '-g'?, '-s', <slug>, …, '-y']`.
 *
 * Invariants (AC3/AC4):
 *   - always pins `skills@latest` and always appends `-y` (UNCONDITIONALLY — the
 *     builder makes it impossible to construct a blocking invocation, so the
 *     interactive picker never appears regardless of caller input);
 *   - each target fans out as a repeated `-a <target>`;
 *   - `-g` is present iff `global` is true.
 *
 * Precondition: `targets` is non-empty — enforced by the act (missing `--target`
 * → `E108`) before this is ever called.
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
  // Unconditional: never let the Vercel interactive picker block (AC3).
  argv.push('-y');
  return argv;
}

/** The human-readable command line we announce before running (and echo in the JSON envelope). */
export function formatInstallCommand(argv: string[]): string {
  return `npx ${argv.join(' ')}`;
}
