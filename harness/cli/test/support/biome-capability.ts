import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * CAN BIOME ACTUALLY RUN ON THIS HOST? — one probe (plan 087).
 *
 * ## Why this exists
 *
 * `@biomejs/biome` **2.5.2 through 2.5.7 crashes on `win32-arm64`** — `0xC0000005`
 * ACCESS_VIOLATION the moment it does analysis, with **stdout and stderr both empty**
 * (upstream `biomejs/biome#11242`, mechanism `mimalloc` v3.3.1 via `libmimalloc-sys`
 * 0.1.47). x64 is unaffected, macOS is unaffected.
 *
 * Anything that shells out to biome therefore fails on that one platform for a reason
 * that has nothing to do with the property under test. Measured on the Windows ARM64
 * VM: `dd-docs-drift`'s end-to-end row went red with `gen-dd-docs: biome format failed`
 * while the same gate is green on macOS and on x64 CI.
 *
 * ## A CAPABILITY PROBE, NOT A PLATFORM TEST — and that distinction is load-bearing
 *
 * `platform() === 'win32' && arch() === 'arm64'` would encode **today's** bug list. It
 * would keep skipping after the upstream fix lands, silently, and it would not catch
 * the next host where biome cannot run for a different reason. So this asks the only
 * question that matters — *does biome complete a trivial format here* — and answers it
 * from behaviour. When upstream fixes the crash this probe starts returning `true` on
 * that host with **no edit here**, which is the property a version check cannot have.
 *
 * Same convention as {@link ./symlink-capability.ts} and {@link ./posix-shell.ts}.
 */
export const BIOME_CAPABLE: boolean = (() => {
  try {
    const bin = fileURLToPath(
      new URL('../../../../node_modules/@biomejs/biome/bin/biome', import.meta.url),
    );
    /*
     * VIA STDIN, DELIBERATELY. A first version wrote a temp file under `os.tmpdir()`
     * and formatted that - biome refused it with "No files were processed in the
     * specified paths", because a path outside the project is not covered by
     * `biome.json`. That is a CONFIG SCOPING answer, not a capability answer, and it
     * made the probe report "biome cannot run" ON MACOS, silently disabling the gate
     * on every host instead of the one that needed it. Caught because the row skipped
     * on a machine where biome demonstrably works.
     *
     * `--stdin-file-path` names a virtual path for rule resolution while the content
     * arrives on stdin, so nothing depends on where a temp file happens to live.
     */
    const formatted = execFileSync(
      process.execPath,
      [bin, 'format', '--stdin-file-path=probe.ts'],
      {
        input: 'export const x  =    1\n',
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    /*
     * ASSERT THE WORK HAPPENED, never merely that the process exited 0. The input is
     * mis-formatted on purpose, so a run that did real analysis MUST return it
     * normalised. Exit 0 alone would also be returned by a build that processed
     * nothing - which is exactly the failure this probe already made once.
     */
    return formatted.trim() === 'export const x = 1;';
  } catch {
    return false;
  }
})();
