/**
 * WHAT `harness hooks fire` ACCEPTS — declared ONCE, as data (plan 082, F004).
 *
 * THE DEFECT THIS EXISTS TO END. The installer composed
 * `… hooks fire cursor --phase pre --hook-input stdin --hook-owner <marker>`.
 * The `fire` verb registered `--phase` and `--hook-input` and nothing else. Every
 * hook we installed, on every machine, died in commander's argument parser with
 * `error: unknown option '--hook-owner'` and exit 1 — before reaching a single
 * line of our code, and in violation of the exit-0 contract on every tool call.
 *
 * Producer and consumer of one contract, each asserted against its own idea of it.
 * The tests that EXECUTED `fire` typed their own argv; the tests that examined the
 * INSTALLED command treated it as a string. Nothing forced them to meet.
 *
 * So the option set is data, in one place, with THREE readers:
 *
 * 1. `acts/hooks.ts` registers commander options from it — the verb cannot accept
 *    an option that is not declared here;
 * 2. `hooks-verbs.ts` (`statusHooks`) checks the options in an INSTALLED command
 *    against it — so a config naming a flag this binary does not declare is
 *    reported on the user's machine, not only in a fixture;
 * 3. `composed-command.int.test.ts` ignores this file entirely and re-derives the
 *    contract from `hooks fire --help` and from the config the real installer
 *    wrote — because a shared constant makes the two sides agree, and only an
 *    end-to-end read proves the agreement survived into the shipped artifacts.
 *
 * A shared declaration alone would be a third idea of the contract. It is the
 * declaration PLUS the end-to-end row that closes this.
 */

export interface FireOption {
  /** Commander's flag spec, e.g. `--phase <phase>`. */
  readonly flags: string;
  readonly description: string;
}

/**
 * The options `fire` accepts.
 *
 * `--hook-owner` takes an OPTIONAL value (`[marker]`, not `<marker>`) so a
 * hand-edited or truncated config carrying a bare `--hook-owner` is still parsed
 * rather than rejected. The exit-0 contract does not get to depend on a config
 * file being well-formed.
 */
export const FIRE_OPTIONS: readonly FireOption[] = [
  { flags: '--phase <phase>', description: 'pre or post' },
  {
    flags: '--hook-input <source>',
    description: 'where the payload comes from; only `stdin` is supported',
  },
  /*
   * WHY A FILE PATH EXISTS BESIDE STDIN, ON ONE PLATFORM ONLY.
   *
   * MEASURED on Windows PowerShell 5.1: a payload piped into `harness-hook.ps1`
   * does NOT survive the extra `.ps1 -> node` hop. Copilot sends it (captured:
   * 299 bytes PRE, 423 POST), the wrapper's args arrive intact, node starts, and
   * stdin arrives EMPTY. `repoRoot` is then null, the repo guard returns, and the
   * fire is silent: exit 0, no stderr, not one journal line. Reproduced with the
   * wrapper alone, no agent involved, inside a real git repo.
   *
   * The wrapper therefore spills stdin to a temp file BYTE FOR BYTE and names it
   * here. It does NOT pipe: PowerShell 5.1 re-encodes a piped string (UTF-16LE
   * when it redirects, ASCII `$OutputEncoding` when it writes to a native
   * command), which would corrupt any non-ASCII payload AND destroy the wire
   * bytes that `UnparseableDetail.headHex` exists to report. A hop that silently
   * "fixes" a BOM is the same class of defect as the one this whole plan removes.
   *
   * POSIX is unaffected and keeps using stdin — the `.sh` twin passes it through
   * correctly (measured on macOS and Linux). The asymmetry is the platform's, not
   * a preference.
   */
  {
    flags: '--hook-input-file <path>',
    description:
      'read the payload from this file instead of stdin; takes precedence over --hook-input',
  },
  {
    flags: '--hook-owner [marker]',
    description:
      'provenance only — identifies the entry as ours. Accepted and deliberately ignored.',
  },
];

/** Just the long names, for checking a command string against what we accept. */
export const FIRE_OPTION_NAMES: readonly string[] = FIRE_OPTIONS.map(
  (option) => option.flags.split(/\s+/)[0],
);

/**
 * The option tokens a command string passes to `fire`, in order.
 *
 * SCOPED TO WHAT THE VERB ACTUALLY RECEIVES — everything after the literal `hooks`
 * token (plan 082 F010 F5). The invocation in front of the script belongs to the
 * INTERPRETER, not to us: `--no-warnings` is Node's flag, `fire` has no business
 * declaring it, and a scan of the whole string reported it as an option this binary
 * does not accept. `status` then said `unknown-options` for every healthy install —
 * a drift report about our own command, which is the same shape as the defects this
 * review found: a reader whose scope was wider than the state it judged.
 *
 * Deliberately naive WITHIN that scope — anything starting with `--` is an option
 * token. It is used to ASK a question about a command, never to execute one, so
 * over-reporting a `--`-prefixed value would be a false alarm and under-reporting
 * would be a miss; the installer never emits a `--`-prefixed value, and a hand-edit
 * that does gets the false alarm, which is the safe direction.
 */
export function optionTokensIn(command: string): string[] {
  const tokens = command
    .split(/\s+/)
    .map((token) => token.replace(/^['"]+|['"]+$/g, ''))
    .filter((token) => token.length > 0);
  // A command that never reaches the verb passes nothing to `fire`; scanning it
  // whole would judge an interpreter's flags as ours.
  const verbAt = tokens.indexOf('hooks');
  return (verbAt === -1 ? [] : tokens.slice(verbAt + 1)).filter((token) => token.startsWith('--'));
}

/** Options a command names that this binary's `fire` does not declare. */
export function unacceptedOptions(command: string): string[] {
  const accepted = new Set(FIRE_OPTION_NAMES);
  return [...new Set(optionTokensIn(command).filter((token) => !accepted.has(token)))];
}
