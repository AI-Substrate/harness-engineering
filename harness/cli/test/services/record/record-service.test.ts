import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import { ErrorCodes } from '../../../src/output/error-codes.js';
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
