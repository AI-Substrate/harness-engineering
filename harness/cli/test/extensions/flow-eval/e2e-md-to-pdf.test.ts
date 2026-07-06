import { readFileSync } from 'node:fs';
import { dirname, join as njoin } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// The frozen Phase-2 engine + its registry — imported, never re-implemented.
import flowEval from '../../../../../.harness/extensions/flow-eval/extension.js';
import { ASSERTION_TYPES } from '../../../../../.harness/extensions/flow-eval/scenario.js';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeExec } from '../../../src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../../src/adapters/git/fake-git.js';
import { buildVerbContext } from '../../../src/services/extensions/verb-context.js';

/*
Test Doc (plan 041 Phase 3, T005 — the end-to-end validation):
- Why: prove the REAL committed `md-to-pdf` bundle (T001/T002/T003/T004) is runnable
  against the FROZEN Phase-2 engine, and that the orchestration loop is internally
  consistent — WITHOUT a live subject spawn. Two halves, per the plan:
    (1) Scoring half — score the real scenario over a SYNTHETIC evidence stub + a fake
        worktree → a report.{json,md} with the expected three-valued rows. The engine
        fetches telemetry ONCE via ctx.exec (never a CLI import) and NEVER drives pij.
    (2) Live-drive verify half — a static checklist over the committed prompts: the
        subject packet stays BLIND (zero flow/method/measurement leakage), and the
        orchestrator runbook is a real, ordered step-list (only real pij/harness verbs,
        `plan --simple`, compact-before-implement, `flow-eval score --worktree`).
- Contract: the bundle loads against the Phase-2 loader; full evidence ⇒ verdict PASS,
  score 1, 10 deterministic rows all pass, A11 surfaced as a pending judged field;
  telemetry-absent ⇒ telemetry rows unknown (NOT fail), required_failed 0; the prompts
  pass the blind + runbook gates.
*/

const HERE = dirname(fileURLToPath(import.meta.url));
// harness/cli/test/extensions/flow-eval → repo root is five levels up.
const REPO_ROOT = njoin(HERE, '..', '..', '..', '..', '..');
const BUNDLE = njoin(REPO_ROOT, 'live-testing', 'scenarios', 'md-to-pdf');

const REPO = '/repo'; // the (fake) cwd the loader resolves live-testing/scenarios under
const WT = '/wt'; // the (fake) subject worktree the fs lane reads
const SESSION = 'pij-fixture';
const TELEMETRY_KEY = `harness telemetry get ${SESSION} --json --worktree ${WT}`;

function readBundle(name: string): string {
  return readFileSync(njoin(BUNDLE, name), 'utf8');
}

/** Synthetic SessionEvidence that satisfies every telemetry-lane assertion (A1..A5, A9, A10-telemetry). */
const EVIDENCE = {
  pij_session_id: SESSION,
  harness: 'claude-code',
  segments: 8,
  skills: { 'the-flow': 4, explore: 1, plan: 1, implement: 1, 'eng-harness-flow': 2 },
  skill_order: ['explore', 'plan', 'the-flow', 'implement'],
  files: { written: ['extension.ts'], edited: [] },
  flow_seams: ['eng-harness-flow:pre-coding'],
  harness_verbs: { checks: 2, retro: 1 },
  checks: [{ status: 'ok' }],
  compactions: 1,
  tools: { Write: 5, Edit: 3 },
  gaps: [],
};

/** A FakeFs with the REAL bundle at /repo + a fake worktree at /wt that satisfies the fs lane. */
function fixtureFs(): FakeFs {
  return new FakeFs(
    {
      [`${REPO}/live-testing/scenarios/md-to-pdf/scenario.json`]: readBundle('scenario.json'),
      [`${REPO}/live-testing/scenarios/md-to-pdf/assertions.json`]: readBundle('assertions.json'),
      // worktree artifacts the subject would have produced.
      [`${WT}/.harness/extensions/md-pdf/extension.ts`]: 'export default {}',
      [`${WT}/.harness/records/retro/2026/r.md`]: '# retro record',
    },
    {
      [`${WT}/.harness/extensions`]: ['md-pdf'],
      [`${WT}/.harness/extensions/md-pdf`]: ['extension.ts'],
      [`${WT}/.harness/records/retro`]: ['2026'],
      [`${WT}/.harness/records/retro/2026`]: ['r.md'],
    },
  );
}

function buildCtx(options: Record<string, unknown>, fs: FakeFs, exec: FakeExec) {
  return buildVerbContext(
    {
      exec,
      fs,
      fsWrite: fs,
      env: new FakeEnv(),
      git: new FakeGit({ isRepo: true, branch: 'feat/041-flow-conformance-eval' }),
      clock: new FakeClock('2026-06-23T11:00:00.000Z'),
    },
    { cwd: REPO, args: { action: 'score' }, options },
  );
}

describe('e2e md-to-pdf — scoring half (real bundle, fixture session, no live spawn)', () => {
  it('full evidence ⇒ PASS, score 1, 10 deterministic rows, A11 judged pending — never drives pij', async () => {
    const exec = new FakeExec({
      [TELEMETRY_KEY]: {
        code: 0,
        stdout: JSON.stringify({ command: 'telemetry', status: 'ok', data: EVIDENCE }),
      },
      // SCRIPT the command-succeeds rows explicitly — never lean on FakeExec's
      // default-to-success (that silent default is exactly what let the old
      // doctor-based A7 false-pass slip through). A7/A8 are subject-resolved
      // placeholder tokens (commandSucceeds splits the cmd on whitespace, so the
      // bare token IS the exec key); here both exit 0 (the conformant case).
      SUBJECT_EXTENSION_HELP: { code: 0 }, // A7: the new verb registered (commander exit 0)
      SUBJECT_PDF_VALIDATOR: { code: 0 }, // A8: the subject's PDF validator passes
    });
    const fs = fixtureFs();
    const ctx = buildCtx({ scenario: 'md-to-pdf', session: SESSION, worktree: WT }, fs, exec);

    const res = await flowEval.run(ctx);

    expect(res.status).toBe('ok');
    const data = res.data as Record<string, unknown>;
    expect(data.verdict).toBe('PASS');
    expect(data.score).toBe(1);
    expect(data.passed).toBe(10);
    expect(data.failed).toBe(0);
    expect(data.unknown).toBe(0);
    expect(data.total).toBe(10); // A1..A10 deterministic; A11 is judged
    expect(data.required_failed).toBe(0);
    expect(data.judged_pending).toBe(1);
    expect(data.telemetry).toMatchObject({ available: true, segments: 8 });

    // a report.{json,md} was written under .harness/live-testing/md-to-pdf/<run-id>/
    const jsonPath = fs.writes.find((p) => p.endsWith('report.json'));
    expect(jsonPath).toMatch(/\.harness\/live-testing\/md-to-pdf\/.*\/report\.json$/);
    expect(fs.writes.some((p) => p.endsWith('report.md'))).toBe(true);

    // the report carries the expected three-valued rows + the surfaced judged field.
    const report = JSON.parse(fs.readText(jsonPath as string) as string);
    expect(report.scenario).toBe('md-to-pdf');
    expect(report.base_ref).toBe('v0.6.0');
    expect(report.subject.pij_session_id).toBe(SESSION);
    expect(report.verdict).toBe('PASS');
    expect(report.deterministic.results).toHaveLength(10);
    expect(report.deterministic.results.every((r: { status: string }) => r.status === 'pass')).toBe(
      true,
    );
    expect(report.judged).toHaveLength(1);
    expect(report.judged[0]).toMatchObject({
      id: 'A11',
      field: 'backpressure_quality',
      verdict: null,
    });

    // evidence fetched EXACTLY once, via the Phase-1 verb (ctx.exec, not an import).
    const telCalls = exec.calls.filter((c) => c.command === 'harness' && c.args[0] === 'telemetry');
    expect(telCalls).toHaveLength(1);
    expect(telCalls[0].args).toEqual(['telemetry', 'get', SESSION, '--json', '--worktree', WT]);

    // critic-F1: the evaluator NEVER drives pij.
    expect(exec.calls.some((c) => c.command === 'pij')).toBe(false);

    // the command-succeeds rows actually RAN their scripted commands in the worktree
    // (proves the pass is earned by exec code 0, not a skipped/defaulted check).
    const extHelp = exec.calls.find((c) => c.command === 'SUBJECT_EXTENSION_HELP');
    expect(extHelp?.cwd).toBe(WT);
    expect(exec.calls.some((c) => c.command === 'SUBJECT_PDF_VALIDATOR')).toBe(true);
  });

  it('negative mutation: A7 (required) command exits 1 ⇒ row fail, required_failed, verdict FAIL (envelope still ok)', async () => {
    // Mutate ONLY A7's command to a nonzero exit (the broken-extension case: the
    // subject's verb never registered, so `<verb> --help` exits nonzero). This is
    // the test the old doctor-based A7 could never produce — doctor always exits 0.
    const exec = new FakeExec({
      [TELEMETRY_KEY]: {
        code: 0,
        stdout: JSON.stringify({ command: 'telemetry', status: 'ok', data: EVIDENCE }),
      },
      SUBJECT_EXTENSION_HELP: { code: 1 }, // A7: the new verb did NOT register
      SUBJECT_PDF_VALIDATOR: { code: 0 }, // A8 still passes — isolate the A7 mutation
    });
    const fs = fixtureFs();
    const ctx = buildCtx({ scenario: 'md-to-pdf', session: SESSION, worktree: WT }, fs, exec);

    const res = await flowEval.run(ctx);

    // a found non-conformance is a SUCCESSFUL evaluation — the envelope stays ok.
    expect(res.status).toBe('ok');
    const data = res.data as Record<string, unknown>;
    expect(data.verdict).toBe('FAIL');
    expect(data.required_failed).toBe(1); // A7 is required
    expect(Number(data.failed)).toBeGreaterThanOrEqual(1);

    // and the report names A7 as the failing required row.
    const jsonPath = fs.writes.find((p) => p.endsWith('report.json')) as string;
    const report = JSON.parse(fs.readText(jsonPath) as string);
    expect(report.verdict).toBe('FAIL');
    const a7 = report.deterministic.results.find((r: { id: string }) => r.id === 'A7');
    expect(a7).toMatchObject({ id: 'A7', status: 'fail', required: true });
    // the mutation is isolated: A8 (same lane, not mutated) still passes.
    const a8 = report.deterministic.results.find((r: { id: string }) => r.id === 'A8');
    expect(a8).toMatchObject({ id: 'A8', status: 'pass' });
  });

  it('telemetry absent ⇒ telemetry rows unknown (not fail), required_failed 0, PASS_WITH_NOTES', async () => {
    // No telemetry script → the telemetry fetch returns empty stdout → evidence
    // parses to null (the determinism boundary). The fs-lane command rows ARE
    // scripted to succeed, so the fs lane's pass is earned, not defaulted.
    const exec = new FakeExec({
      SUBJECT_EXTENSION_HELP: { code: 0 }, // A7
      SUBJECT_PDF_VALIDATOR: { code: 0 }, // A8
    });
    const fs = fixtureFs();
    const ctx = buildCtx({ scenario: 'md-to-pdf', session: SESSION, worktree: WT }, fs, exec);

    const res = await flowEval.run(ctx);

    expect(res.status).toBe('ok');
    const data = res.data as Record<string, unknown>;
    expect(data.telemetry).toMatchObject({ available: false });
    // A1 is REQUIRED + telemetry — unknown must NOT cap the verdict to FAIL.
    expect(data.required_failed).toBe(0);
    expect(Number(data.unknown)).toBeGreaterThan(0);
    expect(data.verdict).toBe('PASS_WITH_NOTES');
    // the fs lane is unaffected: the extension file + the new-verb help (A7) + the
    // placeholder validator (A8) still pass.
    expect(Number(data.passed)).toBeGreaterThanOrEqual(3);
    expect(fs.writes.some((p) => p.endsWith('report.json'))).toBe(true);
  });
});

describe('e2e md-to-pdf — bundle shape (loads against the frozen Phase-2 registry)', () => {
  const scenario = JSON.parse(readBundle('scenario.json'));
  const bundle = JSON.parse(readBundle('assertions.json'));

  it('scenario.json pins the Simple-flow choreography + a real base ref', () => {
    expect(scenario.slug).toBe('md-to-pdf');
    expect(scenario.base.ref).toBe('v0.6.0');
    expect(scenario.subject).toMatchObject({ harness: 'claude', model: 'opus' });
    expect(scenario.flow.mode).toBe('simple');
    expect(scenario.flow.stages).toEqual([
      'explore',
      'plan',
      'validate',
      'compact',
      'implement',
      'review',
      'fix',
      'validate',
    ]);
  });

  it('assertions.json is the workshop worked example A1..A11, every row a valid registry type', () => {
    const rows = bundle.assertions as Array<{
      id: string;
      type: string;
      source: string;
      required?: boolean;
    }>;
    expect(rows.map((r) => r.id)).toEqual([
      'A1',
      'A2',
      'A3',
      'A4',
      'A5',
      'A6',
      'A7',
      'A8',
      'A9',
      'A10',
      'A11',
    ]);
    for (const r of rows) {
      const lanes = ASSERTION_TYPES[r.type];
      expect(lanes, `unknown type ${r.type}`).toBeDefined();
      expect(lanes, `source '${r.source}' invalid for type '${r.type}'`).toContain(r.source);
    }
    // at least one judged row (the orchestrator-filled layer) + a stable required core.
    expect(rows.some((r) => r.type === 'judged')).toBe(true);
    expect(rows.filter((r) => r.required).map((r) => r.id)).toEqual(['A1', 'A6', 'A7']);
  });
});

describe('e2e md-to-pdf — live-drive verify half (prompts are consistent; no spawn)', () => {
  const FORBIDDEN = [
    'explore',
    'plan',
    'implement',
    'compact',
    'compaction',
    'review',
    'reviewer',
    'retro',
    'telemetry',
    'assertion',
    'assertions',
    'rubric',
    'checkpoint',
    'checks',
    'backpressure',
  ];
  const FORBIDDEN_PHRASES = ['back pressure', 'the-flow', 'eng-harness-flow', 'plan --simple'];

  it('subject.md delivers a BLIND packet (no flow/method/measurement leakage above the reviewer gate)', () => {
    const subject = readBundle('prompts/subject.md');
    expect(subject).toContain('REVIEWER-ONLY'); // the gate exists
    // what the orchestrator actually delivers: above the gate, comments stripped.
    const delivered = subject.split('REVIEWER-ONLY')[0].replace(/<!--[\s\S]*?-->/g, '');
    for (const word of FORBIDDEN) {
      expect(new RegExp(`\\b${word}\\b`, 'i').test(delivered), `leaked '${word}'`).toBe(false);
    }
    for (const phrase of FORBIDDEN_PHRASES) {
      expect(delivered.toLowerCase().includes(phrase), `leaked '${phrase}'`).toBe(false);
    }
    // the bare task IS present (the WHAT is allowed; only the HOW is withheld).
    expect(delivered).toMatch(/worktree/i);
    expect(delivered).toMatch(/markdown/i);
    expect(delivered).toMatch(/PDF/);
    expect(delivered).toMatch(/mermaid/i);
    // and the report contract is present.
    expect(delivered).toMatch(/pij/);
    expect(delivered).toMatch(/DONE|BLOCKED/);
  });

  it('orchestrator.md is an executable step-list: only real pij/harness verbs, full choreography', () => {
    const runbook = readBundle('prompts/orchestrator.md');

    // every `pij <subcommand>` invoked is a REAL pij verb.
    const KNOWN_PIJ = new Set([
      'spawn',
      'send',
      'tail',
      'state',
      'path',
      'close',
      'adopt',
      'daemon',
      'whoami',
      'list',
      'phonehome',
      'compact-self',
    ]);
    const invoked = [...runbook.matchAll(/(?:^[ \t]*|`)pij ([a-z][a-z-]*)/gm)].map((m) => m[1]);
    expect(invoked.length).toBeGreaterThan(0);
    for (const sub of invoked) {
      expect(KNOWN_PIJ.has(sub), `unknown pij subcommand '${sub}'`).toBe(true);
    }
    // canary-verify the model + spawn the matrix knob.
    expect(runbook.toLowerCase()).toContain('canary');
    expect(runbook).toMatch(/pij spawn --harness claude --model opus/);
    // the planning step explicitly selects Simple (per the original ask).
    expect(runbook).toContain('plan --simple');
    // compact happens BEFORE implement.
    expect(runbook.toLowerCase()).toContain('before implement');
    expect(runbook.toLowerCase().indexOf('compact')).toBeLessThan(
      runbook.toLowerCase().indexOf('implement'),
    );
    // all eight stages are named in the runbook.
    for (const stage of ['explore', 'plan', 'validate', 'compact', 'implement', 'review', 'fix']) {
      expect(runbook.toLowerCase(), `runbook missing stage '${stage}'`).toContain(stage);
    }
    // the scoring call is the read-only evaluator over the finished session + worktree.
    expect(runbook).toMatch(/harness flow-eval score --scenario md-to-pdf --session .* --worktree/);
    // the subject-specific assertions are resolved before scoring — the runbook and
    // assertions.json must agree on BOTH placeholder tokens (A7 + A8).
    expect(runbook).toContain('SUBJECT_EXTENSION_HELP');
    expect(readBundle('assertions.json')).toContain('SUBJECT_EXTENSION_HELP');
    expect(runbook).toContain('SUBJECT_PDF_VALIDATOR');
    expect(readBundle('assertions.json')).toContain('SUBJECT_PDF_VALIDATOR');
    // and the runbook states the evaluator never drives pij.
    expect(runbook.toLowerCase()).toContain('never drives pij');
  });
});
