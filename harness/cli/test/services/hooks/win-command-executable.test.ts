import { describe, expect, it } from 'vitest';
import { hookInvocation } from '../../../src/acts/hooks.js';
import { AGENT_MATRIX } from '../../../src/services/hooks/agent-matrix.js';
import {
  extractBinaryPath,
  extractInterpreterPath,
  normaliseBinaryPath,
} from '../../../src/services/hooks/binary-path.js';
import { commandTokens } from '../../../src/services/hooks/hook-marker.js';
import { buildEntry } from '../../../src/services/hooks/install-strategy-a.js';

/**
 * THE FIRST TOKEN OF `command` MUST BE A NATIVE EXECUTABLE ON THIS PLATFORM.
 *
 * ## The defect this exists to make impossible (plan 088)
 *
 * `command` is the field EVERY agent reads. Plan 085 shipped two wrappers and wrote
 * the POSIX one — `harness-hook.sh` — into `command` for every agent on every
 * platform. The `.ps1` went only into the separate `powershell` field, which only
 * `github-copilot` carries. So on Windows FOUR OF FIVE AGENTS got a hook that cannot
 * execute, and copilot survived by accident of reading a different field.
 *
 * MEASURED on the Windows VM, each candidate spawned two ways:
 *
 * | first token              | direct spawn      | via a shell               |
 * |-------------------------|-------------------|---------------------------|
 * | `harness-hook.sh`       | `null`, EFTYPE    | **exit 0 — and a lie**    |
 * | `harness-hook.cmd`      | `null`, EINVAL    | exit 0, ran               |
 * | `powershell.exe -File …`| exit 0, resolved  | exit 0, resolved          |
 *
 * The shell row is the dangerous one: Windows resolves `.sh` through the
 * `sh_auto_file` association to `git-bash.exe`, which returns SUCCESS having done
 * none of our work. A hook's contract is exit 0 and silence, so a hook that cannot
 * run is byte-for-byte indistinguishable from one that is not installed.
 *
 * ## Why this is a TEST and not a comment
 *
 * This plan has now watched a boundary-in-prose fail twice: `hook-wrapper.int.test.ts`
 * declared "WINDOWS IS NOT COVERED HERE" at its line 24 while nothing enforced it, and
 * the parity writeup asserted we matched git-ai without naming WHICH of its properties
 * mattered. git-ai is immune to this bug because its `command` is a native `.exe` —
 * we copied its field layout and not the property that was load-bearing.
 *
 * **When you take parity from another implementation, name the properties you rely
 * on; the ones you do not name are the ones you did not copy.** So the property is
 * asserted per agent per platform, and the next agent added — or the next platform —
 * re-introduces this defect loudly instead of silently.
 *
 * A `.cmd` would NOT satisfy this and that is deliberate: Node refuses to spawn
 * `.cmd`/`.bat` without `shell: true` (CVE-2024-27980), so it fails the same class of
 * caller one step further along. It is a script a shell interprets, not an executable.
 */

/** A wrapper directory where both twins exist — the shape a real install has. */
const bothWrappersPresent = { exists: () => true } as const;

/** Neither wrapper shipped — the fallback path, which must ALSO stay executable. */
const noWrappers = { exists: () => false } as const;

const firstTokenOf = (command: string): string => commandTokens(command)[0] ?? '';

/**
 * Is this token something the OS can execute DIRECTLY on `platform`?
 *
 * On win32 that means a real executable image — `.exe`. A bare script path is not
 * one, whatever its extension, which is the entire finding. Elsewhere a POSIX shell
 * script with a shebang is directly executable, so the `.sh` qualifies.
 */
const isNativelyExecutable = (token: string, platform: NodeJS.Platform): boolean =>
  platform === 'win32'
    ? token.toLowerCase().replace(/^"|"$/g, '').endsWith('.exe')
    : !token.toLowerCase().endsWith('.cmd') && !token.toLowerCase().endsWith('.bat');

describe('the emitted command starts with something the platform can EXECUTE', () => {
  it('win32: names a native .exe first, never a bare script', () => {
    const command = hookInvocation(bothWrappersPresent, 'win32');

    expect(isNativelyExecutable(firstTokenOf(command), 'win32'), command).toBe(true);
    // It must still REACH our wrapper - an executable first token that runs the wrong
    // thing would pass the line above and fix nothing.
    expect(command).toContain('harness-hook.ps1');
    // And it must not carry a policy flag: measured RemoteSigned on the target box,
    // under which our zone-unmarked npm-installed .ps1 runs clean. `Bypass` would be a
    // security posture nobody asked for, quietly baked into every Windows install.
    expect(command).not.toContain('ExecutionPolicy');
  });

  it('posix: still names the .sh wrapper directly', () => {
    const command = hookInvocation(bothWrappersPresent, 'darwin');

    expect(firstTokenOf(command)).toContain('harness-hook.sh');
    expect(isNativelyExecutable(firstTokenOf(command), 'darwin'), command).toBe(true);
  });

  it('win32 with NO wrapper shipped: the fallback is still executable', () => {
    /*
    Test Doc:
    - Why: the wrapper is probed, never assumed - a partial copy or a packaging change
      can remove it. The fallback names the interpreter and the script, and the
      interpreter is `process.execPath`, a real binary. If that ever regressed to a
      bare `.js` first token it would be dispatched by FILE ASSOCIATION to WScript.exe,
      which opens our ES module, cannot run it, and EXITS 0 - the F008 defect, and the
      same silent-success shape as the `.sh`.
    - Contract: whatever the fallback emits, its first token is executable.
    */
    const command = hookInvocation(noWrappers, 'win32');

    /*
     * ASSERTED AS "NAMES THE INTERPRETER", NOT AS "ENDS IN .exe", because this row
     * SIMULATES win32 from whatever host runs the suite. On a real Windows box
     * `process.execPath` IS `node.exe`; on the macOS gate it is `.../bin/node`, so an
     * extension check here would be testing the HOST rather than the product - a
     * simulation artifact masquerading as a finding.
     *
     * The property that is true on every host: the first token is the INTERPRETER
     * (a real binary by construction), never the script.
     */
    // Read through the QUOTE-AWARE extractor, never by splitting on whitespace:
    // `process.execPath` on Windows is `C:\Program Files\nodejs\node.exe`, which
    // contains a SPACE, and the naive split reported `C:/Program` as the first token.
    // Normalised, because that is the form we embed on every platform.
    expect(extractInterpreterPath(command)).toBe(normaliseBinaryPath(process.execPath));
    /*
     * THE F008 PROPERTY: the leading token is the INTERPRETER, never the script.
     *
     * A bare `.js` first token is dispatched by FILE ASSOCIATION to WScript.exe, which
     * opens our ES module, cannot run it, and EXITS 0 - the same silent-success shape
     * as the `.sh` this plan removes. Asserted as "the two tokens are DIFFERENT paths",
     * not as "the script is not a .js": under vitest `process.argv[1]` is the runner's
     * own `forks.js`, so an extension check here grades the TEST RUNNER rather than the
     * product, and went red for that reason.
     */
    expect(extractBinaryPath(command)).not.toBe(extractInterpreterPath(command));
  });

  it.each(
    AGENT_MATRIX.filter((spec) => spec.supported).map((spec) => [spec.agent, spec] as const),
  )('%s: every emitted entry on win32 leads with a native executable', (agent, spec) => {
    /*
      Test Doc:
      - Why: THE PER-AGENT LOOP IS THE POINT. The defect was not that the command was
        wrong in general - it was that ONE agent (github-copilot) read a different
        field and escaped, which made the whole class survive review. A row per agent
        means the next agent added cannot inherit the broken shape silently.
      - Contract: for both phases, the `command` field leads with a native executable,
        and so does the `powershell` field where an agent carries one.
      */
    const invocation = hookInvocation(bothWrappersPresent, 'win32');

    for (const phase of ['pre', 'post'] as const) {
      const entry = buildEntry(spec, invocation, phase) as Record<string, unknown>;
      const nested = (entry.hooks as Array<Record<string, unknown>> | undefined)?.[0];
      const command = String((nested ?? entry).command ?? '');

      expect(command, `${agent} ${phase}: no command emitted`).not.toBe('');
      expect(
        isNativelyExecutable(firstTokenOf(command), 'win32'),
        `${agent} ${phase}: command must lead with a native executable, got: ${command}`,
      ).toBe(true);

      const powershell = (nested ?? entry).powershell;
      if (typeof powershell === 'string') {
        // The powershell field is invoked BY PowerShell, so its call operator form
        // is correct there - it must simply still name our wrapper rather than a
        // path this platform cannot run.
        expect(powershell, `${agent} ${phase}: powershell field lost the wrapper`).toContain(
          'harness-hook.ps1',
        );
      }
    }
  });
});
