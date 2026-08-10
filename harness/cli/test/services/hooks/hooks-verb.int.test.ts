import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hermeticGitEnv } from '../../support/hermetic-git.js';

/**
 * FAULT INJECTION against the REAL verb (plan 082 tk-000a, tk-000b).
 *
 * Two properties are proven here and they are deliberately different:
 *
 * 1. **Every failure path exits 0 and writes nothing the agent can see.** The hook
 *    runs inside an agent's tool loop; a non-zero exit or a stray line could abort
 *    or corrupt the agent's own turn.
 *
 * 2. **Because of (1), the exit code carries NO information** — it is 0
 *    unconditionally, including when everything failed. So no assertion here may
 *    rest on the exit code alone. Every one is paired with the JOURNAL, which is
 *    the actual observable, and `harness hooks status` cannot be used because it
 *    is a Phase 2 deliverable and Phase 2 depends on Phase 1.
 */

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'bin', 'harness.js');

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function fire(home: string, phase: 'pre' | 'post', payload: string | Buffer, cwd: string): Run {
  const result = execFileSync(
    process.execPath,
    [CLI, 'hooks', 'fire', 'cursor', '--phase', phase, '--hook-input', 'stdin'],
    {
      cwd,
      encoding: 'utf8',
      input: payload,
      env: { ...hermeticGitEnv(), HOME: home, USERPROFILE: home },
      // A non-zero exit would THROW here; catching below would hide it, so we let
      // execFileSync's own failure be the test failure.
    },
  );
  return { status: 0, stdout: result, stderr: '' };
}

function journal(home: string): Record<string, unknown>[] {
  try {
    return readFileSync(join(home, '.harness', 'hooks', 'fires.jsonl'), 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

describe('hooks fire — every failure path exits 0 and stays silent (dw-0018, dw-0019)', () => {
  it.each([
    ['a malformed payload', '{ not json at all'],
    ['an empty payload', ''],
    ['a payload naming a directory that is not a repo', '{"tool_input":{"cwd":"/nonexistent-42"}}'],
    ['a payload with no repo at all', '{"tool_name":"Shell"}'],
    ['a payload that is a JSON scalar', '"just a string"'],
  ])('survives %s with exit 0 and no agent-visible output', (_name, payload) => {
    /*
    Test Doc:
    - Why: dw-0018. These are the shapes an agent can hand us on a version bump
      nobody tested against. A crash here breaks the agent's turn.
    - Contract: exit 0, empty stdout.
    - Quality Contribution: drives the REAL verb through the REAL bin, so it also
      proves the wiring, not just the service.
    */
    const home = mkdtempSync(join(tmpdir(), 'harness-hookfault-'));
    try {
      const run = fire(home, 'post', payload, home);
      expect(run.status).toBe(0);
      expect(run.stdout).toBe('');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('survives an UNREACHABLE socket, and the journal records the failure AND its cause (dw-001a)', () => {
    /*
    Test Doc:
    - Why: dw-001a and dw-001b. This is the case that would otherwise be perfectly
      invisible: the guard decides to emit, the emit fails, and exit 0 says nothing.
    - Contract: exit 0, silent, and a journal entry naming the outcome and cause.
    - Quality Contribution: asserts on the JOURNAL FILE, never on `hooks status`
      (Phase 2) and never on the exit code (which is unconditional by design).
    */
    const home = mkdtempSync(join(tmpdir(), 'harness-hookfault-'));
    const repo = join(home, 'repo');
    try {
      execFileSync('git', ['init', '-q', '-b', 'main', repo], { env: hermeticGitEnv() });
      const git = (args: string[]): string =>
        execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: hermeticGitEnv() }).trim();
      writeFileSync(join(repo, 'a.txt'), 'a\n');
      git(['add', 'a.txt']);
      git(['commit', '-qm', 'base']);

      const payload = JSON.stringify({
        tool_name: 'Shell',
        tool_input: { cwd: repo, command: 'git add -A && git commit -m "x"' },
      });

      // PRE brackets the commit; the agent then commits; POST decides to emit and
      // finds nothing listening (the hermetic env points trace2 nowhere usable).
      expect(fire(home, 'pre', payload, repo).status).toBe(0);
      writeFileSync(join(repo, 'a.txt'), 'edited\n');
      git(['add', 'a.txt']);
      git(['commit', '-qm', 'the agent authored this']);
      const post = fire(home, 'post', payload, repo);

      expect(post.status).toBe(0);
      expect(post.stdout).toBe('');

      const entries = journal(home);
      expect(entries.length).toBeGreaterThanOrEqual(2);
      const phases = entries.map((e) => e.phase);
      expect(phases).toContain('pre');
      expect(phases).toContain('post');

      // The POST entry names WHAT happened and WHY. Asserted UNCONDITIONALLY:
      // an `if (kind === 'failed')` guard would let this test pass on a run where
      // the guard never even reached the emit, which is precisely the invisible
      // case the journal exists to expose.
      const last = entries.at(-1) as { outcome?: { kind?: string; cause?: string } };
      expect(last.outcome?.kind).toBe('failed');
      expect(last.outcome?.cause).toBe('no relayable trace2 ingress configured');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('writes its state OUTSIDE the observed repository — the hook leaves no trace in the tree', () => {
    // An agent working in a repo must never find hook bookkeeping in its own
    // `git status`. State and journal live under the user's home.
    const home = mkdtempSync(join(tmpdir(), 'harness-hookfault-'));
    const repo = join(home, 'repo');
    try {
      execFileSync('git', ['init', '-q', '-b', 'main', repo], { env: hermeticGitEnv() });
      const git = (args: string[]): string =>
        execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: hermeticGitEnv() }).trim();
      writeFileSync(join(repo, 'a.txt'), 'a\n');
      git(['add', 'a.txt']);
      git(['commit', '-qm', 'base']);

      const before = git(['status', '--porcelain']);
      fire(home, 'pre', JSON.stringify({ tool_input: { cwd: repo } }), repo);
      fire(home, 'post', JSON.stringify({ tool_input: { cwd: repo } }), repo);

      expect(git(['status', '--porcelain'])).toBe(before);
      // And the journal genuinely was written — otherwise this passes vacuously.
      expect(journal(home).length).toBeGreaterThan(0);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

/**
 * The UTF-8 BOM as BYTES — `EF BB BF`, built from the numbers, never typed as a
 * character and never routed through a text-mode instrument.
 *
 * THIS IS THE POINT OF THE WHOLE FIXTURE. The defect below cost two hours because
 * a PowerShell wrapper read stdin as TEXT, rendered these three bytes as the ASCII
 * `n++`, and that rendering was then fed to another tool as if it were the wire.
 * A refusal of a string Cursor never sends was recorded as a property of that
 * tool. Constructing the stimulus by hand is the exact error this test exists to
 * guard against, so the stimulus here is bytes and the assertion below proves it.
 */
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function repoAt(home: string): string {
  const repo = join(home, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', repo], { env: hermeticGitEnv() });
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: hermeticGitEnv() }).trim();
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  git(['add', 'a.txt']);
  git(['commit', '-qm', 'base']);
  return repo;
}

function journalText(home: string): string {
  try {
    return readFileSync(join(home, '.harness', 'hooks', 'fires.jsonl'), 'utf8');
  } catch {
    return '';
  }
}

describe('hooks fire — a payload it cannot parse is VISIBLE, not silent (plan 082 F009)', () => {
  it('the fixture is REAL BOM BYTES — EF BB BF — and not a hand-typed rendering of them', () => {
    /*
    Test Doc:
    - Why: three separate probes on this defect measured a fiction, and the worst
      of them baked a text-mode rendering of these bytes (`n++`) into a claim. A
      guard built on a hand-typed stand-in would repeat that error INSIDE the guard.
    - Contract: the stimulus fed to the verb below is exactly EF BB BF.
    - Quality Contribution: makes the instrument itself falsifiable, so a future
      edit that "tidies" the fixture into a string literal fails here first.
    */
    expect(UTF8_BOM.toString('hex')).toBe('efbbbf');
    expect(UTF8_BOM).toHaveLength(3);
  });

  it('a BOM-prefixed payload is UNDERSTOOD — the Cursor-on-Windows shape (defect a)', () => {
    /*
    Test Doc:
    - Why: Cursor on Windows prepends a UTF-8 BOM to the hook payload. JSON.parse
      rejects it, so the hook journalled NOTHING across three sessions and ~58 real
      invocations. Measured A/B on the machine: identical bytes, delta 0 with the
      BOM and delta 1 without it.
    - Contract: the same payload with a real BOM in front of it produces the same
      journal records as the clean one — repoRoot resolved, both phases present.
    - Quality Contribution: drives the REAL bin over a REAL pipe with REAL bytes,
      so it proves the wire, not a unit's idea of the wire.
    */
    const home = mkdtempSync(join(tmpdir(), 'harness-hookbom-'));
    try {
      const repo = repoAt(home);
      const body = JSON.stringify({
        tool_name: 'Shell',
        tool_input: { cwd: repo, command: 'git add -A && git commit -m "x"' },
      });
      const withBom = Buffer.concat([UTF8_BOM, Buffer.from(body, 'utf8')]);
      expect(withBom.subarray(0, 3).toString('hex')).toBe('efbbbf');

      fire(home, 'pre', withBom, repo);
      fire(home, 'post', withBom, repo);

      const entries = journal(home);
      expect(entries.map((e) => e.phase)).toEqual(['pre', 'post']);
      // Understood means the repo was RESOLVED from the BOM-prefixed document —
      // not merely that some line was written.
      expect(entries.map((e) => e.repoRoot)).toEqual([repo, repo]);
      // And the strip left a trace, so a CHANGE in what arrives is visible on the
      // first fire rather than the fiftieth. It rides an entry that already
      // existed: no extra line, no firehose.
      expect(entries.every((e) => e.strippedBom === true)).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('a GENUINELY MALFORMED payload journals `unparseable` rather than nothing (defect b)', () => {
    /*
    Test Doc:
    - Why: THE HEADLINE DEFECT. The journal exists to see through an exit-0,
      always-silent contract, and the one failure it could not record was its own:
      an unparseable payload returned before the journal was ever constructed, so
      an agent invoking the hook and an agent never invoking it produced
      byte-identical evidence. If Cursor fixed the BOM tomorrow this would still be
      here, waiting for the next malformed payload on any agent, on any platform.
    - Contract: a line naming WHAT could not be parsed and how much of it there was.
    - Quality Contribution: this is exactly the case a scan-to-first-brace fix
      would have SWALLOWED, which is why that approach was withdrawn. Asserted on
      the journal, never the exit code — the contract forbids the latter, and it is
      that forbidding which made this invisible.
    */
    const home = mkdtempSync(join(tmpdir(), 'harness-hookbom-'));
    try {
      const repo = repoAt(home);
      fire(home, 'post', '{ "tool_input": { "cwd": ', repo);

      const entries = journal(home);
      expect(entries).toHaveLength(1);
      const outcome = entries[0]?.outcome as { kind?: string; reason?: string; rawLen?: number };
      expect(outcome.kind).toBe('unparseable');
      expect(outcome.reason).toBe('payload-not-json');
      expect(outcome.rawLen).toBe('{ "tool_input": { "cwd": '.length);
      expect(entries[0]?.repoRoot).toBeNull();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('records the failure WITHOUT the payload body — it carries user_email and a transcript path', () => {
    /*
    Test Doc:
    - Why: the payload is the one input this runtime does not control AND it is
      the most sensitive thing the hook ever touches. Making a failure observable
      must not turn the journal into a leak; the fix is worthless if it is the
      thing that has to be turned off.
    - Contract: the journal names the shape of the failure and none of its content.
    - Quality Contribution: a real secret-shaped string in the stimulus, asserted
      absent from the journal FILE TEXT rather than from a parsed field — a leak
      through any field, named or not, fails here.
    */
    const home = mkdtempSync(join(tmpdir(), 'harness-hookbom-'));
    try {
      const repo = repoAt(home);
      const secret = 'someone@example.com';
      const transcript = '/Users/someone/.cursor/transcripts/abc123.jsonl';
      fire(home, 'post', `{ "user_email": "${secret}", "transcript_path": "${transcript}"`, repo);

      const text = journalText(home);
      expect(text).toContain('unparseable');
      expect(text).not.toContain(secret);
      expect(text).not.toContain(transcript);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('cannot split a journal line — a payload newline is escaped or hexed, never raw (dw-newline)', () => {
    /*
    Test Doc:
    - Why: `fires.jsonl` is LINE-ORIENTED and an agent's `tool_use_id` can contain
      a LITERAL NEWLINE (observed on Windows). One split line would corrupt every
      consumer of the file, including `hooks status` — a fix for blindness that
      blinds the reader instead.
    - Contract: one fire, one line, and a `headHex` that is hex by construction.
    - Quality Contribution: safe TWICE OVER and this proves both — the body is
      never journalled, and `JSON.stringify` escapes a newline inside any string it
      does write. Asserted on the FILE TEXT, so either protection failing fails here.
    */
    const home = mkdtempSync(join(tmpdir(), 'harness-hookbom-'));
    try {
      const repo = repoAt(home);
      fire(home, 'post', '{"tool_use_id":"abc\ndef", "tool_input": {', repo);

      const lines = journalText(home)
        .split('\n')
        .filter((l) => l.trim().length > 0);
      expect(lines).toHaveLength(1);
      const outcome = (JSON.parse(lines[0] as string) as { outcome: { headHex: string } }).outcome;
      // Hex and spaces only. A raw byte cannot travel through this field at all.
      expect(outcome.headHex).toMatch(/^[0-9a-f]{2}( [0-9a-f]{2})*$/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it.each([
    ['UTF-16LE, the PowerShell 5.1 default when it redirects or pipes', 'utf16le', 'ff fe'],
    ['UTF-16BE', 'utf16be', 'fe ff'],
  ])('an encoding we do NOT decode (%s) still NAMES ITSELF in the record', (_n, enc, mark) => {
    /*
    Test Doc:
    - Why: git-ai's decoder handles UTF-16LE/BE by BOM and BOM-less UTF-16 by a
      NUL-position heuristic — nobody writes an endianness heuristic speculatively,
      so someone was handed BOM-less UTF-16 once. Windows PowerShell 5.1 defaults
      to UTF-16LE when redirecting or piping, so the case is plausible HERE.
    - Contract: we deliberately do NOT decode it — nothing measured sends it to us
      and an unmeasured decode path is the same guessing this parser refuses. What
      we guarantee instead is that the failure DESCRIBES ITSELF: `headHex` opens
      with the encoding mark, diagnosable from the record alone.
    - Quality Contribution: this is the test that would have to be deleted to make
      the record lossy again. It failed before `readStdin` stopped decoding to
      UTF-8: every unknown encoding collapsed to `ef bf bd`, the replacement
      character, which names nothing.
    */
    const home = mkdtempSync(join(tmpdir(), 'harness-hookbom-'));
    try {
      const repo = repoAt(home);
      const body = Buffer.from('{"tool_input":{"cwd":"/r"}}', 'utf16le');
      if (enc === 'utf16be') body.swap16();
      const bom = mark === 'ff fe' ? Buffer.from([0xff, 0xfe]) : Buffer.from([0xfe, 0xff]);
      fire(home, 'post', Buffer.concat([bom, body]), repo);

      const entries = journal(home);
      expect(entries).toHaveLength(1);
      const outcome = entries[0]?.outcome as { kind?: string; headHex?: string };
      expect(outcome.kind).toBe('unparseable');
      // The WIRE bytes. A headHex computed after a UTF-8 decode reads
      // `ef bf bd ef bf bd` here — the replacement character, identical for every
      // encoding we cannot read, and therefore useless for telling them apart.
      expect(outcome.headHex?.startsWith(mark)).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('does NOT journal a fire that simply had no stdin — the guard must not become a firehose', () => {
    /*
    Test Doc:
    - Why: the hook fires on EVERY tool call (~38 across a 19-tool-call run) and
      Node starts slowly. A journal line per skipped read would trade a blind
      journal for an unusable one, which is the same loss by a different route.
    - Contract: an absent or blank payload is not a parse failure and writes nothing.
    - Quality Contribution: pins the BOUND on the new write, so the fix cannot grow
      into the failure mode its own brief warns about.
    */
    const home = mkdtempSync(join(tmpdir(), 'harness-hookbom-'));
    try {
      const repo = repoAt(home);
      fire(home, 'post', '', repo);
      fire(home, 'post', '   \n', repo);
      expect(journal(home)).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
