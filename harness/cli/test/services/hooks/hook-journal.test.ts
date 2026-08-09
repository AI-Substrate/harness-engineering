import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FileHookJournal, JOURNAL_KEEP } from '../../../src/services/hooks/hook-journal.js';
import {
  couldBeCommitBearing,
  parseHookPayload,
} from '../../../src/services/hooks/hook-payload.js';

const entry = (n: number) => ({
  at: `T${n}`,
  phase: 'post' as const,
  repoRoot: '/repo',
  outcome: { kind: 'silent' as const, reason: 'head-unchanged' as const },
});

describe('FileHookJournal — the only Phase-1 observable (tk-000b)', () => {
  it('appends one line per fire and reads them back oldest-first', () => {
    const fs = new FakeFs();
    const journal = new FileHookJournal(fs, '/state/fires.jsonl', '/state');
    journal.record(entry(1));
    journal.record(entry(2));

    expect(journal.read().map((e) => e.at)).toEqual(['T1', 'T2']);
  });

  it('keeps the NEWEST entries when trimming, never the oldest', () => {
    /*
    Test Doc:
    - Why: this file is written on EVERY agent tool call. Unbounded, it degrades
      quietly on a customer's machine. But a trim that kept the OLDEST would be
      worse than no trim: the journal would freeze at the first N fires and never
      show a current failure — the exact thing it exists to show.
    - Contract: after N+5 records, the last N survive.
    */
    const fs = new FakeFs();
    const journal = new FileHookJournal(fs, '/state/fires.jsonl', '/state');
    for (let i = 1; i <= JOURNAL_KEEP + 5; i += 1) journal.record(entry(i));

    const kept = journal.read();
    expect(kept).toHaveLength(JOURNAL_KEEP);
    expect(kept[0].at).toBe('T6');
    expect(kept.at(-1)?.at).toBe(`T${JOURNAL_KEEP + 5}`);
  });

  it('NEVER throws when it cannot be written — a hook must not break the agent it observes', () => {
    const fs = new FakeFs();
    fs.writeText = () => {
      throw new Error('read-only filesystem');
    };
    const journal = new FileHookJournal(fs, '/state/fires.jsonl', '/state');
    expect(() => journal.record(entry(1))).not.toThrow();
  });

  it('survives one corrupt line rather than losing the whole journal', () => {
    const fs = new FakeFs();
    fs.writeText(
      '/state/fires.jsonl',
      `${JSON.stringify(entry(1))}\nnot json\n${JSON.stringify(entry(2))}\n`,
    );
    const journal = new FileHookJournal(fs, '/state/fires.jsonl', '/state');
    expect(journal.read().map((e) => e.at)).toEqual(['T1', 'T2']);
  });

  it('reads an absent journal as empty, not as an error', () => {
    expect(new FileHookJournal(new FakeFs(), '/state/fires.jsonl', '/state').read()).toEqual([]);
  });
});

describe('parseHookPayload — the one input this runtime does not control (tk-0009)', () => {
  it('reads the MEASURED Cursor shape', () => {
    expect(
      parseHookPayload(
        JSON.stringify({
          tool_name: 'Shell',
          tool_input: { cwd: '/repo/alpha', command: 'git add -A && git commit -m "x"' },
        }),
      ),
    ).toEqual({
      repoRoot: '/repo/alpha',
      command: 'git add -A && git commit -m "x"',
      toolName: 'Shell',
    });
  });

  it('falls back to workspace_roots[0] — what the proven POC read', () => {
    expect(parseHookPayload(JSON.stringify({ workspace_roots: ['/repo/beta'] })).repoRoot).toBe(
      '/repo/beta',
    );
  });

  it.each([
    ['malformed JSON', '{ not json'],
    ['an empty string', ''],
    ['null input', null],
    ['a JSON scalar', '"a string"'],
    ['a JSON array', '[1,2,3]'],
  ])('yields an EMPTY payload for %s rather than a partial guess', (_name, raw) => {
    // A repo path inferred from a malformed document could point the state store
    // at the WRONG repository, and mis-attributing to the wrong repo is worse
    // than not firing at all.
    expect(parseHookPayload(raw)).toEqual({ repoRoot: null, command: null, toolName: null });
  });

  it('ignores blank strings rather than treating them as values', () => {
    expect(parseHookPayload(JSON.stringify({ tool_input: { cwd: '   ' } })).repoRoot).toBeNull();
  });
});

describe('couldBeCommitBearing — exit before any git work on a read-only tool (tk-0009)', () => {
  it.each(['read', 'Read', 'glob', 'grep', 'list_dir'])('skips %s', (tool) => {
    expect(couldBeCommitBearing(tool)).toBe(false);
  });

  it.each([
    'Shell',
    'bash',
    'Write',
    'edit',
    'something-new-nobody-listed',
    null,
  ])('observes %s', (tool) => {
    // A DENY list of known read-only tools, not an ALLOW list of known committers:
    // the cost of skipping a real commit is a lost note, while the cost of
    // observing a harmless tool is a few milliseconds.
    expect(couldBeCommitBearing(tool)).toBe(true);
  });
});
