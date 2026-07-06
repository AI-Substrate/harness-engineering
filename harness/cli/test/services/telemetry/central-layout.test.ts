import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerTelemetryAct } from '../../../src/acts/telemetry.js';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { FakeGitWrite } from '../../../src/adapters/git/fake-git-write.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import type { CliIo, Writers } from '../../../src/output/output-port.js';

/**
 * Plan 047 Phase 3 · T002 — the central storage layout + sweep-granularity (AC-09).
 *
 * The layout is `<root>/<org__repo>/<YYYY-MM-DD>/<format>/<leaf>` with
 * `<format> ∈ {sessions, reports}` (workshop 004): repo FIRST so an ORG rollup is a
 * sweep of `<root>/`, a REPO rollup a sweep of `<root>/<repo>/`, a DAY one level
 * deeper — **sweep level = rollup granularity**. These tests exercise the layout with
 * the SAME recursive `sweepSessionFiles` the `report` act uses (driven end-to-end via
 * the real `report` command over the committed fixture tree, read through the real
 * `NodeFs`), proving each level yields the expected session set and that the sibling
 * `reports/` format dir is never ingested by a `*.session.json` sweep. A non-vacuity
 * mutation (point at a subtree / a nonexistent date) flips the granularity assertion.
 *
 * Identity (user/branch/models) lives INSIDE each leaf, never in the path (workshop
 * 004) — so repo + date are the only partition keys and everything else is a filter.
 */

const CENTRAL = fileURLToPath(new URL('./fixtures/central/', import.meta.url));
const WEB_APP = `${CENTRAL}acme-org__web-app`;
const API_SVC = `${CENTRAL}acme-org__api-svc`;

/** Drive the real `report` command over `paths`, returning the parsed JSON envelope. */
function runReport(
  paths: string[],
  extraArgs: string[] = [],
): { code: number; data: Record<string, unknown> } {
  const outDir = mkdtempSync(join(tmpdir(), 'harness-central-'));
  let emitted = '';
  const writers: Writers = {
    out: (t) => {
      emitted += t;
    },
    err: (t) => {
      emitted += t;
    },
  };
  const io: CliIo = { mode: 'json', writers };
  let code = -1;
  vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
    code = c ?? 0;
    throw new Error(`exit:${code}`);
  }) as never);
  try {
    const program = new Command().name('harness');
    registerTelemetryAct(program, io, {
      fs: new NodeFs(),
      proc: new FakeProcess({}, '/repo'),
      clock: new FakeClock('2026-06-30T00:00:00.000Z'),
      env: new FakeEnv(),
      gitWrite: new FakeGitWrite(),
    });
    expect(() =>
      program.parse([
        'node',
        'harness',
        'telemetry',
        'report',
        ...paths,
        '--out',
        join(outDir, 'r.json'),
        '--no-html',
        ...extraArgs,
      ]),
    ).toThrow(/^exit:/);
  } finally {
    vi.restoreAllMocks();
    rmSync(outDir, { recursive: true, force: true });
  }
  const envelope = JSON.parse(emitted) as { data?: Record<string, unknown> };
  return { code, data: envelope.data ?? {} };
}

/** The authoritative session count a sweep produced (dedup-by-id, from the envelope). */
function sessions(paths: string[], extraArgs: string[] = []): number {
  const { code, data } = runReport(paths, extraArgs);
  expect(code).toBe(0);
  return data.sessions as number;
}

describe('central layout — sweep level = rollup granularity (T002, AC-09)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('ORG sweep (<root>/) rolls up every repo × every date', () => {
    // 2 repos × 2 dates = 4 sessions across the whole tree.
    expect(sessions([CENTRAL])).toBe(4);
  });

  it('REPO sweep (<root>/<repo>/) rolls up only that repo, all its dates', () => {
    expect(sessions([WEB_APP])).toBe(2);
    expect(sessions([API_SVC])).toBe(2);
  });

  it('REPO-DAY sweep (<repo>/<date>/sessions/) rolls up exactly that partition', () => {
    expect(sessions([`${WEB_APP}/2026-06-24/sessions`])).toBe(1);
  });

  it('SINGLE-session sweep (a leaf file) is a one-session report (scope.single)', () => {
    const leaf = `${WEB_APP}/2026-06-24/sessions/11111111-1111-4111-8111-111111111111.session.json`;
    const { code, data } = runReport([leaf]);
    expect(code).toBe(0);
    expect(data.sessions).toBe(1);
    expect(data.single).toBe(true);
  });

  it('the sibling reports/ format dir is NEVER ingested by a session sweep', () => {
    // web-app/2026-06-24 holds BOTH sessions/<id>.session.json AND
    // reports/daily.report.json — the day sweep sees the one session, not the report.
    expect(sessions([`${WEB_APP}/2026-06-24`])).toBe(1);
  });

  it('NON-VACUITY: the count tracks the swept subtree (org > repo > day), not a constant', () => {
    const org = sessions([CENTRAL]);
    const repo = sessions([WEB_APP]);
    const day = sessions([`${WEB_APP}/2026-06-24/sessions`]);
    expect(org).toBeGreaterThan(repo);
    expect(repo).toBeGreaterThan(day);
    expect([org, repo, day]).toEqual([4, 2, 1]);
  });

  it('NON-VACUITY: a nonexistent date partition sweeps to ZERO sessions (honest error)', () => {
    const { code } = runReport([`${WEB_APP}/2099-01-01/sessions`]);
    expect(code).toBe(1); // no *.session.json found → honest exit 1, not a fabricated report
  });

  it('a content FILTER narrows within the same sweep (identity is in-file, not in the path)', () => {
    // Org sweep filtered to copilot-cli → only the web-app repo's 2 sessions.
    expect(sessions([CENTRAL], ['--filter-harness', 'copilot-cli'])).toBe(2);
    expect(sessions([CENTRAL], ['--filter-harness', 'claude-code'])).toBe(2);
  });
});
