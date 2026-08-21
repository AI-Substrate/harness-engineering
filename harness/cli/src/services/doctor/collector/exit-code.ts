/**
 * Exit codes that are not exit codes (plan 082 · F007b).
 *
 * MEASURED, on a Windows 11 guest running the pinned git-ai release, 2026-08-10:
 *
 *     install-hooks exited 3221225781
 *
 * That is the whole message an operator got. `3221225781` is `0xC0000135`,
 * STATUS_DLL_NOT_FOUND — a Windows NTSTATUS, not a program's chosen exit code.
 * The loader killed the process before a single line of git-ai's own code ran,
 * which is exactly why its stderr was EMPTY and our message could only quote the
 * number.
 *
 * Two facts make that number worth translating:
 *
 * - **Empty stderr is the signature, not an accident.** A process the OS
 *   terminates during load has not opened its own error path yet. So "non-zero
 *   AND said nothing" is the observable shape of "never started", and it is a
 *   different operator action from "ran and refused".
 * - **`3221225781` is un-Googleable in a way `0xC0000135` is not.** The decimal
 *   is what the process reports and what a reader will paste back at us, so both
 *   are printed; only the hex is searchable.
 *
 * DELIBERATELY THREE CODES AND A FALLBACK, not an NTSTATUS table. The named
 * three are the ones a shipped binary actually dies of on a user machine; a
 * fourth hundred would be transcription, not knowledge, and every untranslated
 * code still gets the one thing that is always true of this class.
 */

/** `0xC0000000` — the floor of the NTSTATUS *error* severity range, unsigned. */
export const NTSTATUS_ERROR_FLOOR = 0xc000_0000;

/**
 * Causes we can name. UNVERIFIED except where stated: the exit code and the
 * empty stderr are measured; only `0xC0000135`'s cause has been measured, by
 * fixing it (see below).
 */
const NAMED: ReadonlyMap<number, { name: string; because: string }> = new Map([
  [
    0xc000_0135,
    {
      name: 'STATUS_DLL_NOT_FOUND',
      // MEASURED CAUSE, and the only one here that is. On the Windows 11 guest
      // of 2026-08-10, installing `Microsoft.VCRedist.2015+.x64` turned this
      // exact failure into `git-ai hooks: installed` with no other change.
      because:
        'a DLL the binary needs is missing, so it never started. On a clean Windows box this is usually the Microsoft Visual C++ Redistributable, which Windows does not ship — installing it (`winget install Microsoft.VCRedist.2015+.x64`) fixed exactly this failure on a Windows 11 guest on 2026-08-10',
    },
  ],
  [
    0xc000_0142,
    {
      name: 'STATUS_DLL_INIT_FAILED',
      because:
        'a DLL the binary needs was found but failed to initialise, so it never reached its own code',
    },
  ],
  [
    0xc000_0005,
    {
      name: 'STATUS_ACCESS_VIOLATION',
      because: 'the process crashed with an access violation',
    },
  ],
]);

/** Is this exit code an NTSTATUS error rather than a value a program chose? */
export function isNtStatusError(code: number): boolean {
  return Number.isInteger(code) && code >= NTSTATUS_ERROR_FLOOR && code <= 0xffff_ffff;
}

/** `0xC0000135` — upper case, zero padded, the form that is searchable. */
export function ntStatusHex(code: number): string {
  return `0x${code.toString(16).toUpperCase().padStart(8, '0')}`;
}

/**
 * How a process ended, in words, from ONLY the two things we observed: its exit
 * code and whether it said anything.
 *
 * THE VENDOR'S OWN WORDS ALWAYS LEAD. When stderr has content the process was
 * plainly alive enough to speak, so the NTSTATUS class sentence would be false —
 * all we add there is the searchable hex. We are adding context, never replacing
 * evidence.
 */
export function describeExit(code: number, stderr: string): string {
  const said = stderr.trim().split('\n')[0] ?? '';
  const nt = isNtStatusError(code);
  if (said !== '') return `exited ${code}${nt ? ` (${ntStatusHex(code)})` : ''}: ${said}`;
  if (!nt) return `exited ${code} and produced no output`;
  const known = NAMED.get(code);
  return known === undefined
    ? `exited ${code} (${ntStatusHex(code)}) and produced no output — that is a Windows NTSTATUS, so the process was terminated by the OS before it could report anything`
    : `exited ${code} (${ntStatusHex(code)}) and produced no output — that is a Windows NTSTATUS, ${known.name}: ${known.because}`;
}
