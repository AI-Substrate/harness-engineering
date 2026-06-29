import { existsSync, readFileSync } from 'node:fs';
import { dirname, join as njoin } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../harness/cli/src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../harness/cli/src/adapters/env/fake-env.js';
import { FakeExec } from '../../../harness/cli/src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../../harness/cli/src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../../harness/cli/src/adapters/git/fake-git.js';
import { buildVerbContext } from '../../../harness/cli/src/services/extensions/verb-context.js';
import flowEval from './extension.js';

/*
Test Doc:
- Why: AC-04/05/06/07 end-to-end for the extension. The single `flow-eval` verb dispatches
  on a positional action; `score` is the ONLY action verb — it fetches evidence ONCE via the
  Phase-1 verb (ctx.exec, NOT a CLI import), resolves+scores, and writes a report; it NEVER
  drives pij (critic-F1). `scaffold` writes a valid skeleton.
- Contract: score over the committed fixture + satisfied telemetry → ok envelope, verdict
  PASS, report written; telemetry error → telemetry assertions unknown (verdict not FAIL);
  malformed scenario → error; no ctx.exec call is `pij`; scaffold writes + refuses clobber.
*/

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = njoin(HERE, 'fixtures', 'scenarios', 'md-to-pdf');
const REPO = '/repo';
const WT = '/wt';
const SESSION = 'pij-fixture';

/** The SessionEvidence the (faked) `telemetry get` returns — all telemetry lanes satisfied. */
const EVIDENCE = {
  pij_session_id: SESSION,
  harness: 'claude-code',
  segments: 7,
  skills: { 'the-flow': 4, explore: 1, plan: 1, implement: 1 },
  skill_order: ['explore', 'plan', 'the-flow', 'implement'],
  files: { written: ['x.ts'], edited: [] },
  flow_seams: ['eng-harness-flow:pre-coding'],
  harness_verbs: { checks: 2, retro: 1 },
  checks: [{ status: 'ok' }],
  compactions: 1,
  tools: { Write: 5, Edit: 3 },
  gaps: ['plans_touched'],
};

const TELEMETRY_KEY = `harness telemetry get ${SESSION} --json --worktree ${WT}`;

function readFixture(name: string): string {
  return readFileSync(njoin(FIXTURE, name), 'utf8');
}

/** A FakeFs holding the committed scenario bundle (at /repo/...) + the worktree fixture (at /wt). */
function repoFs(): FakeFs {
  return new FakeFs(
    {
      [`${REPO}/live-testing/scenarios/md-to-pdf/scenario.json`]: readFixture('scenario.json'),
      [`${REPO}/live-testing/scenarios/md-to-pdf/assertions.json`]: readFixture('assertions.json'),
      [`${WT}/.harness/extensions/foo/extension.ts`]: 'export default {}',
      [`${WT}/README.md`]: '# converts markdown to PDF',
      [`${WT}/docs/guide/usage.md`]: '# usage',
      [`${WT}/.harness/records/retro/2026/r.md`]: '# retro',
    },
    {
      [WT]: ['.harness', 'README.md', 'docs'],
      [`${WT}/.harness`]: ['extensions', 'records'],
      [`${WT}/.harness/extensions`]: ['foo'],
      [`${WT}/.harness/extensions/foo`]: ['extension.ts'],
      [`${WT}/docs`]: ['guide'],
      [`${WT}/docs/guide`]: ['usage.md'],
      [`${WT}/.harness/records`]: ['retro'],
      [`${WT}/.harness/records/retro`]: ['2026'],
      [`${WT}/.harness/records/retro/2026`]: ['r.md'],
    },
  );
}

function buildCtx(
  action: string,
  options: Record<string, unknown>,
  fs: FakeFs,
  exec: FakeExec,
  withFsWrite = true,
) {
  const ctx = buildVerbContext(
    {
      exec,
      fs,
      ...(withFsWrite && { fsWrite: fs }),
      env: new FakeEnv(),
      git: new FakeGit({ isRepo: true, branch: 'main' }),
      clock: new FakeClock('2026-06-23T11:00:00.000Z'),
    },
    { cwd: REPO, args: { action }, options },
  );
  return ctx;
}

describe('flow-eval — default export', () => {
  it('is a single verb named flow-eval that dispatches score|scaffold via a positional', () => {
    expect(flowEval.name).toBe('flow-eval');
    expect(flowEval.args?.[0]?.name).toBe('[action]');
  });

  it('errors (E_ACTION) on an unknown action', async () => {
    const res = await flowEval.run(buildCtx('nope', {}, new FakeFs(), new FakeExec()));
    expect(res.status).toBe('error');
    expect(res.error?.code).toBe('E_ACTION');
  });
});

describe('flow-eval score — happy path over the committed fixture', () => {
  it('fetches evidence once, scores PASS, and writes the report (never driving pij)', async () => {
    const exec = new FakeExec({ [TELEMETRY_KEY]: { code: 0, stdout: JSON.stringify({ command: 'telemetry', status: 'ok', data: EVIDENCE }) } });
    const fs = repoFs();
    const ctx = buildCtx('score', { scenario: 'md-to-pdf', session: SESSION, worktree: WT }, fs, exec);

    const res = await flowEval.run(ctx);

    expect(res.status).toBe('ok');
    const data = res.data as Record<string, unknown>;
    expect(data.verdict).toBe('PASS');
    expect(data.score).toBe(1);
    expect(data.telemetry).toMatchObject({ available: true, segments: 7 });
    expect(data.judged_pending).toBe(1);

    // the report landed under .harness/live-testing/<slug>/<run-id>/
    const wrote = fs.writes.find((p) => p.endsWith('report.json'));
    expect(wrote).toMatch(/\.harness\/live-testing\/md-to-pdf\/.*\/report\.json$/);
    expect(fs.writes.some((p) => p.endsWith('report.md'))).toBe(true);

    // evidence fetched EXACTLY once via the Phase-1 verb.
    const telCalls = exec.calls.filter((c) => c.command === 'harness' && c.args[0] === 'telemetry');
    expect(telCalls).toHaveLength(1);
    expect(telCalls[0].args).toEqual(['telemetry', 'get', SESSION, '--json', '--worktree', WT]);

    // critic-F1: the extension NEVER drives pij.
    expect(exec.calls.some((c) => c.command === 'pij')).toBe(false);
  });
});

describe('flow-eval score — telemetry unavailable ⇒ telemetry assertions unknown (not fail)', () => {
  it('still writes a report and does NOT cap to FAIL on a telemetry capability gap', async () => {
    // No script for telemetry get → empty stdout → evidence parses to null.
    const exec = new FakeExec();
    const fs = repoFs();
    const ctx = buildCtx('score', { scenario: 'md-to-pdf', session: SESSION, worktree: WT }, fs, exec);

    const res = await flowEval.run(ctx);

    expect(res.status).toBe('ok');
    const data = res.data as Record<string, unknown>;
    expect(data.telemetry).toMatchObject({ available: false });
    // A1 is a REQUIRED telemetry assertion — but unknown, so it must NOT force FAIL.
    expect(data.required_failed).toBe(0);
    expect(data.verdict).toBe('PASS_WITH_NOTES');
    expect(Number(data.unknown)).toBeGreaterThan(0);
  });
});

describe('flow-eval score — error paths', () => {
  it('errors (E_SCENARIO) on a malformed scenario bundle', async () => {
    const fs = new FakeFs({ [`${REPO}/live-testing/scenarios/broken/scenario.json`]: '{ not json' });
    const ctx = buildCtx('score', { scenario: 'broken', session: SESSION }, fs, new FakeExec());
    const res = await flowEval.run(ctx);
    expect(res.status).toBe('error');
    expect(res.error?.code).toBe('E_SCENARIO');
  });

  it('errors (E_ARGS) when --scenario / --session are missing', async () => {
    const ctx = buildCtx('score', {}, new FakeFs(), new FakeExec());
    const res = await flowEval.run(ctx);
    expect(res.status).toBe('error');
    expect(res.error?.code).toBe('E_ARGS');
  });
});

describe('flow-eval scaffold — writes a valid skeleton, refuses to clobber', () => {
  it('writes scenario.json + assertions.json + prompts under live-testing/scenarios/<slug>/', async () => {
    const fs = new FakeFs();
    const ctx = buildCtx('scaffold', { slug: 'new-scn' }, fs, new FakeExec());
    const res = await flowEval.run(ctx);
    expect(res.status).toBe('ok');
    const base = `${REPO}/live-testing/scenarios/new-scn`;
    expect(fs.writes).toContain(`${base}/scenario.json`);
    expect(fs.writes).toContain(`${base}/assertions.json`);
    expect(fs.writes).toContain(`${base}/prompts/orchestrator.md`);
    expect(fs.writes).toContain(`${base}/prompts/subject.md`);
    // the scaffolded scenario.json is itself valid JSON carrying the slug.
    const parsed = JSON.parse(fs.readText(`${base}/scenario.json`) as string);
    expect(parsed.slug).toBe('new-scn');
  });

  it('refuses (E_EXISTS) when the scenario already exists', async () => {
    const fs = new FakeFs({ [`${REPO}/live-testing/scenarios/dup/scenario.json`]: '{}' });
    const ctx = buildCtx('scaffold', { slug: 'dup' }, fs, new FakeExec());
    const res = await flowEval.run(ctx);
    expect(res.status).toBe('error');
    expect(res.error?.code).toBe('E_EXISTS');
  });

  it('errors (E_NO_FSWRITE) when the core provides no fsWrite', async () => {
    const ctx = buildCtx('scaffold', { slug: 'x' }, new FakeFs(), new FakeExec(), false);
    const res = await flowEval.run(ctx);
    expect(res.status).toBe('error');
    expect(res.error?.code).toBe('E_NO_FSWRITE');
  });
});
