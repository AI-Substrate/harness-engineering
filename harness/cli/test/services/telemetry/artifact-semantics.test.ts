import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_EXTRACTORS,
  type ArtifactContentReader,
  type ArtifactExtractor,
  artifactSemanticsEvents,
  extractArtifact,
  MAX_ARTIFACT_BYTES,
  matchExtractor,
  resolveArtifactPath,
} from '../../../src/services/telemetry/artifact-semantics.js';
import {
  ARTIFACT_COUNT_KEYS,
  ARTIFACT_ENUM_KEYS,
  type ArtifactEvent,
} from '../../../src/services/telemetry/events.js';
import { serializeEvent } from '../../../src/services/telemetry/segment.js';

/**
 * Plan 050 T005 — the artifact-semantics extractor registry.
 *
 * Fixtures are lifted from this repo's OWN flow grammar (real `**Verdict**:`,
 * `F<n> · SEV`, `#### Phase`, gate-matrix, status-token shapes). Each extractor
 * is proven to (a) return known counts/enums on a real sample, (b) yield `{}` on
 * garbage without throwing (AC-04), and (c) gate enum values to a fixed
 * vocabulary with an `other` fallback (AC-05).
 */

const REPO = '/repo';

/** Fetch the single registered extractor for a type (readability in assertions). */
function extractorFor(type: ArtifactEvent['artifact_type']): ArtifactExtractor {
  const ex = ARTIFACT_EXTRACTORS.find((e) => e.type === type);
  if (ex === undefined) throw new Error(`no extractor for ${type}`);
  return ex;
}

describe('extractor: review', () => {
  const content = [
    '# Review — 050 Phase 1',
    '**Verdict**: ✅ **APPROVE** (FIX_REQUIRED → 1 HIGH + 1 MED fixed → narrow re-review)',
    '## Findings',
    '- **F1 · HIGH · gap**: the thing. **Fix**: did it. re-review confirmed.',
    '- **F2 · MED · docs**: lied. **Fix (test-only)**: added a test.',
  ].join('\n');

  it('counts fixes, findings by severity, and re-review loops', () => {
    const { counts } = extractorFor('review').extract(content);
    expect(counts).toEqual({ findings_high: 1, findings_med: 1, fixes: 2, re_reviews: 2 });
  });

  it('lifts the verdict enum from the first bold token', () => {
    expect(extractorFor('review').extract(content).enums).toEqual({ verdict: 'APPROVE' });
  });

  it('maps an unknown verdict to `other` (allowlist gate)', () => {
    const c = '**Verdict**: ✅ **SHIPPED_IT** (novel)';
    expect(extractorFor('review').extract(c).enums).toEqual({ verdict: 'other' });
  });

  // F1 — the verdict token travels with OR without bold/emoji decoration.
  it('lifts an UNBOLDED verdict token (`**Verdict**: FIX_REQUIRED`)', () => {
    expect(extractorFor('review').extract('**Verdict**: FIX_REQUIRED').enums).toEqual({
      verdict: 'FIX_REQUIRED',
    });
  });

  it('lifts an emoji-prefixed unbolded verdict (`✅ APPROVE_WITH_NOTES …`)', () => {
    const c = '**Verdict**: ✅ APPROVE_WITH_NOTES (one MEDIUM raised → fixed → re-verified)';
    expect(extractorFor('review').extract(c).enums).toEqual({ verdict: 'APPROVE_WITH_NOTES' });
  });

  it('takes the FIRST verdict token, not one named in the parenthetical', () => {
    // `✅ **APPROVE** (FIX_REQUIRED → …)` must resolve to APPROVE, never FIX_REQUIRED.
    const c = '**Verdict**: ✅ **APPROVE** (FIX_REQUIRED → 1 HIGH fixed → re-review)';
    expect(extractorFor('review').extract(c).enums).toEqual({ verdict: 'APPROVE' });
  });
});

describe('F-08 — review-packet templates are NOT reviews (plan 052 T002)', () => {
  // The REAL 050/051 packet shapes (public repo grammar): a rubric verdict line +
  // a finding-FORMAT line with `<…>` placeholders and no concrete `F<digit>`.
  const PACKET = [
    '# Review packet — 051 Phase 1',
    '## Output',
    'Write `docs/plans/051-x/reviews/review.phase-1.md`:',
    '- `**Verdict**: APPROVE | APPROVE_WITH_NOTES | FIX_REQUIRED`',
    '- Findings `F<N> · <CRITICAL|HIGH|MED>` with file:line, claim, proof, smallest fix',
  ].join('\n');

  // The REAL 051 review.phase-1.md shape: a single verdict + one CRITICAL finding.
  const REAL_REVIEW = [
    '# Review — plan 051 phase 1',
    '**Verdict**: FIX_REQUIRED',
    '## Findings',
    '### F1 · CRITICAL · roster scope is only labelled, not actually scoped',
  ].join('\n');

  it('a *-packet.md path matches NO extractor (never classified as review)', () => {
    expect(matchExtractor('docs/plans/051-x/reviews/review-packet.md')).toBeNull();
    expect(matchExtractor('docs/plans/050-x/reviews/review-packet.md')).toBeNull();
  });

  it('a real review.phase-1.md path still matches the review extractor', () => {
    expect(matchExtractor('docs/plans/051-x/reviews/review.phase-1.md')?.type).toBe('review');
  });

  it('the packet emits NO artifact event (capture pass)', () => {
    const events = artifactSemanticsEvents(
      reader({ '/repo/docs/plans/051-x/reviews/review-packet.md': PACKET }),
      REPO,
      { written: ['docs/plans/051-x/reviews/review-packet.md'] },
      '2026-07-04T00:00:00Z',
    );
    expect(events).toEqual([]);
  });

  it('the REAL 051 review still yields verdict FIX_REQUIRED, findings {critical:1} (AC-04)', () => {
    const { counts, enums } = extractorFor('review').extract(REAL_REVIEW);
    expect(enums).toEqual({ verdict: 'FIX_REQUIRED' });
    expect(counts).toEqual({ findings_critical: 1 });
  });

  it('a rubric verdict line is rejected even in a non-packet review file (defense in depth)', () => {
    // A pipe-separated vocabulary enumeration is an instruction, not a verdict —
    // no verdict enum travels, whatever the filename.
    const rubric = '**Verdict**: APPROVE | APPROVE_WITH_NOTES | FIX_REQUIRED | NEEDS_ATTENTION';
    expect(extractorFor('review').extract(rubric).enums).toEqual({});
  });
});

describe('extractor: plan', () => {
  it('counts phases, CS, gate rows, gaps, workshop opps; lifts mode + status (Full)', () => {
    const content = [
      '**Mode**: Full',
      '**Status**: READY',
      '- **Score**: CS-3 (medium)',
      '#### Phase 1: A',
      '#### Phase 2: B',
      '| G1 | Clarify | PASS | ok |',
      '| G2 | Const | N/A | none |',
      '| G3 | Arch | FAIL | bad |',
      '⚠️ GAP: unresolved thing',
      '### Workshop Opportunities',
      '- WS-1 folded, WS-2 deferred, WS-1 revisited (WS-1 counts once).',
    ].join('\n');
    const { counts, enums } = extractorFor('plan').extract(content);
    expect(counts).toEqual({
      phases: 2,
      cs: 3,
      gate_pass: 1,
      gate_na: 1,
      gate_fail: 1,
      gaps: 1,
      workshop_opps: 2,
    });
    expect(enums).toEqual({ mode: 'FULL', status: 'READY' });
  });

  it('a Simple plan with no Phase headers is a single phase', () => {
    const content = '**Mode**: Simple\n**Status**: DRAFT\n(no phase index)';
    const { counts, enums } = extractorFor('plan').extract(content);
    expect(counts).toEqual({ phases: 1 });
    expect(enums).toEqual({ mode: 'SIMPLE', status: 'DRAFT' });
  });
});

describe('extractor: workshop', () => {
  it('counts sections, decisions, open/resolved; lifts proof levels', () => {
    const content = [
      '**Target Proof Level**: Contract Ready',
      '**Current Proof Level**: Preferred Direction',
      '## Purpose',
      '## Decision Space',
      '| D1 | x | **A** — Selected |',
      '| D2 | y | **B** — Selected |',
      '## Open Questions',
      '**OPEN** — q1',
      '**RESOLVED**: q2',
    ].join('\n');
    const { counts, enums } = extractorFor('workshop').extract(content);
    expect(counts).toEqual({ sections: 3, decisions: 2, open: 1, resolved: 1 });
    expect(enums).toEqual({ target_proof: 'CONTRACT_READY', current_proof: 'PREFERRED_DIRECTION' });
  });
});

describe('extractor: dossier', () => {
  it('counts sections, findings, high-impact rows', () => {
    const content = [
      '## Summary',
      '## Findings',
      '| F-01 | thing | src | High |',
      '| F-02 | other | src | High |',
    ].join('\n');
    expect(extractorFor('dossier').extract(content).counts).toEqual({
      sections: 2,
      findings: 2,
      high: 2,
    });
  });
});

describe('extractor: tasks', () => {
  it('counts table rows by status token', () => {
    const content = [
      '| [x] | T1 | done |',
      '| [ ] | T2 | todo |',
      '| [!] | T3 | blocked |',
      '| [~] | T4 | wip |',
    ].join('\n');
    expect(extractorFor('tasks').extract(content).counts).toEqual({
      done: 1,
      todo: 1,
      blocked: 1,
      in_progress: 1,
    });
  });
});

describe('extractor: execution-log', () => {
  it('counts entry headers, deviations, deferrals', () => {
    const content = [
      '# Execution Log',
      '## Outcome',
      '## Gates',
      '- Deviation: changed X',
      '- Deferred: Y to next phase',
    ].join('\n');
    expect(extractorFor('execution-log').extract(content).counts).toEqual({
      entries: 2,
      deviations: 1,
      deferred: 1,
    });
  });
});

describe('extractor: backpressure', () => {
  it('counts sensor status; lifts the certainty enum', () => {
    const content = [
      '**Certainty**: Partial',
      '| AC-01 | s | EXISTS | tier |',
      '| AC-02 | s | BUILDABLE | tier |',
      '| AC-03 | s | ABSENT | tier |',
    ].join('\n');
    const { counts, enums } = extractorFor('backpressure').extract(content);
    expect(counts).toEqual({ exists: 1, buildable: 1, absent: 1 });
    expect(enums).toEqual({ certainty: 'PARTIAL' });
  });
});

describe('extractor: validation', () => {
  it('counts findings by severity; lifts the verdict enum', () => {
    const content = [
      '**Verdict**: ✅ VALIDATED WITH FIXES',
      '| F1 | HIGH | thing |',
      '| F2 | MEDIUM | other |',
    ].join('\n');
    const { counts, enums } = extractorFor('validation').extract(content);
    expect(counts).toEqual({ findings_high: 1, findings_med: 1 });
    expect(enums).toEqual({ verdict: 'VALIDATED_WITH_FIXES' });
  });
});

describe('extractor: ship-report', () => {
  it('counts checks green/total + pr-opened; lifts the PR-state enum', () => {
    const content = [
      '**PR**: https://github.com/x/y/pull/40 (#40)  ·  **State**: open',
      '**Verdict**: all green (5/5)',
    ].join('\n');
    const { counts, enums } = extractorFor('ship-report').extract(content);
    expect(counts).toEqual({ checks_green: 5, checks_total: 5, pr_opened: 1 });
    expect(enums).toEqual({ pr_state: 'OPEN' });
  });
});

describe('extractor: flight-plan', () => {
  it('rolls up nodes by type/status + chore-scoped status + events + comments', () => {
    const content = JSON.stringify({
      nodes: [
        { type: 'phase', status: 'done' },
        { type: 'phase', status: 'assumed' },
        { type: 'workshop', status: 'done' },
        { type: 'chore', status: 'skipped', comments: ['a', 'b'] },
        { type: 'chore', status: 'done' },
        { type: 'chore', status: 'known' },
      ],
      events: [1, 2, 3],
    });
    expect(extractorFor('flight-plan').extract(content).counts).toEqual({
      nodes: 6,
      phases: 2,
      workshops: 1,
      chores: 3,
      chores_done: 1,
      chores_skipped: 1,
      chores_todo: 1,
      done: 3,
      skipped: 1,
      comments: 2,
      events: 3,
    });
  });

  it('malformed JSON yields empty counts, never throws (AC-04)', () => {
    expect(extractorFor('flight-plan').extract('{ not json').counts).toEqual({});
  });
});

describe('defensive parse (AC-04) — garbage → empty counts, no throw', () => {
  for (const ex of ARTIFACT_EXTRACTORS) {
    it(`${ex.type}: garbage content extracts to {} counts`, () => {
      const out = extractArtifact(ex, 'garbage with no markers whatsoever\n\n');
      expect(out.counts).toEqual({});
      expect(out.enums).toEqual({});
    });
  }

  it('a throwing extractor degrades to empty counts', () => {
    const bad: ArtifactExtractor = {
      type: 'review',
      match: () => true,
      extract: () => {
        throw new Error('boom');
      },
    };
    expect(extractArtifact(bad, 'x')).toEqual({ counts: {}, enums: {} });
  });
});

describe('registry dispatch (path-first, first-match)', () => {
  const cases: Array<[string, ArtifactEvent['artifact_type']]> = [
    ['docs/plans/046-x/reviews/p1-review.md', 'review'],
    ['docs/plans/046-x/046-x-plan.md', 'plan'],
    ['docs/plans/046-x/workshops/001-x.md', 'workshop'],
    ['docs/plans/046-x/research-dossier.md', 'dossier'],
    ['docs/plans/046-x/tasks/phase-1/tasks.md', 'tasks'],
    ['docs/plans/046-x/tasks/phase-1/execution.log.md', 'execution-log'],
    ['docs/plans/046-x/backpressure-coverage.md', 'backpressure'],
    ['docs/plans/046-x/validations/046-x-validation.md', 'validation'],
    ['docs/plans/046-x/ship/2026-07-04/ship-report.md', 'ship-report'],
    ['docs/plans/046-x/the-flow.json', 'flight-plan'],
    ['.harness/records/retro/2026-07-09T11-00-00Z-agent-a8f3.md', 'retro'],
  ];
  for (const [path, type] of cases) {
    it(`${path} → ${type}`, () => {
      expect(matchExtractor(path)?.type).toBe(type);
    });
  }

  it('an unrelated source file matches no extractor', () => {
    expect(matchExtractor('harness/cli/src/index.ts')).toBeNull();
  });

  it('a plan-validation file resolves to validation, not plan', () => {
    // `…/validations/x-plan-validation.md` must not be shadowed by the plan matcher.
    expect(matchExtractor('docs/plans/046-x/validations/046-x-plan-validation.md')?.type).toBe(
      'validation',
    );
  });
});

describe('resolveArtifactPath', () => {
  it('relativizes an absolute in-repo path + returns the read path', () => {
    expect(resolveArtifactPath('/repo/docs/plans/x/reviews/r.md', REPO)).toEqual({
      rel: 'docs/plans/x/reviews/r.md',
      read: '/repo/docs/plans/x/reviews/r.md',
    });
  });

  it('anchors a relative path to the repo root', () => {
    expect(resolveArtifactPath('docs/plans/x/reviews/r.md', REPO)).toEqual({
      rel: 'docs/plans/x/reviews/r.md',
      read: '/repo/docs/plans/x/reviews/r.md',
    });
  });

  it('skips an out-of-repo path (privacy)', () => {
    expect(resolveArtifactPath('/etc/passwd', REPO)).toBeNull();
    expect(resolveArtifactPath('/repo/../secret.md', REPO)).toBeNull();
  });
});

// ── the capture helper ───────────────────────────────────────────────────────

function reader(map: Record<string, string>): ArtifactContentReader {
  return { readText: (p) => map[p] ?? null };
}

const REVIEW = [
  '**Verdict**: ✅ **APPROVE** (clean)',
  '- **F1 · HIGH · x**: thing. **Fix**: done.',
].join('\n');

describe('artifactSemanticsEvents (the capture pass)', () => {
  it('emits one counts-only event per matched changed file, with plan_id + change', () => {
    const rel = 'docs/plans/050-x/reviews/r.md';
    const events = artifactSemanticsEvents(
      reader({ '/repo/docs/plans/050-x/reviews/r.md': REVIEW }),
      REPO,
      { edited: [rel] },
      '2026-07-04T00:00:00Z',
    );
    expect(events).toHaveLength(1);
    const ev = events[0] as ArtifactEvent;
    expect(ev.kind).toBe('artifact');
    expect(ev.artifact_type).toBe('review');
    expect(ev.path).toBe(rel);
    expect(ev.plan_id).toBe('050-x');
    expect(ev.change).toBe('edited');
    expect(ev.counts).toEqual({ findings_high: 1, fixes: 1 });
    expect(ev.enums).toEqual({ verdict: 'APPROVE' });
    expect(ev.size.lines).toBe(2);
    expect(ev.size.bytes).toBeGreaterThan(0);
    expect(ev.t).toBe('2026-07-04T00:00:00Z');
  });

  it('a missing file in the changed set emits no event and never throws (AC-04)', () => {
    const events = artifactSemanticsEvents(
      reader({}), // nothing on disk
      REPO,
      { edited: ['docs/plans/050-x/reviews/gone.md'] },
      '2026-07-04T00:00:00Z',
    );
    expect(events).toEqual([]);
  });

  it('skips an oversized artifact (AC-04)', () => {
    const huge = `# big\n${'x'.repeat(MAX_ARTIFACT_BYTES + 1)}`;
    const events = artifactSemanticsEvents(
      reader({ '/repo/docs/plans/050-x/reviews/big.md': huge }),
      REPO,
      { edited: ['docs/plans/050-x/reviews/big.md'] },
      '2026-07-04T00:00:00Z',
    );
    expect(events).toEqual([]);
  });

  it('skips a binary artifact (NUL byte)', () => {
    const events = artifactSemanticsEvents(
      reader({ '/repo/docs/plans/050-x/reviews/bin.md': 'PK\u0000\u0000binary' }),
      REPO,
      { edited: ['docs/plans/050-x/reviews/bin.md'] },
      '2026-07-04T00:00:00Z',
    );
    expect(events).toEqual([]);
  });

  it('skips out-of-repo and unmatched paths', () => {
    const events = artifactSemanticsEvents(
      reader({ '/etc/passwd': 'root:x', '/repo/src/x.ts': 'code' }),
      REPO,
      { edited: ['/etc/passwd', 'src/x.ts'] },
      '2026-07-04T00:00:00Z',
    );
    expect(events).toEqual([]);
  });

  it('deduplicates a path present in both written and edited (written wins)', () => {
    const rel = 'docs/plans/050-x/reviews/r.md';
    const events = artifactSemanticsEvents(
      reader({ '/repo/docs/plans/050-x/reviews/r.md': REVIEW }),
      REPO,
      { written: [rel], edited: [rel] },
      '2026-07-04T00:00:00Z',
    );
    expect(events).toHaveLength(1);
    expect((events[0] as ArtifactEvent).change).toBe('written');
  });
});

describe('privacy (AC-05) — no artifact prose can travel', () => {
  it('the serialized event carries only counts/enums/path/size, never finding text', () => {
    const secret = 'ZZZ_SUPER_SECRET_FINDING_PROSE_ZZZ';
    const content = [
      '**Verdict**: ⚠️ **FIX_REQUIRED**',
      `- **F1 · HIGH · leak**: ${secret}. **Fix**: ${secret}.`,
    ].join('\n');
    const [ev] = artifactSemanticsEvents(
      reader({ '/repo/docs/plans/050-x/reviews/r.md': content }),
      REPO,
      { edited: ['docs/plans/050-x/reviews/r.md'] },
      '2026-07-04T00:00:00Z',
    );
    const serialized = serializeEvent(ev);
    const json = JSON.stringify(serialized);
    expect(json).not.toContain(secret);
    // Keys are exactly the allowlisted artifact shape — no smuggled channel.
    expect(new Set(Object.keys(serialized)).size).toBeGreaterThan(0);
    expect(Object.keys(serialized).sort()).toEqual(
      [
        'artifact_type',
        'change',
        'counts',
        'enums',
        'kind',
        'path',
        'plan_id',
        'size',
        't',
        't_precision',
      ].sort(),
    );
    // The enum value is a fixed-vocab token, not the raw line.
    expect((serialized as ArtifactEvent).enums.verdict).toBe('FIX_REQUIRED');
  });
});

// ── F2 — the counts/enums channel is a CLOSED key union, schema-enforced ──────

const SCHEMA_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../src/services/telemetry/segment.schema.json',
);
const SCHEMA = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as {
  properties: {
    event_stream: {
      items: {
        properties: {
          counts: { additionalProperties: boolean; properties: Record<string, unknown> };
          enums: {
            additionalProperties: boolean;
            properties: Record<string, { enum?: string[] }>;
          };
        };
      };
    };
  };
};
const ITEM_PROPS = SCHEMA.properties.event_stream.items.properties;
const SCHEMA_COUNT_KEYS = new Set(Object.keys(ITEM_PROPS.counts.properties));
const SCHEMA_ENUM_KEYS = new Set(Object.keys(ITEM_PROPS.enums.properties));

/** Keys present on `obj` that `allowed` does not declare (ajv-free additionalProperties:false). */
function additionalKeys(obj: Record<string, unknown>, allowed: Set<string>): string[] {
  return Object.keys(obj).filter((k) => !allowed.has(k));
}

describe('F2 — counts/enums are a closed, schema-enumerated key union', () => {
  it('both maps are additionalProperties:false (the guard has teeth)', () => {
    expect(ITEM_PROPS.counts.additionalProperties).toBe(false);
    expect(ITEM_PROPS.enums.additionalProperties).toBe(false);
  });

  it('the TS key unions equal the schema property sets (single source of truth)', () => {
    expect([...SCHEMA_COUNT_KEYS].sort()).toEqual([...ARTIFACT_COUNT_KEYS].sort());
    expect([...SCHEMA_ENUM_KEYS].sort()).toEqual([...ARTIFACT_ENUM_KEYS].sort());
  });

  it('NEGATIVE — a payload with an un-enumerated nested key fails validation', () => {
    // MUTATION guard: a rogue extractor that planted a free-text-derived key
    // (`leaked_prose`) would be reported as an additional property → the schema
    // (additionalProperties:false) rejects the segment.
    expect(additionalKeys({ fixes: 2, leaked_prose: 1 }, SCHEMA_COUNT_KEYS)).toEqual([
      'leaked_prose',
    ]);
    expect(additionalKeys({ verdict: 'APPROVE', leaked: 'text' }, SCHEMA_ENUM_KEYS)).toEqual([
      'leaked',
    ]);
  });

  it('every extractor emits ONLY schema-enumerated count/enum keys (inventory parity)', () => {
    // Non-vacuous: drives every extractor over a marker-rich fixture so real keys
    // are produced, then asserts none escapes the closed union. A future extractor
    // inventing an un-enumerated channel flips this RED.
    const fixtures: Record<ArtifactEvent['artifact_type'], string> = {
      review: [
        '**Verdict**: ✅ **APPROVE** (clean)',
        '- **F1 · CRITICAL**: a. **Fix**: x. re-review',
        '- **F2 · HIGH**: b. **F3 · MED**: c. **F4 · LOW**: d.',
      ].join('\n'),
      plan: [
        '**Mode**: Full',
        '**Status**: READY',
        'CS-3',
        '#### Phase 1: A',
        '| G | x | PASS | | FAIL | | N/A |',
        '⚠️ GAP: g',
        '### Workshop Opportunities: WS-1, WS-2',
      ].join('\n'),
      workshop: [
        '**Target Proof Level**: Contract Ready',
        '**Current Proof Level**: Directional',
        '## S',
        '| Selected |',
        '**OPEN** **RESOLVED**',
      ].join('\n'),
      dossier: '## S\n| F-01 | x | src | High |',
      tasks: '| [x] | | [ ] | | [!] | | [~] |',
      'execution-log': '## E\nDeviation Deferred',
      backpressure: '**Certainty**: Full\nEXISTS BUILDABLE ABSENT',
      validation: '**Verdict**: ✅ VALIDATED\n| CRITICAL | | HIGH | | MEDIUM |',
      'ship-report': '**PR**: pull/40 · **State**: open\nall green (5/5)',
      'flight-plan': JSON.stringify({
        nodes: [
          { type: 'phase', status: 'done' },
          { type: 'workshop', status: 'skipped' },
          { type: 'chore', status: 'known', comments: ['c'] },
        ],
        events: [1],
      }),
      retro: [
        '  - id: DL-001',
        '    kind: difficulty',
        '    disposition: fixed-now',
        '  - id: WIN-001',
        '    kind: win',
        '    disposition: declined',
      ].join('\n'),
    };
    for (const ex of ARTIFACT_EXTRACTORS) {
      const { counts, enums } = ex.extract(fixtures[ex.type]);
      expect(
        additionalKeys(counts, SCHEMA_COUNT_KEYS),
        `${ex.type} emitted an un-enumerated COUNT key`,
      ).toEqual([]);
      expect(
        additionalKeys(enums, SCHEMA_ENUM_KEYS),
        `${ex.type} emitted an un-enumerated ENUM key`,
      ).toEqual([]);
      // guard-of-the-guard: the fixture is marker-rich (non-vacuous coverage).
      expect(Object.keys(counts).length).toBeGreaterThan(0);
    }
  });

  it('every emitted enum VALUE is within its schema vocabulary (or `other`)', () => {
    const enumFixtures = [
      '**Verdict**: FIX_REQUIRED\n**Mode**: Simple\n**Status**: DRAFT',
      '**Target Proof Level**: Exploratory\n**Certainty**: None\n**State**: merged',
      '**Verdict**: ✅ VALIDATED WITH FIXES', // multi-word validation verdict
      '**Verdict**: TOTALLY_MADE_UP', // → other
    ];
    for (const ex of ARTIFACT_EXTRACTORS) {
      for (const content of enumFixtures) {
        const { enums } = ex.extract(content);
        for (const [key, value] of Object.entries(enums)) {
          const vocab = ITEM_PROPS.enums.properties[key]?.enum ?? [];
          expect(vocab, `enum key ${key} is not schema-declared`).toContain(value);
        }
      }
    }
  });
});

describe('retro extractor (plan 056 T004) — observation/disposition/kind counts', () => {
  // A realistic drained retro record: 4 entries, mixed kinds + dispositions,
  // including a `declined` and a `deferred` (the AC-04 headline branch). The `fp`
  // fingerprints and description prose must NEVER surface in the counts.
  const RETRO_RECORD = `---
schema_version: "1.2"
retro_id: "2026-07-09T11:00:00Z-flow-pair-coder-a8f3"
agent: "flow-pair-coder"
started_at: "2026-07-09T10:00:00Z"
entries:
  - id: DL-001
    kind: difficulty
    description: "the misleading error hid the real cause"
    fp: a3f9c2d1e4b5
    disposition: fixed-now
  - id: DL-002
    kind: difficulty
    description: "second friction, deferred for later"
    fp: b1c2d3e4f5a6
    disposition: deferred
  - id: SUGG-001
    kind: improvement-suggestion
    description: "a nice-to-have we chose not to do"
    fp: c7d8e9f0a1b2
    disposition: declined
  - id: WIN-001
    kind: win
    description: "the fingerprint round-tripped first try"
    fp: d3e4f5a6b7c8
    disposition: kept
---
`;

  const ex = matchExtractor('.harness/records/retro/2026-07-09T11-00-00Z-flow-pair-coder-a8f3.md');

  it('counts observations, kinds, and dispositions summing against the record', () => {
    expect(ex?.type).toBe('retro');
    const { counts, enums } = extractArtifact(ex as ArtifactExtractor, RETRO_RECORD);
    expect(counts.observations).toBe(4);
    // kinds
    expect(counts.kind_difficulty).toBe(2);
    expect(counts.kind_improvement_suggestion).toBe(1);
    expect(counts.kind_win).toBe(1);
    // dispositions — declined + deferred present (AC-04 headline)
    expect(counts.disp_fixed_now).toBe(1);
    expect(counts.disp_deferred).toBe(1);
    expect(counts.disp_declined).toBe(1);
    expect(counts.disp_kept).toBe(1);
    // sums are internally consistent: kinds sum = dispositions sum = observations
    const kindSum = (counts.kind_difficulty ?? 0) + (counts.kind_improvement_suggestion ?? 0) + (counts.kind_win ?? 0);
    const dispSum =
      (counts.disp_fixed_now ?? 0) + (counts.disp_deferred ?? 0) + (counts.disp_declined ?? 0) + (counts.disp_kept ?? 0);
    expect(kindSum).toBe(counts.observations);
    expect(dispSum).toBe(counts.observations);
    // no free text, no fp travels
    expect(enums).toEqual({});
    const json = JSON.stringify(counts);
    expect(json).not.toContain('a3f9c2d1e4b5');
    expect(json).not.toContain('misleading');
  });

  it('a garbage retro file yields {} counts, never a throw', () => {
    const { counts } = extractArtifact(ex as ArtifactExtractor, 'not a retro at all\n');
    expect(counts).toEqual({});
  });

  it('emits a counts-only retro artifact event through the capture window', () => {
    const reader: ArtifactContentReader = {
      readText: (p) =>
        p.endsWith('flow-pair-coder-a8f3.md') ? RETRO_RECORD : null,
    };
    const events = artifactSemanticsEvents(
      reader,
      REPO,
      { written: ['.harness/records/retro/2026-07-09T11-00-00Z-flow-pair-coder-a8f3.md'] },
      '2026-07-09T11:05:00Z',
    );
    expect(events).toHaveLength(1);
    const ev = events[0] as ArtifactEvent;
    expect(ev.artifact_type).toBe('retro');
    expect(ev.counts.observations).toBe(4);
    // every emitted count key is a member of the closed vocabulary
    for (const k of Object.keys(ev.counts)) {
      expect(ARTIFACT_COUNT_KEYS).toContain(k);
    }
  });
});
