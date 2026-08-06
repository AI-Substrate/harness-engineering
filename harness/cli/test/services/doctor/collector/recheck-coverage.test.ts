import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../../src/adapters/clock/fake-clock.js';
import { NodeHash } from '../../../../src/adapters/hash/node-hash.js';
import { readCollectorHealth } from '../../../../src/services/doctor/collector/health.js';
import {
  installCollector,
  recheckCollector,
} from '../../../../src/services/doctor/collector/install.js';
import { GITAI_PIN } from '../../../../src/services/doctor/collector/pin.js';
import { readCollectorState } from '../../../../src/services/doctor/collector/state.js';
import type { CollectorDeps } from '../../../../src/services/doctor/collector/types.js';
import {
  FakeCollectorFs,
  FakeDownload,
  FakeExecutableBit,
  FakePathKind,
  FakeSequencedExec,
  ok200,
} from '../../../support/collector-fakes.js';

/**
 * Plan 073 · ac-0010, ac-0014 — THE WHOLE SEQUENCE, end to end, because every
 * part of it passed on its own while the sequence produced a wrong number
 * (phase-1 review, round 3).
 *
 * What went wrong: Claude and Codex are hooked and verified. Cursor appears.
 * Doctor correctly says `hooks-incomplete`. The operator does exactly what we
 * told them and runs `--recheck-collector`. The trace2 guard blocks — correctly,
 * because git-ai's own keys are now in the global config and nothing local can
 * prove they are still ours to delete. The block then overwrote hook coverage
 * with `agents: []`, so the next doctor read took the `cli-only-trace2` branch
 * and announced that NO AI attribution was being collected at all.
 *
 * That is false — Claude and Codex are still hooked — and it also discarded the
 * new-agent gap the re-check had just found. Following our own advice made the
 * report worse than not running it: a confident wrong number, which is the exact
 * defect this plan exists to stop shipping.
 *
 * These tests are written at the seam where that happened: state in, health out,
 * over a real install followed by a real block.
 */

const HOME = '/home/u';
const REPO = '/repo';
const NOW = '2026-08-06T10:00:00.000Z';
const BINARY = '/home/u/.git-ai/bin/git-ai';
const TRACE2_GET = 'git config --global --get-regexp ^trace2\\.';
/** git-ai's own two keys — what a successful `install-hooks` leaves behind. */
const GITAI_TRACE2 =
  'trace2.eventtarget af_unix:/home/u/.git-ai/internal/daemon/trace2.sock\ntrace2.eventnesting 5';
const PAYLOAD = new TextEncoder().encode('#!/bin/sh\necho git-ai\n');
const ARTIFACT_URL = `${GITAI_PIN.release_base_url}/${GITAI_PIN.version}/git-ai-macos-arm64`;

function testPin() {
  const digest = new NodeHash().sha256Hex(PAYLOAD);
  return {
    ...GITAI_PIN,
    artifacts: {
      ...GITAI_PIN.artifacts,
      'macos-arm64': { file: 'git-ai-macos-arm64', sha256: digest },
    },
  } as typeof GITAI_PIN;
}

/**
 * A machine that installs cleanly and then STAYS that way: trace2 reads empty
 * for the first (guard) read and reports git-ai's own keys for every read after
 * it. That is not a contrivance — it is what a successful install does to a
 * machine, and it is why every later re-check gets blocked.
 */
function machine(): CollectorDeps & { fs: FakeCollectorFs; exec: FakeSequencedExec } {
  const fs = new FakeCollectorFs();
  fs.mkdirp(`${HOME}/.claude`);
  fs.mkdirp(`${HOME}/.codex`);
  const exec = new FakeSequencedExec({
    [TRACE2_GET]: [
      { code: 1, stdout: '' },
      { code: 0, stdout: `${GITAI_TRACE2}\n` },
    ],
    [`${BINARY} install-hooks`]: { code: 0, stdout: 'claude: installed\ncodex: installed\n' },
    [`${BINARY} status --json`]: { code: 0, stdout: '{"schema_version":"authorship/3.0.0"}' },
  });
  return {
    fs,
    exec,
    hash: new NodeHash(),
    paths: new FakePathKind(),
    http: new FakeDownload({ [ARTIFACT_URL]: ok200(PAYLOAD) }),
    exe: new FakeExecutableBit(),
    clock: new FakeClock(NOW),
    host: { platform: 'darwin', arch: 'arm64', home: HOME },
    cwd: REPO,
    manifest: testPin(),
  };
}

function health(deps: CollectorDeps & { fs: FakeCollectorFs }) {
  return readCollectorHealth({
    fs: deps.fs,
    host: deps.host,
    cwd: REPO,
    hash: new NodeHash(),
    manifest: testPin(),
  });
}

describe('install → new agent → blocked re-check (the sequence, not the steps)', () => {
  it('a trace2-blocked re-check keeps the coverage it proved and the gap it found', async () => {
    const deps = machine();
    await installCollector(deps);
    expect(health(deps).verdict).toBe('healthy');

    // July: Cursor arrives. Nothing on the machine says its edits are unattributed.
    deps.fs.mkdirp(`${HOME}/.cursor`);
    const beforeRecheck = health(deps);
    expect(beforeRecheck.verdict).toBe('hooks-incomplete');
    expect(beforeRecheck.hooks.missing).toEqual(['cursor']);

    // The operator does what the row told them to do.
    const recheck = await recheckCollector(deps);

    // The ATTEMPT was blocked — that part was already right.
    expect(recheck.hooks).toBe('skipped-trace2');
    expect(recheck.newAgents).toEqual(['cursor']);
    expect(recheck.manualInstructions.join('\n')).toContain('install-hooks');
    // …and COVERAGE survived it. The guard never invoked git-ai, so nothing on
    // this machine changed, so nothing we say about this machine may change.
    expect(recheck.coverage).toEqual({ status: 'installed', agents: ['claude', 'codex'] });

    const state = readCollectorState(deps.fs, REPO);
    expect(state?.hooks.status).toBe('installed');
    expect(state?.hooks.agents).toEqual(['claude', 'codex']);
    // The block is recorded — as an attempt, in its own field, naming the gap.
    expect(state?.last_attempt?.status).toBe('skipped-trace2');
    expect(state?.last_attempt?.uncovered).toEqual(['cursor']);
  });

  it('doctor after the blocked re-check names the new harness, not an absence of attribution', async () => {
    const deps = machine();
    await installCollector(deps);
    deps.fs.mkdirp(`${HOME}/.cursor`);
    await recheckCollector(deps);

    const after = health(deps);

    // Not a false healthy row…
    expect(after.verdict).not.toBe('healthy');
    // …and not the far worse false claim that nothing is being collected.
    expect(after.verdict).toBe('hooks-incomplete');
    expect(after.verdict).not.toBe('cli-only-trace2');
    expect(after.detail).not.toContain('no AI attribution is being collected');
    expect(after.hooks.status).toBe('installed');
    expect(after.hooks.missing).toEqual(['cursor']);
    // It says what IS collecting, and what is not.
    expect(after.detail).toContain('claude, codex');
    expect(after.detail).toContain('Cursor');
    expect(after.detail).toContain('NOT instrumented');
    // Yellow, with the command that actually works — not "re-run the re-check",
    // which we have just watched get blocked.
    expect(after.next_action).toContain(`${BINARY} install-hooks`);
    expect(after.next_action).toContain('Cursor');
    // The block itself is still visible, in the field that is about the attempt.
    expect(after.lastAttempt?.status).toBe('skipped-trace2');
  });

  it('the warning says the existing hooks are unaffected, not that hooks are off', async () => {
    const deps = machine();
    await installCollector(deps);
    deps.fs.mkdirp(`${HOME}/.cursor`);

    const recheck = await recheckCollector(deps);
    const text = recheck.warnings.join(' ');

    expect(text).toContain('Cursor');
    expect(text).toContain('UNAFFECTED');
    expect(text).not.toContain('hooks NOT installed');
  });

  it('a FIRST install blocked by trace2 still reports cli-only-trace2 — there was nothing to preserve', async () => {
    const deps = machine();
    // Someone else's trace2 config, on a machine harness has never touched.
    const exec = new FakeSequencedExec({
      [TRACE2_GET]: { code: 0, stdout: 'trace2.normalTarget /tmp/trace\n' },
      [`${BINARY} status --json`]: { code: 0, stdout: '{"schema_version":"authorship/3.0.0"}' },
    });

    await installCollector({ ...deps, exec });

    const state = readCollectorState(deps.fs, REPO);
    expect(state?.hooks.status).toBe('skipped-trace2');
    expect(state?.hooks.agents).toEqual([]);
    // The two verdicts stay distinct: THIS is the one that means no attribution
    // at all, and it is reachable only when no coverage was ever proven.
    expect(health(deps).verdict).toBe('cli-only-trace2');
    expect(exec.calls.some((call) => call.args[0] === 'install-hooks')).toBe(false);
  });
});
