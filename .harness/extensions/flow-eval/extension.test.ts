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
import { validateRunRecord } from './ledger.js';
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

describe('flow-eval score — F-A subject/base-ref fidelity + worktree drift warning (dogfood run-1)', () => {
  const HEAD_KEY = 'git rev-parse --short HEAD';

  /** The record appended on the LAST line of the scenario ledger (the run we just scored). */
  function lastLedgerRecord(fs: FakeFs): Record<string, unknown> {
    const path = fs.writes.find((p) => p.endsWith('ledger.jsonl'));
    expect(path).toBeDefined();
    const raw = fs.readText(path as string) as string;
    return JSON.parse(raw.trim().split('\n').pop() as string);
  }

  it('--subject-* / --base-ref overrides win over scenario.json for subject, base_ref, seed_tuple AND the report header', async () => {
    const exec = new FakeExec({ [TELEMETRY_KEY]: { code: 0, stdout: JSON.stringify({ command: 'telemetry', status: 'ok', data: EVIDENCE }) } });
    const fs = repoFs();
    const ctx = buildCtx(
      'score',
      { scenario: 'md-to-pdf', session: SESSION, worktree: WT, subjectHarness: 'pi', subjectModel: 'gpt-5.5', subjectEffort: 'medium', baseRef: 'e27e4c69' },
      fs,
      exec,
    );

    const res = await flowEval.run(ctx);
    expect(res.status).toBe('ok');

    // report.json carries the HONEST subject + base_ref (the override, NOT the fixture defaults).
    const reportPath = fs.writes.find((p) => p.endsWith('report.json')) as string;
    const json = JSON.parse(fs.readText(reportPath) as string);
    expect(json.subject).toMatchObject({ harness: 'pi', model: 'gpt-5.5', effort: 'medium', pij_session_id: SESSION });
    expect(json.base_ref).toBe('e27e4c69');

    // report.md header reflects the override too.
    const md = fs.readText(fs.writes.find((p) => p.endsWith('report.md')) as string) as string;
    expect(md).toContain('pi · gpt-5.5 · medium');
    expect(md).toContain('**Base ref**: e27e4c69');

    // NON-VACUITY (override-ignored → RED): ledger subject/base_ref AND seed_tuple stay LOCK-STEP.
    const rec = lastLedgerRecord(fs);
    expect(rec.subject).toMatchObject({ model: 'gpt-5.5', harness: 'pi', effort: 'medium' });
    expect(rec.base_ref).toBe('e27e4c69');
    expect(rec.seed_tuple).toMatchObject({ model: 'gpt-5.5', harness: 'pi', effort: 'medium', base_ref: 'e27e4c69' });
    // the fixture defaults (opus / claude / v0.6.0) must NOT survive anywhere in the record.
    const recStr = JSON.stringify(rec);
    expect(recStr).not.toContain('opus');
    expect(recStr).not.toContain('v0.6.0');
    expect(recStr).not.toContain('"harness":"claude"');

    // schema round-trip still holds — RunRecord FIELDS unchanged, only their VALUES honest.
    expect(validateRunRecord(rec)).toEqual([]);
  });

  it('warns (envelope + report.md) when the worktree HEAD ≠ the effective base_ref, never crashing', async () => {
    const exec = new FakeExec({
      [TELEMETRY_KEY]: { code: 0, stdout: JSON.stringify({ command: 'telemetry', status: 'ok', data: EVIDENCE }) },
      [HEAD_KEY]: { code: 0, stdout: 'e27e4c6\n' },
    });
    const fs = repoFs();
    // base_ref stays the fixture default v0.6.0; the worktree's real HEAD is a different sha.
    const ctx = buildCtx('score', { scenario: 'md-to-pdf', session: SESSION, worktree: WT }, fs, exec);

    const res = await flowEval.run(ctx);
    expect(res.status).toBe('ok'); // never a crash, never a silent pass

    const data = res.data as Record<string, unknown>;
    const warnings = (data.warnings as string[] | undefined) ?? [];
    expect(warnings.join(' ')).toContain('e27e4c6');
    expect(warnings.join(' ')).toContain('v0.6.0');

    // the drift is visible in report.md too.
    const md = fs.readText(fs.writes.find((p) => p.endsWith('report.md')) as string) as string;
    expect(md).toMatch(/worktree HEAD/i);
    expect(md).toContain('e27e4c6');

    // HEAD was detected against the WORKTREE cwd (not the caller's cwd).
    const headCall = exec.calls.find((c) => c.command === 'git' && c.args.join(' ') === 'rev-parse --short HEAD');
    expect(headCall?.cwd).toBe(WT);
  });

  it('does NOT warn when the worktree HEAD matches the effective (overridden) base_ref', async () => {
    const exec = new FakeExec({
      [TELEMETRY_KEY]: { code: 0, stdout: JSON.stringify({ command: 'telemetry', status: 'ok', data: EVIDENCE }) },
      [HEAD_KEY]: { code: 0, stdout: 'e27e4c6\n' },
    });
    const fs = repoFs();
    const ctx = buildCtx('score', { scenario: 'md-to-pdf', session: SESSION, worktree: WT, baseRef: 'e27e4c6' }, fs, exec);

    const res = await flowEval.run(ctx);
    expect(res.status).toBe('ok');
    expect((res.data as Record<string, unknown>).warnings ?? []).toHaveLength(0);
    const md = fs.readText(fs.writes.find((p) => p.endsWith('report.md')) as string) as string;
    expect(md).not.toMatch(/base_ref warning/i);
  });

  it('does NOT attempt HEAD detection when no --worktree is given (no false drift warning)', async () => {
    const exec = new FakeExec({ harness: { code: 0, stdout: '' } });
    const fs = repoFs();
    // No worktree → fs lane resolves against cwd; HEAD detection is skipped entirely.
    const ctx = buildCtx('score', { scenario: 'md-to-pdf', session: SESSION }, fs, exec);
    await flowEval.run(ctx);
    expect(exec.calls.some((c) => c.command === 'git')).toBe(false);
  });
});

describe('flow-eval render — regenerates report.md from the CURRENT report.json (F-C)', () => {
  async function scoreOnce(fs: FakeFs): Promise<{ runId: string; jsonPath: string; mdPath: string }> {
    const exec = new FakeExec({ [TELEMETRY_KEY]: { code: 0, stdout: JSON.stringify({ command: 'telemetry', status: 'ok', data: EVIDENCE }) } });
    const res = await flowEval.run(buildCtx('score', { scenario: 'md-to-pdf', session: SESSION, worktree: WT }, fs, exec));
    expect(res.status).toBe('ok');
    const runId = (res.data as Record<string, unknown>).run_id as string;
    const jsonPath = fs.writes.find((p) => p.endsWith('report.json')) as string;
    return { runId, jsonPath, mdPath: jsonPath.replace('report.json', 'report.md') };
  }

  it('re-renders FILLED judged verdicts/rationale/by that the first score left `_pending_`', async () => {
    const fs = repoFs();
    const { runId, jsonPath, mdPath } = await scoreOnce(fs);

    // pre-condition: the score-time report.md shows the judged fields as _pending_.
    expect(fs.readText(mdPath) as string).toContain('_pending_');

    // the orchestrator fills the judged verdicts in report.json (post-render).
    const json = JSON.parse(fs.readText(jsonPath) as string);
    for (const j of json.judged) {
      j.verdict = 'pass';
      j.rationale = `evidence for ${j.field}`;
      j.by = 'gpt-5.5@judge';
    }
    json.judged[1].verdict = 'fail';
    fs.writeText(jsonPath, `${JSON.stringify(json, null, 2)}\n`);

    const res = await flowEval.run(buildCtx('render', { scenario: 'md-to-pdf', run: runId }, fs, new FakeExec()));
    expect(res.status).toBe('ok');
    expect((res.data as Record<string, unknown>).judged_filled).toBe(3);

    const md = fs.readText(mdPath) as string;
    // NON-VACUITY (render-skips-judged → RED): the fills now show; nothing left pending.
    expect(md).not.toContain('_pending_');
    expect(md).toContain('by: gpt-5.5@judge');
    expect(md).toContain('rationale: evidence for plan-coherence');
    expect(md).toMatch(/verdict: fail/);
    expect(md).toMatch(/verdict: pass/);
  });

  it('writes ONLY report.md and performs NO telemetry/ledger/pij/git side effects; is idempotent', async () => {
    const fs = repoFs();
    const { runId, mdPath } = await scoreOnce(fs);

    const renderExec = new FakeExec();
    const before = fs.writes.length;
    const r1 = await flowEval.run(buildCtx('render', { scenario: 'md-to-pdf', run: runId }, fs, renderExec));
    expect(r1.status).toBe('ok');
    // render's ONLY write is report.md — never the ledger, never report.json.
    expect(fs.writes.slice(before)).toEqual([mdPath]);
    // render never fetches telemetry, never drives pij, never shells git.
    expect(renderExec.calls).toHaveLength(0);

    const md1 = fs.readText(mdPath) as string;
    const r2 = await flowEval.run(buildCtx('render', { scenario: 'md-to-pdf', run: runId }, fs, renderExec));
    expect(r2.status).toBe('ok');
    expect(fs.readText(mdPath) as string).toBe(md1); // byte-identical re-render (idempotent)
  });

  it('errors E_ARGS without --run and E_NOT_FOUND when the report.json is absent', async () => {
    const noArgs = await flowEval.run(buildCtx('render', { scenario: 'md-to-pdf' }, new FakeFs(), new FakeExec()));
    expect(noArgs.status).toBe('error');
    expect(noArgs.error?.code).toBe('E_ARGS');

    const missing = await flowEval.run(buildCtx('render', { scenario: 'md-to-pdf', run: 'no-such-run' }, new FakeFs(), new FakeExec()));
    expect(missing.status).toBe('error');
    expect(missing.error?.code).toBe('E_NOT_FOUND');
  });

  it("score's next_action points at `render` when judged fields are pending", async () => {
    const fs = repoFs();
    const exec = new FakeExec({ [TELEMETRY_KEY]: { code: 0, stdout: JSON.stringify({ command: 'telemetry', status: 'ok', data: EVIDENCE }) } });
    const res = await flowEval.run(buildCtx('score', { scenario: 'md-to-pdf', session: SESSION, worktree: WT }, fs, exec));
    expect(res.status).toBe('ok');
    expect(String(res.next_action)).toContain('flow-eval render --scenario md-to-pdf --run');
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
    // 4.6 rider: scaffold emits the placeholder guard ON for new scenarios.
    expect(parsed.placeholder_policy).toBe('unknown');
    expect(parsed.judge.criteria).toEqual([
      'plan-coherence',
      'report-contract-coverage',
      'explanation-matches-telemetry',
    ]);
    const loaded = loadScenario('new-scn', fs, `${REPO}/live-testing/scenarios`);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.scenario.config.placeholder_policy).toBe('unknown');
      // it ships a placeholder command-succeeds so the honest-unknown guard is exercised.
      const cmdA = loaded.scenario.assertions.find((a) => a.type === 'command-succeeds');
      expect(cmdA?.params.cmd).toBe('SUBJECT_VALIDATOR');
      expect(loaded.scenario.assertions.find((a) => a.type === 'judged')?.required).toBeUndefined();
    }
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

describe('flow-eval score — 4.6 per-run resolution (SUGG-003): --resolve + placeholder_policy', () => {
  /** A one-assertion scenario whose only lane is a subject-specific placeholder command. */
  function resolveBundleFs(policy?: 'raw' | 'unknown', cmd = 'SUBJECT_VALIDATOR'): FakeFs {
    const scn = {
      slug: 'resolvedemo',
      title: 't',
      task: 'do',
      base: { repo: '.', ref: 'HEAD' },
      subject: { harness: 'claude', model: 'opus' },
      flow: { mode: 'simple', stages: ['implement'] },
      prompts: { orchestrator: 'prompts/o.md', subject: 'prompts/s.md' },
      ...(policy !== undefined && { placeholder_policy: policy }),
      assertions: 'assertions.json',
    };
    const asr = {
      scenario: 'resolvedemo',
      assertions: [
        { id: 'C1', type: 'command-succeeds', source: 'fs', required: true, params: { cmd }, describe: 'subject validator' },
      ],
    };
    return new FakeFs({
      [`${REPO}/live-testing/scenarios/resolvedemo/scenario.json`]: JSON.stringify(scn),
      [`${REPO}/live-testing/scenarios/resolvedemo/assertions.json`]: JSON.stringify(asr),
    });
  }
  function report(fs: FakeFs): Record<string, unknown> {
    return JSON.parse(fs.readText(fs.writes.find((p) => p.endsWith('report.json')) as string) as string);
  }
  function lastLedgerRecord(fs: FakeFs): Record<string, unknown> {
    const raw = fs.readText(fs.writes.find((p) => p.endsWith('ledger.jsonl')) as string) as string;
    return JSON.parse(raw.trim().split('\n').pop() as string);
  }

  it('--resolve overrides the placeholder cmd and records the resolution in report.json + the ledger (resolution-ignored → RED)', async () => {
    const fs = resolveBundleFs('unknown');
    // resolved cmd exits 0 (pass); the raw token is scripted to exit 1 — running it would FAIL.
    const exec = new FakeExec({ 'node real.js': { code: 0 }, SUBJECT_VALIDATOR: { code: 1 } });
    const ctx = buildCtx('score', { scenario: 'resolvedemo', session: SESSION, worktree: WT, resolve: ['C1=node real.js'] }, fs, exec);

    const res = await flowEval.run(ctx);
    expect(res.status).toBe('ok');
    const data = res.data as Record<string, unknown>;
    expect(data.passed).toBe(1);
    expect(data.failed).toBe(0);
    // it ran the RESOLVED command, never the raw placeholder token.
    expect(exec.calls.some((c) => c.command === 'node' && c.args.join(' ') === 'real.js')).toBe(true);
    expect(exec.calls.some((c) => c.command === 'SUBJECT_VALIDATOR')).toBe(false);

    // recorded in report.json provenance AND the RunRecord provenance (comparison must know what ran).
    expect(report(fs).provenance).toMatchObject({ resolutions: { C1: 'node real.js' } });
    const rec = lastLedgerRecord(fs);
    expect((rec.provenance as Record<string, unknown>).resolutions).toEqual({ C1: 'node real.js' });
    expect(validateRunRecord(rec)).toEqual([]); // schema round-trip still holds (additive)
  });

  it("an unresolved placeholder under policy 'unknown' resolves unknown + warns, never a silent pass or raw exec", async () => {
    const fs = resolveBundleFs('unknown');
    const exec = new FakeExec();
    const ctx = buildCtx('score', { scenario: 'resolvedemo', session: SESSION, worktree: WT }, fs, exec);

    const res = await flowEval.run(ctx);
    expect(res.status).toBe('ok');
    const data = res.data as Record<string, unknown>;
    expect(data.unknown).toBe(1);
    expect(data.passed).toBe(0);
    expect(data.required_failed).toBe(0); // an unknown NEVER caps, even for a required lane
    const warnings = (data.warnings as string[] | undefined) ?? [];
    expect(warnings.join(' ')).toContain('SUBJECT_VALIDATOR');
    expect(warnings.join(' ')).toContain('--resolve C1=');
    // never executed the raw token; the row is unknown, not a silent pass.
    expect(exec.calls.some((c) => c.command === 'SUBJECT_VALIDATOR')).toBe(false);
    const c1 = (report(fs).deterministic as { results: Array<{ id: string; status: string }> }).results.find((r) => r.id === 'C1');
    expect(c1?.status).toBe('unknown');
  });

  it('without placeholder_policy (default raw) a placeholder token is executed as-is (frozen-bundle back-compat, no warning)', async () => {
    const fs = resolveBundleFs(); // no policy ⇒ legacy raw-exec
    const exec = new FakeExec({ SUBJECT_VALIDATOR: { code: 0 } });
    const ctx = buildCtx('score', { scenario: 'resolvedemo', session: SESSION, worktree: WT }, fs, exec);

    const res = await flowEval.run(ctx);
    const data = res.data as Record<string, unknown>;
    expect(data.passed).toBe(1);
    expect(exec.calls.some((c) => c.command === 'SUBJECT_VALIDATOR')).toBe(true);
    expect(((data.warnings as string[] | undefined) ?? []).join(' ')).not.toContain('unresolved placeholder');
  });

  it('resolves ONLY the named id — a second lane keeps its own cmd (first-match mutation → RED)', async () => {
    // Two command-succeeds lanes; only C1 gets a --resolve override. This is the
    // isolation sensor: a `Object.values(rc.resolutions)[0]` first-match bug would
    // leak C1's resolved cmd onto C2, so `node c2.js` would never run.
    const scn = {
      slug: 'twolane',
      title: 't',
      task: 'do',
      base: { repo: '.', ref: 'HEAD' },
      subject: { harness: 'claude', model: 'opus' },
      flow: { mode: 'simple', stages: ['implement'] },
      prompts: { orchestrator: 'prompts/o.md', subject: 'prompts/s.md' },
      assertions: 'assertions.json',
    };
    const asr = {
      scenario: 'twolane',
      assertions: [
        { id: 'C1', type: 'command-succeeds', source: 'fs', required: true, params: { cmd: 'SUBJECT_VALIDATOR' }, describe: 'subject validator' },
        { id: 'C2', type: 'command-succeeds', source: 'fs', required: true, params: { cmd: 'node c2.js' }, describe: 'own cmd' },
      ],
    };
    const fs = new FakeFs({
      [`${REPO}/live-testing/scenarios/twolane/scenario.json`]: JSON.stringify(scn),
      [`${REPO}/live-testing/scenarios/twolane/assertions.json`]: JSON.stringify(asr),
    });
    const exec = new FakeExec({ 'node c1.js': { code: 0 }, 'node c2.js': { code: 0 } });
    const ctx = buildCtx('score', { scenario: 'twolane', session: SESSION, worktree: WT, resolve: ['C1=node c1.js'] }, fs, exec);

    const res = await flowEval.run(ctx);
    expect(res.status).toBe('ok');
    expect((res.data as Record<string, unknown>).passed).toBe(2);

    // C1 ran the RESOLVED cmd; C2 ran its OWN cmd (the mutation would run c1.js here instead).
    expect(exec.calls.some((c) => c.command === 'node' && c.args.join(' ') === 'c1.js')).toBe(true);
    expect(exec.calls.some((c) => c.command === 'node' && c.args.join(' ') === 'c2.js')).toBe(true);
    // exactly ONE lane ran c1.js — the resolution did not leak onto the other lane.
    expect(exec.calls.filter((c) => c.command === 'node' && c.args.join(' ') === 'c1.js').length).toBe(1);

    // provenance records exactly the one resolution, not both lanes.
    expect(report(fs).provenance).toMatchObject({ resolutions: { C1: 'node c1.js' } });
    expect(Object.keys((report(fs).provenance as { resolutions: Record<string, string> }).resolutions)).toEqual(['C1']);
  });
});

describe('flow-eval supersede — 4.6 SUGG-004 (append-only annotation; ledger flags + compare excludes)', () => {
  const LEDGER = `${REPO}/.harness/live-testing/md-to-pdf/ledger.jsonl`;
  function recLine(over: Record<string, unknown>): string {
    const base = {
      schema_version: 1,
      run_id: 'r',
      ts: '2026-07-01T00:00:00.000Z',
      scenario: 'md-to-pdf',
      subject: { model: 'opus', harness: 'claude' },
      base_ref: 'base-A',
      seed_tuple: { model: 'opus', harness: 'claude', base_ref: 'base-A', scenario_hash: 'fnv1a:v1', prompt_hash: 'p' },
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

  it('appends the annotation without rewriting prior lines; ledger flags the stale run + --compare excludes it', async () => {
    const fs = new FakeFs({
      [LEDGER]:
        recLine({ run_id: 'staleopus', subject: { model: 'opus', harness: 'claude' }, seed_tuple: { model: 'opus', harness: 'claude', base_ref: 'base-A', scenario_hash: 'fnv1a:v1', prompt_hash: 'p' } }) +
        recLine({ run_id: 'freshopus', subject: { model: 'opus', harness: 'claude' }, seed_tuple: { model: 'opus', harness: 'claude', base_ref: 'base-A', scenario_hash: 'fnv1a:v1', prompt_hash: 'p' } }) +
        recLine({ run_id: 'g1', subject: { model: 'gpt-5.5', harness: 'claude' }, seed_tuple: { model: 'gpt-5.5', harness: 'claude', base_ref: 'base-A', scenario_hash: 'fnv1a:v1', prompt_hash: 'p' } }),
    });
    const before = fs.readText(LEDGER) as string;

    const res = await flowEval.run(buildCtx('supersede', { scenario: 'md-to-pdf', run: 'staleopus', by: 'freshopus' }, fs, new FakeExec()));
    expect(res.status).toBe('ok');
    expect(res.data).toMatchObject({ superseded: 'staleopus', superseded_by: 'freshopus' });

    // append-only: the three pre-existing records are a byte-exact prefix (nothing rewritten).
    const after = fs.readText(LEDGER) as string;
    expect(after.startsWith(before)).toBe(true);

    // the ledger LIST now flags the stale run (still listed, never dropped).
    const list = await flowEval.run(buildCtx('ledger', { scenario: 'md-to-pdf' }, fs, new FakeExec()));
    expect((list.data as Record<string, unknown>).superseded_runs).toEqual(['staleopus']);
    expect(String((list.data as Record<string, unknown>).board)).toContain('⊘');

    // --compare EXCLUDES it: opus keeps only the fresh run.
    const cmp = await flowEval.run(buildCtx('ledger', { scenario: 'md-to-pdf', compare: ['opus', 'gpt-5.5'] }, fs, new FakeExec()));
    expect(cmp.status).toBe('ok');
    expect((cmp.data as { counts: Record<string, number> }).counts.opus).toBe(1);
  });

  it('errors E_ARGS without --by and E_NOT_FOUND for an unknown --run', async () => {
    const fs = new FakeFs({ [LEDGER]: recLine({ run_id: 'only' }) });
    const noBy = await flowEval.run(buildCtx('supersede', { scenario: 'md-to-pdf', run: 'only' }, fs, new FakeExec()));
    expect(noBy.status).toBe('error');
    expect(noBy.error?.code).toBe('E_ARGS');

    const missing = await flowEval.run(buildCtx('supersede', { scenario: 'md-to-pdf', run: 'nope', by: 'only' }, fs, new FakeExec()));
    expect(missing.status).toBe('error');
    expect(missing.error?.code).toBe('E_NOT_FOUND');
  });

  it('rejects self-supersede (--run === --by) with E_ARGS and writes NO annotation (ledger byte-identical)', async () => {
    const fs = new FakeFs({ [LEDGER]: recLine({ run_id: 'only' }) });
    const before = fs.readText(LEDGER) as string;

    const res = await flowEval.run(buildCtx('supersede', { scenario: 'md-to-pdf', run: 'only', by: 'only' }, fs, new FakeExec()));
    expect(res.status).toBe('error');
    expect(res.error?.code).toBe('E_ARGS');

    // no append happened: the ledger is byte-identical (a self-supersede would tombstone
    // the run with no corrected replacement — reject BEFORE any write).
    expect(fs.readText(LEDGER)).toBe(before);
    expect(fs.writes.some((p) => p === LEDGER)).toBe(false);
  });

  it("score hints `supersede` when a prior run of the SAME session is already recorded", async () => {
    const fs = repoFs();
    // a prior run of the same session (its run-id shares the session's `-ixture` suffix).
    fs.writeText(LEDGER, recLine({ run_id: '20260101-000000Z-ixture', scenario: 'md-to-pdf' }));
    const exec = new FakeExec({ [TELEMETRY_KEY]: { code: 0, stdout: JSON.stringify({ command: 'telemetry', status: 'ok', data: EVIDENCE }) } });
    const res = await flowEval.run(buildCtx('score', { scenario: 'md-to-pdf', session: SESSION, worktree: WT }, fs, exec));
    expect(res.status).toBe('ok');
    expect(String(res.next_action)).toContain('supersede');
    expect((res.data as Record<string, unknown>).prior_session_runs).toEqual(['20260101-000000Z-ixture']);
  });
});
