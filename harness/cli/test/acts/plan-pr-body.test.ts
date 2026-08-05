import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { headBlobBase } from '../../src/acts/plan/index.js';
import type { VerbActDeps } from '../../src/acts/verb.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../src/adapters/env/fake-env.js';
import { FakeExec } from '../../src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../src/adapters/git/fake-git.js';
import type { GitPort } from '../../src/adapters/git/git-port.js';
import { FakeProcess } from '../../src/adapters/process/fake-process.js';
import { buildProgram } from '../../src/app.js';
import type { CliIo } from '../../src/output/output-port.js';
import { createSyntheticPlan, type SyntheticCorpus } from '../support/dd-corpus.js';
import { runCli } from '../support/run-cli.js';

const testDeps = (): VerbActDeps => ({
  exec: new FakeExec(),
  fs: new FakeFs(),
  env: new FakeEnv({}, '/home/u'),
  git: new FakeGit({ isRepo: true, branch: 'main' }),
  clock: new FakeClock('2026-08-04T00:00:00.000Z'),
  proc: new FakeProcess({}, '/repo'),
});

/**
 * `harness plan pr-body` — the corpus renders its own proof (tk-7151, ac-7112).
 *
 * The pull request is where a human first decides whether to believe an
 * autonomous journey. These controls hold the two properties that decision rests
 * on: the table is DERIVED from the same index the validator reads, and an
 * unclosed corpus REFUSES rather than rendering a partial one. A table that
 * silently omitted the criteria that were not met would make an approval mean
 * less than the approver thought it did — so the refusal is the headline control,
 * not the happy path.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const EXEMPLAR = 'docs/how/dd/exemplar/plan.dd.json';

interface PrBodyData {
  markdown: string;
  count: number;
  criteria: Array<{
    id: string;
    state: string | null;
    proven_by: Array<{ label: string; href: string | null }>;
    pressure: Array<{ label: string; href: string | null }>;
    satisfied_by: Array<{ label: string; href: string | null }>;
  }>;
}

let previousCwd = '';
let temp = '';
let corpus: SyntheticCorpus | undefined;

const enter = (dir: string): void => {
  previousCwd = process.cwd();
  process.chdir(dir);
};

afterEach(() => {
  if (previousCwd.length > 0) process.chdir(previousCwd);
  previousCwd = '';
  if (temp.length > 0) rmSync(temp, { recursive: true, force: true });
  temp = '';
  corpus?.cleanup();
  corpus = undefined;
});

/** A throwaway copy of the shipped exemplar, so a control may edit it. */
const copyExemplar = (): string => {
  temp = mkdtempSync(join(tmpdir(), 'pr-body-exemplar-'));
  cpSync(join(REPO_ROOT, '.dd'), join(temp, '.dd'), { recursive: true });
  cpSync(join(REPO_ROOT, 'docs/how/dd/exemplar'), join(temp, 'docs/how/dd/exemplar'), {
    recursive: true,
  });
  return temp;
};

const closeEveryCriterion = (root: string): void => {
  const path = join(root, EXEMPLAR);
  const doc = JSON.parse(readFileSync(path, 'utf8')) as {
    sections: Array<{ name: string; value: unknown }>;
  };
  for (const section of doc.sections) {
    if (section.name !== 'acceptance_criteria') continue;
    for (const row of section.value as Array<Record<string, unknown>>) row.state = 'checked';
  }
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
};

const data = (result: Awaited<ReturnType<typeof runCli>>): PrBodyData =>
  result.envelope?.data as unknown as PrBodyData;

describe('harness plan pr-body — the corpus renders its own proof', () => {
  // helpers hoisted to module scope — a second describe needs them too.

  // -- dw-0002: the refusal ------------------------------------------------

  it('REFUSES an unclosed corpus, naming the criteria that are still open', async () => {
    // The SHIPPED exemplar is the planted-bad fixture: ac-0901 is deliberately
    // unchecked, and teaching material that quietly rendered as a proof would be
    // the defect this control exists for.
    enter(REPO_ROOT);
    const result = await runCli(['plan', 'pr-body', EXEMPLAR]);

    expect(result.code).not.toBe(0);
    expect(result.envelope?.error?.code).toBe('E457');
    expect(result.envelope?.error?.message).toContain('still open');
    expect(result.envelope?.error?.message).toContain('ac-0901');
    const details = result.envelope?.error?.details as { open: string[]; reason: string };
    expect(details.reason).toBe('unclosed');
    expect(details.open).toEqual(['docs/how/dd/exemplar/plan.dd.json#acceptance_criteria/ac-0901']);
    // Nothing renderable escaped alongside the refusal.
    expect(JSON.stringify(result.envelope)).not.toContain('| Criterion |');
  });

  it('REFUSES a corpus that declares no criteria at all — an empty proof is a claim', async () => {
    corpus = createSyntheticPlan({ acceptance: [], phases: [] });
    enter(corpus.root);

    const result = await runCli(['plan', 'pr-body', corpus.planRelative]);

    expect(result.code).not.toBe(0);
    expect(result.envelope?.error?.code).toBe('E457');
    expect((result.envelope?.error?.details as { reason: string }).reason).toBe('no-criteria');
  });

  // -- dw-0001: the golden -------------------------------------------------

  it('renders the golden table from the exemplar corpus once it is closed', async () => {
    const root = copyExemplar();
    closeEveryCriterion(root);
    enter(root);

    const result = await runCli(['plan', 'pr-body', EXEMPLAR]);

    expect(result.code).toBe(0);
    expect(data(result).markdown).toBe(
      [
        '## Acceptance criteria',
        '',
        "All 4 criteria are closed in the plan's own documents. Each row links to",
        'the evidence it rests on, so a claim can be checked rather than taken on trust.',
        '',
        '| Criterion | Claim | Proven by | Instrument | Accounted for by |',
        '| --- | --- | --- | --- | --- |',
        '| ✅ `ac-0201` · checked | A schema named `builder/plan` resolves doc-folder -&gt; &lt;gitroot&gt;/.dd -&gt; .harness/.dd -&gt; ~/.dd with deep scan, and every shadowed duplicate is reported with its path. | [lg-0201](docs/how/dd/exemplar/execution-log.dd.md#entries) | [bp-0201](docs/how/dd/exemplar/backpressure.dd.md#rows) | [tk-0201](docs/how/dd/exemplar/tasks/phase-2/tasks.dd.md#tasks), [tk-0202](docs/how/dd/exemplar/tasks/phase-2/tasks.dd.md#tasks), [tk-0203](docs/how/dd/exemplar/tasks/phase-2/tasks.dd.md#tasks), [tk-0204](docs/how/dd/exemplar/tasks/phase-2/tasks.dd.md#tasks), [tk-0205](docs/how/dd/exemplar/tasks/phase-2/tasks.dd.md#tasks), [tk-0206](docs/how/dd/exemplar/tasks/phase-2/tasks.dd.md#tasks), [tk-0208](docs/how/dd/exemplar/tasks/phase-2/tasks.dd.md#tasks) |',
        '| ✅ `ac-0801` · checked | `dd docs list` enumerates the baked docs with descriptions and `dd docs get how-to-add-a-schema` returns the worked schema+adapter guide, with a drift gate that fails when the committed module stops matching its sources. | [lg-0801](docs/how/dd/exemplar/execution-log.dd.md#entries) | [bp-0801](docs/how/dd/exemplar/backpressure.dd.md#rows) | [tk-0207](docs/how/dd/exemplar/tasks/phase-2/tasks.dd.md#tasks) |',
        '| ✅ `ac-0901` · checked | A real plan authored as plan.dd.json — with per-task `done_when` assertion lists and AC rows carrying `pressure`/`proven_by` — validates, renders, and is queryable with stock jq. | [lg-0901](docs/how/dd/exemplar/execution-log.dd.md#entries) | [bp-0901](docs/how/dd/exemplar/backpressure.dd.md#rows) | — |',
        '| ✅ `ac-1201` · checked | dep-cruiser rules and an architecture test prove services/dd/core/** imports no output/, no acts, and no node-* adapters. | [lg-1201](docs/how/dd/exemplar/execution-log.dd.md#entries) | [bp-1201](docs/how/dd/exemplar/backpressure.dd.md#rows) | [tk-0209](docs/how/dd/exemplar/tasks/phase-2/tasks.dd.md#tasks) |',
        '',
      ].join('\n'),
    );
    expect(data(result).count).toBe(4);
  });

  it('resolves the INCOMING satisfies — which tasks accounted for each criterion', async () => {
    corpus = createSyntheticPlan({
      acceptance: [
        { id: 'ac-0001', claim: 'the thing works', state: 'checked' },
        { id: 'ac-0002', claim: 'nobody claimed this one', state: 'checked' },
      ],
      phases: [
        {
          id: 'ph-0001',
          title: 'build it',
          state: 'checked',
          tasks: [
            { id: 'tk-0001', title: 'first half', state: 'checked', satisfies: ['ac-0001'] },
            { id: 'tk-0002', title: 'second half', state: 'checked', satisfies: ['ac-0001'] },
          ],
        },
      ],
    });
    enter(corpus.root);

    const result = await runCli(['plan', 'pr-body', corpus.planRelative]);

    expect(result.code).toBe(0);
    const rows = data(result).criteria;
    expect(rows.map((row) => row.id)).toEqual(['ac-0001', 'ac-0002']);
    expect(rows[0]?.satisfied_by.map((reference) => reference.label)).toEqual([
      'tk-0001',
      'tk-0002',
    ]);
    // The honest empty: a criterion nothing claims renders a dash, not a guess.
    expect(rows[1]?.satisfied_by).toEqual([]);
    expect(data(result).markdown).toContain('| — |');
  });

  it('pins every reference at a head sha when --link-base is given', async () => {
    const root = copyExemplar();
    closeEveryCriterion(root);
    enter(root);

    const result = await runCli([
      'plan',
      'pr-body',
      EXEMPLAR,
      '--link-base',
      'https://github.com/o/r/blob/abc123/',
      '--heading',
      'Proof',
    ]);

    expect(result.code).toBe(0);
    expect(data(result).markdown).toContain('## Proof');
    expect(data(result).markdown).toContain(
      '[bp-0201](https://github.com/o/r/blob/abc123/docs/how/dd/exemplar/backpressure.dd.md#rows)',
    );
    // A trailing slash on the base must not double up — the link has to survive
    // being pasted into a PR body, where a 404 discredits the whole surface.
    expect(data(result).markdown).not.toContain('abc123//');
  });

  it('escapes document-supplied text — a claim can never break the table or inject HTML', async () => {
    corpus = createSyntheticPlan({
      acceptance: [
        {
          id: 'ac-0001',
          claim: 'a | pipe and <script>alert(1)</script> in the claim',
          state: 'checked',
        },
      ],
      phases: [],
    });
    enter(corpus.root);

    const result = await runCli(['plan', 'pr-body', corpus.planRelative]);

    expect(result.code).toBe(0);
    expect(data(result).markdown).toContain('a \\| pipe');
    expect(data(result).markdown).toContain('&lt;script&gt;');
    expect(data(result).markdown).not.toContain('<script>');
  });

  it('prints its own surface in --help — the flags a caller needs are discoverable', () => {
    // The REAL help text commander would print, taken from the built program
    // rather than grepped out of the source: a `--link-base` a caller cannot
    // discover is a link base nobody pins, and unpinned links rot the day the
    // branch moves. (`--help` itself exits through commander, so the text is read
    // off the command instead of driven through the CLI.)
    const io: CliIo = { mode: 'json', writers: { out: () => {}, err: () => {} } };
    const program = buildProgram('0.0.0', io, testDeps(), { verbs: [], records: [] });
    const plan = program.commands.find((command) => command.name() === 'plan');
    const prBody = plan?.commands.find((command) => command.name() === 'pr-body');

    const help = prBody?.helpInformation() ?? '';
    expect(help).toContain('--link-base <url>');
    expect(help).toContain('head sha');
    expect(help).toContain('--heading <text>');
    expect(help).toContain('--depth <n>');
  });
});

/**
 * tk-7152 / dw-0003 — the ship stage's half: read from the ARCHIVE path, and pin
 * every link at the head sha.
 *
 * `headBlobBase` is unit-driven over a fake GitPort rather than a real remote,
 * because what needs proving is the DECISION — which remote shapes produce a URL
 * and which produce a refusal. A refusal here is the whole point: the plan's risk
 * register names broken PR links as the thing that would discredit this surface
 * on day one, so an unrecognised remote must never become a plausible guess.
 */
describe('dw-0003 — links pinned at the head sha, derived and not assembled', () => {
  const gitWith = (remote: string | null, commit: string | null): GitPort =>
    ({
      isRepo: () => true,
      currentBranch: () => 'main',
      currentCommit: () => commit,
      remoteUrl: () => remote,
      knownWorktreeRoots: () => ({ status: 'ok', roots: [] }),
    }) as unknown as GitPort;

  const SHA = 'a'.repeat(40);

  it('builds the same blob base from an https remote and an scp-style ssh remote', () => {
    const https = headBlobBase(
      gitWith('https://github.com/AI-Substrate/harness-engineering.git', SHA),
    );
    const ssh = headBlobBase(gitWith('git@github.com:AI-Substrate/harness-engineering.git', SHA));

    expect(https).toEqual({
      ok: true,
      sha: SHA,
      base: `https://github.com/AI-Substrate/harness-engineering/blob/${SHA}/`,
    });
    // Two ways of naming ONE repository must not produce two different link bases.
    expect(ssh).toEqual(https);
  });

  it('pins a SHA, never a branch — a branch link silently changes what it shows', () => {
    const pinned = headBlobBase(gitWith('https://github.com/o/r.git', SHA));
    expect(pinned.ok && pinned.base).toContain(`/blob/${SHA}/`);
    expect(pinned.ok && pinned.base).not.toContain('/blob/main/');
  });

  it('REFUSES rather than guessing when there is no remote, no commit, or an odd URL', () => {
    for (const [remote, commit, needle] of [
      [null, SHA, 'no `origin` remote'],
      ['https://github.com/o/r.git', null, 'does not resolve to a commit'],
      ['/some/local/path.git', SHA, 'not a shape blob links can be built from'],
    ] as const) {
      const pinned = headBlobBase(gitWith(remote, commit));
      expect(pinned.ok).toBe(false);
      expect(pinned.ok === false && pinned.reason).toContain(needle);
      // Every refusal offers the manual way out rather than dead-ending.
      expect(pinned.ok === false && pinned.hint).toContain('--link-base');
    }
  });

  it('refuses --pin-head together with --link-base — which one wins should not be luck', async () => {
    const root = copyExemplar();
    closeEveryCriterion(root);
    enter(root);

    const result = await runCli([
      'plan',
      'pr-body',
      EXEMPLAR,
      '--pin-head',
      '--link-base',
      'https://example.invalid/',
    ]);

    expect(result.code).not.toBe(0);
    expect(result.envelope?.error?.code).toBe('E108');
  });

  it('renders from the ARCHIVE path — the corpus ship reads has already moved', async () => {
    const root = copyExemplar();
    closeEveryCriterion(root);
    // The #90 read-from-archive rule: post-flight archives BEFORE ship runs, so
    // the path ship resolves is under docs/plans/archive/. A renderer that only
    // worked at the authoring path would fail exactly when it is needed.
    mkdirSync(join(root, 'docs/plans/archive'), { recursive: true });
    cpSync(join(root, 'docs/how/dd/exemplar'), join(root, 'docs/plans/archive/099-exemplar'), {
      recursive: true,
    });
    enter(root);

    const result = await runCli([
      'plan',
      'pr-body',
      'docs/plans/archive/099-exemplar/plan.dd.json',
    ]);

    expect(result.code).toBe(0);
    expect(data(result).count).toBe(4);
    expect(data(result).markdown).toContain(
      '(docs/plans/archive/099-exemplar/backpressure.dd.md#rows)',
    );
  });
});
