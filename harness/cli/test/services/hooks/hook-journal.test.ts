import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import {
  FileHookJournal,
  JOURNAL_KEEP,
  JOURNAL_ROTATE_AT,
  ROTATE_CLAIM_STALE_MS,
} from '../../../src/services/hooks/hook-journal.js';
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

  it('keeps the NEWEST entries when READING, never the oldest', () => {
    /*
    Test Doc:
    - Why: this file is written on EVERY agent tool call. Unbounded, it degrades
      quietly on a customer's machine. But a bound that kept the OLDEST would be
      worse than no bound: the journal would freeze at the first N fires and never
      show a current failure — the exact thing it exists to show.
    - Contract: after N+5 records, read() returns the last N.
    - NOTE (tk-0011): the bound moved from record() to read(). It used to be a trim
      inside record(), and that trim was the whole-file REWRITE that made concurrent
      hook processes lose each other's records.
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
    /*
    Test Doc:
    - Why: a journal that cannot be written must not become an agent-visible
      failure. The fire it describes has already happened either way.
    - CAUTION: this stubs the method record() ACTUALLY CALLS. It used to stub
      writeText, and after tk-0011 moved record() onto appendText that stub would
      have made this row pass while injecting no fault at all — a test whose own
      premise was absent, which is the defect this plan has now hit five times.
    */
    const fs = new FakeFs();
    fs.appendText = () => {
      throw new Error('read-only filesystem');
    };
    const journal = new FileHookJournal(fs, '/state/fires.jsonl', '/state');
    expect(() => journal.record(entry(1))).not.toThrow();
  });

  it('APPENDS and never rewrites the file during a fire (dw-003d)', () => {
    /*
    Test Doc:
    - Why: the interprocess loss came from record() reading the file and writing
      the whole thing back. The out-of-process fixture (journal-race.int.test.ts)
      proves the SYMPTOM is gone; this proves the CAUSE is gone, which is what
      stops it being reintroduced by someone who only reruns the unit tests.
    - Contract: record() appends, and issues no whole-file write.
    - Quality Contribution: asserts a mechanism, not an outcome — the outcome
      assertion cannot tell a fixed rewrite from a lucky one.
    */
    const fs = new FakeFs();
    const journal = new FileHookJournal(fs, '/state/fires.jsonl', '/state');
    journal.record(entry(1));
    journal.record(entry(2));

    expect(fs.appends).toEqual(['/state/fires.jsonl', '/state/fires.jsonl']);
    expect(fs.writes).toEqual([]);
  });

  it('a DOUBLED rotation does not destroy the rotated generation (CONFIRMED race)', () => {
    /*
    Test Doc:
    - Why: compact() is called by READERS, and two concurrent `harness hooks status`
      invocations can both pass the threshold check before either renames. MEASURED
      against the real filesystem before the fix: the second rename put a
      freshly-recreated ONE-LINE live file over the rotated generation, and a
      journal of 2001 records became 1 — read() returned a single entry.
    - Contract: the second compactor declines and the history survives.
    - CAUTION: this row exercises the OUTER check only — by the time B runs, the
      live file is already small, so B never reaches its claim. The row that proves
      the RE-CHECK is the next one, and it needs the interleaving modelled
      explicitly. Keeping both, labelled, because this one passed unchanged when
      the re-check was mutated out — it cannot see that mechanism at all.
    */
    const fs = new FakeFs();
    const a = new FileHookJournal(fs, '/state/fires.jsonl', '/state');
    const b = new FileHookJournal(fs, '/state/fires.jsonl', '/state');
    for (let i = 1; i <= JOURNAL_ROTATE_AT + 1; i += 1) a.record(entry(i));

    expect(a.compact()).toBe(true);
    // A fire recreates the live file between the two rotations — the exact window.
    a.record(entry(9001));
    expect(b.compact()).toBe(false);

    // The history survived: the newest KEEP are still readable, not a single entry.
    const kept = a.read();
    expect(kept).toHaveLength(JOURNAL_KEEP);
    expect(kept.at(-1)?.at).toBe('T9001');
  });

  it('the RE-CHECK saves it when the other rotation lands mid-window', () => {
    /*
    Test Doc:
    - Why: the dangerous interleaving is B passing its threshold check while the
      live file is still large, and A rotating before B takes its claim. B's guard
      is then STALE, and a stale guard is what destroyed 2001 records. A sequential
      test cannot reach this — B's outer check would already see the small file.
    - Contract: B declines, and the rotated generation is intact.
    - HOW THE INTERLEAVING IS MODELLED, stated plainly: A's rotation is triggered
      from inside B's `createExclusive` call, which is exactly the window between
      B's check and B's rename. This is a MODELLED ordering, not a real race — the
      real-concurrency proof for this file is journal-race.int.test.ts. It is
      modelled because the ordering is the thing under test and a real race would
      reproduce it only intermittently.
    - Quality Contribution: without it, removing the re-check leaves every other row
      green — measured, not assumed.
    */
    const fs = new FakeFs();
    const a = new FileHookJournal(fs, '/state/fires.jsonl', '/state');
    const b = new FileHookJournal(fs, '/state/fires.jsonl', '/state');
    for (let i = 1; i <= JOURNAL_ROTATE_AT + 1; i += 1) a.record(entry(i));

    const realCreateExclusive = fs.createExclusive.bind(fs);
    let interleaved = false;
    fs.createExclusive = (path: string, contents: string): boolean => {
      if (!interleaved) {
        interleaved = true;
        // A rotates and releases, all inside B's window.
        a.compact();
        a.record(entry(9001));
      }
      return realCreateExclusive(path, contents);
    };

    // B's guard was passed against the LARGE file; only the re-check can stop it.
    expect(b.compact()).toBe(false);

    const kept = a.read();
    expect(kept).toHaveLength(JOURNAL_KEEP);
    expect(kept.at(-1)?.at).toBe('T9001');
  });

  it('an ABANDONED rotation claim does not disable rotation for good', () => {
    /*
    Test Doc:
    - Why: serialising rotation with an exclusive claim introduces a new way to
      fail silently — a process killed mid-rotation leaves the claim behind, and
      rotation would then never run again. That is unbounded growth in a hidden
      directory, which is the failure this bound exists to prevent, reintroduced by
      its own fix.
    - Contract: a claim older than the stale bound is cleared and rotation proceeds.
    - Quality Contribution: proves the recovery path, not just the happy one.
    */
    const fs = new FakeFs();
    const journal = new FileHookJournal(fs, '/state/fires.jsonl', '/state');
    for (let i = 1; i <= JOURNAL_ROTATE_AT + 1; i += 1) journal.record(entry(i));

    // A claim left by a process that died. Aged past the bound.
    fs.mkdirp('/state');
    fs.writeText('/state/fires.jsonl.rotating', 'rotating');
    fs.setMtime('/state/fires.jsonl.rotating', Date.now() - (ROTATE_CLAIM_STALE_MS + 1000));

    expect(journal.compact()).toBe(true);
    expect(fs.exists('/state/fires.jsonl.1')).toBe(true);
  });

  it('a FRESH rotation claim makes a second compactor stand down', () => {
    const fs = new FakeFs();
    const journal = new FileHookJournal(fs, '/state/fires.jsonl', '/state');
    for (let i = 1; i <= JOURNAL_ROTATE_AT + 1; i += 1) journal.record(entry(i));

    fs.writeText('/state/fires.jsonl.rotating', 'rotating');
    fs.setMtime('/state/fires.jsonl.rotating', Date.now());

    expect(journal.compact()).toBe(false);
    expect(fs.exists('/state/fires.jsonl.1')).toBe(false);
  });

  it('bounds the DISK by rotating with a rename, losing no record a reader wanted (dw-003e)', () => {
    /*
    Test Doc:
    - Why: moving the bound out of record() leaves the file growing. Rotation is a
      rename — atomic, and a process holding the old descriptor keeps writing to
      the same inode, so a fire concurrent with a rotation loses nothing. A
      compaction that read and wrote a trimmed copy back would race exactly as
      record() used to, and would lose the NEWEST records.
    - Contract: below the threshold it does nothing; above it, it rotates, and the
      rotated generation is still visible to read().
    */
    const fs = new FakeFs();
    const journal = new FileHookJournal(fs, '/state/fires.jsonl', '/state');

    for (let i = 1; i <= JOURNAL_ROTATE_AT; i += 1) journal.record(entry(i));
    expect(journal.compact()).toBe(false);

    journal.record(entry(JOURNAL_ROTATE_AT + 1));
    expect(journal.compact()).toBe(true);
    expect(fs.exists('/state/fires.jsonl.1')).toBe(true);

    // The rotation is invisible to a reader: the newest KEEP still come back, and
    // they come from the rotated generation because nothing has been appended since.
    const kept = journal.read();
    expect(kept).toHaveLength(JOURNAL_KEEP);
    expect(kept.at(-1)?.at).toBe(`T${JOURNAL_ROTATE_AT + 1}`);

    // A fire after the rotation lands in the fresh file and reads back last.
    journal.record(entry(9999));
    expect(journal.read().at(-1)?.at).toBe('T9999');
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
      strippedBom: false,
      unparseable: null,
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
    const payload = parseHookPayload(raw);
    expect({
      repoRoot: payload.repoRoot,
      command: payload.command,
      toolName: payload.toolName,
    }).toEqual({ repoRoot: null, command: null, toolName: null });
  });

  it('SAYS it could not parse — the other half of do-not-guess (plan 082 F009)', () => {
    /*
    Test Doc:
    - Why: do-not-guess was implemented and say-you-could-not-parse was not, so the
      one failure the journal could not record was its own.
    - Contract: an unparseable document reports WHY and HOW MUCH, alongside the
      empty payload it already returned.
    - Quality Contribution: separates "nothing arrived" from "something arrived and
      was rubbish" — indistinguishable before this, and that was the whole defect.
    */
    expect(parseHookPayload('{ not json')).toMatchObject({
      repoRoot: null,
      unparseable: { reason: 'payload-not-json', rawLen: 10 },
    });
  });

  it.each([
    ['null input', null],
    ['an empty string', ''],
    ['whitespace only', '  \n '],
  ])('does NOT call %s a parse failure — nothing arrived, nothing broke', (_name, raw) => {
    // The hook fires on every tool call. Journalling an absent stdin would put a
    // line on the disk for invocations that are working exactly as designed.
    expect(parseHookPayload(raw).unparseable).toBeNull();
  });

  it('ignores blank strings rather than treating them as values', () => {
    expect(parseHookPayload(JSON.stringify({ tool_input: { cwd: '   ' } })).repoRoot).toBeNull();
  });
});

describe('parseHookPayload — the UTF-8 BOM Cursor prepends on Windows (plan 082 F009)', () => {
  /**
   * Decoded FROM the bytes `EF BB BF`, never typed as `\uFEFF` and never copied
   * out of a text-mode log. A PowerShell wrapper rendered these same three bytes
   * as the ASCII `n++`, and that rendering was trusted as a measurement for hours.
   */
  const BOM = Buffer.from([0xef, 0xbb, 0xbf]).toString('utf8');

  it('the fixture is the decode of REAL BOM BYTES', () => {
    expect(Buffer.from(BOM, 'utf8').toString('hex')).toBe('efbbbf');
    expect(BOM).toHaveLength(1);
  });

  it('strips ONE leading BOM and parses the document behind it', () => {
    const payload = parseHookPayload(`${BOM}${JSON.stringify({ tool_input: { cwd: '/repo/a' } })}`);
    expect(payload.repoRoot).toBe('/repo/a');
    expect(payload.strippedBom).toBe(true);
    expect(payload.unparseable).toBeNull();
  });

  it('strips a BOM and NOTHING ELSE — junk before a brace stays a parse failure', () => {
    /*
    Test Doc:
    - Why: scan-to-first-brace was the original proposal and is WITHDRAWN. It was
      designed for ASCII junk of unknown shape; against a known BOM it is both
      imprecise and actively harmful, because it silently swallows the malformed
      payloads the observability half of this fix exists to expose.
    - Contract: a precise strip, then an honest failure for anything else.
    - Quality Contribution: this test IS the withdrawal. A future scan-to-brace
      "tolerance" cannot be added without deleting it.
    */
    const payload = parseHookPayload(`n++${JSON.stringify({ tool_input: { cwd: '/repo/a' } })}`);
    expect(payload.repoRoot).toBeNull();
    expect(payload.unparseable?.reason).toBe('payload-not-json');
    expect(payload.strippedBom).toBe(false);
  });

  it('a SECOND BOM is not stripped — one BOM is a prefix, two are a malformed document', () => {
    expect(parseHookPayload(`${BOM}${BOM}{"cwd":"/repo/a"}`).unparseable?.reason).toBe(
      'payload-not-json',
    );
  });

  it('reports the head of an unparseable payload as HEX, bounded, so a NEW prefix is diagnosable', () => {
    // Bounded to a few structural bytes on purpose: the head of a JSON document
    // is punctuation and key names, and the body carries user_email and a
    // transcript path that must never reach the journal.
    const head = parseHookPayload('n++{"tool_input":{"cwd":"/repo/a"}}')?.unparseable?.headHex;
    expect(head).toBe('6e 2b 2b 7b 22 74 6f 6f');
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
