import { describe, expect, it } from 'vitest';
import { FakeGitAttribution } from '../../../../src/adapters/git/fake-git-attribution.js';
import { NodeHash } from '../../../../src/adapters/hash/node-hash.js';
import { FakeSocketProbe } from '../../../../src/adapters/net/fake-socket-probe.js';
import type { ProbeOutcome } from '../../../../src/adapters/net/socket-probe-port.js';
import { describeExit } from '../../../../src/services/doctor/collector/exit-code.js';
import {
  type CollectorHealth,
  readCollectorHealth,
} from '../../../../src/services/doctor/collector/health.js';
import { readIngress } from '../../../../src/services/doctor/collector/ingress.js';
import { GITAI_PIN } from '../../../../src/services/doctor/collector/pin.js';
import {
  type CollectorState,
  collectorStatePath,
  emptyCollectorState,
} from '../../../../src/services/doctor/collector/state.js';
import { FakeCollectorFs } from '../../../support/collector-fakes.js';

/**
 * Plan 073 · ac-000a, ac-000b, ac-000c, ac-0010, ac-0012, ac-0014 — the health
 * ladder.
 *
 * The three assertions that carry the design: `could-not-determine` is its own
 * rung and never reads as healthy; `cli-only-trace2` is its own rung and is
 * neither healthy nor a failed install; and the healthy rung explicitly declines
 * to claim collection is OCCURRING, because nothing available in v1 can prove
 * that (ac-0012).
 */

const HOME = '/home/u';
const REPO = '/repo';
const NOW = '2026-08-06T10:00:00.000Z';
const BINARY = '/home/u/.git-ai/bin/git-ai';
const DAEMON_PID = '/home/u/.git-ai/internal/daemon/daemon.pid.json';
const SOCKET = '/home/u/.git-ai/internal/daemon/trace2.sock';
const PAYLOAD = new TextEncoder().encode('#!/bin/sh\necho git-ai\n');
const DIGEST = new NodeHash().sha256Hex(PAYLOAD);

function pin() {
  return {
    ...GITAI_PIN,
    artifacts: {
      ...GITAI_PIN.artifacts,
      'macos-arm64': { file: 'git-ai-macos-arm64', sha256: DIGEST },
    },
  } as typeof GITAI_PIN;
}

function stateWith(over: Partial<CollectorState> = {}): CollectorState {
  const base = emptyCollectorState(NOW, GITAI_PIN);
  return {
    ...base,
    cli: {
      status: 'installed',
      path: BINARY,
      digest: DIGEST,
      verified_at: NOW,
      executable: true,
      detail: 'installed',
    },
    hooks: { status: 'installed', at: NOW, agents: ['claude'], detail: 'hooks installed' },
    trace2: [{ observed: 'empty', entries: [], at: NOW }],
    note_schema: {
      expected: 'authorship/3.0.0',
      observed: 'authorship/3.0.0',
      status: 'match',
    },
    ...over,
  };
}

function health(
  over: {
    fs?: FakeCollectorFs;
    state?: CollectorState | null;
    hash?: boolean;
    platform?: string;
  } = {},
): CollectorHealth {
  const fs = over.fs ?? new FakeCollectorFs();
  if (over.state !== null) {
    fs.writeText(collectorStatePath(REPO), JSON.stringify(over.state ?? stateWith()));
  }
  return readCollectorHealth({
    fs,
    host: { platform: over.platform ?? 'darwin', arch: 'arm64', home: HOME },
    cwd: REPO,
    ...(over.hash === false ? {} : { hash: new NodeHash() }),
    manifest: pin(),
  });
}

function installedFs(): FakeCollectorFs {
  const fs = new FakeCollectorFs();
  fs.seedBytes(BINARY, PAYLOAD);
  fs.mkdirp(`${HOME}/.claude`);
  fs.writeText(DAEMON_PID, '{"pid":4242}');
  return fs;
}

describe('the healthy rung — configured, and honest that it is only configured', () => {
  it('reports healthy and explicitly does NOT claim collection is occurring (ac-0012)', () => {
    const result = health({ fs: installedFs() });

    expect(result.verdict).toBe('healthy');
    expect(result.binary).toMatchObject({ present: true, digest: 'match' });
    expect(result.hooks).toEqual({ status: 'installed', missing: [] });
    expect(result.daemon).toBe('pidfile-present');
    expect(result.detail).toContain('CONFIGURED');
    expect(result.detail).toContain('cannot prove it is occurring');
    expect(result.next_action).toBeUndefined();
  });
});

describe('`could not determine` is a distinct state, never folded in (ac-000b)', () => {
  it('a binary with no harness record is undetermined, NOT healthy and NOT not-installed', () => {
    const fs = new FakeCollectorFs();
    fs.seedBytes(BINARY, PAYLOAD);

    const result = readCollectorHealth({
      fs,
      host: { platform: 'darwin', arch: 'arm64', home: HOME },
      cwd: REPO,
      hash: new NodeHash(),
      manifest: pin(),
    });

    expect(result.verdict).toBe('could-not-determine');
    expect(result.detail).toContain('no record');
    expect(result.next_action).toBeDefined();
  });

  it('a recorded install whose binary has vanished is undetermined, not "not installed"', () => {
    const result = health({ fs: new FakeCollectorFs() });

    expect(result.verdict).toBe('could-not-determine');
    expect(result.detail).toContain('moved or removed');
  });

  it('a malformed state file reads as undetermined rather than as absence', () => {
    const fs = installedFs();
    fs.writeText(collectorStatePath(REPO), '{ not json');

    const result = readCollectorHealth({
      fs,
      host: { platform: 'darwin', arch: 'arm64', home: HOME },
      cwd: REPO,
      hash: new NodeHash(),
      manifest: pin(),
    });

    expect(result.verdict).toBe('could-not-determine');
  });

  it('an unverifiable digest cannot be upgraded to healthy', () => {
    const fs = installedFs();
    // No hash port wired AND no recorded digest: the read cannot prove the bytes.
    const result = health({
      fs,
      hash: false,
      state: stateWith({
        cli: {
          status: 'installed',
          path: BINARY,
          digest: null,
          verified_at: NOW,
          executable: true,
          detail: 'installed',
        },
      }),
    });

    expect(result.binary.digest).toBe('unknown');
    expect(result.verdict).toBe('could-not-determine');
  });
});

describe('`CLI installed, hooks not installed (trace2 present)` is its own rung (ac-0014)', () => {
  it('is not healthy, not a failed install, and not could-not-determine', () => {
    const result = health({
      fs: installedFs(),
      state: stateWith({
        hooks: {
          status: 'skipped-trace2',
          at: NOW,
          agents: [],
          detail: 'global trace2 config is PRESENT',
        },
        trace2: [{ observed: 'present', entries: ['trace2.eventTarget /t'], at: NOW }],
      }),
    });

    expect(result.verdict).toBe('cli-only-trace2');
    expect(result.binary.digest).toBe('match');
    expect(result.detail).toContain('no AI attribution is being collected');
    expect(result.next_action).toContain('install-hooks');
    expect(result.trace2).toEqual({ observed: 'present', at: NOW });
  });
});

describe('the degraded rungs name their cause', () => {
  it('a binary that no longer matches the pin is degraded, not healthy', () => {
    const fs = installedFs();
    fs.seedBytes(BINARY, new TextEncoder().encode('a newer git-ai'));

    const result = health({ fs });

    expect(result.verdict).toBe('degraded');
    expect(result.binary.digest).toBe('mismatch');
    expect(result.detail).toContain('does NOT match the pinned');
  });

  it('a note-schema mismatch is degraded and points at the pin', () => {
    const result = health({
      fs: installedFs(),
      state: stateWith({
        note_schema: {
          expected: 'authorship/3.0.0',
          observed: 'authorship/4.0.0',
          status: 'mismatch',
        },
      }),
    });

    expect(result.verdict).toBe('degraded');
    expect(result.detail).toContain('authorship/4.0.0');
  });

  it('an unsupported platform reports not-installed with an honest reason (ac-0017)', () => {
    const result = health({ platform: 'freebsd' });

    expect(result.verdict).toBe('not-installed');
    expect(result.detail).toContain('freebsd');
  });

  it('a machine with nothing installed says so plainly', () => {
    const result = health({ fs: new FakeCollectorFs(), state: null });

    expect(result.verdict).toBe('not-installed');
    expect(result.next_action).toContain('--install-collector');
  });
});

describe('a NEW coding harness is surfaced by the health read (ac-0010)', () => {
  it('reports hooks-incomplete when an agent appeared after the hooks went on', () => {
    const fs = installedFs();
    fs.mkdirp(`${HOME}/.cursor`); // installed later; hooks only cover claude

    const result = health({ fs });

    expect(result.verdict).toBe('hooks-incomplete');
    expect(result.hooks.missing).toEqual(['cursor']);
    expect(result.detail).toContain('Cursor');
    expect(result.next_action).toContain('trace2 guard runs again');
  });
});

/**
 * Plan 077 — the probe reading must SURVIVE the verdict that outranks it.
 *
 * Every one of these rungs returns before the `ingress-blocked` rung, and each
 * one used to drop `deps.ingress` on the floor: `undetermined()` never set the
 * field, so the key came back ABSENT. That made a reading we took and discarded
 * indistinguishable from one we never took — and `null` on this field exists
 * precisely to mean "nobody probed".
 *
 * The verdict is deliberately NOT promoted to `ingress-blocked`. "We cannot
 * determine whether git-ai is installed" stays the answer to the question it
 * answers, because `ingress-blocked`'s own detail asserts git-ai "is installed
 * and hooked up" — which is the one thing these rungs could not establish. Two
 * independent facts, one row, neither stated as the other.
 */
describe('plan 077 — a blocked ingress is not lost to a could-not-determine verdict', () => {
  async function blockedIngress(outcome: ProbeOutcome = 'denied') {
    const cfs = new FakeCollectorFs();
    cfs.writeText(SOCKET, '');
    return readIngress({
      fs: cfs,
      probe: new FakeSocketProbe({ [SOCKET]: outcome }),
      git: new FakeGitAttribution({ trace2Target: `af_unix:stream:${SOCKET}` }),
      env: { get: () => undefined },
    });
  }

  it('carries the reading AND names the blockage when the install is unrecorded', async () => {
    const fs = new FakeCollectorFs();
    fs.seedBytes(BINARY, PAYLOAD);

    const result = readCollectorHealth({
      fs,
      host: { platform: 'darwin', arch: 'arm64', home: HOME },
      cwd: REPO,
      hash: new NodeHash(),
      manifest: pin(),
      ingress: await blockedIngress(),
    });

    // The verdict still answers its own question honestly…
    expect(result.verdict).toBe('could-not-determine');
    expect(result.detail).toContain('no record');
    // …and the evidence is neither dropped nor downgraded to "nobody probed".
    expect(result.ingress).not.toBeUndefined();
    expect(result.ingress).not.toBeNull();
    // …and the operator is TOLD, because this is the actionable half.
    expect(result.detail).toContain('NO attribution');
    expect(result.next_action).toContain('harness doctor telemetry-nudge');
  });

  it('carries the reading when the recorded binary has vanished', async () => {
    // A RECORDED install with nothing on disk — distinct from "no binary and no
    // record", which is `not-installed` and is a different rung entirely.
    const fs = new FakeCollectorFs();
    fs.writeText(collectorStatePath(REPO), JSON.stringify(stateWith()));

    const result = readCollectorHealth({
      fs,
      host: { platform: 'darwin', arch: 'arm64', home: HOME },
      cwd: REPO,
      hash: new NodeHash(),
      manifest: pin(),
      ingress: await blockedIngress(),
    });

    expect(result.verdict).toBe('could-not-determine');
    expect(result.ingress).not.toBeUndefined();
    expect(result.detail).toContain('NO attribution');
  });

  it('a REACHABLE ingress adds no warning — the row must not cry wolf', async () => {
    const fs = new FakeCollectorFs();
    fs.seedBytes(BINARY, PAYLOAD);

    const result = readCollectorHealth({
      fs,
      host: { platform: 'darwin', arch: 'arm64', home: HOME },
      cwd: REPO,
      hash: new NodeHash(),
      manifest: pin(),
      ingress: await blockedIngress('connected'),
    });

    expect(result.verdict).toBe('could-not-determine');
    // Still carried — a clean probe is evidence too…
    expect(result.ingress).not.toBeUndefined();
    // …but it is NOT narrated, or the warning stops meaning anything.
    expect(result.detail).not.toContain('NO attribution');
    expect(result.next_action).not.toContain('telemetry-nudge');
  });

  it('an UNPROBED read still reports null, and never invents a blockage', () => {
    const fs = new FakeCollectorFs();
    fs.seedBytes(BINARY, PAYLOAD);

    const result = readCollectorHealth({
      fs,
      host: { platform: 'darwin', arch: 'arm64', home: HOME },
      cwd: REPO,
      hash: new NodeHash(),
      manifest: pin(),
    });

    expect(result.verdict).toBe('could-not-determine');
    expect(result.ingress).toBeNull();
    expect(result.detail).not.toContain('NO attribution');
  });
});

/**
 * Plan 082 · F006 — a NAMED PIPE reading can now reach these rungs.
 *
 * Both strings below were written when only an af_unix reading could get here,
 * and both contained a claim that is false about a pipe: the socket PATH
 * collapsed to `(unknown)`, and the recovery pointed at
 * `harness doctor telemetry-nudge`, which refuses a pipe
 * (`TRACE2_TARGET_POLICY.named_pipe.replayInto === false`). Making the ingress
 * probeable without sweeping the strings would have reproduced plan 075's
 * failure — several wrong statements from one classification — through the front
 * door.
 */
describe('plan 082 · F006 — the pipe rungs say what is true about a PIPE', () => {
  const PIPE = '\\\\.\\pipe\\git-ai-abc-trace2';

  async function blockedPipe(outcome: ProbeOutcome = 'denied') {
    return readIngress({
      fs: new FakeCollectorFs(),
      probe: new FakeSocketProbe({ [PIPE]: outcome }),
      git: new FakeGitAttribution({ trace2Target: PIPE }),
      env: { get: () => undefined },
    });
  }

  async function blockedSocket() {
    const fs = new FakeCollectorFs();
    fs.writeText(SOCKET, '');
    return readIngress({
      fs,
      probe: new FakeSocketProbe({ [SOCKET]: 'denied' }),
      git: new FakeGitAttribution({ trace2Target: `af_unix:stream:${SOCKET}` }),
      env: { get: () => undefined },
    });
  }

  it('names the PIPE PATH instead of collapsing it to (unknown)', async () => {
    /*
    Test Doc:
    - Why: the path came from `kind === 'af_unix' ? target.path : '(unknown)'`,
      so a blocked pipe told the operator the location was unknown when it was
      right there in the reading. "(unknown)" reads as a missing fact rather than
      an omitted one, and it is the only identifier they could act on.
    - Contract: the blocked detail carries the pipe path verbatim.
    - Quality Contribution: asserts `(unknown)` is ABSENT as well as the path
      present — a string containing both would pass a presence-only check.
    - Note: the HOST platform is left at the suite's default. A pipe target is a
      fact about the trace2 config, and pinning it to `win32` here would only
      change which BINARY filename the health read looks for, sending the fixture
      down a `not-installed` rung before it ever reaches the ingress warning.
    */
    const fs = new FakeCollectorFs();
    fs.seedBytes(BINARY, PAYLOAD);

    const result = readCollectorHealth({
      fs,
      host: { platform: 'darwin', arch: 'arm64', home: HOME },
      cwd: REPO,
      hash: new NodeHash(),
      manifest: pin(),
      ingress: await blockedPipe(),
    });

    expect(result.detail).toContain(PIPE);
    expect(result.detail).not.toContain('(unknown)');
  });

  it('does NOT send a Windows operator to a nudge that will refuse them', async () => {
    /*
    Test Doc:
    - Why: replay into a named pipe is refused (plan 075, unchanged by F006). A
      `next_action` naming `telemetry-nudge` hands the operator a command that
      answers "not supported on this platform" — worse than naming no command,
      because it burns the one recovery attempt they were told to make.
    - Contract: the pipe recovery text mentions the nudge only to say it cannot
      replay, and the af_unix recovery still names it as an instruction.
    - Quality Contribution: the af_unix half is the mutation guard — deleting the
      nudge sentence outright would satisfy the pipe half alone.
    */
    const fs = new FakeCollectorFs();
    fs.seedBytes(BINARY, PAYLOAD);
    const base = {
      fs,
      host: { platform: 'darwin', arch: 'arm64', home: HOME },
      cwd: REPO,
      hash: new NodeHash(),
      manifest: pin(),
    };

    const pipe = readCollectorHealth({ ...base, ingress: await blockedPipe() });
    expect(pipe.next_action).toContain('cannot replay into a named-pipe ingress');

    const socket = readCollectorHealth({
      ...base,
      ingress: await blockedSocket(),
    });
    expect(socket.next_action).toContain('from an UNSANDBOXED shell');
    expect(socket.next_action).not.toContain('cannot replay');
  });

  it('the ingress-blocked VERDICT names the pipe and its own recovery (both rungs)', async () => {
    /*
    Test Doc:
    - Why: `(unknown)` and the nudge instruction appear TWICE — once in
      `withIngressWarning` (appended to a rung that outranks the ingress) and
      once in the `ingress-blocked` verdict itself. Fixing one and not the other
      leaves an operator on a fully-installed Windows box reading the exact
      sentence F006 set out to remove. The two sites were found by mutating each
      independently and watching the other's tests stay green.
    - Contract: on the `ingress-blocked` rung specifically, a pipe reading is
      named by path, described by what was observed, and not sent to the nudge.
    - Quality Contribution: pins the SECOND site; the sibling tests above pin the
      first, and neither covers the other.
    */
    const fs = installedFs();
    fs.writeText(collectorStatePath(REPO), JSON.stringify(stateWith()));

    const result = readCollectorHealth({
      fs,
      host: { platform: 'darwin', arch: 'arm64', home: HOME },
      cwd: REPO,
      hash: new NodeHash(),
      manifest: pin(),
      ingress: await blockedPipe(),
    });

    expect(result.verdict).toBe('ingress-blocked');
    expect(result.detail).toContain(PIPE);
    expect(result.detail).not.toContain('(unknown)');
    // The false half: there is no socket file, and none was stat'ed.
    expect(result.detail).not.toContain('while the socket file exists');
    expect(result.detail).toContain('rather than simply failing to find the pipe');
    expect(result.next_action).toContain('NOT available for a named-pipe ingress');
  });

  it('the pipe recovery promises only what `harness commit` actually produces (F2)', async () => {
    /*
    Test Doc:
    - Why: this rung told a Windows operator that `harness commit` "tells you
      whether attribution landed". On the named-pipe branch commit-service
      deliberately SKIPS the note poll and returns `ingress-unverified` (plan 075
      · ac-0005), so the rung promised evidence the command refuses to produce —
      an operator would run it, read UNVERIFIED, and reasonably conclude the tool
      is broken. The right fix is to the promise, not to the commit behaviour:
      plan 075 chose not to claim on this transport on purpose.
    - Contract: the pipe recovery says the commit reports NOT VERIFIED and names
      the manual `git notes --ref=ai show` check; the af_unix recovery keeps its
      landed/buffer promise, which is true there.
    - Quality Contribution: pins a claim about a SIBLING service's behaviour that
      no test in this file would otherwise notice drifting. The af_unix row below
      stops the fix from being "delete the sentence everywhere".
    */
    const fs = installedFs();
    fs.writeText(collectorStatePath(REPO), JSON.stringify(stateWith()));
    const health = async (ingress: Awaited<ReturnType<typeof blockedPipe>>) =>
      readCollectorHealth({
        fs,
        host: { platform: 'darwin', arch: 'arm64', home: HOME },
        cwd: REPO,
        hash: new NodeHash(),
        manifest: pin(),
        ingress,
      });

    const pipe = await health(await blockedPipe());
    expect(pipe.next_action).not.toContain('tells you whether attribution landed');
    expect(pipe.next_action).toContain('NOT VERIFIED');
    expect(pipe.next_action).toContain('git notes --ref=ai show');

    const socket = await health(await blockedSocket());
    expect(socket.next_action).toContain('tells you whether attribution landed');
    expect(socket.next_action).not.toContain('git notes --ref=ai show');
  });

  it('the pipe sandbox sentence does NOT inherit the af_unix MEASURED claim (F3)', async () => {
    /*
    Test Doc:
    - Why: "which is what a command sandbox looks like" is a MEASURED statement
      about af_unix on this machine (an observed Seatbelt denial). Nothing here
      has ever run on Windows, so the pipe arm reading identically would launder
      an inference into an observation — exactly the honesty boundary this whole
      change is fenced by. The pipe arm is entitled to the inference; it is not
      entitled to the same confidence.
    - Contract: the pipe detail is labelled unmeasured; the af_unix detail keeps
      the unqualified sentence.
    - Quality Contribution: asserts the two sentences DIFFER, which is the actual
      property — a copy-paste of either arm into the other passes any test that
      only checks one of them.
    */
    const fs = installedFs();
    fs.writeText(collectorStatePath(REPO), JSON.stringify(stateWith()));
    const health = async (ingress: Awaited<ReturnType<typeof blockedPipe>>) =>
      readCollectorHealth({
        fs,
        host: { platform: 'darwin', arch: 'arm64', home: HOME },
        cwd: REPO,
        hash: new NodeHash(),
        manifest: pin(),
        ingress,
      });

    const pipe = await health(await blockedPipe());
    expect(pipe.detail).toContain('UNMEASURED on Windows');
    expect(pipe.detail).not.toContain('which is what a command sandbox looks like');

    const socket = await health(await blockedSocket());
    expect(socket.detail).toContain('which is what a command sandbox looks like');
    expect(socket.detail).not.toContain('UNMEASURED');
  });

  it('the ingress-blocked verdict is UNCHANGED for an af_unix socket', async () => {
    // The mutation guard on the row above: deleting the socket wording entirely
    // would satisfy every pipe assertion in this describe.
    const fs = installedFs();
    fs.writeText(collectorStatePath(REPO), JSON.stringify(stateWith()));

    const result = readCollectorHealth({
      fs,
      host: { platform: 'darwin', arch: 'arm64', home: HOME },
      cwd: REPO,
      hash: new NodeHash(),
      manifest: pin(),
      ingress: await blockedSocket(),
    });

    expect(result.verdict).toBe('ingress-blocked');
    expect(result.detail).toContain('while the socket file exists');
    expect(result.next_action).toContain('telemetry-nudge');
    expect(result.next_action).not.toContain('NOT available');
  });
});

/**
 * Plan 082 · F007 — A NEW STATE INHERITS THE DEFAULT VERDICT OF EVERY RUNG THAT
 * PREDATES IT, AND THE DEFAULT IS USUALLY "FINE".
 *
 * `binary-unusable` was added to the hook-status union for the installer's sake.
 * This ladder was written when that value could not exist, so every rung passed
 * it through — and the bottom of the ladder is `healthy`. A binary the Windows
 * loader refuses to start would have been reported as "installed and
 * hash-matching, collection is CONFIGURED".
 *
 * That is the same exhaustiveness lesson as the named-pipe work (F006), arriving
 * in a third place: adding a state to a union is never a local change, because
 * the fall-through verdict is always the most confident one available. These
 * rows exist so the ladder cannot silently regain that default.
 */
describe('a binary that cannot RUN is never healthy (plan 082 · F007)', () => {
  const unusable = (detail: string) =>
    stateWith({
      hooks: { status: 'binary-unusable', at: NOW, agents: [], detail },
    });

  it('does NOT fall through to healthy — the row would have lied more loudly after the fix', () => {
    // THE FIXTURE IS THE REAL PRODUCER, not a hand-typed sentence. The claim
    // under test is a COMPOSITION — `describeExit` names the measured cause, the
    // ladder interpolates it — and a fixture that types the detail by hand can
    // assert that composition while it is broken. This one goes through the
    // function production goes through.
    const result = health({
      fs: installedFs(),
      state: unusable(`\`${BINARY} --version\` ${describeExit(3_221_225_781, '')}`),
    });

    expect(result.verdict).not.toBe('healthy');
    expect(result.verdict).toBe('degraded');
    expect(result.detail).not.toContain('CONFIGURED');
    // The two halves that were previously said as one: the digest is REAL…
    expect(result.detail).toContain('digest matches');
    // …and it proves provenance, not that the program runs.
    expect(result.detail).toContain('CANNOT RUN');
    expect(result.detail).toContain('no AI attribution is being collected');
    // And the operator is given the measured cause, not a ten-digit integer —
    // stated ONCE, by the code that measured it, in the detail it produced.
    expect(`${result.detail} ${result.next_action}`).toContain('Visual C++ Redistributable');
    // F3 (review round 2): the command handed over must be RUNNABLE. Harness
    // deliberately never runs git-ai's own installer, which is the thing that
    // would put `git-ai` on PATH — so a bare `git-ai --version` is advice we
    // know does not work on the machine we are giving it to.
    expect(result.next_action).toContain(`${BINARY} --version`);
    expect(result.next_action).not.toContain('`git-ai --version`');
  });

  /**
   * F3 — THE MEASURED CAUSE IS NOT A GENERAL ONE. The brief allowed the
   * redistributable to be named for `0xC0000135` and nothing else: it is the one
   * cause that was verified, by fixing it on a Windows 11 guest. A probe that
   * timed out, could not be spawned, or exited 0 in silence has told us nothing
   * about DLLs — and on a Linux box the sentence is not even coherent.
   */
  it('does NOT name the Visual C++ Redistributable for an outcome that is not STATUS_DLL_NOT_FOUND', () => {
    const silent = health({
      fs: installedFs(),
      state: unusable(
        '`/home/u/.git-ai/bin/git-ai --version` exited 0 but printed nothing to either stream',
      ),
    });
    const timedOut = health({
      fs: installedFs(),
      state: unusable(
        '`/home/u/.git-ai/bin/git-ai --version` could not be spawned at all (ETIMEDOUT)',
      ),
    });

    for (const result of [silent, timedOut]) {
      const row = `${result.detail} ${result.next_action}`;
      expect(row).not.toContain('Visual C++');
      expect(row).not.toContain('VCRedist');
      // Still actionable, still executable, still honest about not knowing.
      expect(result.next_action).toContain(`${BINARY} --version`);
    }
  });

  it('tells the operator it self-heals — no flag, no re-run by hand', () => {
    const result = health({ fs: installedFs(), state: unusable('cannot start') });

    expect(result.next_action).toContain('next ordinary `harness doctor`');
    // Nothing here should send them at `--install-collector`: the probe is
    // re-attempted on every run precisely so that is unnecessary.
    expect(result.next_action).not.toContain('--install-collector');
  });

  it('a BLOCKED re-check keeps the coverage it proved and does not advise a command that cannot work', () => {
    const fs = installedFs();
    fs.mkdirp(`${HOME}/.cursor`);

    const result = health({
      fs,
      state: stateWith({
        // Hooks went on earlier, by a binary that DID run…
        hooks: {
          status: 'installed',
          at: NOW,
          agents: ['claude'],
          claimed: ['claude'],
          detail: 'hooks installed',
        },
        // …and the re-check for the new harness hit a binary that no longer does.
        last_attempt: {
          status: 'binary-unusable',
          at: NOW,
          detail: `\`${BINARY} --version\` ${describeExit(3_221_225_781, '')}`,
          uncovered: ['cursor'],
        },
      }),
    });

    expect(result.verdict).toBe('hooks-incomplete');
    expect(result.detail).toContain('Cursor');
    expect(result.detail).toContain('could no longer run');
    // The hooks that ARE on are still on: a probe that refused to invoke the
    // vendor command changed nothing on this machine.
    expect(result.detail).toContain('remain installed and collecting');
    // `--recheck-collector` would run the same probe and refuse again. Naming it
    // is advice we already know does not work.
    expect(result.next_action).not.toContain('--recheck-collector');
    // F3: same two rules as the primary rung — a runnable command, and the
    // measured cause carried by the attempt that measured it rather than
    // guessed at again here.
    expect(result.next_action).toContain(`${BINARY} --version`);
    expect(result.next_action).not.toContain('`git-ai --version`');
    expect(`${result.detail} ${result.next_action}`).toContain('0xC0000135');
  });

  it('the BLOCKED re-check does not guess at Windows either when the cause is something else', () => {
    const fs = installedFs();
    fs.mkdirp(`${HOME}/.cursor`);

    const result = health({
      fs,
      state: stateWith({
        hooks: {
          status: 'installed',
          at: NOW,
          agents: ['claude'],
          claimed: ['claude'],
          detail: 'hooks installed',
        },
        last_attempt: {
          status: 'binary-unusable',
          at: NOW,
          detail: `\`${BINARY} --version\` exited 0 but printed nothing to either stream`,
          uncovered: ['cursor'],
        },
      }),
    });

    const row = `${result.detail} ${result.next_action}`;
    expect(row).not.toContain('Visual C++');
    expect(row).not.toContain('VCRedist');
    expect(result.next_action).toContain(`Make the binary at ${BINARY} runnable`);
  });

  /**
   * F3 · THE RULE THIS ROUND ESTABLISHED — AN ACTIONABLE STRING MUST BE
   * SELF-CONTAINED, BECAUSE YOU CANNOT CONTROL WHICH SURFACE RENDERS IT ALONE.
   *
   * This is not hypothetical and it is not general-caution: `harness checks`'
   * housekeeping nudge takes `next_action` and NOTHING else
   * (`CollectorHooksReading`, three fields on purpose so it cannot couple to
   * this ladder), and it can reach exactly this rung — `hooks.missing` is `[]`
   * unless `hooks.status === 'installed'`, so the blocked RE-CHECK is the only
   * `binary-unusable` verdict that surface ever sees.
   *
   * So the assertion is deliberately on `next_action` BY ITSELF. A version that
   * said "see the detail above" passed a row-composed assertion and was false
   * exactly where an operator was standing.
   */
  it('next_action ALONE carries the cause — the `checks` nudge renders it with no detail beside it', () => {
    const fs = installedFs();
    fs.mkdirp(`${HOME}/.cursor`);
    const result = health({
      fs,
      state: stateWith({
        hooks: {
          status: 'installed',
          at: NOW,
          agents: ['claude'],
          claimed: ['claude'],
          detail: 'hooks installed',
        },
        last_attempt: {
          status: 'binary-unusable',
          at: NOW,
          detail: `\`${BINARY} --version\` ${describeExit(3_221_225_781, '')}`,
          uncovered: ['cursor'],
        },
      }),
    });

    const alone = result.next_action ?? '';
    // Everything an operator needs, with nothing else on screen: what to do…
    expect(alone).toContain(`Make the binary at ${BINARY} runnable`);
    // …what was actually observed…
    expect(alone).toContain('0xC0000135');
    expect(alone).toContain('Visual C++ Redistributable');
    // …and that it self-heals.
    expect(alone).toContain('next ordinary `harness doctor`');
    // The failure mode this row exists to forbid.
    expect(alone).not.toContain('above');
  });
});
