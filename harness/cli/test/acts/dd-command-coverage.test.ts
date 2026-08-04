import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * tk-7162 / dw-0005 — every command this plan ships is documented AND runnable.
 *
 * dw-0005 records its pressure as `not-applicable`, because whether the docs are
 * GOOD is a human judgement and no test can hold it. What a test can hold is the
 * part that rots silently: a command that ships with no chapter entry and no
 * recipe. That gap is invisible until somebody needs the command and cannot find
 * it, at which point they hand-write whatever the command would have done — which
 * is exactly the failure mode `plan pr-body` and `flow relocate` exist to remove.
 *
 * So this is a COVERAGE instrument and says so: present, not sufficient. The
 * recipes are separately proven runnable by having been run — a recipe that only
 * exists in a file is a promise, not an example.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const reference = readFileSync(`${ROOT}docs/how/dd/10-command-reference.md`, 'utf8');
const recipes = readFileSync(`${ROOT}docs/how/dd/justfile`, 'utf8');

/** Command → the string its chapter row must contain, and its recipe name. */
const SHIPPED = [
  { command: 'dd get', chapter: 'harness dd get <address>', recipe: 'w-get:' },
  { command: 'dd set', chapter: 'harness dd set <address> <value>', recipe: 'w-set:' },
  { command: 'dd set --value-json', chapter: '--value-json', recipe: 'w-set-json:' },
  { command: 'dd add', chapter: 'harness dd add <address> <json>', recipe: 'w-add:' },
  { command: 'dd add --mint', chapter: '--mint <prefix>', recipe: 'w-add:' },
  { command: 'dd rm', chapter: 'harness dd rm <address>', recipe: 'w-rm:' },
  { command: 'dd graph map --rel', chapter: '--rel <rel>', recipe: 'graph-satisfies:' },
  { command: 'plan validate --complete', chapter: '--complete', recipe: 'p-complete:' },
  { command: 'plan validate --address', chapter: '--address <address>', recipe: 'p-address:' },
  { command: 'plan pr-body', chapter: 'harness plan pr-body <plan>', recipe: 'pr-body:' },
  { command: 'plan pr-body --pin-head', chapter: '--pin-head', recipe: 'pr-body-pinned:' },
  { command: 'flow create --plan-dir', chapter: '--plan-dir <dir>', recipe: 'f-create:' },
  { command: 'flow relocate', chapter: 'harness flow relocate --to <dir>', recipe: 'f-relocate:' },
  { command: 'the check-kind gate', chapter: '"check": "plan-validate"', recipe: 'f-create:' },
  { command: 'plan fence', chapter: 'harness plan fence <fence>', recipe: 'fence-ok:' },
  { command: 'plan fence --paths', chapter: '--paths <p...>', recipe: 'fence-refused:' },
  { command: 'reviews as documents', chapter: 'builder/review', recipe: 'review-refuted:' },
] as const;

describe("dw-0005 — this plan's commands are covered by a chapter and a recipe", () => {
  it.each(SHIPPED)('$command has a command-reference entry', ({ chapter }) => {
    expect(reference).toContain(chapter);
  });

  it.each(SHIPPED)('$command has a runnable recipe', ({ recipe }) => {
    expect(recipes).toContain(`\n${recipe}`);
  });

  it('keeps every MUTATING recipe LINE off the committed corpus', () => {
    // A documentation example that edits the thing it documents breaks the
    // repository the first time somebody runs it twice — and the second run
    // reports a diff nobody made. So the rule is not "writer recipes are named
    // w-*", it is: every line that MUTATES runs in the throwaway tree. Read lines
    // are free to read the real corpus, which is the point of having one.
    //
    // Per LINE, not per recipe, deliberately. An earlier version of this control
    // asked whether the recipe MENTIONED the scratch tree anywhere, and a recipe
    // with one line repointed at the real corpus and one line still on the
    // scratch copy sailed through it — which is exactly the half-edit a hurried
    // change produces.
    const mutates = /harness dd (set|add|rm)\b|harness flow (create|relocate)\b|sed -i|rm -rf/;
    const offenders: string[] = [];
    let checked = 0;
    for (const line of recipes.split('\n')) {
      if (line.trimStart().startsWith('#')) continue;
      if (!mutates.test(line)) continue;
      checked += 1;
      if (!line.includes('{{scratch}}')) offenders.push(line.trim());
    }
    expect(offenders).toEqual([]);
    // Guard the guard: if the parse stops finding recipe lines, this test would
    // pass by examining nothing at all.
    expect(checked).toBeGreaterThanOrEqual(6);
  });
});

/**
 * tk-7163 — the promoted chapter, and the signpost that stops the rough-out
 * being cited instead of it.
 *
 * A design doc promoted without a signpost leaves two copies in the tree and no
 * way to tell which one is current — and the stale one is usually the one a
 * search finds first, because it has been there longer.
 */
describe('dw-0006 — the builder proof graph is promoted, indexed, and signposted', () => {
  const CHAPTER = 'docs/how/dd/11-the-builder-proof-graph.md';
  const ROUGH_OUT =
    'docs/plans/065-deterministic-documents/builder-tuning/structural-proof-graph.md';

  it('lands as a chapter that states the shipped surface, not the pending one', () => {
    const chapter = readFileSync(`${ROOT}${CHAPTER}`, 'utf8');
    // The rough-out hedged on everything this plan then shipped. If any of these
    // markers survive the promotion, the chapter is describing a design rather
    // than the system a reader is holding.
    expect(chapter).not.toMatch(/rename pending|\(proposed\)|Pending features/);
    for (const shipped of ['satisfies', 'done_when', 'plan pr-body', 'dd set', 'plan-validate']) {
      expect(chapter).toContain(shipped);
    }
  });

  it('is framed as the work-graph / knowledge-graph join, with recorded freshness', () => {
    const chapter = readFileSync(`${ROOT}${CHAPTER}`, 'utf8');
    expect(chapter).toContain('work graph');
    expect(chapter).toContain('knowledge graph');
    // The freshness half is the part that stops the knowledge graph becoming
    // fiction, so it is named rather than implied.
    expect(chapter).toMatch(/recorded freshness|basis ledger/i);
  });

  it('is reachable: indexed in the README, and the rough-out points at it', () => {
    expect(readFileSync(`${ROOT}docs/how/dd/README.md`, 'utf8')).toContain(
      '11-the-builder-proof-graph.md',
    );
    const roughOut = readFileSync(`${ROOT}${ROUGH_OUT}`, 'utf8');
    expect(roughOut).toContain('SUPERSEDED');
    expect(roughOut).toContain('11-the-builder-proof-graph.md');
    expect(roughOut).toContain('not maintained');
  });
});
