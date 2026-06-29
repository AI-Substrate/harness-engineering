import { describe, expect, it } from 'vitest';
import { FakeExec } from '../../../harness/cli/src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../../harness/cli/src/adapters/fs/fake-fs.js';
import {
  RESOLVERS,
  type ResolveContext,
  resolveAssertion,
  type SessionEvidence,
} from './resolvers.js';
import { ASSERTION_TYPES, type Assertion } from './scenario.js';

/*
Test Doc:
- Why: the resolver registry is the load-bearing Phase-2 contract (AC-05). Each `type`
  must resolve to pass/fail/unknown per the workshop lanes, and the tests must be
  NON-VACUOUS — a mutated fixture has to FLIP the verdict (dim-0). These tests pin every
  lane (telemetry / fs / command / composite) and prove the flip in both directions.
- Contract: telemetry resolvers read shared evidence (null ⇒ unknown, never fail); fs
  resolvers read the worktree (absent ⇒ fail); command-succeeds runs in the worktree;
  retro-drained is a three-valued AND (fail dominates, then unknown).
*/

const WT = '/wt';

/** The fixture evidence — the parsed `telemetry get --json` payload (all lanes satisfied). */
function evidence(): SessionEvidence {
  return {
    pij_session_id: 'pij-fixture',
    harness: 'claude-code',
    segments: 7,
    skills: { 'the-flow': 4, explore: 1, plan: 1, implement: 1 },
    skill_order: ['explore', 'plan', 'the-flow', 'implement'],
    files: { written: ['x.ts'], edited: [] },
    flow_seams: ['eng-harness-flow:pre-coding', 'eng-harness-flow:explore'],
    harness_verbs: { checks: 2, retro: 1, observe: 1 },
    checks: [{ status: 'ok' }],
    compactions: 1,
    tools: { Write: 5, Edit: 3 },
    gaps: ['plans_touched'],
  };
}

/** A worktree fixture with one of each fs artifact the assertions look for. */
function worktreeFs(): FakeFs {
  return new FakeFs(
    {
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

function ctxWith(
  ev: SessionEvidence | null,
  fs: FakeFs = worktreeFs(),
  exec = new FakeExec(),
): ResolveContext {
  return { evidence: ev, worktree: WT, fs, exec: (c, a, o) => exec.run(c, a, o) };
}

function a(type: string, params: Record<string, unknown> = {}, extra: Partial<Assertion> = {}): Assertion {
  return { id: type, type, source: 'telemetry', params, ...extra };
}

describe('resolvers — registry shape stays in lock-step with the type catalog', () => {
  it('has a resolver for every deterministic type, and NONE for judged', () => {
    const deterministic = Object.keys(ASSERTION_TYPES).filter((t) => t !== 'judged');
    expect(Object.keys(RESOLVERS).sort()).toEqual(deterministic.sort());
    expect(RESOLVERS.judged).toBeUndefined();
  });

  it('each resolver declares the same lane(s) as the catalog', () => {
    for (const [type, entry] of Object.entries(RESOLVERS)) {
      expect(entry.lanes).toEqual(ASSERTION_TYPES[type]);
    }
  });
});

describe('resolvers — telemetry lane (evidence present ⇒ pass/fail)', () => {
  it('resolves every telemetry assertion to pass over the satisfied fixture', async () => {
    const rc = ctxWith(evidence());
    expect(await resolveAssertion(a('skill-called', { skill: 'the-flow' }), rc)).toBe('pass');
    expect(await resolveAssertion(a('skill-sequence', { skills: ['explore', 'plan', 'implement'] }), rc)).toBe('pass');
    expect(await resolveAssertion(a('flow-seam-fired', { hook: 'pre-coding' }), rc)).toBe('pass');
    expect(await resolveAssertion(a('harness-verb-ran', { verb: 'checks' }), rc)).toBe('pass');
    expect(await resolveAssertion(a('checks-ran', { status: 'ok' }), rc)).toBe('pass');
    expect(await resolveAssertion(a('tool-used', { tool: 'Write' }), rc)).toBe('pass');
    expect(await resolveAssertion(a('compaction-occurred', { min: 1 }), rc)).toBe('pass');
  });

  it('skill-sequence FAILS when the order is violated (out-of-order)', async () => {
    const rc = ctxWith(evidence());
    // implement→plan is not a subsequence of [explore,plan,the-flow,implement].
    expect(await resolveAssertion(a('skill-sequence', { skills: ['implement', 'plan'] }), rc)).toBe('fail');
  });

  it('checks-ran FAILS when the required status was never seen', async () => {
    const rc = ctxWith(evidence());
    expect(await resolveAssertion(a('checks-ran', { status: 'error' }), rc)).toBe('fail');
  });
});

describe('resolvers — telemetry gap ⇒ unknown (never punish a missing capability)', () => {
  it('resolves ALL telemetry assertions to unknown when evidence is null', async () => {
    const rc = ctxWith(null);
    for (const type of Object.keys(ASSERTION_TYPES)) {
      if (ASSERTION_TYPES[type][0] !== 'telemetry') continue;
      expect(await resolveAssertion(a(type, { skill: 'x', verb: 'x', tool: 'x', hook: 'x', skills: ['x'], min: 1 }), rc)).toBe('unknown');
    }
  });
});

describe('resolvers — fs lane (worktree reads; absent ⇒ fail)', () => {
  it('resolves fs assertions to pass over the populated worktree', async () => {
    const rc = ctxWith(null);
    expect(await resolveAssertion(a('file-created', { glob: '.harness/extensions/*/extension.ts' }, { source: 'fs' }), rc)).toBe('pass');
    expect(await resolveAssertion(a('file-content-matches', { path: 'README.md', pattern: 'PDF' }, { source: 'fs' }), rc)).toBe('pass');
    expect(await resolveAssertion(a('artifact-exists', { glob: 'docs/**/*.md' }, { source: 'fs' }), rc)).toBe('pass');
  });

  it('file-created FAILS when nothing matches the glob', async () => {
    const rc = ctxWith(null, new FakeFs());
    expect(await resolveAssertion(a('file-created', { glob: '.harness/extensions/*/extension.ts' }, { source: 'fs' }), rc)).toBe('fail');
  });

  it('file-content-matches FAILS when the file is absent and when the pattern misses', async () => {
    const rc = ctxWith(null);
    expect(await resolveAssertion(a('file-content-matches', { path: 'NOPE.md', pattern: 'PDF' }, { source: 'fs' }), rc)).toBe('fail');
    expect(await resolveAssertion(a('file-content-matches', { path: 'README.md', pattern: 'DOCX' }, { source: 'fs' }), rc)).toBe('fail');
  });

  it('command-succeeds passes on exit 0 and fails on a non-zero exit', async () => {
    const exec = new FakeExec({ 'node ok.js': { code: 0 }, 'node bad.js': { code: 1 } });
    const rc = ctxWith(null, worktreeFs(), exec);
    expect(await resolveAssertion(a('command-succeeds', { cmd: 'node ok.js' }, { source: 'fs' }), rc)).toBe('pass');
    expect(await resolveAssertion(a('command-succeeds', { cmd: 'node bad.js' }, { source: 'fs' }), rc)).toBe('fail');
    // the command ran in the worktree, not the orchestrator cwd
    expect(exec.calls.find((c) => c.args.includes('ok.js'))?.cwd).toBe(WT);
  });
});

describe('resolvers — fs+telemetry composite (retro-drained: three-valued AND)', () => {
  const A = a('retro-drained', { evidence_glob: '.harness/records/retro/**/*.md' }, { source: 'fs+telemetry' });

  it('PASSES only when BOTH the retro verb ran AND a retro record exists', async () => {
    expect(await resolveAssertion(A, ctxWith(evidence()))).toBe('pass');
  });

  it('FAILS when the record is missing even though the verb ran (fail dominates)', async () => {
    expect(await resolveAssertion(A, ctxWith(evidence(), new FakeFs()))).toBe('fail');
  });

  it('is UNKNOWN when telemetry is absent but the record exists (unknown over pass)', async () => {
    expect(await resolveAssertion(A, ctxWith(null))).toBe('unknown');
  });
});

describe('resolvers — dim-0: a mutated fixture FLIPS the verdict (non-vacuity)', () => {
  it('skill-called pass→fail when the fixture drops the skill count', async () => {
    const ok = ctxWith(evidence());
    expect(await resolveAssertion(a('skill-called', { skill: 'the-flow' }), ok)).toBe('pass');

    const mutated = evidence();
    mutated.skills['the-flow'] = 0; // the mutation
    expect(await resolveAssertion(a('skill-called', { skill: 'the-flow' }), ctxWith(mutated))).toBe('fail');
  });

  it('file-created pass→fail when the deliverable is removed from the worktree', async () => {
    const A = a('file-created', { glob: '.harness/extensions/*/extension.ts' }, { source: 'fs' });
    expect(await resolveAssertion(A, ctxWith(null, worktreeFs()))).toBe('pass');

    const stripped = new FakeFs({ [`${WT}/README.md`]: 'x' }, { [WT]: ['README.md'] }); // mutation: no extension
    expect(await resolveAssertion(A, ctxWith(null, stripped))).toBe('fail');
  });

  it('tool-used min raises the bar so the same fixture flips pass→fail', async () => {
    expect(await resolveAssertion(a('tool-used', { tool: 'Write', min: 5 }), ctxWith(evidence()))).toBe('pass');
    expect(await resolveAssertion(a('tool-used', { tool: 'Write', min: 6 }), ctxWith(evidence()))).toBe('fail');
  });
});
