import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../../src/adapters/git/fake-git.js';
import { ErrorCodes } from '../../../src/output/error-codes.js';
import {
  createFlow,
  type FlowServiceDeps,
  isLegacyFlow,
  newFlowSchema,
  readFlowDoc,
  showFlow,
  writeFlowAtomic,
} from '../../../src/services/flow/flow-service.js';

/**
 * T007 (path containment) + T008 (E308 legacy detector) + T009 (flow-service:
 * create/new/show/list + atomic temp+rename) — plan 024 AC-01/02/07/14.
 *
 * Hexagonal: every test injects Fake ports (fs/clock/git/env); the service is
 * pure over them. Containment is enforced on WRITE paths (isWithin → E303);
 * `--schema`/`--template` are READ paths and isWithin-exempt.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const legacyFixture = readFileSync(join(HERE, 'fixtures/legacy-flow.json'), 'utf8');
const freshFixture = readFileSync(join(HERE, 'fixtures/fresh-empty-flow.json'), 'utf8');
const overlayFixture = readFileSync(join(HERE, 'fixtures/test-flow.schema.json'), 'utf8');

const REPO = '/repo';

function deps(
  files: Record<string, string> = {},
  dirs: Record<string, string[]> = {},
): {
  d: FlowServiceDeps;
  fs: FakeFs;
} {
  const fs = new FakeFs(files, dirs);
  const d: FlowServiceDeps = {
    fs,
    clock: new FakeClock('2026-06-18T03:00:00.000Z'),
    git: new FakeGit({
      isRepo: true,
      branch: '024-first-class-flow-system',
      remoteUrl: 'github.com/AI-Substrate/harness-engineering',
    }),
    env: new FakeEnv({
      HARNESS_AGENT: 'claude-opus',
      HARNESS_PLAN_ID: '024-first-class-flow-system',
    }),
  };
  return { d, fs };
}

describe('T007 — write-path containment (isWithin → E303); --schema is exempt', () => {
  it('rejects a create whose --path escapes the repo root → E303 + next_action', () => {
    const { d } = deps();
    const res = createFlow(
      {
        type: 'harness-loop',
        slug: 'demo',
        repoRoot: REPO,
        harnessVersion: '0.4.0',
        path: '/etc/evil.json',
      },
      d,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe(ErrorCodes.FLOW_PATH_ESCAPE);
      expect(res.next_action.length).toBeGreaterThan(0);
    }
  });

  it('rejects a relative ../ escape too', () => {
    const { d } = deps();
    const res = createFlow(
      {
        type: 'harness-loop',
        slug: 'demo',
        repoRoot: REPO,
        harnessVersion: '0.4.0',
        path: '/repo/../outside.json',
      },
      d,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe(ErrorCodes.FLOW_PATH_ESCAPE);
  });

  it('accepts an in-repo write redirect (--path inside the repo)', () => {
    const { d, fs } = deps();
    const res = createFlow(
      {
        type: 'harness-loop',
        slug: 'demo',
        repoRoot: REPO,
        harnessVersion: '0.4.0',
        path: '/repo/docs/plans/x/the-flow.json',
      },
      d,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.path).toBe('/repo/docs/plans/x/the-flow.json');
      expect(fs.writes.some((p) => p.endsWith('.tmp'))).toBe(true);
    }
  });

  it('accepts an OUT-OF-REPO --schema (read path is isWithin-exempt) with an in-repo write', () => {
    const outside = '/Users/x/.claude/skills/the-flow/flight-plan.schema.json';
    const { d } = deps({ [outside]: overlayFixture });
    const res = createFlow(
      {
        type: 'test-flow',
        slug: 'tf',
        repoRoot: REPO,
        harnessVersion: '0.4.0',
        schemaPath: outside,
      },
      d,
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.doc.kind).toBe('test-flow');
  });

  it('writeFlowAtomic also rejects an escaping path → E303', () => {
    const { d } = deps();
    const doc = JSON.parse(freshFixture);
    const res = writeFlowAtomic('/etc/evil.json', REPO, doc, d);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe(ErrorCodes.FLOW_PATH_ESCAPE);
  });
});

describe('T008 — E308 FLOW_LEGACY_FORMAT (positive legacy signature; never empty events[])', () => {
  it('a pre-CLI flow (no provenance block) → E308 with an honest hedging next_action', () => {
    const path = '/repo/legacy.json';
    const { d } = deps({ [path]: legacyFixture });
    const res = readFlowDoc(path, d);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe(ErrorCodes.FLOW_LEGACY_FORMAT);
      expect(res.next_action.toLowerCase()).toContain('legacy');
    }
  });

  it('a freshly-created flow (provenance present, empty events[]) does NOT trip E308', () => {
    const path = '/repo/fresh.json';
    const { d } = deps({ [path]: freshFixture });
    const res = readFlowDoc(path, d);
    expect(res.ok).toBe(true);
  });

  it('isLegacyFlow keys on absent-provenance, not on empty events[]', () => {
    expect(isLegacyFlow({ schema_version: 1, cursor: 'p1', nodes: [] })).toBe(true);
    expect(isLegacyFlow(JSON.parse(freshFixture))).toBe(false);
    // empty events[] alone (WITH provenance) is not legacy
    expect(isLegacyFlow({ provenance: {}, events: [], nodes: [], cursor: 'x' })).toBe(false);
    // a non-flow object is not "legacy" (no flow shape)
    expect(isLegacyFlow({ hello: 'world' })).toBe(false);
  });

  it('a missing flow file → E301, invalid JSON → E300', () => {
    const { d } = deps({ '/repo/bad.json': '{ not json' });
    expect((readFlowDoc('/repo/nope.json', d) as { code: string }).code).toBe(
      ErrorCodes.FLOW_NOT_FOUND,
    );
    expect((readFlowDoc('/repo/bad.json', d) as { code: string }).code).toBe(
      ErrorCodes.FLOW_SCHEMA_INVALID,
    );
  });
});

describe('T009 — create (template deep-copy + root identity + atomic temp+rename)', () => {
  it('create harness-loop deep-copies the bundled template verbatim + stamps root identity', () => {
    const { d, fs } = deps();
    const res = createFlow(
      { type: 'harness-loop', slug: 'demo', repoRoot: REPO, harnessVersion: '0.4.0' },
      d,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const doc = res.doc;
    // default path under .harness/flows/
    expect(res.path).toBe('/repo/.harness/flows/demo.json');
    // template nodes copied verbatim (the modern 7-node loop — plan 032: retro split
    // into drain + harvest, drain-gate decision added, edges preserved)
    expect(doc.nodes.map((n) => n.id)).toEqual([
      'boot',
      'backpressure',
      'observe',
      'drain-gate',
      'retro-drain',
      'retro-harvest',
      'improve',
    ]);
    expect(doc.nodes[0]?.next).toEqual(['backpressure']);
    // root identity stamped
    expect(doc.kind).toBe('harness-loop');
    expect(doc.slug).toBe('demo');
    expect(doc.nav?.now).toBe('boot'); // nav seeded from the template's initial node
    expect(doc.schema_version).toBe(1);
    // provenance = the record 7-key block; branch = created_from_branch
    expect(Object.keys(doc.provenance).sort()).toEqual(
      ['agent', 'branch', 'created_at', 'harness_version', 'plan_id', 'record_kind', 'repo'].sort(),
    );
    expect(doc.provenance.branch).toBe('024-first-class-flow-system');
    expect(doc.provenance.harness_version).toBe('0.4.0');
    expect(doc.provenance.agent).toBeNull(); // explicit-only: no --agent → null even with $HARNESS_AGENT (companion HIGH)
    // the `created` (CRT) event fired
    expect(doc.events).toHaveLength(1);
    expect(doc.events[0]?.kind).toBe('created');
    expect(doc.events[0]?.id).toBe('CRT-001');
    expect(doc.events[0]?.details).toEqual({ kind: 'harness-loop', slug: 'demo' });
    // atomic write: a .tmp was written then renamed onto the target
    expect(fs.renames).toContain(
      '/repo/.harness/flows/demo.json.tmp->/repo/.harness/flows/demo.json',
    );
  });

  it('the written file round-trips through readFlowDoc / showFlow', () => {
    const { d } = deps();
    const created = createFlow(
      { type: 'harness-loop', slug: 'rt', repoRoot: REPO, harnessVersion: '0.4.0' },
      d,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const shown = showFlow(created.path, d);
    expect(shown.ok).toBe(true);
    if (shown.ok) expect(shown.doc.slug).toBe('rt');
  });

  it('--bare creates a root-only flow (no template nodes)', () => {
    const { d } = deps();
    const res = createFlow(
      { type: 'harness-loop', slug: 'bare', repoRoot: REPO, harnessVersion: '0.4.0', bare: true },
      d,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.doc.nodes).toEqual([]);
      expect(res.doc.nav).toBeUndefined(); // bare/no-node → nav-less (graceful)
    }
  });

  it('an explicit --template that is missing/unreadable → E300', () => {
    const { d } = deps();
    const res = createFlow(
      {
        type: 'harness-loop',
        slug: 't',
        repoRoot: REPO,
        harnessVersion: '0.4.0',
        templatePath: '/repo/missing.template.json',
      },
      d,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe(ErrorCodes.FLOW_SCHEMA_INVALID);
  });

  it('an unknown flow type → E304', () => {
    const { d } = deps();
    const res = createFlow(
      { type: 'no-such-flow', slug: 'x', repoRoot: REPO, harnessVersion: '0.4.0' },
      d,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe(ErrorCodes.FLOW_TYPE_UNKNOWN);
  });
});

describe('T009 — new (scaffold a custom flow-type overlay)', () => {
  it('scaffolds .harness/schemas/flows/<type>.schema.json', () => {
    const { d, fs } = deps();
    const res = newFlowSchema({ type: 'my-flow', repoRoot: REPO }, d);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.path).toBe('/repo/.harness/schemas/flows/my-flow.schema.json');
      expect(fs.writes).toContain('/repo/.harness/schemas/flows/my-flow.schema.json');
    }
  });

  it('rejects an invalid type name → E108', () => {
    const { d } = deps();
    const res = newFlowSchema({ type: 'Bad Name', repoRoot: REPO }, d);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe(ErrorCodes.INVALID_ARGS);
  });

  it('refuses to clobber an existing schema without --force → E108', () => {
    const target = '/repo/.harness/schemas/flows/dup.schema.json';
    const { d } = deps({ [target]: '{}' });
    const res = newFlowSchema({ type: 'dup', repoRoot: REPO }, d);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe(ErrorCodes.INVALID_ARGS);
  });
});

describe('T011 — create --agent/--plan-id/--title stamp provenance + title (D-06)', () => {
  it('--agent + --plan-id stamp provenance non-null, overriding the env', () => {
    const { d } = deps(); // env has HARNESS_AGENT=claude-opus, HARNESS_PLAN_ID=024-…
    const res = createFlow(
      {
        type: 'harness-loop',
        slug: 'agented',
        repoRoot: REPO,
        harnessVersion: '0.4.0',
        agent: 'the-flow',
        planId: '026-the-flow-cursor-meta-migration',
        title: 'the-flow',
      },
      d,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.doc.provenance.agent).toBe('the-flow'); // --agent wins over env
    expect(res.doc.provenance.plan_id).toBe('026-the-flow-cursor-meta-migration');
    expect(res.doc.title).toBe('the-flow');
  });

  it('without --agent, provenance.agent is null EVEN WHEN $HARNESS_AGENT is set (explicit-only; companion HIGH)', () => {
    const { d } = deps(); // env has HARNESS_AGENT=claude-opus + HARNESS_PLAN_ID=024-…
    const res = createFlow(
      { type: 'harness-loop', slug: 'agentless', repoRoot: REPO, harnessVersion: '0.4.0' },
      d,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      // env must NOT leak into provenance — that would put the model name in the rail title
      expect(res.doc.provenance.agent).toBeNull();
      expect(res.doc.provenance.plan_id).toBeNull();
    }
  });
});

describe('T016 — version gate (unknown major → E306; runs on every load)', () => {
  /** A non-legacy flow (has provenance) but a FORWARD major version. */
  const forwardFlow = JSON.stringify({
    schema_version: 2,
    kind: 'harness-loop',
    slug: 'future',
    cursor: 'boot',
    created_at: '2026-06-18T00:00:00.000Z',
    provenance: {
      record_kind: 'flow',
      harness_version: '9.9.9',
      branch: null,
      repo: null,
      created_at: '2026-06-18T00:00:00.000Z',
      agent: null,
      plan_id: null,
    },
    events: [],
    nodes: [{ id: 'boot', type: 'boot', label: 'Boot', status: 'assumed', next: [] }],
  });

  it('readFlowDoc rejects an unknown-major flow with E306 + a `harness update` next_action', () => {
    const path = '/repo/future.json';
    const { d } = deps({ [path]: forwardFlow });
    const res = readFlowDoc(path, d);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe(ErrorCodes.FLOW_SCHEMA_VERSION);
      expect(res.next_action).toContain('harness update');
    }
  });

  it('a known-major (v1) flow loads fine', () => {
    const path = '/repo/fresh.json';
    const { d } = deps({ [path]: freshFixture });
    expect(readFlowDoc(path, d).ok).toBe(true);
  });
});
