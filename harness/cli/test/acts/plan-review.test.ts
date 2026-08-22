import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hasBinary, missingBinaryReason } from '../support/external-binary.js';
import { runDd } from '../support/run-cli.js';

/**
 * tk-7172 / dw-000d, ac-7121 — a review round is a document.
 *
 * Review history normally lives in prose: a verdict written into a chat window,
 * gone the moment it scrolls. That loses the one thing worth keeping. "Which
 * findings were refuted, and on what grounds" is a question you want to ask
 * ACROSS rounds and ACROSS models — to stop the same finding being re-opened on
 * reasoning that was already answered, and to see which reviewers find things
 * that turn out to be real. Prose cannot answer it; rows can.
 *
 * The Dim-0 rows matter most. A reviewer who mutates a control on purpose and
 * records what happened is producing evidence about the TEST SUITE, and a
 * `pressure` link to the fixture that fired turns "the tests would have caught
 * it" from a claim into a citation.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const REVIEW = 'docs/how/dd/exemplar/review/round-1.dd.json';

interface ReviewDoc {
  sections: Array<{ name: string; value: unknown }>;
}

const doc = (): ReviewDoc => JSON.parse(readFileSync(`${REPO_ROOT}${REVIEW}`, 'utf8')) as ReviewDoc;

const section = <T>(name: string): T[] =>
  (doc().sections.find((entry) => entry.name === name)?.value ?? []) as T[];

interface Finding {
  id: string;
  kind: string;
  severity: string;
  finding: string;
  address?: string;
  pressure?: string;
}
interface Verdict {
  id: string;
  finding: string;
  resolution: string;
  rationale?: string;
}

describe('dw-000d — the review corpus validates and renders like any other document', () => {
  let previousCwd = '';
  beforeEach(() => {
    previousCwd = process.cwd();
    process.chdir(REPO_ROOT);
  });
  afterEach(() => {
    if (previousCwd.length > 0) process.chdir(previousCwd);
    previousCwd = '';
  });

  it('validates against builder/review', async () => {
    const validated = await runDd(['validate', REVIEW]);
    expect(validated.code).toBe(0);
  });

  it('renders a sibling with no drift', async () => {
    const checked = await runDd(['build', REVIEW, '--check']);
    expect(checked.code).toBe(0);
  });
});

describe('dw-000d — the verdict decides EVERY finding', () => {
  it('leaves nothing undecided — an unresolved finding is how a review quietly ends', () => {
    // The property that makes a review round trustworthy at all. A round that
    // silently drops a finding reads exactly like a round that resolved it.
    const findings = section<Finding>('findings').map((finding) => finding.id);
    const decided = section<Verdict>('verdict').map((verdict) =>
      verdict.finding.replace('#findings/', ''),
    );
    expect([...findings].sort()).toEqual([...decided].sort());
  });

  it('gives every verdict a rationale — a resolution with no reasoning is an assertion', () => {
    for (const verdict of section<Verdict>('verdict')) {
      expect(verdict.rationale ?? '').not.toBe('');
    }
  });

  it('records at least one REFUTED finding, with grounds', () => {
    // A corpus in which every finding is confirmed is a corpus that has not been
    // used for the thing this schema exists for.
    const refuted = section<Verdict>('verdict').filter(
      (verdict) => verdict.resolution === 'refuted',
    );
    expect(refuted.length).toBeGreaterThan(0);
    expect(refuted[0]?.rationale ?? '').toContain('mechanism was wrong');
  });
});

describe('dw-000d — Dim-0 rows cite the fixture that fired', () => {
  it('carries a pressure link on every dim0 row', () => {
    const dim0 = section<Finding>('findings').filter((finding) => finding.kind === 'dim0');
    expect(dim0.length).toBeGreaterThan(0);
    for (const finding of dim0) {
      // Without this the row says "I probed the tests" and nothing more. With
      // it, a reader can go to the instrument and check.
      expect(finding.pressure ?? '').toMatch(/backpressure\.dd\.json#rows\//);
    }
  });

  it('records a Dim-0 that FAILED to fire, not only ones that passed', () => {
    const dim0 = section<Finding>('findings').filter((finding) => finding.kind === 'dim0');
    expect(dim0.some((finding) => /NOTHING failed/.test(finding.finding))).toBe(true);
  });
});

/**
 * jq is the SUBJECT here, not the mechanism — do not rewrite these in-process.
 *
 * done_when dw-000d (plan 071, phase 3) claims verbatim that "a jq recipe answers
 * which findings were refuted", and our own dd docs RECOMMEND jq to users for
 * exactly these queries. These three cases are the only thing proving that
 * recommendation holds. Replacing jq with in-process JSON would assert that our
 * parser can read our own JSON — a tautology that passes — so on a host without
 * jq the honest move is to skip loudly and say what stopped being checked.
 */
describe.skipIf(!hasBinary('jq'))('dw-000d — the queries a reviewer actually wants', () => {
  if (!hasBinary('jq')) {
    console.warn(
      missingBinaryReason(
        'jq',
        'that a reviewer at a shell can answer "which findings were refuted", "what did Dim-0 probe", and "is anything undecided" against a builder/review document using the jq recipes our dd docs publish (dw-000d).',
      ),
    );
  }
  const jq = (filter: string): string =>
    execFileSync('jq', ['-r', filter, `${REPO_ROOT}${REVIEW}`], { encoding: 'utf8' }).trim();

  it('answers "which findings were refuted?" as a one-liner', () => {
    const refuted = jq(
      '.sections[] | select(.name=="verdict") | .value[] | select(.resolution=="refuted") | .finding',
    );
    expect(refuted).toBe('#findings/fd-0005');
  });

  it('answers "what did Dim-0 probe, and what did it cite?"', () => {
    const probed = jq(
      '.sections[] | select(.name=="findings") | .value[] | select(.kind=="dim0") | .pressure',
    );
    expect(probed.split('\n')).toHaveLength(2);
  });

  it('answers "is anything still undecided?" with silence', () => {
    const unresolved = jq(
      '[.sections[] | select(.name=="verdict") | .value[] | .finding | sub("^#findings/";"")] as $d | .sections[] | select(.name=="findings") | .value[] | select(.id as $i | $d | index($i) | not) | .id',
    );
    expect(unresolved).toBe('');
  });
});
