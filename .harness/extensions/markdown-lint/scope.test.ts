import { describe, expect, it } from 'vitest';
import { filterInScope, globToRegExp, inScope, normalizePath } from './lib/scope.js';

/**
 * The scope contract is the AC-04 guarantee ("zero findings from excluded dirs"),
 * so it is unit-proven here: include hits, ignore hits, and the ignore-beats-include
 * rule that protects generated/transient markdown nested under authored roots.
 */
describe('inScope — include set', () => {
  it.each([
    'README.md',
    'AGENTS.md',
    'AGENTS_README.md',
    'INSTALL.md',
    'CHANGELOG.md',
    'docs/guide/intro.md',
    'docs/how/extend-the-harness.md',
    'docs/project-rules/constitution.md',
    'harness-foundations/source-notes/notes-public.md',
    'skills/eng-harness-flow/SKILL.md',
    'harness/cli/docs/authoring-verbs.md',
    'harness/cli/README.md',
  ])('includes authored doc %s', (p) => {
    expect(inScope(p)).toBe(true);
  });

  it('bare include entries match the repo root only (same-named files under non-included dirs are out)', () => {
    expect(inScope('docs/README.md')).toBe(false);
    expect(inScope('harness/cli/src/README.md')).toBe(false);
  });

  it('a same-named file under an included tree IS in scope via that tree (e.g. skills/**)', () => {
    expect(inScope('skills/eng-harness-flow/AGENTS.md')).toBe(true);
  });
});

describe('inScope — ignore set (ignore beats include)', () => {
  it.each([
    'docs/plans/029-markdown-lint-extension/markdown-lint-extension-plan.md',
    '.harness/extensions/markdown-lint/instructions.md',
    'agents/validate-harness-flow/prompt.md',
    'docs/retros/009-harnessability-survey.md',
    'harness/cli/test/fixtures/x.md',
    'scratch/sources/raw.md',
    'node_modules/foo/readme.md',
    'dist/x.md',
    'coverage/x.md',
  ])('ignores generated/transient %s', (p) => {
    expect(inScope(p)).toBe(false);
  });

  it('ignores **/the-flow.md, **/*.fltplan.md, **/tasks/**, **/reviews/** at any depth', () => {
    expect(inScope('docs/plans/x/the-flow.md')).toBe(false);
    expect(inScope('the-flow.md')).toBe(false);
    expect(inScope('docs/guide/x.fltplan.md')).toBe(false);
    expect(inScope('skills/eng-harness-flow/tasks/phase-1/tasks.md')).toBe(false);
    expect(inScope('docs/how/reviews/r1.md')).toBe(false);
  });

  it('ignore wins even when the path is under an included root', () => {
    // skills/** is included, but a tasks/ or reviews/ subtree under it is excluded.
    expect(inScope('skills/foo/tasks/t.md')).toBe(false);
    expect(inScope('skills/foo/reviews/r.md')).toBe(false);
    expect(inScope('skills/foo/SKILL.md')).toBe(true);
  });
});

describe('inScope — out-of-scope authored-looking paths', () => {
  it('excludes markdown outside the include set', () => {
    expect(inScope('docs/adr/001.md')).toBe(false);
    expect(inScope('harness/cli/src/x.md')).toBe(false);
    expect(inScope('some/random/file.md')).toBe(false);
  });
});

describe('normalizePath', () => {
  it('drops a leading ./ and converts backslashes', () => {
    expect(normalizePath('./README.md')).toBe('README.md');
    expect(normalizePath('docs\\how\\x.md')).toBe('docs/how/x.md');
  });
  it('keeps an already-normal path unchanged', () => {
    expect(normalizePath('docs/how/x.md')).toBe('docs/how/x.md');
  });
});

describe('filterInScope', () => {
  it('keeps only in-scope paths, normalized, sorted, deduped', () => {
    const out = filterInScope([
      './README.md',
      'README.md',
      'docs/plans/x/p.md',
      'docs/how/b.md',
      'docs/how/a.md',
      '.harness/x.md',
    ]);
    expect(out).toEqual(['README.md', 'docs/how/a.md', 'docs/how/b.md']);
  });
  it('ignores empty entries', () => {
    expect(filterInScope(['', 'README.md'])).toEqual(['README.md']);
  });
});

describe('globToRegExp', () => {
  it('** matches across segments; * stays within a segment', () => {
    expect(globToRegExp('docs/how/**').test('docs/how/a/b.md')).toBe(true);
    expect(globToRegExp('*.md').test('a/b.md')).toBe(false);
    expect(globToRegExp('*.md').test('b.md')).toBe(true);
  });
  it('**/ means zero or more leading directories', () => {
    const re = globToRegExp('**/the-flow.md');
    expect(re.test('the-flow.md')).toBe(true);
    expect(re.test('a/b/the-flow.md')).toBe(true);
    expect(re.test('a/the-flow.md.bak')).toBe(false);
  });
  it('escapes regex metacharacters in literals', () => {
    expect(globToRegExp('a.b+c.md').test('a.b+c.md')).toBe(true);
    expect(globToRegExp('a.b+c.md').test('aXbXc.md')).toBe(false);
  });
});
