import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  alphabeticalResortWriter,
  type ConfigWriter,
  clobberWriter,
  deCommentWriter,
  FIXTURES,
  goldenWriter,
  materialise,
  runWriter,
} from '../../support/config-fixture.js';

/**
 * THE FIXTURE PROVES ITSELF BEFORE ANY REAL WRITER EXISTS (plan 082 tk-0001).
 *
 * Sensors before feature code, as in Phase 1. A gate is not verified until it has
 * refused THE THING WE ARE AFRAID OF — not merely something.
 */

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'harness-config-fixture-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('the fixture REFUSES all three known-bad writers (dw-0001)', () => {
  const knownBad: [string, ConfigWriter, string][] = [
    [
      'CLOBBER — deletes the pre-existing entries',
      clobberWriter,
      'the easy one: caught by the weakest assertion anyone would write',
    ],
    [
      'RE-SORT — preserves every value, reorders every key',
      alphabeticalResortWriter,
      "git-ai's actual serde_json BTreeMap behaviour",
    ],
    [
      'DE-COMMENT — preserves every value and key order, drops the comments',
      deCommentWriter,
      'what a parse-and-reserialize writer actually does to JSONC',
    ],
  ];

  it.each(knownBad)('goes RED against %s', (_name, writer) => {
    /*
    Test Doc:
    - Why: dw-0001. Three mutations, because a clobber is caught by `toContainEqual`
      and proving the sensor sees deletion proves almost nothing. The two the
      workshop actually predicts — a whole-file re-sort and a de-comment — destroy
      nothing a content assertion can see.
    - Contract: for at least one agent, the produced bytes differ from the golden.
    */
    const results = FIXTURES.map((fixture) => runWriter(home, fixture, writer));
    expect(results.some((r) => !r.matchesGolden)).toBe(true);
  });

  it('RE-SORT is caught even though it preserves every VALUE (dw-0002)', () => {
    /*
    Test Doc:
    - Why: this is the row that justifies comparing BYTES. The re-sorting writer
      adds our entry correctly and keeps every existing value, so a deep-equal on
      the parsed documents passes. Only the bytes differ.
    - Contract: parsed-equal, bytes-different. Asserting BOTH is what proves the
      fixture is measuring order rather than content.
    - Quality Contribution: without the parsed-equal half, this row could pass
      against a writer that mangled the values, and we would never know which
      property the fixture actually detects.
    */
    const cursor = FIXTURES.find((f) => f.agent === 'cursor');
    if (cursor === undefined) throw new Error('cursor fixture missing');
    const result = runWriter(home, cursor, alphabeticalResortWriter);

    expect(JSON.parse(result.produced)).toEqual(JSON.parse(result.golden));
    expect(result.matchesGolden).toBe(false);
    // And the specific damage: postToolUse now precedes preToolUse.
    expect(result.produced.indexOf('postToolUse')).toBeLessThan(
      result.produced.indexOf('preToolUse'),
    );
    expect(result.golden.indexOf('preToolUse')).toBeLessThan(result.golden.indexOf('postToolUse'));
  });

  it('DE-COMMENT is caught, and the comments are what is missing', () => {
    const droid = FIXTURES.find((f) => f.agent === 'droid');
    if (droid === undefined) throw new Error('droid fixture missing');
    const result = runWriter(home, droid, deCommentWriter);

    expect(result.matchesGolden).toBe(false);
    expect(result.golden).toContain('// Droid stores settings as JSONC');
    expect(result.produced).not.toContain('// Droid stores settings as JSONC');
  });

  it('THE DETECTION MATRIX — measured, so nobody deletes the fixture that matters', () => {
    /*
      Test Doc:
      - Why: the rows above assert that SOME fixture catches each writer, which hides
        WHICH one does. Measured: the cursor fixture is BLIND to de-commenting,
        because plain JSON has no comments to lose — only the JSONC fixture catches
        it. Left implicit, someone tidying up would delete the droid fixture and
        quietly void a third of dw-0001 while every test stayed green.
      - Contract: the matrix is exactly as measured, blindness included.
      - Quality Contribution: makes a coverage gap a fact rather than a coincidence.
      */
    const matrix = (
      [
        ['clobber', clobberWriter],
        ['resort', alphabeticalResortWriter],
        ['decomment', deCommentWriter],
      ] as [string, ConfigWriter][]
    ).map(([name, writer]) => [
      name,
      FIXTURES.map((f) => (runWriter(home, f, writer).matchesGolden ? 'blind' : 'caught')),
    ]);

    expect(matrix).toEqual([
      ['clobber', ['caught', 'caught']],
      ['resort', ['caught', 'caught']],
      // The cursor fixture CANNOT see a de-comment. The JSONC fixture is the only
      // proof of the workshop's comment-preservation defect.
      ['decomment', ['blind', 'caught']],
    ]);
  });
});

describe('the fixture can also say YES — the positive control', () => {
  it.each(FIXTURES)('passes for $agent when the bytes are exactly the golden', (fixture) => {
    /*
    Test Doc:
    - Why: "all three known-bad writers are RED" is satisfied just as well by a
      comparator that NEVER passes. A sensor that always fires detects nothing, and
      the three refusals above would then be measuring the fixture's own brokenness.
    - Contract: green when the bytes match.
    - LIMIT, stated plainly: this proves the harness CAN say yes. It proves nothing
      about any real writer, which does not exist yet — that is tk-0005.
    */
    expect(runWriter(home, fixture, goldenWriter).matchesGolden).toBe(true);
  });
});

describe('the golden is a COMMITTED FILE, not a self-diff (dw-0003)', () => {
  it('differs from the input — so byte-equality against the input cannot be the check', () => {
    /*
    Test Doc:
    - Why: dw-0003. After a legitimate install the bytes HAVE changed. A fixture
      that compared the result against its own input would call every correct
      install a failure, and the only way to make it pass would be to install
      nothing.
    - Contract: golden and input differ, and the golden carries our entry while the
      input does not.
    */
    for (const fixture of FIXTURES) {
      const input = readFileSync(materialise(home, fixture), 'utf8');
      const golden = runWriter(home, fixture, goldenWriter).golden;

      expect(golden).not.toBe(input);
      expect(input).not.toContain('ai-substrate-harness-hook-v1');
      expect(golden).toContain('ai-substrate-harness-hook-v1');
      // And the pre-existing entries SURVIVE into the golden — the property the
      // clobber writer destroys. Each fixture keeps its OWN seeded entry.
      const preserved = fixture.agent === 'cursor' ? 'git-ai checkpoint cursor' : 'echo droid-pre';
      expect(input).toContain(preserved);
      expect(golden).toContain(preserved);
    }
  });

  it('the seeded input carries git-ai entries, so PRESERVATION is testable at all', () => {
    const cursor = FIXTURES.find((f) => f.agent === 'cursor');
    if (cursor === undefined) throw new Error('cursor fixture missing');
    const input = readFileSync(materialise(home, cursor), 'utf8');

    // Modelled on the LIVE config: git-ai's checkpoint is one stage of a COMPOUND
    // command someone else wrote, not an entry of its own.
    expect(input).toContain('git-ai checkpoint cursor --hook-input stdin');
    expect(input).toContain('| /home/dev/.git-ai/bin/git-ai');
    expect(runWriter(home, cursor, goldenWriter).golden).toContain(
      'git-ai checkpoint cursor --hook-input stdin',
    );
  });
});

describe('config roots resolve through the INJECTED home, by construction (dw-0004)', () => {
  it.each(FIXTURES)('$agent materialises under the injected home and nowhere else', (fixture) => {
    const target = materialise(home, fixture);
    expect(target.startsWith(home)).toBe(true);
  });

  it('the fixture module reads no ambient home — asserted on its SOURCE', () => {
    /*
    Test Doc:
    - Why: dw-0004 says "not possible by construction, not merely avoided by
      convention". A path assertion shows the fixtures happen to be injected today;
      only the absence of any ambient-home read makes it structural.
    - Contract: the support module never reads homedir, HOME or USERPROFILE.
    - Quality Contribution: this is what stops a later helper quietly adding a
      convenience default — the live ~/.cursor/hooks.json holds the git-ai pipeline
      that phase 1's only end-to-end measurement depends on.
    */
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'support', 'config-fixture.ts'),
      'utf8',
    );
    const code = source
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
      .join('\n');

    expect(code).not.toMatch(/homedir/);
    expect(code).not.toMatch(/process\.env/);
    expect(code).not.toMatch(/USERPROFILE/);
  });
});
