import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import { ErrorCodes } from '../../../src/output/error-codes.js';
import {
  OBSERVATION_KINDS,
  OBSERVATION_SEVERITIES,
  parseBuffer,
  serializeEntry,
} from '../../../src/services/observe/buffer-codec.js';
import {
  captureObservation,
  clearObservations,
  listObservations,
  type ObserveDeps,
} from '../../../src/services/observe/observe-service.js';

/*
Test Doc:
- Why: `observe-service` is the pure heart of `harness observe` — CLI-owned friction capture
  into the gitignored transient buffer (.harness/temp/<bucket>/session-buffer.md). It owns the
  deterministic half the old skill made agents re-infer every session: identity resolution
  (D4), schema validation at write (D6), per-kind sequential IDs over a tolerant parse (D2/D3),
  append-only writes, and the ensureTemp gitignore guarantee at capture time (AC-5).
- Contract: captureObservation(opts, deps) → ok outcome {bucket, id, kind, path} with the entry
  appended (full system.compound block, D10); unconfigured (exit 2 at the act) for validation
  rejections + missing .harness/; E146 for an unreadable buffer. parseBuffer is tolerant of the
  old skill's hand-written template (comments included) and counts deviants as malformed.
- Quality Contribution: pins AC-1..AC-5 with fakes only (P3); encodes D2-D6 + D10 decisions.
*/

const DESC = 'a perfectly valid observation description';
const AGENT_BUFFER = '/repo/.harness/temp/agent/session-buffer.md';

const KIND_PREFIXES: Record<string, string> = {
  difficulty: 'DL',
  'magic-wand': 'MW',
  gift: 'GFT',
  insight: 'INS',
  coordination: 'COORD',
  'improvement-suggestion': 'SUGG',
  confusion: 'CONF',
};

function depsAt(fs: FakeFs, env: FakeEnv = new FakeEnv()): ObserveDeps {
  return {
    fs,
    clock: new FakeClock('2026-06-08T07:20:00.000Z'),
    proc: new FakeProcess({}, '/repo'),
    env,
  };
}

/** A FakeFs whose `.harness/` directory already exists (so we're "configured"). */
function configuredFs(
  seedFiles: Record<string, string> = {},
  seedDirs: Record<string, string[]> = {},
): FakeFs {
  const fs = new FakeFs(seedFiles, seedDirs);
  fs.mkdirp('/repo/.harness');
  return fs;
}

/** A valid hand-written legacy entry (the shape the old observe skill taught). */
function legacyEntry(id: string, kind: string): string {
  return [
    `- id: ${id}`,
    `  kind: ${kind}`,
    '  description: "a legacy hand-written entry from the old skill"',
    '  system:',
    '    compound:',
    '      status: open',
    '      source: agent-self',
    '      first_seen_at: "2026-05-18T10:15:00Z"',
    '',
  ].join('\n');
}

describe('captureObservation — happy path (AC-1, AC-3, D10)', () => {
  it('accepts all 7 schema kinds, assigning the per-kind prefix with a 001 start', () => {
    for (const [kind, prefix] of Object.entries(KIND_PREFIXES)) {
      const fs = configuredFs();
      const outcome = captureObservation({ description: DESC, kind }, depsAt(fs));
      expect(outcome).toMatchObject({
        ok: true,
        bucket: 'agent',
        id: `${prefix}-001`,
        kind,
        path: '.harness/temp/agent/session-buffer.md',
      });
      const buffer = fs.readText(AGENT_BUFFER) ?? '';
      expect(buffer).toContain(`- id: ${prefix}-001`);
      expect(buffer).toContain(`kind: ${kind}`);
    }
  });

  it('writes the full system.compound block with the ClockPort ISO timestamp (D10)', () => {
    const fs = configuredFs();
    captureObservation({ description: DESC, kind: 'difficulty' }, depsAt(fs));
    const buffer = fs.readText(AGENT_BUFFER) ?? '';
    expect(buffer).toContain('status: open');
    expect(buffer).toContain('source: agent-self');
    expect(buffer).toContain('first_seen_at: "2026-06-08T07:20:00.000Z"');
  });

  it('carries the optional fields through verbatim when provided', () => {
    const fs = configuredFs();
    captureObservation(
      {
        description: DESC,
        kind: 'difficulty',
        target: 'project-sensor',
        severity: 'degrading',
        workaround: 'read the code manually',
        suggestedEncoding: 'add a smoke command',
      },
      depsAt(fs),
    );
    const buffer = fs.readText(AGENT_BUFFER) ?? '';
    expect(buffer).toContain('target: project-sensor');
    expect(buffer).toContain('severity: degrading');
    expect(buffer).toContain('workaround: "read the code manually"');
    expect(buffer).toContain('suggested_encoding: "add a smoke command"');
  });
});

describe('captureObservation — validation at write (AC-4, D6)', () => {
  it('rejects an unknown kind with the 7 allowed values named, buffer untouched', () => {
    const fs = configuredFs();
    const outcome = captureObservation({ description: DESC, kind: 'signal-gap' }, depsAt(fs));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.status).toBe('unconfigured');
      expect(outcome.next_action).toContain('difficulty');
      expect(outcome.next_action).toContain('confusion');
    }
    expect(fs.writes).toEqual([]);
  });

  it('rejects a missing kind the same way', () => {
    const outcome = captureObservation({ description: DESC }, depsAt(configuredFs()));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.status).toBe('unconfigured');
      expect(outcome.next_action).toContain('difficulty');
    }
  });

  it('rejects an unknown severity naming the allowed values', () => {
    const fs = configuredFs();
    const outcome = captureObservation(
      { description: DESC, kind: 'difficulty', severity: 'catastrophic' },
      depsAt(fs),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.status).toBe('unconfigured');
      expect(outcome.next_action).toContain('blocking');
      expect(outcome.next_action).toContain('degrading');
      expect(outcome.next_action).toContain('annoying');
    }
    expect(fs.writes).toEqual([]);
  });

  it('rejects a 9-char description and accepts a 10-char one (JS string length, D6)', () => {
    const nine = captureObservation(
      { description: '123456789', kind: 'difficulty' },
      depsAt(configuredFs()),
    );
    expect(nine.ok).toBe(false);
    if (!nine.ok) {
      expect(nine.status).toBe('unconfigured');
      expect(nine.next_action).toMatch(/10/);
    }

    const ten = captureObservation(
      { description: '1234567890', kind: 'difficulty' },
      depsAt(configuredFs()),
    );
    expect(ten.ok).toBe(true);
  });

  it('rejects a missing description', () => {
    const outcome = captureObservation({ kind: 'difficulty' }, depsAt(configuredFs()));
    expect(outcome.ok).toBe(false);
  });
});

describe('captureObservation — identity chain (AC-2, D4)', () => {
  it('the --agent flag wins, kebab-sanitized', () => {
    const fs = configuredFs();
    const outcome = captureObservation(
      { description: DESC, kind: 'difficulty', agent: 'Claude Code' },
      depsAt(fs, new FakeEnv({ HARNESS_AGENT: 'other' })),
    );
    expect(outcome).toMatchObject({ ok: true, bucket: 'claude-code' });
    expect(fs.readText('/repo/.harness/temp/claude-code/session-buffer.md')).toContain('DL-001');
  });

  it('falls back to HARNESS_AGENT via the EnvPort when no flag', () => {
    const env = new FakeEnv({ HARNESS_AGENT: 'GitHub Copilot' });
    const outcome = captureObservation(
      { description: DESC, kind: 'difficulty' },
      depsAt(configuredFs(), env),
    );
    expect(outcome).toMatchObject({ ok: true, bucket: 'github-copilot' });
    expect(env.gets).toContain('HARNESS_AGENT');
  });

  it('defaults to the literal `agent` bucket when neither is set — capture never fails on identity', () => {
    const outcome = captureObservation(
      { description: DESC, kind: 'difficulty' },
      depsAt(configuredFs()),
    );
    expect(outcome).toMatchObject({ ok: true, bucket: 'agent' });
  });

  it('treats an empty or whitespace-only HARNESS_AGENT as unset (falls through to the default)', () => {
    const empty = captureObservation(
      { description: DESC, kind: 'difficulty' },
      depsAt(configuredFs(), new FakeEnv({ HARNESS_AGENT: '' })),
    );
    expect(empty).toMatchObject({ ok: true, bucket: 'agent' });

    const blank = captureObservation(
      { description: DESC, kind: 'difficulty' },
      depsAt(configuredFs(), new FakeEnv({ HARNESS_AGENT: '   ' })),
    );
    expect(blank).toMatchObject({ ok: true, bucket: 'agent' });
  });
});

describe('captureObservation — per-kind sequential IDs (AC-3, finding 04)', () => {
  it('two consecutive same-kind captures get consecutive IDs', () => {
    const fs = configuredFs();
    const deps = depsAt(fs);
    expect(captureObservation({ description: DESC, kind: 'difficulty' }, deps)).toMatchObject({
      id: 'DL-001',
    });
    expect(captureObservation({ description: DESC, kind: 'difficulty' }, deps)).toMatchObject({
      id: 'DL-002',
    });
  });

  it('counters are independent per kind; a first capture of a kind starts at 001 among other kinds', () => {
    const fs = configuredFs();
    const deps = depsAt(fs);
    captureObservation({ description: DESC, kind: 'magic-wand' }, deps); // MW-001
    captureObservation({ description: DESC, kind: 'difficulty' }, deps); // DL-001
    const gift = captureObservation({ description: DESC, kind: 'gift' }, deps);
    expect(gift).toMatchObject({ id: 'GFT-001' });
    const wand = captureObservation({ description: DESC, kind: 'magic-wand' }, deps);
    expect(wand).toMatchObject({ id: 'MW-002' });
  });

  it('continues the sequence over legacy hand-written entries (D3)', () => {
    const fs = configuredFs({
      [AGENT_BUFFER]: legacyEntry('DL-001', 'difficulty') + legacyEntry('DL-002', 'difficulty'),
    });
    const outcome = captureObservation({ description: DESC, kind: 'difficulty' }, depsAt(fs));
    expect(outcome).toMatchObject({ ok: true, id: 'DL-003' });
  });

  it('the ID scan skips malformed blocks — including non-numeric suffixes (AC-3)', () => {
    // A malformed block claiming DL-009 (no kind/description) must NOT advance the counter.
    const malformed = '- id: DL-009\n  note: not a valid entry at all\n';
    const fs = configuredFs({ [AGENT_BUFFER]: legacyEntry('DL-001', 'difficulty') + malformed });
    expect(captureObservation({ description: DESC, kind: 'difficulty' }, depsAt(fs))).toMatchObject(
      { id: 'DL-002' },
    );

    // A non-numeric suffix never parses as a counter value.
    const alpha = '- id: DL-ABC\n  kind: difficulty\n  description: "long enough description"\n';
    const fs2 = configuredFs({ [AGENT_BUFFER]: alpha });
    expect(
      captureObservation({ description: DESC, kind: 'difficulty' }, depsAt(fs2)),
    ).toMatchObject({ id: 'DL-001' });
  });
});

describe('captureObservation — append-only + transient guarantee (AC-3, AC-5)', () => {
  it('byte-preserves existing buffer content (append, never rewrite)', () => {
    const existing = legacyEntry('MW-001', 'magic-wand');
    const fs = configuredFs({ [AGENT_BUFFER]: existing });
    captureObservation({ description: DESC, kind: 'difficulty' }, depsAt(fs));
    const buffer = fs.readText(AGENT_BUFFER) ?? '';
    expect(buffer.startsWith(existing)).toBe(true);
    expect(buffer).toContain('- id: DL-001');
  });

  it('invokes ensureTemp on every capture — fresh repo gets the dir + nested self-gitignore', () => {
    const fs = configuredFs();
    captureObservation({ description: DESC, kind: 'difficulty' }, depsAt(fs));
    expect(fs.mkdirs).toContain('/repo/.harness/temp');
    expect(fs.mkdirs).toContain('/repo/.harness/temp/agent');
    expect(fs.writes).toContain('/repo/.harness/temp/.gitignore');
    expect(fs.readText('/repo/.harness/temp/.gitignore')).toContain('*');
  });

  it('does not rewrite an existing temp .gitignore (idempotent)', () => {
    const fs = configuredFs({ '/repo/.harness/temp/.gitignore': '*\n' });
    fs.mkdirp('/repo/.harness/temp');
    captureObservation({ description: DESC, kind: 'difficulty' }, depsAt(fs));
    expect(fs.writes.filter((p) => p.endsWith('temp/.gitignore'))).toEqual([]);
  });
});

describe('captureObservation — unconfigured / error states (AC-4, D6)', () => {
  it('no .harness/ → unconfigured naming harness setup, writes nothing', () => {
    const fs = new FakeFs(); // .harness/ not seeded
    const outcome = captureObservation({ description: DESC, kind: 'difficulty' }, depsAt(fs));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.status).toBe('unconfigured');
      expect(outcome.next_action).toMatch(/\.harness/);
    }
    expect(fs.writes).toEqual([]);
  });

  it('an existing-but-unreadable buffer → error E146, never silent data loss', () => {
    class UnreadableFs extends FakeFs {
      override readText(path: string): string | null {
        if (path.endsWith('session-buffer.md')) return null;
        return super.readText(path);
      }
    }
    const fs = new UnreadableFs({ [AGENT_BUFFER]: 'present but unreadable' });
    fs.mkdirp('/repo/.harness');
    const outcome = captureObservation({ description: DESC, kind: 'difficulty' }, depsAt(fs));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.status).toBe('error');
      expect(outcome.code).toBe(ErrorCodes.OBSERVE_BUFFER_UNREADABLE);
      expect(outcome.code).toBe('E146');
    }
    expect(fs.writes.filter((p) => p.endsWith('session-buffer.md'))).toEqual([]);
  });
});

describe('buffer-codec — the entry grammar (D2/D3)', () => {
  it('exports the 7 schema kinds with their prefixes and the 3 severities', () => {
    expect(OBSERVATION_KINDS).toEqual(KIND_PREFIXES);
    expect([...OBSERVATION_SEVERITIES]).toEqual(['blocking', 'degrading', 'annoying']);
  });

  it("parses the old skill's exact template — inline comments and all (D3)", () => {
    const oldTemplate = [
      '- id: DL-001                          # Required. <PREFIX>-<3+ digit number>. Per-buffer counter.',
      '  kind: difficulty                    # Required. Enum: difficulty | magic-wand | gift | insight | coordination | improvement-suggestion | confusion',
      '  description: "grep on src/ took 47s — should use ripgrep."   # Required. ≥10 chars.',
      '  target: tooling                     # Optional. project | tooling | plan | skill | doc | infra | minih | coordination | (custom)',
      '  severity: degrading                 # Optional. Recommended for kind=difficulty. blocking | degrading | annoying.',
      '  workaround: "Used grep -r -I to skip binaries."              # Optional. What you did to get past it.',
      '  suggested_encoding: "justfile recipe wrapping ripgrep"       # Optional. Free-text hint for eng-harness-4-retro --drain\'s encoding flow.',
      '  system:',
      '    compound:',
      '      status: open                    # Initial status.',
      '      source: agent-self              # user | agent-self',
      '      first_seen_at: "2026-05-18T10:15:00Z"',
      '',
    ].join('\n');
    const { entries, malformed } = parseBuffer(oldTemplate);
    expect(malformed).toBe(0);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'DL-001',
      kind: 'difficulty',
      description: 'grep on src/ took 47s — should use ripgrep.',
      target: 'tooling',
      severity: 'degrading',
      workaround: 'Used grep -r -I to skip binaries.',
      suggested_encoding: 'justfile recipe wrapping ripgrep',
      first_seen_at: '2026-05-18T10:15:00Z',
    });
  });

  it("parses the old skill's deeper-indented system.compound variant", () => {
    const variant = [
      '- id: SUGG-002',
      '  kind: improvement-suggestion',
      '  target: architecture-fitness',
      '  description: "Add a deterministic dependency-direction check so regressions fail before review."',
      '  suggested_encoding: "architecture check recipe"',
      '  system:',
      '    compound:',
      '       status: open',
      '       source: agent-self',
      '       first_seen_at: "2026-05-30T07:47:00Z"',
      '',
    ].join('\n');
    const { entries, malformed } = parseBuffer(variant);
    expect(malformed).toBe(0);
    expect(entries[0]).toMatchObject({
      id: 'SUGG-002',
      kind: 'improvement-suggestion',
      first_seen_at: '2026-05-30T07:47:00Z',
    });
  });

  it('counts deviant blocks as malformed without dropping the valid ones', () => {
    const mixed = `${legacyEntry('DL-001', 'difficulty')}- id: DL-XXX\n  garbage: yes\n`;
    const { entries, malformed } = parseBuffer(mixed);
    expect(entries).toHaveLength(1);
    expect(malformed).toBe(1);
  });

  it('an unknown kind in a legacy block is malformed (schema enum is fixed), not silently accepted', () => {
    const unknownKind =
      '- id: SG-001\n  kind: signal-gap\n  description: "an invented kind from before the merge"\n';
    const { entries, malformed } = parseBuffer(unknownKind);
    expect(entries).toHaveLength(0);
    expect(malformed).toBe(1);
  });

  it('parses an empty buffer to zero entries, zero malformed', () => {
    expect(parseBuffer('')).toEqual({ entries: [], malformed: 0 });
  });

  it('round-trips its own serialized form', () => {
    const block = serializeEntry({
      id: 'INS-007',
      kind: 'insight',
      description: 'serializer and parser agree on the grammar',
      target: 'tooling',
      severity: 'annoying',
      workaround: 'n/a — "quoted" text survives',
      suggested_encoding: 'none needed',
      first_seen_at: '2026-06-08T07:20:00.000Z',
    });
    const { entries, malformed } = parseBuffer(block);
    expect(malformed).toBe(0);
    expect(entries[0]).toEqual({
      id: 'INS-007',
      kind: 'insight',
      description: 'serializer and parser agree on the grammar',
      target: 'tooling',
      severity: 'annoying',
      workaround: 'n/a — "quoted" text survives',
      suggested_encoding: 'none needed',
      first_seen_at: '2026-06-08T07:20:00.000Z',
    });
  });
});

/** Two seeded buckets (one with a malformed block) + the nested .gitignore beside them. */
function sweepFs(): FakeFs {
  return configuredFs(
    {
      '/repo/.harness/temp/.gitignore': '*\n',
      [AGENT_BUFFER]: `${legacyEntry('DL-001', 'difficulty')}- id: DL-XXX\n  garbage: yes\n`,
      '/repo/.harness/temp/claude-code/session-buffer.md': legacyEntry('MW-001', 'magic-wand'),
    },
    { '/repo/.harness/temp': ['claude-code', '.gitignore', 'agent'] },
  );
}

describe('listObservations — the all-buckets sweep (AC-7, D9, D-12)', () => {
  it('sweeps every bucket by default, annotating entries and counting deviants', () => {
    const outcome = listObservations({}, depsAt(sweepFs()));
    expect(outcome).toMatchObject({
      ok: true,
      buckets_scanned: ['agent', 'claude-code'],
      malformed_skipped: 1,
    });
    if (outcome.ok) {
      expect(outcome.observations).toHaveLength(2);
      expect(outcome.observations[0]).toMatchObject({ bucket: 'agent', id: 'DL-001' });
      expect(outcome.observations[1]).toMatchObject({ bucket: 'claude-code', id: 'MW-001' });
    }
  });

  it('--agent scopes to one bucket; a nonexistent bucket is an honest empty ok', () => {
    const scoped = listObservations({ agent: 'claude-code' }, depsAt(sweepFs()));
    expect(scoped).toMatchObject({ ok: true, buckets_scanned: ['claude-code'] });
    if (scoped.ok) expect(scoped.observations.map((o) => o.id)).toEqual(['MW-001']);

    const missing = listObservations({ agent: 'nobody-here' }, depsAt(sweepFs()));
    expect(missing).toMatchObject({
      ok: true,
      observations: [],
      buckets_scanned: [],
      malformed_skipped: 0,
    });
  });

  it('nothing captured yet (no temp dir) → ok with an empty array (D6)', () => {
    const outcome = listObservations({}, depsAt(configuredFs()));
    expect(outcome).toMatchObject({ ok: true, observations: [], buckets_scanned: [] });
  });

  it('no .harness/ → unconfigured; unreadable buffer mid-sweep → E146', () => {
    const bare = listObservations({}, depsAt(new FakeFs()));
    expect(bare.ok).toBe(false);
    if (!bare.ok) expect(bare.status).toBe('unconfigured');

    class UnreadableFs extends FakeFs {
      override readText(path: string): string | null {
        if (path.endsWith('claude-code/session-buffer.md')) return null;
        return super.readText(path);
      }
    }
    const fs = new UnreadableFs(
      {
        [AGENT_BUFFER]: legacyEntry('DL-001', 'difficulty'),
        '/repo/.harness/temp/claude-code/session-buffer.md': 'present but unreadable',
      },
      { '/repo/.harness/temp': ['agent', 'claude-code'] },
    );
    fs.mkdirp('/repo/.harness');
    const outcome = listObservations({}, depsAt(fs));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe(ErrorCodes.OBSERVE_BUFFER_UNREADABLE);
  });
});

describe('clearObservations — truncate what list returns, files kept (AC-7, D6)', () => {
  it('truncates every bucket by default, counting cleared valid entries + deviants', () => {
    const fs = sweepFs();
    const outcome = clearObservations({}, depsAt(fs));
    expect(outcome).toMatchObject({
      ok: true,
      cleared: 2,
      buckets_scanned: ['agent', 'claude-code'],
      malformed_skipped: 1,
    });
    expect(fs.readText(AGENT_BUFFER)).toBe('');
    expect(fs.readText('/repo/.harness/temp/claude-code/session-buffer.md')).toBe('');
  });

  it('--agent scopes the truncation; the other bucket is untouched', () => {
    const fs = sweepFs();
    const outcome = clearObservations({ agent: 'claude-code' }, depsAt(fs));
    expect(outcome).toMatchObject({ ok: true, cleared: 1 });
    expect(fs.readText('/repo/.harness/temp/claude-code/session-buffer.md')).toBe('');
    expect(fs.readText(AGENT_BUFFER)).toContain('DL-001');
  });

  it('nothing to clear → ok with cleared: 0 (D6)', () => {
    const outcome = clearObservations({}, depsAt(configuredFs()));
    expect(outcome).toMatchObject({ ok: true, cleared: 0 });
  });

  it('an unreadable buffer fails the sweep BEFORE any truncation happens', () => {
    class UnreadableFs extends FakeFs {
      override readText(path: string): string | null {
        if (path.endsWith('claude-code/session-buffer.md')) return null;
        return super.readText(path);
      }
    }
    const fs = new UnreadableFs(
      {
        [AGENT_BUFFER]: legacyEntry('DL-001', 'difficulty'),
        '/repo/.harness/temp/claude-code/session-buffer.md': 'present but unreadable',
      },
      { '/repo/.harness/temp': ['agent', 'claude-code'] },
    );
    fs.mkdirp('/repo/.harness');
    const outcome = clearObservations({}, depsAt(fs));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe(ErrorCodes.OBSERVE_BUFFER_UNREADABLE);
    expect(fs.readText(AGENT_BUFFER)).toContain('DL-001'); // nothing truncated
  });
});
