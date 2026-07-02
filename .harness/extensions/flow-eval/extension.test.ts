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
import { loadScenario } from './scenario.js';

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
    expect(data.judged_pending).toBe(3);

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

  it('emits decomposed judged fields + judge provenance in report.json', async () => {
    const exec = new FakeExec({ [TELEMETRY_KEY]: { code: 0, stdout: JSON.stringify({ command: 'telemetry', status: 'ok', data: EVIDENCE }) } });
    const fs = repoFs();
    const ctx = buildCtx('score', { scenario: 'md-to-pdf', session: SESSION, worktree: WT }, fs, exec);

    const res = await flowEval.run(ctx);
    expect(res.status).toBe('ok');
    const reportPath = fs.writes.find((p) => p.endsWith('report.json')) as string;
    const json = JSON.parse(fs.readText(reportPath) as string);
    expect(json.judged.map((j: Record<string, unknown>) => j.field)).toEqual([
      'plan-coherence',
      'report-contract-coverage',
      'explanation-matches-telemetry',
    ]);
    expect(json.judged.every((j: Record<string, unknown>) => String(j.prompt).includes('CoT-before-score'))).toBe(true);
    expect(json.judged.every((j: Record<string, unknown>) => String(j.prompt).includes('<canonical_good_flow_anchor>'))).toBe(true);
    expect(json.provenance.judge).toMatchObject({
      model: 'gpt-5.5',
      model_version: 'gpt-5.5-2026-07-01',
      different_family_than_subject: true,
      artifact_only: true,
      temperature: 0,
      version_pinned: true,
      warnings: [],
    });
  });

  it('3.3 NON-VACUITY: every decomposed judged report prompt excludes prohibited sources', async () => {
    const exec = new FakeExec({ [TELEMETRY_KEY]: { code: 0, stdout: JSON.stringify({ command: 'telemetry', status: 'ok', data: EVIDENCE }) } });
    const fs = repoFs();
    const ctx = buildCtx('score', { scenario: 'md-to-pdf', session: SESSION, worktree: WT }, fs, exec);

    const res = await flowEval.run(ctx);
    expect(res.status).toBe('ok');
    const reportPath = fs.writes.find((p) => p.endsWith('report.json')) as string;
    const json = JSON.parse(fs.readText(reportPath) as string);
    const judged = json.judged as Array<Record<string, unknown>>;
    expect(judged.map((j) => j.field)).toEqual([
      'plan-coherence',
      'report-contract-coverage',
      'explanation-matches-telemetry',
    ]);
    for (const j of judged) {
      const prompt = String(j.prompt);
      expect(prompt).toContain('Artifact boundary: use report.json/report.md, deterministic result rows, session-export.json, and worktree artifacts only');
      expect(prompt).toContain('do not use subject prose, chat transcript, identity hints, or self-report.');
    }
  });

  it('3.2 same-family judge warning is visible in the report, never a crash', async () => {
    const fs = repoFs();
    const scenarioPath = `${REPO}/live-testing/scenarios/md-to-pdf/scenario.json`;
    const raw = JSON.parse(fs.readText(scenarioPath) as string);
    raw.subject.model = 'gpt-5.5';
    fs.writeText(scenarioPath, `${JSON.stringify(raw, null, 2)}\n`);
    const exec = new FakeExec({ [TELEMETRY_KEY]: { code: 0, stdout: JSON.stringify({ command: 'telemetry', status: 'ok', data: EVIDENCE }) } });
    const ctx = buildCtx('score', { scenario: 'md-to-pdf', session: SESSION, worktree: WT }, fs, exec);

    const res = await flowEval.run(ctx);
    expect(res.status).toBe('ok');
    const reportPath = fs.writes.find((p) => p.endsWith('report.json')) as string;
    const json = JSON.parse(fs.readText(reportPath) as string);
    expect(json.provenance.judge.warnings).toEqual(['judge-same-family-as-subject']);
    expect(json.provenance.judge.different_family_than_subject).toBe(false);
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

describe('flow-eval score — F4 cost/export wiring (session save → telemetry_summary)', () => {
  const GET_KEY = `harness telemetry get ${SESSION} --json --worktree ${WT}`;
  const HSID = 'claude-sess-xyz';
  const EVIDENCE_HS = { ...EVIDENCE, harness_session_id: HSID };
  const SAVE_ENVELOPE = {
    command: 'telemetry',
    status: 'ok',
    data: {
      session_id: HSID,
      out: '/repo/.harness/live-testing/md-to-pdf/RUN/session-export.json',
      totals: {
        active_time_s: 1234,
        tokens: { input: 5000, output: 900 },
        cache: { read: 400000, create: 12000 },
        turns: 42,
      },
    },
  };

  /** The record appended on the LAST line of the scenario ledger (the run we just scored). */
  function lastLedgerRecord(fs: FakeFs): Record<string, unknown> {
    const path = fs.writes.find((p) => p.endsWith('ledger.jsonl'));
    expect(path).toBeDefined();
    const raw = fs.readText(path as string) as string;
    return JSON.parse(raw.trim().split('\n').pop() as string);
  }

  it('populates session_export + telemetry_summary from the save envelope totals (one exec AFTER get)', async () => {
    const exec = new FakeExec({
      [GET_KEY]: { code: 0, stdout: JSON.stringify({ command: 'telemetry', status: 'ok', data: EVIDENCE_HS }) },
      // Command-level fallback: the `session save` call (any --out path) returns the totals.
      harness: { code: 0, stdout: JSON.stringify(SAVE_ENVELOPE) },
    });
    const fs = repoFs();
    const ctx = buildCtx('score', { scenario: 'md-to-pdf', session: SESSION, worktree: WT }, fs, exec);

    const res = await flowEval.run(ctx);
    expect(res.status).toBe('ok');

    // get is STILL fetched exactly once; save is a SEPARATE (second) harness call.
    const getCalls = exec.calls.filter((c) => c.command === 'harness' && c.args[1] === 'get');
    expect(getCalls).toHaveLength(1);
    const saveCalls = exec.calls.filter((c) => c.command === 'harness' && c.args[1] === 'session' && c.args[2] === 'save');
    expect(saveCalls).toHaveLength(1);
    expect(saveCalls[0].args).toEqual(expect.arrayContaining(['session', 'save', HSID, '--no-html', '--json']));

    // The appended ledger record carries the REAL cost totals (not null, not zeros).
    const rec = lastLedgerRecord(fs);
    expect(rec.telemetry_summary).toEqual({
      active_time_s: 1234,
      tokens: { input: 5000, output: 900 },
      cache: { read: 400000, create: 12000 },
      turns: 42,
    });
    expect(rec.session_export as string).toContain('session-export.json');
  });

  it('NON-VACUITY: a FAILED save leaves session_export + telemetry_summary null (honest, never zero-filled)', async () => {
    const exec = new FakeExec({
      [GET_KEY]: { code: 0, stdout: JSON.stringify({ command: 'telemetry', status: 'ok', data: EVIDENCE_HS }) },
      harness: { code: 1, stdout: '' }, // the save fails
    });
    const fs = repoFs();
    const ctx = buildCtx('score', { scenario: 'md-to-pdf', session: SESSION, worktree: WT }, fs, exec);

    const res = await flowEval.run(ctx);
    expect(res.status).toBe('ok'); // honest degradation — never a crash

    const rec = lastLedgerRecord(fs);
    expect(rec.telemetry_summary).toBeNull();
    expect(rec.session_export).toBeNull();
    // telemetry_available semantics are UNCHANGED — evidence WAS fetched.
    expect(rec.telemetry_available).toBe(true);
  });

  it('no harness_session_id ⇒ NO save call at all (never guesses an id)', async () => {
    // EVIDENCE (no harness_session_id) → the score path must not attempt a save.
    const exec = new FakeExec({
      [GET_KEY]: { code: 0, stdout: JSON.stringify({ command: 'telemetry', status: 'ok', data: EVIDENCE }) },
    });
    const fs = repoFs();
    const ctx = buildCtx('score', { scenario: 'md-to-pdf', session: SESSION, worktree: WT }, fs, exec);

    await flowEval.run(ctx);
    const saveCalls = exec.calls.filter((c) => c.command === 'harness' && c.args[1] === 'session');
    expect(saveCalls).toHaveLength(0);
    expect(lastLedgerRecord(fs).telemetry_summary).toBeNull();
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
    expect(parsed.judge.criteria).toEqual([
      'plan-coherence',
      'report-contract-coverage',
      'explanation-matches-telemetry',
    ]);
    const loaded = loadScenario('new-scn', fs, `${REPO}/live-testing/scenarios`);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.scenario.assertions.find((a) => a.type === 'judged')?.required).toBeUndefined();
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

describe('flow-eval ledger — reads the scenario ledger (2.4/2.5)', () => {
  const LEDGER = `${REPO}/.harness/live-testing/md-to-pdf/ledger.jsonl`;

  /** A minimal valid RunRecord line for the ledger fixture. */
  function recLine(over: Record<string, unknown>): string {
    const base = {
      schema_version: 1,
      run_id: 'r',
      ts: '2026-07-01T00:00:00.000Z',
      scenario: 'md-to-pdf',
      subject: { model: 'sonnet-5', harness: 'claude' },
      base_ref: 'base-A',
      seed_tuple: { model: 'sonnet-5', harness: 'claude', base_ref: 'base-A', scenario_hash: 'fnv1a:v1', prompt_hash: 'fnv1a:p' },
      lanes: [{ lane: 'skill-sequence', assertion_id: 'A2', verdict: 'pass', required: true, axis: 'process' }],
      axis_scores: { capability: 1, process: 1 },
      verdict: 'PASS',
      telemetry_available: true,
      duration_s: 900,
      session_export: null,
      telemetry_summary: null,
    };
    return `${JSON.stringify({ ...base, ...over })}\n`;
  }

  it('lists runs + surfaces a flipped lane (default view)', async () => {
    const fs = new FakeFs({
      [LEDGER]:
        recLine({ run_id: 'r1', lanes: [{ lane: 'skill-sequence', assertion_id: 'A2', verdict: 'pass', required: true, axis: 'process' }] }) +
        recLine({ run_id: 'r2', ts: '2026-07-01T00:01:00.000Z', lanes: [{ lane: 'skill-sequence', assertion_id: 'A2', verdict: 'fail', required: true, axis: 'process' }] }),
    });
    const res = await flowEval.run(buildCtx('ledger', { scenario: 'md-to-pdf' }, fs, new FakeExec()));
    expect(res.status).toBe('ok');
    const data = res.data as Record<string, unknown>;
    expect(data.run_count).toBe(2);
    expect(data.flipped_lanes).toContain('A2');
    expect(String(data.board)).toContain('⚑');
    // pure read — never fetches telemetry, never drives pij.
    // (no exec scripted; a telemetry/pij call would have thrown / mismatched.)
  });

  it('errors (E_ARGS) without --scenario', async () => {
    const res = await flowEval.run(buildCtx('ledger', {}, new FakeFs(), new FakeExec()));
    expect(res.status).toBe('error');
    expect(res.error?.code).toBe('E_ARGS');
  });

  it('--compare renders a board on matched groups', async () => {
    const fs = new FakeFs({
      [LEDGER]:
        recLine({ run_id: 's1', subject: { model: 'sonnet-5', harness: 'claude' }, seed_tuple: { model: 'sonnet-5', harness: 'claude', base_ref: 'base-A', scenario_hash: 'fnv1a:v1', prompt_hash: 'p' } }) +
        recLine({ run_id: 'g1', subject: { model: 'gpt-5.5', harness: 'claude' }, seed_tuple: { model: 'gpt-5.5', harness: 'claude', base_ref: 'base-A', scenario_hash: 'fnv1a:v1', prompt_hash: 'p' } }),
    });
    const res = await flowEval.run(buildCtx('ledger', { scenario: 'md-to-pdf', compare: ['sonnet-5', 'gpt-5.5'] }, fs, new FakeExec()));
    expect(res.status).toBe('ok');
    const data = res.data as Record<string, unknown>;
    expect(data.models).toEqual(['sonnet-5', 'gpt-5.5']);
    expect(String(data.board)).toContain('McNemar');
  });

  it('--compare REFUSES (E_COMPARE) across a mismatched scenario_hash', async () => {
    const fs = new FakeFs({
      [LEDGER]:
        recLine({ run_id: 's1', subject: { model: 'sonnet-5', harness: 'claude' }, seed_tuple: { model: 'sonnet-5', harness: 'claude', base_ref: 'base-A', scenario_hash: 'fnv1a:v1', prompt_hash: 'p' } }) +
        recLine({ run_id: 'g1', subject: { model: 'gpt-5.5', harness: 'claude' }, seed_tuple: { model: 'gpt-5.5', harness: 'claude', base_ref: 'base-A', scenario_hash: 'fnv1a:v2', prompt_hash: 'p' } }),
    });
    const res = await flowEval.run(buildCtx('ledger', { scenario: 'md-to-pdf', compare: ['sonnet-5', 'gpt-5.5'] }, fs, new FakeExec()));
    expect(res.status).toBe('error');
    expect(res.error?.code).toBe('E_COMPARE');
  });
});
