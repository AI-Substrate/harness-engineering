import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../../src/adapters/git/fake-git.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import { ErrorCodes } from '../../../src/output/error-codes.js';
import { RETRO_TEMPLATE } from '../../../src/services/record/core-types/retro.js';
import {
  type ProvenanceFields,
  spliceProvenance,
} from '../../../src/services/record/provenance.js';
import {
  createRecord,
  ensureTemp,
  type RecordDeps,
  slugify,
} from '../../../src/services/record/record-service.js';
import { buildRecordRegistry } from '../../../src/services/record/registry.js';

/*
Test Doc:
- Why: `record-service` is the pure heart of `harness record <type>` — it owns placement, the
  never-clobber collision counter, the scratch-buffer guarantee, and the honest unconfigured state.
  All side effects go through injected fakes (P2/P3), so the date + paths are deterministic.
- Contract: createRecord(opts, registry, deps) → ok outcome with a repo-relative path under
  .harness/records/<type>/<date>/<NNN>[-slug].md (per-day ordinal, never clobbers); unconfigured
  when no .harness/; E180 for unknown type; E108 for an empty slug; ensureTemp creates a gitignored
  .harness/temp/.
- Quality Contribution: pins the deterministic placement/collision/ensureTemp behaviour with fakes.
*/

const CORE = buildRecordRegistry();

/** Deps with a fixed clock (2026-06-08) and a cwd at /repo; the harness dir is pre-seeded. */
function depsAt(fs: FakeFs): RecordDeps {
  return {
    fs,
    clock: new FakeClock('2026-06-08T07:20:00.000Z'),
    proc: new FakeProcess({}, '/repo'),
    git: new FakeGit({ isRepo: true, branch: 'main' }),
    env: new FakeEnv(),
    version: '0.0.0-test',
  };
}

/**
 * A FakeFs whose `.harness/` directory already exists (so we're "configured").
 * `seedDirs` seeds `readdir` listings — needed because the per-day ordinal is
 * computed from the date dir's existing entries (FakeFs.readdir reads the dirs
 * map, separate from written files).
 */
function configuredFs(
  seedFiles: Record<string, string> = {},
  seedDirs: Record<string, string[]> = {},
): FakeFs {
  const fs = new FakeFs(seedFiles, seedDirs);
  fs.mkdirp('/repo/.harness');
  return fs;
}

describe('slugify', () => {
  it('lowercases, strips unsafe chars, and trims separators', () => {
    expect(slugify('Harness Flow Skill!')).toBe('harness-flow-skill');
    expect(slugify('  --Weird__Name??  ')).toBe('weirdname');
    expect(slugify('a/b\\c')).toBe('abc');
  });

  it('returns empty string when nothing safe remains', () => {
    expect(slugify('!!!')).toBe('');
    expect(slugify('   ')).toBe('');
  });
});

describe('createRecord — happy path', () => {
  it('writes the template to .harness/records/<type>/<date>/<NNN>-<slug>.md and returns it', () => {
    const fs = configuredFs();
    const outcome = createRecord({ type: 'retro', slug: 'my-note' }, CORE, depsAt(fs));
    expect(outcome).toMatchObject({
      ok: true,
      type: 'retro',
      path: '.harness/records/retro/2026-06-08/001-my-note.md',
      source: 'core',
    });
    expect(fs.writes).toContain('/repo/.harness/records/retro/2026-06-08/001-my-note.md');
    // The template (not an empty file) was written.
    expect(fs.readText('/repo/.harness/records/retro/2026-06-08/001-my-note.md')).toContain(
      'schema_version',
    );
  });

  it('without a slug uses an ordinal-only filename', () => {
    const fs = configuredFs();
    const outcome = createRecord({ type: 'retro' }, CORE, depsAt(fs));
    expect(outcome).toMatchObject({ ok: true, path: '.harness/records/retro/2026-06-08/001.md' });
  });
});

describe('createRecord — per-day ordinal (never clobbers)', () => {
  it('a fresh day starts at 001; the next gets 002, and a different slug shares the sequence (003)', () => {
    // Empty date dir → first record is 001.
    const first = createRecord({ type: 'retro', slug: 'x' }, CORE, depsAt(configuredFs()));
    expect(first).toMatchObject({ ok: true, path: '.harness/records/retro/2026-06-08/001-x.md' });

    // 001 present (seed the date-dir listing) → next is 002.
    const fs2 = configuredFs(
      { '/repo/.harness/records/retro/2026-06-08/001-x.md': 'existing' },
      { '/repo/.harness/records/retro/2026-06-08': ['001-x.md'] },
    );
    const second = createRecord({ type: 'retro', slug: 'x' }, CORE, depsAt(fs2));
    expect(second).toMatchObject({ ok: true, path: '.harness/records/retro/2026-06-08/002-x.md' });

    // 001-x + 002-x present → a record with a *different* slug still gets 003
    // (the ordinal is a per-day sequence, not per-slug).
    const fs3 = configuredFs(
      {
        '/repo/.harness/records/retro/2026-06-08/001-x.md': 'existing',
        '/repo/.harness/records/retro/2026-06-08/002-x.md': 'existing',
      },
      { '/repo/.harness/records/retro/2026-06-08': ['001-x.md', '002-x.md'] },
    );
    const third = createRecord({ type: 'retro', slug: 'y' }, CORE, depsAt(fs3));
    expect(third).toMatchObject({ ok: true, path: '.harness/records/retro/2026-06-08/003-y.md' });
  });
});

describe('createRecord — unconfigured / error states', () => {
  it('no .harness/ → unconfigured, writes nothing', () => {
    const fs = new FakeFs(); // .harness/ not seeded
    const outcome = createRecord({ type: 'retro' }, CORE, depsAt(fs));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.status).toBe('unconfigured');
      expect(outcome.next_action).toMatch(/\.harness/);
    }
    expect(fs.writes).toEqual([]);
  });

  it('unknown type → error E180 listing known types', () => {
    const fs = configuredFs();
    const outcome = createRecord({ type: 'nope' }, CORE, depsAt(fs));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.status).toBe('error');
      expect(outcome.code).toBe(ErrorCodes.RECORD_TYPE_UNKNOWN);
      expect(outcome.next_action).toContain('retro');
    }
    expect(fs.writes).toEqual([]);
  });

  it('an invalid type name (fails the pattern) → error E180', () => {
    const fs = configuredFs();
    const outcome = createRecord({ type: 'Retro!' }, CORE, depsAt(fs));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe(ErrorCodes.RECORD_TYPE_UNKNOWN);
    }
  });

  it('refuses (never clobbers) when the per-day ordinal space is exhausted', () => {
    // A date dir whose highest ordinal is already 999 → nextOrdinal = 1000 > MAX.
    // (nextOrdinal takes the max prefix, so one 999-entry listing is enough.)
    const fs = configuredFs(
      { '/repo/.harness/records/retro/2026-06-08/999-x.md': 'existing' },
      { '/repo/.harness/records/retro/2026-06-08': ['999-x.md'] },
    );
    const before = fs.writes.length;
    const outcome = createRecord({ type: 'retro', slug: 'x' }, CORE, depsAt(fs));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe(ErrorCodes.RECORD_WRITE_FAILED);
    }
    // Nothing was overwritten (no write into the records dir).
    expect(fs.writes.filter((p) => p.includes('/records/retro/'))).toEqual([]);
    expect(fs.writes.length).toBe(before); // not even the temp buffer (guard returns first)
  });

  it('a write/permission failure surfaces as E181 (not a generic throw)', () => {
    // A FakeFs that throws on any write — models a read-only `.harness/`.
    class ThrowingFs extends FakeFs {
      override writeText(): void {
        throw new Error('EACCES: permission denied');
      }
    }
    const fs = new ThrowingFs();
    fs.mkdirp('/repo/.harness');
    const outcome = createRecord({ type: 'retro', slug: 'x' }, CORE, depsAt(fs));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.status).toBe('error');
      expect(outcome.code).toBe(ErrorCodes.RECORD_WRITE_FAILED);
      expect(outcome.next_action).toMatch(/writable/);
    }
  });

  it('a slug that empties after slugify → error E108', () => {
    const fs = configuredFs();
    const outcome = createRecord({ type: 'retro', slug: '!!!' }, CORE, depsAt(fs));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe(ErrorCodes.INVALID_ARGS);
    }
    expect(fs.writes).toEqual([]);
  });
});

describe('ensureTemp', () => {
  it('creates .harness/temp/ and a self-gitignore on first use', () => {
    const fs = configuredFs();
    const dir = ensureTemp(depsAt(fs));
    expect(dir).toBe('/repo/.harness/temp');
    expect(fs.mkdirs).toContain('/repo/.harness/temp');
    expect(fs.writes).toContain('/repo/.harness/temp/.gitignore');
    expect(fs.readText('/repo/.harness/temp/.gitignore')).toContain('*');
  });

  it('is idempotent — does not rewrite an existing .gitignore', () => {
    const fs = configuredFs({ '/repo/.harness/temp/.gitignore': '*\n' });
    fs.mkdirp('/repo/.harness/temp');
    const before = fs.writes.length;
    ensureTemp(depsAt(fs));
    expect(fs.writes.length).toBe(before);
  });

  it('createRecord ensures the temp buffer as a side effect', () => {
    const fs = configuredFs();
    createRecord({ type: 'retro', slug: 'x' }, CORE, depsAt(fs));
    expect(fs.writes).toContain('/repo/.harness/temp/.gitignore');
  });
});

// ── T003: provenance-coverage + null-degradation (the Frozen 8-key contract) ──

/** The 8 Frozen-Contract frontmatter keys (1 template-owned + 7 spliced). */
const FROZEN_KEYS = [
  'schema_version',
  'record_kind',
  'harness_version',
  'branch',
  'repo',
  'created_at',
  'agent',
  'plan_id',
];

/** Extract the first `---`-fenced frontmatter block's inner YAML text. */
function frontmatter(content: string): string {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1] : '';
}

/** Count TOP-LEVEL occurrences of `key:` in a frontmatter block. */
function countKey(fm: string, key: string): number {
  return (fm.match(new RegExp(`^${key}:`, 'gm')) ?? []).length;
}

/** Read the written file for an ok outcome under cwd `/repo`. */
function readWritten(fs: FakeFs, outcome: ReturnType<typeof createRecord>): string {
  if (!outcome.ok) throw new Error(`expected ok, got ${JSON.stringify(outcome)}`);
  return fs.readText(`/repo/${outcome.path}`);
}

describe('createRecord — provenance stamping (Frozen 8-key contract, T003)', () => {
  /** Deps that stamp every provenance key with a concrete, distinct value. */
  const stamped = (fs: FakeFs): RecordDeps => ({
    fs,
    clock: new FakeClock('2026-06-08T07:20:00.000Z'),
    proc: new FakeProcess({}, '/repo'),
    git: new FakeGit({ isRepo: true, branch: 'feat/x', remoteUrl: 'git@github.com:acme/repo.git' }),
    env: new FakeEnv({ HARNESS_AGENT: 'github-copilot', HARNESS_PLAN_ID: '020-bypass' }),
    version: '9.9.9',
  });

  it('writes all 8 keys exactly once — even though RETRO_TEMPLATE ships its own agent/plan_id', () => {
    const fs = configuredFs();
    const fm = frontmatter(readWritten(fs, createRecord({ type: 'retro' }, CORE, stamped(fs))));
    for (const key of FROZEN_KEYS) {
      expect(countKey(fm, key), `${key} should appear exactly once`).toBe(1);
    }
    // The 7 spliced values are the stamped ones (not the template's placeholders).
    expect(fm).toContain('record_kind: "retro"');
    expect(fm).toContain('harness_version: "9.9.9"');
    expect(fm).toContain('branch: "feat/x"');
    expect(fm).toContain('repo: "git@github.com:acme/repo.git"');
    expect(fm).toContain('created_at: "2026-06-08T07:20:00.000Z"');
    expect(fm).toContain('agent: "github-copilot"');
    expect(fm).toContain('plan_id: "020-bypass"');
  });

  it('leaves schema_version template-owned (present once, value read from the template — never spliced/hardcoded)', () => {
    const fs = configuredFs();
    const fm = frontmatter(readWritten(fs, createRecord({ type: 'retro' }, CORE, stamped(fs))));
    const templateSchemaLine = RETRO_TEMPLATE.match(/^schema_version:.*$/m)?.[0];
    expect(templateSchemaLine).toBeDefined();
    expect(fm).toContain(templateSchemaLine as string); // Phase-2-proof: whatever the template declares
    expect(countKey(fm, 'schema_version')).toBe(1); // the splice never adds a second one
  });

  it('null-degrades each git/env-sourced key when unavailable; the write still succeeds', () => {
    const fs = configuredFs();
    const deps: RecordDeps = {
      fs,
      clock: new FakeClock('2026-06-08T07:20:00.000Z'),
      proc: new FakeProcess({}, '/repo'),
      git: new FakeGit({ isRepo: false }), // not a repo → null branch + null remote
      env: new FakeEnv({}), // no HARNESS_AGENT / HARNESS_PLAN_ID
      version: '9.9.9',
    };
    const outcome = createRecord({ type: 'retro' }, CORE, deps);
    expect(outcome.ok).toBe(true);
    const fm = frontmatter(readWritten(fs, outcome));
    expect(fm).toContain('branch: null');
    expect(fm).toContain('repo: null');
    expect(fm).toContain('agent: null');
    expect(fm).toContain('plan_id: null');
    // Never-null keys are still present.
    expect(fm).toContain('record_kind: "retro"');
    expect(fm).toContain('harness_version: "9.9.9"');
  });
});

describe('spliceProvenance — pure helper (idempotent, in-fence, YAML-safe)', () => {
  const fields: ProvenanceFields = {
    record_kind: 'harness-bypass',
    harness_version: '1.2.3',
    branch: 'feat/x',
    repo: 'git@github.com:acme/repo.git',
    created_at: '2026-06-08T07:20:00.000Z',
    agent: 'github-copilot',
    plan_id: '020-bypass',
  };
  const TEMPLATE = '---\nschema_version: "1.0"\nbody_key: "<fill>"\n---\n\n# Body\n';

  it('prepends the 7 keys INSIDE the first frontmatter block (right after the opening fence)', () => {
    const out = spliceProvenance(TEMPLATE, fields);
    expect(out.startsWith('---\nrecord_kind: "harness-bypass"\n')).toBe(true);
    // schema_version stays template-owned; body + closing fence are intact.
    expect(out).toContain('schema_version: "1.0"');
    expect(out).toContain('body_key: "<fill>"');
    expect(out).toContain('\n---\n\n# Body\n');
  });

  it('is idempotent — re-splicing the same fields is a no-op', () => {
    const once = spliceProvenance(TEMPLATE, fields);
    expect(spliceProvenance(once, fields)).toBe(once);
  });

  it('double-quotes string values so a slash-bearing branch round-trips; null stays bare', () => {
    const out = spliceProvenance(TEMPLATE, { ...fields, branch: 'feat/x', repo: null });
    expect(out).toContain('branch: "feat/x"');
    expect(out).toContain('repo: null');
  });
});

// ── T005: the two new core types scaffold + carry exactly the frozen body keys ──

describe('new core types — scaffold + frozen body keys (T005)', () => {
  it('harness record harness-bypass → ok/core; body carries exactly cause/attempted/command/severity', () => {
    const fs = configuredFs();
    const outcome = createRecord({ type: 'harness-bypass' }, CORE, depsAt(fs));
    expect(outcome).toMatchObject({ ok: true, type: 'harness-bypass', source: 'core' });
    const fm = frontmatter(readWritten(fs, outcome));
    for (const k of ['cause', 'attempted', 'command', 'severity']) {
      expect(countKey(fm, k), `harness-bypass should declare ${k} once`).toBe(1);
    }
    // ...and NOT the other type's body keys.
    for (const k of ['resolves', 'change_type']) expect(countKey(fm, k)).toBe(0);
    // Provenance still spliced over the new template.
    expect(countKey(fm, 'record_kind')).toBe(1);
    expect(countKey(fm, 'schema_version')).toBe(1);
    expect(fm).toContain('record_kind: "harness-bypass"');
  });

  it('harness record harness-change → ok/core; body carries exactly resolves/change_type/target', () => {
    const fs = configuredFs();
    const outcome = createRecord({ type: 'harness-change' }, CORE, depsAt(fs));
    expect(outcome).toMatchObject({ ok: true, type: 'harness-change', source: 'core' });
    const fm = frontmatter(readWritten(fs, outcome));
    for (const k of ['resolves', 'change_type', 'target']) {
      expect(countKey(fm, k), `harness-change should declare ${k} once`).toBe(1);
    }
    for (const k of ['cause', 'attempted', 'severity']) expect(countKey(fm, k)).toBe(0);
    expect(fm).toContain('record_kind: "harness-change"');
  });

  it('pins the locked enums in the type templates (cause / change_type)', () => {
    const bypass = CORE.types.find((t) => t.type === 'harness-bypass');
    const change = CORE.types.find((t) => t.type === 'harness-change');
    expect(bypass?.template).toContain(
      'missing-command|command-failed|too-slow|unclear-output|no-coverage|policy|agent-could-not',
    );
    expect(change?.template).toContain(
      'new-command|sensor|fixture|template|doc|skill-edit|routing',
    );
  });

  it('still rejects an unknown type, and is unconfigured without .harness/', () => {
    const unknown = createRecord({ type: 'no-such-type' }, CORE, depsAt(configuredFs()));
    expect(unknown.ok).toBe(false);
    const unconfigured = createRecord({ type: 'harness-bypass' }, CORE, depsAt(new FakeFs()));
    expect(unconfigured.ok).toBe(false);
    if (!unconfigured.ok) expect(unconfigured.status).toBe('unconfigured');
  });
});
