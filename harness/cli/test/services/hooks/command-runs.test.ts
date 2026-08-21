import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { embedInvocation } from '../../../src/services/hooks/binary-path.js';
import {
  type HooksDeps,
  type InvocationProbe,
  installHooks,
  statusHooks,
} from '../../../src/services/hooks/hooks-verbs.js';

/**
 * WE ASSERT PATHS RESOLVE; WE NEVER ASSERT COMMANDS RUN (plan 082, F008 §4).
 *
 * `binaryState: 'resolves'` is `fs.exists`. On the Windows 11 guest measured on
 * 2026-08-10 it was TRUE on a machine where the command could not execute one
 * line of our code — the file was there, and the OS handed it to WScript.exe.
 * We read that green in a pre-run baseline and believed it.
 *
 * This is F007's own finding pointed back at us. F007 (`408ce72f`) added a
 * viability probe before invoking git-ai's binary, on the principle that *a
 * digest proves the bytes are the ones we asked for, not that they execute
 * here*. We wrote that guard for somebody else's binary while our own hook
 * command went unexecuted on an entire platform.
 *
 * So the states are separate and the new one requires POSITIVE EVIDENCE that OUR
 * CODE RAN. Exit 0 is not evidence — exit 0 is precisely what WScript returned.
 */

let home: string;
const fs = new NodeFs();

/** A probe that reports whatever the row wants, and records what it was asked. */
const fakeProbe = (result: { ok: boolean; evidence: boolean; detail?: string }) => {
  const calls: { interpreter: string | null; script: string }[] = [];
  const probe: InvocationProbe = (interpreter, script) => {
    calls.push({ interpreter, script });
    return result;
  };
  return { probe, calls };
};

const deps = (over: Partial<HooksDeps> = {}): HooksDeps => ({
  fs,
  home,
  env: () => undefined,
  binary: embedInvocation('/usr/local/bin/node', '/usr/local/bin/harness.js'),
  ...over,
});

const installed = (over: Partial<HooksDeps> = {}) => {
  mkdirSync(join(home, '.cursor'), { recursive: true });
  mkdirSync(join(home, 'usr'), { recursive: true });
  installHooks(deps(over));
};

/** A binary path that EXISTS, so `binaryState` is `resolves` and cannot excuse the row. */
const realScript = () => {
  const path = join(home, 'bin', 'harness.js');
  mkdirSync(join(home, 'bin'), { recursive: true });
  writeFileSync(path, '// a real file, and that proves nothing\n');
  return path;
};

/**
 * An interpreter path that EXISTS, for the same reason {@link realScript} does.
 *
 * `binaryState` is the conjunction of BOTH halves of the invocation (plan 084), so a
 * row asserting `resolves` has to supply a real interpreter as well as a real
 * script. Before that change the hardcoded `/usr/local/bin/node` below was never
 * checked, so it did not matter that it does not exist on this machine — which is a
 * small live instance of the very defect: a fixture claiming a resolvable hook while
 * naming an interpreter that was not there.
 */
const realInterpreter = () => {
  const path = join(home, 'bin', 'node');
  mkdirSync(join(home, 'bin'), { recursive: true });
  writeFileSync(path, '#!/bin/sh\n');
  return path;
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'harness-runs-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('executionState — the check that would have caught this (row 3)', () => {
  it('a command that EXITS 0 WITH NO EVIDENCE is INERT, not healthy', () => {
    /*
    Test Doc:
    - Why: the measured Windows shape exactly. WScript.exe opened our ES module,
      could not execute it, and exited 0. Every signal we had said healthy: the
      file existed, the options were accepted, the exit code was 0. A check that
      trusts exit 0 reproduces the bug it was written to catch.
    - Contract: evidence absent ⇒ state is `inert`, and it is NOT any of the
      states an operator reads as working.
    */
    const script = realScript();
    // BOTH halves real, so `binaryState` genuinely cannot excuse the row below —
    // which is the whole point of this fixture and now requires the interpreter too.
    const node = realInterpreter();
    const { probe } = fakeProbe({ ok: true, evidence: false });
    installed({ binary: embedInvocation(node, script), probe });

    const row = statusHooks(deps({ binary: embedInvocation(node, script), probe })).find(
      (r) => r.agent === 'cursor',
    );

    expect(row?.binaryState).toBe('resolves');
    expect(row?.executionState).toBe('inert');
    expect(row?.executionState).not.toBe('runs');
  });

  it('names the failure in words an operator can act on', () => {
    const script = realScript();
    const { probe } = fakeProbe({ ok: true, evidence: false, detail: 'no self-test marker' });
    installed({ binary: embedInvocation('/usr/local/bin/node', script), probe });

    const row = statusHooks(
      deps({ binary: embedInvocation('/usr/local/bin/node', script), probe }),
    ).find((r) => r.agent === 'cursor');

    expect(row?.executionDetail ?? '').toMatch(/self-test|did not run|no evidence/i);
  });

  it('a NON-ZERO exit is inert too — a different cause, the same verdict', () => {
    const script = realScript();
    const { probe } = fakeProbe({ ok: false, evidence: false, detail: 'exit 1' });
    installed({ binary: embedInvocation('/usr/local/bin/node', script), probe });

    const row = statusHooks(
      deps({ binary: embedInvocation('/usr/local/bin/node', script), probe }),
    ).find((r) => r.agent === 'cursor');
    expect(row?.executionState).toBe('inert');
  });

  it('probes the INTERPRETER AND SCRIPT PAIR that is actually configured', () => {
    /*
    Test Doc:
    - Why: a probe that runs some other command — `harness` off PATH, or the
      script without its interpreter — answers a question nobody asked. The whole
      defect is that the CONFIGURED pair is not what we assumed.
    - Contract: the probe receives both parts, read back out of the config.
    */
    const script = realScript();
    const { probe, calls } = fakeProbe({ ok: true, evidence: true });
    installed({ binary: embedInvocation('/usr/local/bin/node', script), probe });
    statusHooks(deps({ binary: embedInvocation('/usr/local/bin/node', script), probe }));

    expect(calls.length).toBeGreaterThan(0);
    // THE LOGICAL SPELLING, because the probe receives what was READ BACK OUT of the
    // config — and what goes in is deliberately forward-slashed by
    // `normaliseBinaryPath` (a shell command inside another tool's file, where a
    // backslash escapes). Comparing against the native `join` asserted a shape this
    // surface never promised, and only Windows could tell (plan 083). The PAIRING —
    // interpreter AND script together — is what this row is actually about, and it
    // is untouched.
    expect(calls[0]).toEqual({
      interpreter: '/usr/local/bin/node',
      script: script.replace(/\\/g, '/'),
    });
  });
});

describe('the counter-rows — this must not become "always report broken" (row 4)', () => {
  it('a command that DOES run reports RUNS', () => {
    /*
    Test Doc:
    - Why: without this row, an implementation that hard-codes `inert` passes
      every assertion above. This is the row that makes the check a measurement
      rather than a slogan.
    - Contract: evidence present ⇒ `runs`.
    */
    const script = realScript();
    const { probe } = fakeProbe({ ok: true, evidence: true });
    installed({ binary: embedInvocation('/usr/local/bin/node', script), probe });

    const row = statusHooks(
      deps({ binary: embedInvocation('/usr/local/bin/node', script), probe }),
    ).find((r) => r.agent === 'cursor');
    expect(row?.executionState).toBe('runs');
  });

  it('NO PROBE supplied is UNCHECKED — never silently healthy, never silently broken', () => {
    /*
    Test Doc:
    - Why: status is called from places that must not spawn a child. The honest
      answer there is "not measured", and it must be a state of its own: folding
      it into `runs` re-creates the false green, folding it into `inert` cries
      wolf on every working install.
    - Contract: a distinct third value.
    */
    const script = realScript();
    installed({ binary: embedInvocation('/usr/local/bin/node', script) });

    const row = statusHooks(deps({ binary: embedInvocation('/usr/local/bin/node', script) })).find(
      (r) => r.agent === 'cursor',
    );
    expect(row?.executionState).toBe('unchecked');
  });

  it('ABSENT when nothing of ours is installed — nothing to execute, nothing to claim', () => {
    mkdirSync(join(home, '.cursor'), { recursive: true });
    const { probe } = fakeProbe({ ok: true, evidence: true });
    const row = statusHooks(deps({ probe })).find((r) => r.agent === 'cursor');
    expect(row?.executionState).toBe('absent');
  });
});

describe('EVERY configured command, not the first (F008 review F2)', () => {
  /**
   * A GREEN THAT COULD NOT GO RED FOR THE SECOND COMMAND.
   *
   * `harness hooks status --probe` promises to EXECUTE EACH configured command.
   * The implementation destructured the first and reported its result for the
   * whole agent, so `executionState: runs` could be returned while another
   * configured command was inert.
   *
   * That is a false green on exactly the configurations most likely to be
   * stale — windsurf writes TWO files, every agent writes a pre and a post
   * entry, and mid-upgrade a config can legitimately hold one command of each
   * form. The one shape guaranteed to be probed was the one least likely to be
   * wrong.
   *
   * Same lesson as M6 arriving from the other side: a predicate that answers a
   * narrower question than the one being asked. Both findings of this round
   * were found by CONSTRUCTING the adversarial case, not by reading the code.
   */

  /** Evidence only when an interpreter is configured — the mid-upgrade machine. */
  const interpreterAwareProbe = () => {
    const seen: (string | null)[] = [];
    const probe: InvocationProbe = (interpreter, script) => {
      seen.push(interpreter);
      void script;
      return interpreter === null
        ? { ok: true, evidence: false, detail: 'no interpreter — dispatched by file association' }
        : { ok: true, evidence: true };
    };
    return { probe, seen };
  };

  /** Install current-form commands, then rewrite ONLY post back to the legacy form. */
  const mixedInstall = (script: string) => {
    installed({ binary: embedInvocation('/usr/local/bin/node', script) });
    const path = join(home, '.cursor', 'hooks.json');
    const doc = JSON.parse(readFileSync(path, 'utf8')) as {
      hooks: Record<string, { command: string }[]>;
    };
    for (const entry of doc.hooks.postToolUse) {
      /*
       * DEGRADE TO A FORM THE INSTALLER ACTUALLY WROTE — the WHOLE invocation
       * prefix, not just the node path. A pre-F008 entry was `"<script>" hooks
       * fire …` and never `--no-warnings "<script>" …`; stripping only the
       * interpreter once the invocation carries flags would build a stimulus no
       * version of this tool has ever emitted, and then measure our readers
       * against it. That is the constructed-stimulus error this plan has paid for
       * three times.
       */
      entry.command = entry.command.slice(entry.command.indexOf('"', 1) + 1).trimStart();
      entry.command = entry.command.slice(entry.command.indexOf('"'));
    }
    writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  };

  it('probes EVERY owned command, not just the first', () => {
    const script = realScript();
    const { probe, seen } = interpreterAwareProbe();
    mixedInstall(script);

    statusHooks(deps({ binary: embedInvocation('/usr/local/bin/node', script), probe }));

    expect(seen).toEqual(['/usr/local/bin/node', null]);
  });

  it('does NOT report runs when a LATER command is inert', () => {
    /*
    Test Doc:
    - Why: the reviewer's counter-row. `runs` on an agent where one of two
      configured commands cannot execute is precisely the false green this
      field was added to abolish.
    - Contract: not `runs`, and the detail NAMES the failing command so the
      operator can find it — a bare "inert" on an agent with four commands sends
      them hunting.
    */
    const script = realScript();
    const { probe } = interpreterAwareProbe();
    mixedInstall(script);

    const row = statusHooks(
      deps({ binary: embedInvocation('/usr/local/bin/node', script), probe }),
    ).find((r) => r.agent === 'cursor');

    expect(row?.executionState).not.toBe('runs');
    expect(row?.executionDetail ?? '').toMatch(/1 of 2|--phase post/);
    expect(row?.inertCommands?.length).toBe(1);
    expect(row?.inertCommands?.[0]).toContain('--phase post');
  });

  it('reports RUNS when EVERY command is evidenced — the counter-row', () => {
    /*
    Test Doc:
    - Why: without this, "refuse whenever there is more than one command"
      passes the row above.
    - Contract: two commands, both evidenced, still `runs`.
    */
    const script = realScript();
    const { probe, seen } = interpreterAwareProbe();
    installed({ binary: embedInvocation('/usr/local/bin/node', script) });

    const row = statusHooks(
      deps({ binary: embedInvocation('/usr/local/bin/node', script), probe }),
    ).find((r) => r.agent === 'cursor');

    expect(seen.length).toBe(2);
    expect(row?.executionState).toBe('runs');
    expect(row?.inertCommands ?? []).toEqual([]);
  });
});
