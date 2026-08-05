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
import { buildRunRecord, validateRunRecord } from './ledger.js';
import { renderLedgerList } from './ledger-view.js';
import { buildReportJson, buildReportMd, renderMarkdownFromReportJson } from './report.js';
import { type ResolveContext, resolveAssertionDetailed, type SessionEvidence } from './resolvers.js';
import { loadScenario } from './scenario.js';
import type { Assertion } from './scenario.js';
import { scoreScenario } from './scorer.js';

/*
Test Doc:
- Why: FX003 — the eval instrument reports conclusions it did not reach. The resolvers'
  own contract says a missing/errored evidence object resolves `unknown`, NEVER `fail`
  ("a capability gap is not a subject failure — the determinism boundary"); the layers
  above them threw that care away in six places. These are the planted-bad controls:
  EVERY test here must FAIL against pre-fix source, and each carries its GUARD — the
  case that must NOT fire — because a fix that can no longer say `fail` is less useful,
  not more honest.
- Contract: D1 gate-refused never accuses on an undemonstrated lane; D2 an axis that
  measured nothing is `null`, not `0`, in ONE place that everything else reads; D3 an
  abbreviated sha is not drift and an unpinned base says so; D4/D5 a corpus floor
  separates real work from a token gesture; D6 an unresolved placeholder is an operator
  error, not missing subject evidence. Plus the ruling's condition: an UNKNOWN assertion
  type degrades to `unknown`, never a crash and never a pass.
*/

const WT = '/wt';
const REPO = '/repo';

function evidence(over: Partial<SessionEvidence> = {}): SessionEvidence {
  return {
    pij_session_id: 'pij-fx003',
    harness_session_id: 'hs-fx003',
    harness: 'claude-code',
    segments: 7,
    skills: { builder: 1 },
    skill_order: ['builder'],
    files: { written: [], edited: [] },
    flow_seams: [],
    harness_verbs: { checks: 1 },
    checks: [{ status: 'ok' }],
    compactions: 0,
    tools: {},
    refusals: {},
    gaps: [],
    duration_s: 10,
    ...over,
  };
}

function rc(ev: SessionEvidence | null, fs: FakeFs = new FakeFs()): ResolveContext {
  const exec = new FakeExec();
  return { evidence: ev, worktree: WT, fs, exec: (c, a, o) => exec.run(c, a, o) };
}

function a(type: string, params: Record<string, unknown> = {}, extra: Partial<Assertion> = {}): Assertion {
  return { id: type, type, source: 'telemetry', params, ...extra };
}

// ---------------------------------------------------------------------------
// D1 — gate-refused must not ACCUSE on a lane that never showed it can record
// ---------------------------------------------------------------------------

describe('FX003 D1 — a gate-refusal shortfall is only a subject failure on a demonstrated lane', () => {
  it('CONTROL: evidence PRESENT + refusals EMPTY + lane never demonstrated ⇒ unknown (pre-fix: fail)', async () => {
    // The live regression FX001 armed. Before FX001 the evidence object was always
    // null here, so this branch was unreachable; once the telemetry fallback started
    // resolving evidence, a subject that WAS correctly stopped by a gate scored a
    // false RED — "the subject dodged the gate". A false accusation is the worst
    // polarity a scorer has.
    const r = await resolveAssertionDetailed(a('gate-refused', { min: 1 }), rc(evidence({ refusals: {} })));
    expect(r.verdict).toBe('unknown');
    expect(r.note).toMatch(/refusal lane never demonstrated/);
  });

  it('CONTROL: the same shortfall is unknown for a NAMED code too, on an undemonstrated lane', async () => {
    const r = await resolveAssertionDetailed(a('gate-refused', { code: 'E440' }), rc(evidence({ refusals: {} })));
    expect(r.verdict).toBe('unknown');
  });

  it('GUARD: a genuine refusal still scores PASS', async () => {
    const ev = evidence({ refusals: { E440: 1 } });
    expect((await resolveAssertionDetailed(a('gate-refused', {}), rc(ev))).verdict).toBe('pass');
    expect((await resolveAssertionDetailed(a('gate-refused', { code: 'E440' }), rc(ev))).verdict).toBe('pass');
  });

  it('GUARD: `fail` stays REACHABLE — a demonstrated lane that did not record THIS code still fails', async () => {
    // The property the fix must not trade away. The lane recorded E440, so it
    // demonstrably carries codes; the absence of E443 is therefore real evidence,
    // not a blind spot, and the row is entitled to say so.
    const ev = evidence({ refusals: { E440: 2 } });
    expect((await resolveAssertionDetailed(a('gate-refused', { code: 'E443' }), rc(ev))).verdict).toBe('fail');
    expect((await resolveAssertionDetailed(a('gate-refused', { code: 'E440', min: 3 }), rc(ev))).verdict).toBe('fail');
    expect((await resolveAssertionDetailed(a('gate-refused', { min: 3 }), rc(ev))).verdict).toBe('fail');
  });

  it('GUARD: a null evidence object is still unknown (the pre-existing determinism boundary)', async () => {
    expect((await resolveAssertionDetailed(a('gate-refused', {}), rc(null))).verdict).toBe('unknown');
  });

  it('evidence.source is NOT trusted as the discriminator: `buffer` alone cannot license a fail', async () => {
    // `source: buffer` proves only that the OTLP roll did not eat the code (FX001 D2).
    // It says NOTHING about D4, where a failing harness command produced no
    // command_exit at all — so a pre-D4 buffer segment is equally blind, and an empty
    // map still cannot be read as "no gate refused".
    const r = await resolveAssertionDetailed(a('gate-refused', {}), rc(evidence({ refusals: {}, source: 'buffer' })));
    expect(r.verdict).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// D2 — an axis that measured nothing is not zero, and ONE place decides it
// ---------------------------------------------------------------------------

/** Two process assertions that cannot resolve (no evidence) + one capability that fails. */
const D2_ASSERTIONS: Assertion[] = [
  { id: 'p1', type: 'skill-called', source: 'telemetry', params: { skill: 'builder' } },
  { id: 'p2', type: 'harness-verb-ran', source: 'telemetry', params: { verb: 'checks' } },
  { id: 'c1', type: 'file-created', source: 'fs', params: { path: 'nope.txt' } },
];

describe('FX003 D2 — an axis with zero resolved assertions is absent, not 0', () => {
  it('CONTROL: the process axis measured NOTHING ⇒ null (pre-fix: 0, pixel-identical to failing every check)', async () => {
    const scored = await scoreScenario(D2_ASSERTIONS, rc(null));
    expect(scored.deterministic.axis_scores.process).toBeNull();
    // …and the capability axis genuinely scored zero, which is a different fact.
    expect(scored.deterministic.axis_scores.capability).toBe(0);
  });

  it('GUARD: an axis that genuinely scored 0 of 3 still reports 0, not null', async () => {
    const allFail: Assertion[] = [
      { id: 'c1', type: 'file-created', source: 'fs', params: { path: 'a.txt' } },
      { id: 'c2', type: 'file-created', source: 'fs', params: { path: 'b.txt' } },
      { id: 'c3', type: 'file-created', source: 'fs', params: { path: 'c.txt' } },
    ];
    const scored = await scoreScenario(allFail, rc(null));
    expect(scored.deterministic.axis_scores.capability).toBe(0);
    expect(scored.deterministic.failed).toBe(3);
  });

  it('CONTROL: the overall score is null when NOTHING was scorable (pre-fix: 0)', async () => {
    const scored = await scoreScenario(
      [{ id: 'p1', type: 'skill-called', source: 'telemetry', params: { skill: 'builder' } }],
      rc(null),
    );
    expect(scored.deterministic.score).toBeNull();
  });

  it('CONTROL: report.json carries the null through — it is not coerced back to 0 on the way out', async () => {
    const scored = await scoreScenario(D2_ASSERTIONS, rc(null));
    const json = buildReportJson({
      scenario: 's', run_id: 'r', subject: { harness: 'claude', model: 'opus', pij_session_id: 'pij-x' },
      base_ref: 'abc', started_at: 't0', finished_at: 't1', scored,
    }) as { deterministic: { axis_scores: { process: unknown }; score: unknown } };
    expect(json.deterministic.axis_scores.process).toBeNull();
    expect(json.deterministic.score).toBe(0); // capability's genuine 0/1 IS measured
  });

  it('CONTROL: the ledger record takes the scorer’s null DIRECTLY (no second re-derivation)', async () => {
    const scored = await scoreScenario(D2_ASSERTIONS, rc(null));
    const rec = buildRunRecord({
      scenario: 's', run_id: 'r', ts: '2026-08-05T00:00:00.000Z',
      subject: { model: 'opus', harness: 'claude' }, base_ref: 'abc', scored,
      seed: { scenario_hash: 'h1', prompt_hash: 'h2' },
      telemetry_available: false, duration_s: null, session_export: null, telemetry_summary: null,
    });
    expect(rec.axis_scores.process).toBeNull();
    expect(rec.axis_scores.capability).toBe(0);
    expect(validateRunRecord(rec)).toEqual([]);
  });

  it('report.md renders an unmeasured axis as `unmeasured`, and a real zero as `0.00`', async () => {
    const scored = await scoreScenario(D2_ASSERTIONS, rc(null));
    const md = buildReportMd({
      scenario: 's', run_id: 'r', subject: { harness: 'claude', model: 'opus', pij_session_id: 'pij-x' },
      base_ref: 'abc', started_at: 't0', finished_at: 't1', scored,
    });
    expect(md).toContain('process unmeasured');
    expect(md).toContain('capability 0.00');
  });

  it('CONTROL: the re-render reader never turns a null into a 0 (the same lie, one frame later)', async () => {
    const parsed = {
      scenario: 's', run_id: 'r', subject: { harness: 'c', model: 'm', pij_session_id: 'p' },
      base_ref: 'abc', started_at: 't0', finished_at: 't1',
      deterministic: {
        score: null, axis_scores: { process: null, capability: 0 },
        passed: 0, failed: 1, unknown: 2, total: 3, required_failed: 0,
        results: [{ id: 'c1', type: 'file-created', source: 'fs', axis: 'capability', status: 'fail', required: false, weight: 1 }],
      },
      judged: [], alarms: [], verdict: 'PASS_WITH_NOTES',
    };
    const out = renderMarkdownFromReportJson(parsed);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.md).toContain('process unmeasured');
      expect(out.md).not.toContain('process 0.00');
    }
  });

  it('back-compat: a HISTORIC report.json with a numeric 0 still reads as 0 (it cannot be corrected retroactively)', () => {
    const parsed = {
      scenario: 's', run_id: 'r', subject: { harness: 'c', model: 'm', pij_session_id: 'p' },
      base_ref: 'abc', started_at: 't0', finished_at: 't1',
      deterministic: {
        score: 0, axis_scores: { process: 0, capability: 0 },
        passed: 0, failed: 0, unknown: 0, total: 0, required_failed: 0, results: [],
      },
      judged: [], alarms: [], verdict: 'PASS',
    };
    const out = renderMarkdownFromReportJson(parsed);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.md).toContain('process 0.00');
  });

  it('the mimicry alarm still needs BOTH axes measured (a null axis never triggers it)', async () => {
    const scored = await scoreScenario(D2_ASSERTIONS, rc(null));
    expect(scored.alarms).not.toContain('mimicry');
  });

  it('ledger-view (the 4th consumer) renders a null axis as — and never as 0.00', async () => {
    const scored = await scoreScenario(D2_ASSERTIONS, rc(null));
    const rec = buildRunRecord({
      scenario: 's', run_id: 'r1', ts: '2026-08-05T00:00:00.000Z',
      subject: { model: 'opus', harness: 'claude' }, base_ref: 'abc', scored,
      seed: { scenario_hash: 'h1', prompt_hash: 'h2' },
      telemetry_available: false, duration_s: null, session_export: null, telemetry_summary: null,
    });
    const { board, data } = renderLedgerList('s', [rec]);
    expect(data.runs[0].process).toBeNull();
    expect(board).toContain('—');
  });
});

// ---------------------------------------------------------------------------
// D3 — an abbreviated sha is not drift; an unpinned base is its own finding
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const MD_FIXTURE = njoin(HERE, 'fixtures', 'scenarios', 'md-to-pdf');
const FULL_OID = 'f947a2fc49928b997079297c53ef3925e107c789';
const SHORT_OID = 'f947a2fc';
const OTHER_OID = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

async function scoreWithBaseRef(baseRef: string, execScripts: Record<string, { code: number; stdout?: string }>) {
  const { readFileSync } = await import('node:fs');
  const fs = new FakeFs(
    {
      [`${REPO}/live-testing/scenarios/md-to-pdf/scenario.json`]: readFileSync(njoin(MD_FIXTURE, 'scenario.json'), 'utf8'),
      [`${REPO}/live-testing/scenarios/md-to-pdf/assertions.json`]: readFileSync(njoin(MD_FIXTURE, 'assertions.json'), 'utf8'),
    },
    { [WT]: [] },
  );
  const exec = new FakeExec(execScripts);
  const ctx = buildVerbContext(
    {
      exec, fs, fsWrite: fs, env: new FakeEnv(),
      git: new FakeGit({ isRepo: true, branch: 'main' }),
      clock: new FakeClock('2026-08-05T11:00:00.000Z'),
    },
    { cwd: REPO, args: { action: 'score' }, options: { scenario: 'md-to-pdf', session: 'pij-fx003', worktree: WT, baseRef } },
  );
  const res = await flowEval.run(ctx);
  if (res.status === 'error') throw new Error(`score failed: ${JSON.stringify(res.error)}`);
  const warnings = (res.data as { warnings?: string[] } | undefined)?.warnings ?? [];
  return warnings.length > 0 ? warnings[0] : null;
}

describe('FX003 D3 — the base_ref check compares commits, not string lengths', () => {
  const RESOLVE_SAME = {
    'git rev-parse --short HEAD': { code: 0, stdout: `${SHORT_OID}\n` },
    'git rev-parse --verify --quiet HEAD^{commit}': { code: 0, stdout: `${FULL_OID}\n` },
    [`git rev-parse --verify --quiet ${FULL_OID}^{commit}`]: { code: 0, stdout: `${FULL_OID}\n` },
  };

  it('CONTROL: an ABBREVIATED HEAD vs the FULL sha of the SAME commit does NOT warn (pre-fix: warns)', async () => {
    // The pre-fix bug verbatim: `worktree HEAD f947a2fc ≠ base_ref f947a2fc49928…`
    // — the same commit, reported as "your worktree was not cut from the declared base".
    expect(await scoreWithBaseRef(FULL_OID, RESOLVE_SAME)).toBeNull();
  });

  it('GUARD: a genuinely DIFFERENT base still warns', async () => {
    const warning = await scoreWithBaseRef(OTHER_OID, {
      ...RESOLVE_SAME,
      [`git rev-parse --verify --quiet ${OTHER_OID}^{commit}`]: { code: 0, stdout: `${OTHER_OID}\n` },
    });
    expect(warning).toMatch(/was not cut from the declared base_ref/);
  });

  it('GUARD: the prefix tolerance holds even when git cannot resolve the declared ref', async () => {
    // Unscripted rev-parse --verify returns empty ⇒ no oid ⇒ the hex-prefix fallback.
    expect(await scoreWithBaseRef(FULL_OID, { 'git rev-parse --short HEAD': { code: 0, stdout: `${SHORT_OID}\n` } })).toBeNull();
  });

  it('GUARD: an unresolvable, genuinely different ref still warns through the fallback', async () => {
    const warning = await scoreWithBaseRef(OTHER_OID, { 'git rev-parse --short HEAD': { code: 0, stdout: `${SHORT_OID}\n` } });
    expect(warning).toMatch(/was not cut from the declared base_ref/);
  });

  it('CONTROL: a literal `HEAD` base is UNPINNED and says so — it is not a silent pass', async () => {
    // The ruling: `scaffold` writes base.ref = 'HEAD' by default, so resolving both
    // sides to oids would install a check that can NEVER fire. A literal HEAD is the
    // ABSENCE of a pinned base, which is a real finding about reproducibility.
    const warning = await scoreWithBaseRef('HEAD', RESOLVE_SAME);
    expect(warning).toMatch(/pins NO base commit/);
    expect(warning).toMatch(/not reproducible/);
  });

  it('GUARD: an undetectable HEAD is still no finding (never a false drift claim)', async () => {
    expect(await scoreWithBaseRef(FULL_OID, { 'git rev-parse --short HEAD': { code: 1, stdout: '' } })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// D4/D5 — a non-vacuity floor: is there enough here to be real work?
// ---------------------------------------------------------------------------

/** A dd tasks document with `n` task rows, `withPressure` of which carry a pressure link. */
function tasksDoc(n: number, withPressure: number): string {
  const tasks = Array.from({ length: n }, (_, i) => ({
    id: `tk-000${i + 1}`, title: `t${i + 1}`, state: 'checked',
    satisfies: [`../../plan.dd.json#acceptance_criteria/ac-000${i + 1}`],
  }));
  const done_when = Object.fromEntries(
    tasks.map((t, i) => [t.id, [{ id: `dw-${i}`, assertion: 'a', state: 'checked', ...(i < withPressure && { pressure: '../../backpressure.dd.json#rows/bp-1' }) }]]),
  );
  return JSON.stringify({ dd: { schema: 'builder/tasks' }, sections: [{ name: 'tasks', value: tasks }, { name: 'done_when', value: done_when }] });
}

function planDoc(acs: number): string {
  return JSON.stringify({
    dd: { schema: 'builder/plan' },
    sections: [{ name: 'acceptance_criteria', value: Array.from({ length: acs }, (_, i) => ({ id: `ac-000${i + 1}`, claim: 'c', state: 'open' })) }],
  });
}

function corpusFs(tasks: string, plan: string): FakeFs {
  return new FakeFs(
    {
      [`${WT}/docs/plans/001-x/plan.dd.json`]: plan,
      [`${WT}/docs/plans/001-x/assets/tasks/phase-1/tasks.dd.json`]: tasks,
    },
    {
      [WT]: ['docs'], [`${WT}/docs`]: ['plans'], [`${WT}/docs/plans`]: ['001-x'],
      [`${WT}/docs/plans/001-x`]: ['plan.dd.json', 'assets'],
      [`${WT}/docs/plans/001-x/assets`]: ['tasks'],
      [`${WT}/docs/plans/001-x/assets/tasks`]: ['phase-1'],
      [`${WT}/docs/plans/001-x/assets/tasks/phase-1`]: ['tasks.dd.json'],
    },
  );
}

const TASK_GLOB = 'docs/plans/*/assets/tasks/phase-*/tasks.dd.json';

describe('FX003 D4/D5 — a corpus floor separates real work from a token gesture', () => {
  it('the DEFECT, demonstrated: a substring grep for "pressure" passes on a ONE-row corpus', async () => {
    // Not a control — the evidence that A5/A6 could not tell the two apart. This type
    // is unchanged by the fix; what changed is that the scenario no longer relies on it.
    const r = await resolveAssertionDetailed(
      { id: 'A5old', type: 'file-content-matches', source: 'fs', params: { glob: TASK_GLOB, pattern: '"pressure"' } },
      rc(null, corpusFs(tasksDoc(1, 1), planDoc(1))),
    );
    expect(r.verdict).toBe('pass');
  });

  it('CONTROL: a trivial one-task corpus FAILS the cardinality floor (pre-fix: no such check, it passed)', async () => {
    const r = await resolveAssertionDetailed(
      { id: 'A9b', type: 'corpus-floor', source: 'fs', params: { glob: TASK_GLOB, section: 'tasks', min_items: 3 } },
      rc(null, corpusFs(tasksDoc(1, 1), planDoc(1))),
    );
    expect(r.verdict).toBe('fail');
    expect(r.note).toMatch(/below the floor of 3/);
  });

  it('GUARD: a real corpus PASSES the same floor', async () => {
    const r = await resolveAssertionDetailed(
      { id: 'A9b', type: 'corpus-floor', source: 'fs', params: { glob: TASK_GLOB, section: 'tasks', min_items: 3 } },
      rc(null, corpusFs(tasksDoc(9, 9), planDoc(21))),
    );
    expect(r.verdict).toBe('pass');
  });

  it('CONTROL: require_field FAILS when only SOME rows carry the key (the exact case the grep waved through)', async () => {
    const r = await resolveAssertionDetailed(
      { id: 'A5', type: 'corpus-floor', source: 'fs', params: { glob: TASK_GLOB, section: 'done_when', require_field: 'pressure' } },
      rc(null, corpusFs(tasksDoc(5, 1), planDoc(5))),
    );
    expect(r.verdict).toBe('fail');
    expect(r.note).toMatch(/4 of 5 .*carry no 'pressure'/);
  });

  it('GUARD: require_field PASSES when every row carries the key', async () => {
    const r = await resolveAssertionDetailed(
      { id: 'A5', type: 'corpus-floor', source: 'fs', params: { glob: TASK_GLOB, section: 'done_when', require_field: 'pressure' } },
      rc(null, corpusFs(tasksDoc(5, 5), planDoc(5))),
    );
    expect(r.verdict).toBe('pass');
  });

  it('CONTROL (D5): the plan-side AC floor fails a one-AC corpus, so `dd doctor` is never clean by vacuity alone', async () => {
    const params = { glob: 'docs/plans/*/plan.dd.json', section: 'acceptance_criteria', min_items: 3 };
    const thin = await resolveAssertionDetailed({ id: 'A9a', type: 'corpus-floor', source: 'fs', params }, rc(null, corpusFs(tasksDoc(1, 1), planDoc(1))));
    expect(thin.verdict).toBe('fail');
    const real = await resolveAssertionDetailed({ id: 'A9a', type: 'corpus-floor', source: 'fs', params }, rc(null, corpusFs(tasksDoc(9, 9), planDoc(21))));
    expect(real.verdict).toBe('pass');
  });

  it('a corpus that does not exist at all FAILS the floor (nothing matched ⇒ nothing proven)', async () => {
    const r = await resolveAssertionDetailed(
      { id: 'A9b', type: 'corpus-floor', source: 'fs', params: { glob: TASK_GLOB, section: 'tasks', min_items: 3 } },
      rc(null, new FakeFs({}, { [WT]: [] })),
    );
    expect(r.verdict).toBe('fail');
  });

  it('an UNPARSEABLE document is unknown, never a fail — we cannot count what we cannot read', async () => {
    const fs = corpusFs('{ not json', planDoc(3));
    const r = await resolveAssertionDetailed(
      { id: 'A9b', type: 'corpus-floor', source: 'fs', params: { glob: TASK_GLOB, section: 'tasks', min_items: 3 } },
      rc(null, fs),
    );
    expect(r.verdict).toBe('unknown');
    expect(r.note).toMatch(/could not parse/);
  });

  it('CONTROL: the committed dd-native-builder bundle actually USES the floor (pre-fix: substring greps)', () => {
    const loaded = loadScenario('dd-native-builder', {
      exists: (p: string) => require('node:fs').existsSync(p),
      readText: (p: string) => (require('node:fs').existsSync(p) ? require('node:fs').readFileSync(p, 'utf8') : null),
    }, njoin(HERE, '..', '..', '..', 'live-testing', 'scenarios'));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const byId = Object.fromEntries(loaded.scenario.assertions.map((x) => [x.id, x]));
    expect(byId.A5.type).toBe('corpus-floor');
    expect(byId.A5.params.require_field).toBe('pressure');
    expect(byId.A6.type).toBe('corpus-floor');
    expect(byId.A6.params.require_field).toBe('satisfies');
    expect(byId.A9a.type).toBe('corpus-floor');
    expect(byId.A9b.type).toBe('corpus-floor');
    // and the standing caution: coverage stays `plan validate --complete`'s job.
    for (const asrt of loaded.scenario.assertions) {
      expect(asrt.params.coverage).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// D6 — an unresolved placeholder is an operator error, not missing evidence
// ---------------------------------------------------------------------------

describe('FX003 D6 — an unresolved --resolve placeholder says so distinctly', () => {
  it('CONTROL: the row carries a placeholder-specific note (pre-fix: a bare `unknown`, indistinguishable from absent evidence)', async () => {
    const r = await resolveAssertionDetailed(
      { id: 'A11', type: 'command-succeeds', source: 'fs', params: { cmd: 'SUBJECT_PLAN_VALIDATE_COMPLETE' } },
      { ...rc(null), placeholderPolicy: 'unknown' },
    );
    expect(r.verdict).toBe('unknown');
    expect(r.note).toMatch(/placeholder never resolved/);
    expect(r.note).toMatch(/NOT missing subject evidence/);
    expect(r.note).toMatch(/--resolve A11=/);
  });

  it('GUARD: a RESOLVED placeholder runs the real command and carries no such note', async () => {
    const exec = new FakeExec({ 'true ok': { code: 0 } });
    const r = await resolveAssertionDetailed(
      { id: 'A11', type: 'command-succeeds', source: 'fs', params: { cmd: 'SUBJECT_PLAN_VALIDATE_COMPLETE' } },
      { evidence: null, worktree: WT, fs: new FakeFs(), exec: (c, x, o) => exec.run(c, x, o), resolutions: { A11: 'true ok' }, placeholderPolicy: 'unknown' },
    );
    expect(r.verdict).toBe('pass');
    expect(r.note).toBeUndefined();
  });

  it('the note reaches the report row and the ledger lane, not just the resolver', async () => {
    const scored = await scoreScenario(
      [{ id: 'A11', type: 'command-succeeds', source: 'fs', params: { cmd: 'SUBJECT_PLAN_VALIDATE_COMPLETE' } }],
      { ...rc(null), placeholderPolicy: 'unknown' },
    );
    expect(scored.deterministic.results[0].note).toMatch(/placeholder never resolved/);
    const json = buildReportJson({
      scenario: 's', run_id: 'r', subject: { harness: 'c', model: 'm', pij_session_id: 'p' },
      base_ref: 'abc', started_at: 't0', finished_at: 't1', scored,
    }) as { deterministic: { results: Array<{ note?: string }> } };
    expect(json.deterministic.results[0].note).toMatch(/placeholder never resolved/);
    const rec = buildRunRecord({
      scenario: 's', run_id: 'r', ts: '2026-08-05T00:00:00.000Z',
      subject: { model: 'm', harness: 'c' }, base_ref: 'abc', scored,
      seed: { scenario_hash: 'h1', prompt_hash: 'h2' },
      telemetry_available: false, duration_s: null, session_export: null, telemetry_summary: null,
    });
    expect(rec.lanes[0].note).toMatch(/placeholder never resolved/);
    expect(validateRunRecord(rec)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Ruling condition — an older scorer meeting a newer scenario degrades honestly
// ---------------------------------------------------------------------------

describe('FX003 — an UNKNOWN assertion type resolves unknown: never a crash, never a pass', () => {
  it('CONTROL: an unrecognised type carries an explanatory note (pre-fix: a silent bare unknown)', async () => {
    const r = await resolveAssertionDetailed(a('teleport-verified', { min: 1 }), rc(evidence()));
    expect(r.verdict).toBe('unknown');
    expect(r.note).toMatch(/unknown assertion type 'teleport-verified'/);
  });

  it('GUARD: it is never a pass, and the run does not throw', async () => {
    const scored = await scoreScenario([a('teleport-verified', {}, { required: true, axis: 'capability' })], rc(evidence()));
    expect(scored.deterministic.results[0].status).toBe('unknown');
    expect(scored.deterministic.required_failed).toBe(0);
    expect(scored.deterministic.axis_scores.capability).toBeNull();
  });
});
