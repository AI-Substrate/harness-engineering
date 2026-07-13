import { describe, expect, it } from 'vitest';
import { FakeExec } from '../../../harness/cli/src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../../harness/cli/src/adapters/fs/fake-fs.js';
import {
  RESOLVERS,
  type ResolveContext,
  isPlaceholderToken,
  resolveAssertion,
  type SessionEvidence,
} from './resolvers.js';
import { ASSERTION_AXES, ASSERTION_TYPES, type Assertion, axisFor } from './scenario.js';

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
    duration_s: 900,
  };
}

/**
 * Copilot-shaped evidence (F8): skills run as anonymous `tools.skill` + harness verbs,
 * but the harness emits NO `kind:"skill"`/`kind:"flow"` NAME events — so `skills`,
 * `skill_order`, and `flow_seams` are structurally empty and the `skill_name_capture`
 * gap is set. the-flow ran (its `flow` verb family is present); the eng-harness-flow
 * loop did NOT (no observe/retro/boot/backpressure verbs).
 */
function copilotEvidence(): SessionEvidence {
  return {
    pij_session_id: 'pij-copilot',
    harness: 'copilot-cli',
    segments: 24,
    skills: {},
    skill_order: [],
    files: { written: ['x.ts'], edited: [] },
    flow_seams: [],
    harness_verbs: { flow: 13, 'flow nav': 11, 'flow orient': 6, doctor: 5, 'markdown-pdf': 4, checks: 1 },
    checks: [],
    compactions: 0,
    tools: { bash: 100, skill: 4, view: 182 },
    gaps: ['subagent_tokens', 'plans_touched', 'skill_name_capture'],
    duration_s: 4200,
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

  it('every type has exactly one axis (process|capability|safety) in lock-step with the catalog (1.1)', () => {
    // Axis map covers EVERY type in the catalog (no drift), and only those.
    expect(Object.keys(ASSERTION_AXES).sort()).toEqual(Object.keys(ASSERTION_TYPES).sort());
    for (const type of Object.keys(ASSERTION_TYPES)) {
      expect(['process', 'capability', 'safety']).toContain(ASSERTION_AXES[type]);
      expect(axisFor(type)).toBe(ASSERTION_AXES[type]);
    }
    // The cap-bearing axes are exactly the fs-capability + safety lanes; process never caps.
    expect(ASSERTION_AXES['file-created']).toBe('capability');
    expect(ASSERTION_AXES['forbidden-state']).toBe('safety');
    expect(ASSERTION_AXES['retro-drained']).toBe('process'); // orthogonal to its fs+telemetry lane
    expect(ASSERTION_AXES['skill-sequence']).toBe('process');
    // An unknown type is never a cap axis.
    expect(axisFor('teleport')).toBe('process');
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

  it('skill-sequence FAILS when the order is violated (out-of-order) under STRICT mode', async () => {
    const rc = ctxWith(evidence());
    // implement→plan is not a subsequence of [explore,plan,the-flow,implement]. STRICT enforces order.
    expect(await resolveAssertion(a('skill-sequence', { skills: ['implement', 'plan'], match_mode: 'strict' }), rc)).toBe('fail');
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

describe('resolvers — 4.6 per-run resolution + placeholder policy (SUGG-003)', () => {
  /** A command-succeeds assertion carrying a subject-specific placeholder cmd. */
  function cmd(id: string, token: string) {
    return a('command-succeeds', { cmd: token }, { source: 'fs', id });
  }
  function cmdCtx(exec: FakeExec, extra: Partial<ResolveContext> = {}): ResolveContext {
    return { evidence: null, worktree: WT, fs: worktreeFs(), exec: (c, ar, o) => exec.run(c, ar, o), ...extra };
  }

  it('isPlaceholderToken matches a bare screaming-snake token but never a real command', () => {
    expect(isPlaceholderToken('SUBJECT_EXTENSION_HELP')).toBe(true);
    expect(isPlaceholderToken('SUBJECT_PDF_VALIDATOR')).toBe(true);
    expect(isPlaceholderToken('node harness/cli/dist/index.js md-pdf --help')).toBe(false);
    expect(isPlaceholderToken('just build')).toBe(false);
    expect(isPlaceholderToken('X')).toBe(false); // single char is not a token
  });

  it('a --resolve override runs the resolved command in place of the placeholder (resolution-ignored → RED)', async () => {
    // The resolved command exits 0; the raw placeholder token is scripted to exit 1.
    // If the resolver IGNORED the resolution and ran the raw token, the verdict would flip.
    const exec = new FakeExec({ 'node real.js --help': { code: 0 }, SUBJECT_EXTENSION_HELP: { code: 1 } });
    const rc = cmdCtx(exec, { resolutions: { A7: 'node real.js --help' } });
    expect(await resolveAssertion(cmd('A7', 'SUBJECT_EXTENSION_HELP'), rc)).toBe('pass');
    // it ran the RESOLVED command, never the bare token.
    expect(exec.calls.some((c) => c.command === 'node' && c.args.join(' ') === 'real.js --help')).toBe(true);
    expect(exec.calls.some((c) => c.command === 'SUBJECT_EXTENSION_HELP')).toBe(false);
  });

  it("an UNRESOLVED placeholder under policy 'unknown' resolves unknown and never execs the token", async () => {
    const exec = new FakeExec();
    const rc = cmdCtx(exec, { placeholderPolicy: 'unknown' });
    expect(await resolveAssertion(cmd('A8', 'SUBJECT_PDF_VALIDATOR'), rc)).toBe('unknown');
    // never a silent pass, never a crash, never a raw exec of the token.
    expect(exec.calls.some((c) => c.command === 'SUBJECT_PDF_VALIDATOR')).toBe(false);
  });

  it("legacy 'raw' policy (default) executes the placeholder token as-is (frozen md-to-pdf back-compat)", async () => {
    const exec = new FakeExec({ SUBJECT_PDF_VALIDATOR: { code: 0 } });
    const rc = cmdCtx(exec); // no placeholderPolicy ⇒ default 'raw'
    expect(await resolveAssertion(cmd('A8', 'SUBJECT_PDF_VALIDATOR'), rc)).toBe('pass');
    // NON-VACUITY: it really RAN the token (a non-zero exit would fail).
    expect(exec.calls.some((c) => c.command === 'SUBJECT_PDF_VALIDATOR')).toBe(true);
    const bad = new FakeExec({ SUBJECT_PDF_VALIDATOR: { code: 1 } });
    expect(await resolveAssertion(cmd('A8', 'SUBJECT_PDF_VALIDATOR'), cmdCtx(bad))).toBe('fail');
  });

  it("a --resolve override wins even under policy 'unknown'", async () => {
    const exec = new FakeExec({ 'node r.js': { code: 0 } });
    const rc = cmdCtx(exec, { placeholderPolicy: 'unknown', resolutions: { A7: 'node r.js' } });
    expect(await resolveAssertion(cmd('A7', 'SUBJECT_EXTENSION_HELP'), rc)).toBe('pass');
    expect(exec.calls.some((c) => c.command === 'node' && c.args.join(' ') === 'r.js')).toBe(true);
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

describe('resolvers — F11: retro drain keys on the real `record` verb, not phantom `retro`', () => {
  const A = a('retro-drained', { evidence_glob: '.harness/records/retro/**/*.md' }, { source: 'fs+telemetry' });

  /** The REAL harness drain shape: `observe` (capture) → `record` (write), NO `retro` verb. */
  function realDrainEvidence(): SessionEvidence {
    const ev = evidence();
    ev.harness_verbs = { observe: 3, record: 2, boot: 1, checks: 1 }; // no `retro` verb exists
    return ev;
  }

  it('PASSES on a real drain — `record` verb ran + record file exists (the F11 fix)', async () => {
    expect(await resolveAssertion(A, ctxWith(realDrainEvidence()))).toBe('pass');
  });

  it('flips pass→fail when the `record` verb is dropped (non-vacuous; stale file alone never passes)', async () => {
    const ev = realDrainEvidence();
    ev.harness_verbs.record = 0; // the mutation: no drain-write this session, only a pre-existing file
    expect(await resolveAssertion(A, ctxWith(ev))).toBe('fail');
  });

  it('still honours a legacy `retro` verb if some harness emits one (backward compat)', async () => {
    const ev = realDrainEvidence();
    ev.harness_verbs = { retro: 1 }; // legacy-only shape
    expect(await resolveAssertion(A, ctxWith(ev))).toBe('pass');
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

describe('resolvers — F8: skill-name-capture gap (copilot) ⇒ verb-signature fallback', () => {
  it('skill-called the-flow PASSES via its `flow` verb signature (no kind:skill event)', async () => {
    expect(await resolveAssertion(a('skill-called', { skill: 'the-flow' }), ctxWith(copilotEvidence()))).toBe('pass');
  });

  it('skill-called eng-harness-flow FAILS — loop verbs absent (preserves the real F7 signal)', async () => {
    expect(await resolveAssertion(a('skill-called', { skill: 'eng-harness-flow' }), ctxWith(copilotEvidence()))).toBe('fail');
  });

  it('eng-harness-flow flips fail→pass when a loop verb (observe) appears (non-vacuous)', async () => {
    const ev = copilotEvidence();
    ev.harness_verbs.observe = 1; // the mutation: the loop actually engaged
    expect(await resolveAssertion(a('skill-called', { skill: 'eng-harness-flow' }), ctxWith(ev))).toBe('pass');
  });

  it('skill-called a skill with NO known signature ⇒ unknown (never a false fail)', async () => {
    expect(await resolveAssertion(a('skill-called', { skill: 'validate-v2' }), ctxWith(copilotEvidence()))).toBe('unknown');
  });

  it('skill-sequence and flow-seam-fired ⇒ unknown (names/seams uncaptured for copilot)', async () => {
    const rc = ctxWith(copilotEvidence());
    expect(await resolveAssertion(a('skill-sequence', { skills: ['explore', 'plan', 'implement'] }), rc)).toBe('unknown');
    expect(await resolveAssertion(a('flow-seam-fired', { hook: 'pre-coding' }), rc)).toBe('unknown');
  });

  it('the fallback is GATED on the gap: the same empty skills WITHOUT the gap still FAIL (Claude semantics intact)', async () => {
    const ev = copilotEvidence();
    ev.gaps = ev.gaps.filter((g) => g !== 'skill_name_capture'); // mutation: drop the gap marker
    expect(await resolveAssertion(a('skill-called', { skill: 'the-flow' }), ctxWith(ev))).toBe('fail');
  });
});

describe('resolvers — 1.4 skill-sequence match_mode (WS003 §D2); default SUPERSET', () => {
  // Observed trajectory: explore → plan → the-flow → implement (an EXTRA `the-flow` step).
  const seq = (params: Record<string, unknown>) => a('skill-sequence', params);

  it('DEFAULT is SUPERSET — order-agnostic presence; out-of-order still PASSES (the default flip vs strict)', async () => {
    const rc = ctxWith(evidence());
    // Same skills, reversed order — SUPERSET ignores order, so this PASSES (STRICT would FAIL: pinned above).
    expect(await resolveAssertion(seq({ skills: ['implement', 'plan'] }), rc)).toBe('pass');
  });

  describe('STRICT — ordered subsequence (order is the invariant)', () => {
    it('PASSES when required skills appear in order (extras allowed between)', async () => {
      expect(await resolveAssertion(seq({ skills: ['explore', 'plan', 'implement'], match_mode: 'strict' }), ctxWith(evidence()))).toBe('pass');
    });
    it('FLIPS to fail when the order is violated', async () => {
      expect(await resolveAssertion(seq({ skills: ['implement', 'explore'], match_mode: 'strict' }), ctxWith(evidence()))).toBe('fail');
    });
  });

  describe('LEGACY `ordered: true` maps to STRICT (back-compat; load-bearing — live md-to-pdf uses it)', () => {
    // Mutating seqMode's `ordered === true ⇒ 'strict'` to 'superset' MUST flip these RED.
    it('FLIPS to fail on out-of-order — proving STRICT, not the default SUPERSET', async () => {
      // ['implement','explore'] is NOT an ordered subsequence of [explore,plan,the-flow,implement];
      // SUPERSET (the mutation) would PASS since both are present — so this asserts the strict mapping.
      expect(await resolveAssertion(seq({ ordered: true, skills: ['implement', 'explore'] }), ctxWith(evidence()))).toBe('fail');
    });
    it("is equivalent to match_mode:'strict' across ordered-pass and out-of-order-fail", async () => {
      const inOrder = ['explore', 'plan', 'implement'];
      const outOfOrder = ['implement', 'explore'];
      expect(await resolveAssertion(seq({ ordered: true, skills: inOrder }), ctxWith(evidence()))).toBe(
        await resolveAssertion(seq({ match_mode: 'strict', skills: inOrder }), ctxWith(evidence())),
      );
      expect(await resolveAssertion(seq({ ordered: true, skills: outOfOrder }), ctxWith(evidence()))).toBe(
        await resolveAssertion(seq({ match_mode: 'strict', skills: outOfOrder }), ctxWith(evidence())),
      );
      // and concretely: in-order PASSES, out-of-order FAILS (guards against both collapsing to a constant).
      expect(await resolveAssertion(seq({ ordered: true, skills: inOrder }), ctxWith(evidence()))).toBe('pass');
      expect(await resolveAssertion(seq({ ordered: true, skills: outOfOrder }), ctxWith(evidence()))).toBe('fail');
    });
  });

  describe('SUPERSET — every required present, order + extras ignored (≥)', () => {
    it('PASSES with extra steps present (the-flow is extra)', async () => {
      expect(await resolveAssertion(seq({ skills: ['explore', 'implement'], match_mode: 'superset' }), ctxWith(evidence()))).toBe('pass');
    });
    it('FLIPS to fail when a required skill is absent', async () => {
      expect(await resolveAssertion(seq({ skills: ['explore', 'deploy'], match_mode: 'superset' }), ctxWith(evidence()))).toBe('fail');
    });
  });

  describe('SUBSET — no out-of-scope skills (observed ⊆ required); scope-creep guard', () => {
    it('PASSES when every observed skill is in the allowed set', async () => {
      // allowed superset of the observed 4 → no scope creep.
      expect(await resolveAssertion(seq({ skills: ['explore', 'plan', 'the-flow', 'implement', 'review'], match_mode: 'subset' }), ctxWith(evidence()))).toBe('pass');
    });
    it('FLIPS to fail when the subject ran a skill outside the allowed set (the-flow omitted)', async () => {
      expect(await resolveAssertion(seq({ skills: ['explore', 'plan', 'implement'], match_mode: 'subset' }), ctxWith(evidence()))).toBe('fail');
    });
  });

  describe('UNORDERED — exact set match, order ignored (== )', () => {
    it('PASSES when the sets are equal regardless of order', async () => {
      expect(await resolveAssertion(seq({ skills: ['implement', 'the-flow', 'plan', 'explore'], match_mode: 'unordered' }), ctxWith(evidence()))).toBe('pass');
    });
    it('FLIPS to fail when an extra observed skill breaks exact equality', async () => {
      // missing `the-flow` from the required set → observed has an extra → not equal.
      expect(await resolveAssertion(seq({ skills: ['explore', 'plan', 'implement'], match_mode: 'unordered' }), ctxWith(evidence()))).toBe('fail');
    });
  });

  describe('per-arg overrides — volatile-arg tolerance (ignore | regex), NOT membership', () => {
    /** Evidence whose skill_order entries carry volatile args (a plan path). */
    function argEvidence(): SessionEvidence {
      const ev = evidence();
      ev.skill_order = ['explore', 'plan docs/plans/046-x/plan.md', 'implement'];
      return ev;
    }

    it('a bare-name required entry is name-only (args never constrain it) — back-compat', async () => {
      expect(await resolveAssertion(seq({ skills: ['plan', 'implement'], match_mode: 'strict' }), ctxWith(argEvidence()))).toBe('pass');
    });

    it("no override + a required entry WITH args exact-matches the arg tail (fails on a volatile mismatch)", async () => {
      expect(await resolveAssertion(seq({ skills: ['plan docs/plans/999-other/plan.md'], match_mode: 'strict' }), ctxWith(argEvidence()))).toBe('fail');
    });

    it("arg_overrides '<skill>':'ignore' relaxes the arg tail so a volatile path still matches (FLIP vs above)", async () => {
      expect(
        await resolveAssertion(
          seq({ skills: ['plan docs/plans/999-other/plan.md'], match_mode: 'strict', arg_overrides: { plan: 'ignore' } }),
          ctxWith(argEvidence()),
        ),
      ).toBe('pass');
    });

    it("arg_overrides '<skill>':'<regex>' pattern-matches the arg tail (pass on match, fail on miss)", async () => {
      const pass = seq({ skills: ['plan x'], match_mode: 'strict', arg_overrides: { plan: '046-x' } });
      const fail = seq({ skills: ['plan x'], match_mode: 'strict', arg_overrides: { plan: '^999-' } });
      expect(await resolveAssertion(pass, ctxWith(argEvidence()))).toBe('pass');
      expect(await resolveAssertion(fail, ctxWith(argEvidence()))).toBe('fail');
    });
  });

  it('still resolves UNKNOWN under the copilot skill_name_capture gap (mode never overrides the gap guard)', async () => {
    const rc = ctxWith(copilotEvidence());
    expect(await resolveAssertion(seq({ skills: ['explore', 'implement'], match_mode: 'superset' }), rc)).toBe('unknown');
  });
});

describe('resolvers — 1.5 forbidden-state (safety axis, fs lane; WS003 §D8)', () => {
  const fstate = (params: Record<string, unknown>) =>
    a('forbidden-state', params, { source: 'fs', required: true });

  it('PASSES when no forbidden artifact matches and the required contract is present', async () => {
    const A = fstate({ forbidden_glob: 'secrets/**/*.key', require_path: 'README.md' });
    expect(await resolveAssertion(A, ctxWith(null, worktreeFs()))).toBe('pass');
  });

  it('FLIPS to fail when a forbidden artifact IS present (out-of-scope edit)', async () => {
    // The worktree HAS .harness/extensions/foo/extension.ts — forbid edits there.
    const A = fstate({ forbidden_glob: '.harness/extensions/**/*.ts' });
    expect(await resolveAssertion(A, ctxWith(null, worktreeFs()))).toBe('fail');
  });

  it('FLIPS to fail when the required report-contract file is absent', async () => {
    const A = fstate({ require_path: 'REPORT_CONTRACT.md' });
    expect(await resolveAssertion(A, ctxWith(null, worktreeFs()))).toBe('fail');
  });

  it('is UNKNOWN when neither a forbidden nor a required param is given (nothing to evaluate)', async () => {
    expect(await resolveAssertion(fstate({}), ctxWith(null, worktreeFs()))).toBe('unknown');
  });

  it('supports require_glob and AND-s both checks (fail dominates)', async () => {
    const ok = fstate({ forbidden_glob: 'nope/**', require_glob: 'docs/**/*.md' });
    expect(await resolveAssertion(ok, ctxWith(null, worktreeFs()))).toBe('pass');
    const bad = fstate({ forbidden_glob: 'README.md', require_glob: 'docs/**/*.md' }); // README exists ⇒ forbidden hit
    expect(await resolveAssertion(bad, ctxWith(null, worktreeFs()))).toBe('fail');
  });
});

describe('file-content-matches — glob content assertion (plan 056 T014)', () => {
  const RECORD = [
    'entries:',
    '  - id: DL-001',
    '    disposition: fixed-now',
    '  - id: SUGG-001',
    '    disposition: declined',
    '  - id: MW-001',
    '    disposition: deferred',
    '    fp: a3f9c2d1e4b5',
  ].join('\n');

  function retroFs(body: string): FakeFs {
    return new FakeFs(
      { [`${WT}/.harness/records/retro/2026-07-09/001-x.md`]: body },
      {
        [WT]: ['.harness'],
        [`${WT}/.harness`]: ['records'],
        [`${WT}/.harness/records`]: ['retro'],
        [`${WT}/.harness/records/retro`]: ['2026-07-09'],
        [`${WT}/.harness/records/retro/2026-07-09`]: ['001-x.md'],
      },
    );
  }

  const GLOB = '.harness/records/retro/**/*.md';

  it('passes when the pattern matches inside a glob-matched file (declined + deferred + fp)', async () => {
    const rc = ctxWith(null, retroFs(RECORD));
    for (const pattern of ['disposition:\\s*declined', 'disposition:\\s*deferred', 'fp:\\s*[a-f0-9]{12}']) {
      expect(await resolveAssertion(a('file-content-matches', { glob: GLOB, pattern }, { source: 'fs' }), rc)).toBe('pass');
    }
  });

  it('fails when no glob-matched file carries the pattern', async () => {
    const rc = ctxWith(null, retroFs('entries:\n  - id: DL-001\n    disposition: kept\n'));
    expect(await resolveAssertion(a('file-content-matches', { glob: GLOB, pattern: 'disposition:\\s*declined' }, { source: 'fs' }), rc)).toBe('fail');
  });

  it('fails when the glob matches nothing', async () => {
    const rc = ctxWith(null, new FakeFs({}, { [WT]: [] }));
    expect(await resolveAssertion(a('file-content-matches', { glob: GLOB, pattern: 'disposition:' }, { source: 'fs' }), rc)).toBe('fail');
  });

  it('still supports the exact-path form', async () => {
    const rc = ctxWith(null, retroFs(RECORD));
    const p = a('file-content-matches', { path: '.harness/records/retro/2026-07-09/001-x.md', pattern: 'disposition:\\s*declined' }, { source: 'fs' });
    expect(await resolveAssertion(p, rc)).toBe('pass');
  });
});
