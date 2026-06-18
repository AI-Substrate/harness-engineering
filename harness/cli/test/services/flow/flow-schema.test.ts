import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { ErrorCodes } from '../../../src/output/error-codes.js';
import { resolveFlowSchema, validateFlowDoc } from '../../../src/services/flow/flow-schema.js';

/**
 * T004 (schema validation) + T005 (resolution precedence) — plan 024 AC-03/10/11.
 *
 * Hand-rolled validation (no JSON-Schema validator dep — mirrors
 * `recordTypeShapeIssues`): a CLI-OWNED schema descriptor (shared-core field
 * shape + per-overlay `kind`/`statuses`/`nodeTypes`) validated by a pure
 * `validateFlowDoc(doc, resolvedSchema) → issues[]`. Two distinct overlays prove
 * the split: bundled `harness-loop` + a test fixture (`test-flow`) that declares
 * a status absent from harness-loop (`declined`) + uses the optional `authority`
 * tag — the forward-compat guard for the later adopt plan (Finding 02b).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const fixtureOverlay = readFileSync(join(HERE, 'fixtures/test-flow.schema.json'), 'utf8');
const REPO = '/repo';

/** A valid harness-loop flow doc (bundled overlay). */
function harnessLoopDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    kind: 'harness-loop',
    slug: 'demo',
    cursor: 'boot',
    created_at: '2026-06-18T00:00:00Z',
    provenance: {
      record_kind: 'flow',
      harness_version: '0.4.0',
      branch: null,
      repo: null,
      created_at: '2026-06-18T00:00:00Z',
      agent: null,
      plan_id: null,
    },
    events: [],
    nodes: [
      { id: 'boot', type: 'boot', label: 'Boot', status: 'done', next: ['bp'] },
      { id: 'bp', type: 'backpressure', label: 'Backpressure', status: 'known', next: [] },
    ],
    ...overrides,
  };
}

/** Resolve the bundled harness-loop overlay (the common case for validation tests). */
function harnessLoopSchema() {
  const res = resolveFlowSchema({ type: 'harness-loop', repoRoot: REPO }, { fs: new FakeFs() });
  if (!res.ok) throw new Error(`expected harness-loop to resolve (bundled): ${res.message}`);
  return res.schema;
}

describe('T005 — schema resolution precedence (--schema › .harness/schemas/flows › bundled › E304)', () => {
  it('resolves the bundled built-in (harness-loop) when no override exists', () => {
    const res = resolveFlowSchema({ type: 'harness-loop', repoRoot: REPO }, { fs: new FakeFs() });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.source).toBe('bundled');
      expect(res.schema.kind).toBe('harness-loop');
      // field shape comes from the shared core
      expect(res.schema.rootRequired).toContain('provenance');
      expect(res.schema.nodeRequired).toContain('status');
    }
  });

  it('resolves a repo overlay at .harness/schemas/flows/<type>.schema.json (over bundled)', () => {
    const fs = new FakeFs({
      [`${REPO}/.harness/schemas/flows/test-flow.schema.json`]: fixtureOverlay,
    });
    const res = resolveFlowSchema({ type: 'test-flow', repoRoot: REPO }, { fs });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.source).toBe('repo');
      expect(res.schema.statuses).toContain('declined');
    }
  });

  it('--schema wins over the repo overlay AND resolves ABSOLUTE OUT-OF-REPO paths (isWithin-exempt)', () => {
    const outside = '/Users/x/.claude/skills/the-flow/flight-plan.schema.json';
    const fs = new FakeFs({
      [outside]: fixtureOverlay,
      // a repo overlay also exists — --schema must still win
      [`${REPO}/.harness/schemas/flows/test-flow.schema.json`]: fixtureOverlay,
    });
    const res = resolveFlowSchema(
      { type: 'test-flow', schemaPath: outside, repoRoot: REPO },
      { fs },
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.source).toBe('flag');
  });

  it('an unresolvable type → E304 FLOW_TYPE_UNKNOWN', () => {
    const res = resolveFlowSchema(
      { type: 'nope-not-a-flow', repoRoot: REPO },
      { fs: new FakeFs() },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe(ErrorCodes.FLOW_TYPE_UNKNOWN);
  });

  it('a --schema path that does not exist → E300 FLOW_SCHEMA_INVALID (explicit override must resolve)', () => {
    const res = resolveFlowSchema(
      { type: 'test-flow', schemaPath: '/outside/missing.schema.json', repoRoot: REPO },
      { fs: new FakeFs() },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe(ErrorCodes.FLOW_SCHEMA_INVALID);
  });
});

describe('T004 — schema validation (shared-core + overlay, kind discriminator + node constraints)', () => {
  it('a well-formed harness-loop flow doc validates clean', () => {
    expect(validateFlowDoc(harnessLoopDoc(), harnessLoopSchema())).toEqual([]);
  });

  it('rejects a wrong-flow node type (oneOf node constraint)', () => {
    const doc = harnessLoopDoc({
      nodes: [{ id: 'p1', type: 'phase', label: 'Phase 1', status: 'known', next: [] }],
      cursor: 'p1',
    });
    const issues = validateFlowDoc(doc, harnessLoopSchema());
    expect(issues.join(' ')).toMatch(/phase/);
    expect(issues.length).toBeGreaterThan(0);
  });

  it('rejects a status outside the overlay-declared vocabulary (not a hard-coded enum)', () => {
    const doc = harnessLoopDoc({
      nodes: [{ id: 'boot', type: 'boot', label: 'Boot', status: 'declined', next: [] }],
    });
    // `declined` is valid in test-flow but NOT in harness-loop
    const issues = validateFlowDoc(doc, harnessLoopSchema());
    expect(issues.join(' ')).toMatch(/declined|status/);
  });

  it('accepts an overlay-declared status + populated authority (extensibility / Finding 02b)', () => {
    const fs = new FakeFs({
      [`${REPO}/.harness/schemas/flows/test-flow.schema.json`]: fixtureOverlay,
    });
    const res = resolveFlowSchema({ type: 'test-flow', repoRoot: REPO }, { fs });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const doc = harnessLoopDoc({
      kind: 'test-flow',
      cursor: 'd1',
      nodes: [
        {
          id: 'd1',
          type: 'decision',
          label: 'Pick a branch',
          status: 'declined',
          authority: 'substrate',
          next: ['a', 'b'],
        },
        { id: 'a', type: 'branch-a', label: 'A', status: 'assumed', next: [] },
        { id: 'b', type: 'branch-b', label: 'B', status: 'assumed', next: [] },
      ],
    });
    expect(validateFlowDoc(doc, res.schema)).toEqual([]);
  });

  it('the `decision` node type validates (a labelled fork with ≥2 next)', () => {
    const fs = new FakeFs({
      [`${REPO}/.harness/schemas/flows/test-flow.schema.json`]: fixtureOverlay,
    });
    const res = resolveFlowSchema({ type: 'test-flow', repoRoot: REPO }, { fs });
    if (!res.ok) throw new Error('fixture must resolve');
    expect(res.schema.nodeTypes).toContain('decision');
  });

  it('flags missing required root fields', () => {
    const doc = harnessLoopDoc();
    delete (doc as Record<string, unknown>).provenance;
    delete (doc as Record<string, unknown>).cursor;
    const issues = validateFlowDoc(doc, harnessLoopSchema());
    expect(issues.join(' ')).toMatch(/provenance/);
    expect(issues.join(' ')).toMatch(/cursor/);
  });

  it('flags a node missing required fields', () => {
    const doc = harnessLoopDoc({
      nodes: [{ id: 'boot', type: 'boot' /* no label/status/next */ }],
    });
    const issues = validateFlowDoc(doc, harnessLoopSchema());
    expect(issues.length).toBeGreaterThan(0);
  });

  it('flags a comment missing its required {at, text}', () => {
    const doc = harnessLoopDoc({
      nodes: [
        {
          id: 'boot',
          type: 'boot',
          label: 'Boot',
          status: 'done',
          next: [],
          comments: [{ text: 'no at field' }],
        },
      ],
      cursor: 'boot',
    });
    const issues = validateFlowDoc(doc, harnessLoopSchema());
    expect(issues.join(' ')).toMatch(/at/);
  });

  it('tolerates pass-through fields (agents[]/output/error) on round-trip — never rejected', () => {
    const doc = harnessLoopDoc({
      agents: [{ slug: 'code-review-companion', kind: 'companion' }],
      nodes: [
        {
          id: 'boot',
          type: 'boot',
          label: 'Boot',
          status: 'done',
          next: [],
          output: 'some/artifact.md',
          error: null,
        },
      ],
      cursor: 'boot',
    });
    expect(validateFlowDoc(doc, harnessLoopSchema())).toEqual([]);
  });
});
