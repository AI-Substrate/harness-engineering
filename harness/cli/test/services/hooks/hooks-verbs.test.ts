import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { AGENT_MATRIX } from '../../../src/services/hooks/agent-matrix.js';
import {
  type HooksDeps,
  hooksDisabled,
  installHooks,
  listAgents,
  statusHooks,
  UNIMPLEMENTED_AGENTS,
} from '../../../src/services/hooks/hooks-verbs.js';

/** The verbs (plan 082 tk-0008). */

let home: string;
const fs = new NodeFs();
const BINARY = '"/usr/local/bin/harness"';

const deps = (over: Partial<HooksDeps> = {}): HooksDeps => ({
  fs,
  home,
  env: () => undefined,
  binary: BINARY,
  ...over,
});

/** Make an agent "present" by creating its marker directory. */
const present = (marker: string) => mkdirSync(join(home, marker), { recursive: true });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'harness-hooks-verbs-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('HARNESS_NO_HOOKS is honoured INSIDE the verb (dw-001e, dw-001f)', () => {
  it('writes NOTHING to the filesystem — asserted on disk, not on a message', () => {
    /*
    Test Doc:
    - Why: dw-001e. A guard that lives only at doctor's call site is bypassed the
      moment someone runs the verb directly, which is exactly what a user reaching
      for `harness hooks install` does.
    - Contract: the home is byte-for-byte unchanged. Asserting on a returned message
      would pass for an implementation that prints "skipped" and installs anyway.
    */
    present('.cursor');
    const before = readdirSync(join(home, '.cursor'));

    const report = installHooks(deps({ env: (n) => (n === 'HARNESS_NO_HOOKS' ? '1' : undefined) }));

    expect(report.optedOut).toBe(true);
    expect(report.installed).toEqual([]);
    expect(readdirSync(join(home, '.cursor'))).toEqual(before);
    expect(existsSync(join(home, '.cursor/hooks.json'))).toBe(false);
  });

  it.each([
    ['1', true],
    ['true', true],
    ['yes', true],
    ['0', true],
    ['false', true],
    ['anything', true],
    ['', false],
  ])('value %j opts out: %s (dw-001f)', (value, expected) => {
    /*
    Test Doc:
    - Why: dw-001f. If doctor's call site and the verb disagree about what "set"
      means, one of them silently does the opposite of what the user asked.
    - Contract: ANY non-empty value opts out; only unset or empty proceeds.
    - The `0` and `false` rows are the deliberate ones: someone exporting
      HARNESS_NO_HOOKS=0 is reaching for the off switch, and a variable named
      NO_HOOKS that INSTALLS when set to 0 is a trap.
    */
    expect(hooksDisabled((n) => (n === 'HARNESS_NO_HOOKS' ? value : undefined))).toBe(expected);
  });

  it('unset proceeds — the positive control', () => {
    // Without this, "opts out" would be satisfied by a verb that never installs.
    present('.cursor');
    const report = installHooks(deps());
    expect(report.optedOut).toBe(false);
    expect(report.installed.length).toBeGreaterThan(0);
    expect(existsSync(join(home, '.cursor/hooks.json'))).toBe(true);
  });
});

describe('`list` has a defined contract (dw-001c)', () => {
  it('reports detected / supported / installed for every known agent', () => {
    present('.cursor');
    const rows = listAgents(deps());

    const cursor = rows.find((r) => r.agent === 'cursor');
    expect(cursor).toEqual({ agent: 'cursor', detected: true, supported: true, installed: false });

    const gemini = rows.find((r) => r.agent === 'gemini');
    expect(gemini).toEqual({ agent: 'gemini', detected: false, supported: true, installed: false });
  });

  it('installed flips to true only after an install', () => {
    present('.cursor');
    expect(listAgents(deps()).find((r) => r.agent === 'cursor')?.installed).toBe(false);
    installHooks(deps());
    expect(listAgents(deps()).find((r) => r.agent === 'cursor')?.installed).toBe(true);
  });

  it('covers every matrix agent AND every unimplemented one — nothing omitted', () => {
    const listed = new Set(listAgents(deps()).map((r) => r.agent));
    for (const spec of AGENT_MATRIX) expect(listed.has(spec.agent)).toBe(true);
    for (const { agent } of UNIMPLEMENTED_AGENTS) expect(listed.has(agent)).toBe(true);
  });
});

describe('the CUT LINE is explicit, never a silent skip (dw-001d)', () => {
  it('an unimplemented strategy is reported NOT SUPPORTED, with a named reason', () => {
    /*
    Test Doc:
    - Why: dw-001d. If strategies C and D are cut, four matrix rows have no writer.
      `list` advertising them as installable, or `status` reporting them
      identically to not-installed, is this plan's own silent-failure class arriving
      from the installer side.
    - Contract: supported=false and a reason naming the strategy.
    */
    const rows = listAgents(deps());
    for (const { agent, strategy } of UNIMPLEMENTED_AGENTS) {
      const row = rows.find((r) => r.agent === agent);
      expect(row?.supported).toBe(false);
      expect(row?.unsupportedReason).toBe(`strategy ${strategy} is not implemented`);
    }
  });

  it('install REFUSES a detected-but-unsupported agent BY NAME', () => {
    /*
    Test Doc:
    - Why: silently skipping is the failure. The agent is present, we cannot serve
      it, and the user must be told which one and why.
    - Contract: it appears in `refused` with its reason, and nothing is written for it.
    */
    present('.amp');
    const report = installHooks(deps());

    expect(report.refused).toEqual([{ agent: 'amp', reason: 'strategy C is not implemented' }]);
    expect(existsSync(join(home, '.config'))).toBe(false);
  });

  it('an UNDETECTED agent is flagged as such — not merely absent', () => {
    // cline is editor-level, so marker detection cannot reach it. "Not detected" and
    // "not installed" are different facts and collapsing them makes a coverage hole
    // look like an empty machine.
    expect(listAgents(deps()).find((r) => r.agent === 'cline')?.undetectable).toBe(true);
  });

  it('a supported agent carries NO unsupportedReason — the discriminator', () => {
    // Without this, "reason is set for unsupported" would pass for an implementation
    // that sets a reason on everything.
    expect(listAgents(deps()).find((r) => r.agent === 'cursor')?.unsupportedReason).toBeUndefined();
  });
});

describe('`status` proves its target RESOLVES, not merely that an entry exists', () => {
  it('reports the configured binary and whether it resolves', () => {
    /*
    Test Doc:
    - Why: MEASURED on this machine — the live Cursor hook points into untracked
      scratch/. A config entry can exist while its target does not, and because a
      hook exits 0 by design that is indistinguishable from a working hook. A status
      that only confirms the entry exists reintroduces this plan's own silent-failure
      class from the installer side.
    - Contract: the binary path is extracted back out and stat'ed.
    */
    present('.cursor');
    const binaryPath = join(home, 'bin', 'harness');
    mkdirSync(join(home, 'bin'), { recursive: true });
    writeFileSync(binaryPath, '#!/bin/sh\n');

    installHooks(deps({ binary: `"${binaryPath}"` }));
    const cursor = statusHooks(deps()).find((r) => r.agent === 'cursor');

    expect(cursor?.configuredBinary).toBe(binaryPath);
    expect(cursor?.binaryResolves).toBe(true);
  });

  it('reports binaryResolves FALSE when the target is gone — the row that matters', () => {
    present('.cursor');
    const binaryPath = join(home, 'bin', 'harness');
    mkdirSync(join(home, 'bin'), { recursive: true });
    writeFileSync(binaryPath, '#!/bin/sh\n');

    installHooks(deps({ binary: `"${binaryPath}"` }));
    rmSync(binaryPath); // the scratch directory gets cleaned

    const cursor = statusHooks(deps()).find((r) => r.agent === 'cursor');
    expect(cursor?.configuredBinary).toBe(binaryPath);
    expect(cursor?.binaryResolves).toBe(false);
  });

  it('lists the config files it would write, and whether each exists', () => {
    present('.codeium');
    const windsurf = statusHooks(deps()).find((r) => r.agent === 'windsurf');
    expect(windsurf?.files.map((f) => f.exists)).toEqual([false, false]);

    installHooks(deps());
    const after = statusHooks(deps()).find((r) => r.agent === 'windsurf');
    expect(after?.files.map((f) => f.exists)).toEqual([true, true]);
  });
});
