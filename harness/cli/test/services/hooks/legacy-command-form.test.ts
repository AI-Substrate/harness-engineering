import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { findAgent } from '../../../src/services/hooks/agent-matrix.js';
import {
  embedBinaryPath,
  embedInvocation,
  extractBinaryPath,
  extractInterpreterPath,
} from '../../../src/services/hooks/binary-path.js';
import { isOwnedByUs } from '../../../src/services/hooks/hook-marker.js';
import {
  type HooksDeps,
  installHooks,
  statusHooks,
  uninstallHooks,
} from '../../../src/services/hooks/hooks-verbs.js';
import { hookCommand, installStrategyA } from '../../../src/services/hooks/install-strategy-a.js';

/**
 * THE READER MUST NOT FORGET THE OLD SHAPE (plan 082, F008 backward compatibility).
 *
 * F008 changes the command we EMIT. Every install already in the field — every
 * macOS machine in the dogfood fleet — carries the one-token form in its config
 * right now, and those entries are OURS. Three things must survive the change,
 * and the third is the one that would be catastrophic:
 *
 *   1. the reader still extracts a legacy path;
 *   2. ownership still recognises a legacy entry as ours;
 *   3. UNINSTALL still removes one.
 *
 * If (3) regresses we strand our own hooks on every machine that installed
 * before this lands — silently, on WORKING machines, which is strictly worse
 * than the defect being fixed.
 *
 * THIS IS THE THIRD INSTANCE OF WRITER/READER DISAGREEMENT IN THIS SURFACE IN
 * ONE NIGHT. F005: the writer knew one entry shape and three agents needed
 * another. Phase-5 F1: the writer learned both shapes and the READER knew one.
 * Now: the writer is about to learn a new command shape, and the reader must not
 * forget the old one. The pattern is stable enough to name — a shape change is
 * never done until the READER has been asked what it does with both.
 */

const NODE = '/usr/local/bin/node';

let home: string;
const fs = new NodeFs();

const cursor = () => {
  const spec = findAgent('cursor');
  if (spec === undefined) throw new Error('cursor missing from the matrix');
  return spec;
};

const deps = (over: Partial<HooksDeps> = {}): HooksDeps => ({
  fs,
  home,
  env: () => undefined,
  binary: embedInvocation(NODE, join(home, 'bin', 'harness.js')),
  ...over,
});

/** What we wrote BEFORE F008 — a single quoted script path, no interpreter. */
const legacyBinary = () => embedBinaryPath(join(home, 'bin', 'harness.js'));

const cursorConfig = () => join(home, '.cursor', 'hooks.json');
const readCursor = () =>
  JSON.parse(readFileSync(cursorConfig(), 'utf8')) as {
    hooks: Record<string, { command: string }[]>;
  };

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'harness-legacy-'));
  mkdirSync(join(home, '.cursor'), { recursive: true });
  mkdirSync(join(home, 'bin'), { recursive: true });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('the reader handles BOTH forms', () => {
  it('a legacy one-token command still yields its script, and NO interpreter', () => {
    const command = hookCommand(legacyBinary(), 'cursor', 'post');
    expect(extractBinaryPath(command)).toBe(join(home, 'bin', 'harness.js'));
    expect(extractInterpreterPath(command)).toBeNull();
  });

  it('a legacy entry is still recognised as OURS', () => {
    /*
    Test Doc:
    - Why: ownership is decided by the marker, not by the path — but that is a
      property nothing asserted against the NEW form's arrival. An ownership
      check that started keying on command shape would orphan every field
      install at once.
    - Contract: legacy and current commands are both ours.
    */
    expect(isOwnedByUs(hookCommand(legacyBinary(), 'cursor', 'post'))).toBe(true);
    expect(isOwnedByUs(hookCommand(embedInvocation(NODE, '/x/harness.js'), 'cursor', 'post'))).toBe(
      true,
    );
  });

  it('status reports a legacy install as INSTALLED, and stats its script', () => {
    installHooks(deps({ binary: legacyBinary() }));
    const row = statusHooks(deps({ binary: legacyBinary() })).find((r) => r.agent === 'cursor');
    expect(row?.installed).toBe(true);
    expect(row?.configuredBinary).toBe(join(home, 'bin', 'harness.js'));
  });
});

describe('UNINSTALL still removes a legacy entry (the catastrophic row)', () => {
  it('removes an entry written in the OLD form', () => {
    /*
    Test Doc:
    - Why: if this regresses, every machine that installed before F008 keeps a
      hook we can no longer see or remove. It is silent, it is on working
      machines, and the user's only recourse is hand-editing JSON.
    - Contract: install with the legacy binary, uninstall with the NEW binary
      configured, and nothing of ours remains.
    */
    installHooks(deps({ binary: legacyBinary() }));
    expect(readCursor().hooks.preToolUse.length).toBe(1);

    uninstallHooks(deps());

    // Uninstall's symmetry for a file WE created is delete, not restore — so
    // "gone" and "present with nothing of ours in it" are both clean removals.
    // What must never happen is a legacy entry of ours surviving.
    if (fs.exists(cursorConfig())) {
      const remaining = Object.values(readCursor().hooks).flat();
      expect(remaining.filter((e) => isOwnedByUs(e.command)).length).toBe(0);
    }
    expect(fs.exists(cursorConfig())).toBe(false);
  });
});

describe('RE-INSTALL over a legacy entry UPGRADES it', () => {
  it('exactly one entry afterwards, carrying the new form', () => {
    /*
    Test Doc:
    - Why: idempotency finds our entry by MARKER, so a legacy entry short-
      circuits install as `alreadyPresent` — correct for duplication, wrong for
      repair. A user who installs again after upgrading gets told everything is
      fine while the broken command stays exactly where it was, which on Windows
      means the fix never reaches the machine that needs it.
    - Contract: one entry per event key, and its command names the interpreter.
    */
    installHooks(deps({ binary: legacyBinary() }));
    expect(readCursor().hooks.preToolUse[0].command.startsWith(`"${NODE}"`)).toBe(false);

    installHooks(deps());

    const after = readCursor();
    expect(after.hooks.preToolUse.length).toBe(1);
    expect(after.hooks.postToolUse.length).toBe(1);
    for (const entry of [...after.hooks.preToolUse, ...after.hooks.postToolUse]) {
      expect(entry.command.startsWith(`"${NODE}" "`)).toBe(true);
      expect(extractInterpreterPath(entry.command)).toBe(NODE);
    }
  });

  it('re-installing over a CURRENT-form entry still does nothing', () => {
    /*
    Test Doc:
    - Why: the counter-row. An upgrade path that rewrites unconditionally would
      pass the row above while churning every config on every run.
    - Contract: byte-identical file after a second install, AND the outcome still
      reports `alreadyPresent`. The report is the half with teeth: `installHooks`
      rolls back "what THIS run wrote" when the provenance record fails, so an
      install that claims it wrote a pre-existing entry can UNINSTALL A GOOD
      HOOK to compensate for its own failure. Bytes alone cannot see that — a
      rewrite producing identical bytes is invisible on disk and loud in the
      outcome.
    */
    installHooks(deps());
    const before = readFileSync(cursorConfig(), 'utf8');

    const outcomes = installStrategyA(fs, cursor(), home, () => undefined, deps().binary);
    expect(outcomes.every((o) => o.alreadyPresent)).toBe(true);
    expect(readFileSync(cursorConfig(), 'utf8')).toBe(before);
  });

  it('the UPGRADE reports that it wrote — the same field, the other direction', () => {
    /*
    Test Doc:
    - Why: the mirror of the row above, and it is what stops `alreadyPresent`
      being hard-coded either way. An upgrade that reported `alreadyPresent`
      would tell a user on the platform this repairs that nothing needed doing,
      on the very run that did it.
    - Contract: upgrading a legacy entry reports a write.
    */
    installHooks(deps({ binary: legacyBinary() }));
    const outcomes = installStrategyA(fs, cursor(), home, () => undefined, deps().binary);
    expect(outcomes.every((o) => o.alreadyPresent)).toBe(false);
  });

  it('leaves a FOREIGN entry in the same array untouched', () => {
    /*
    Test Doc:
    - Why: the upgrade edits entries in place, by index. An off-by-one or an
      over-broad match rewrites somebody else's hook — the exact clobbering
      posture `hook-marker.ts` exists to refuse.
    - Contract: the foreign command survives the upgrade unchanged.
    */
    installHooks(deps({ binary: legacyBinary() }));
    const doc = readCursor();
    doc.hooks.preToolUse.push({ command: 'other-tool --run' });
    fs.writeText(cursorConfig(), `${JSON.stringify(doc, null, 2)}\n`);

    installHooks(deps());

    const after = readCursor();
    expect(after.hooks.preToolUse.some((e) => e.command === 'other-tool --run')).toBe(true);
    const ours = after.hooks.preToolUse.filter((e) => isOwnedByUs(e.command));
    expect(ours.length).toBe(1);
    // And ours WAS upgraded — otherwise this row passes on an implementation
    // that refuses to touch the array at all.
    expect(extractInterpreterPath(ours[0].command)).toBe(NODE);
  });
});
