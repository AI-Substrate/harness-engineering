import { describe, expect, it } from 'vitest';
import {
  checkAll,
  checkSkill,
  DESCRIPTION_MAX,
  DESCRIPTION_WARN,
  parseFrontmatter,
  type SkillFile,
  toDecision,
} from './frontmatter.js';

const skill = (overrides: Partial<SkillFile> & { text: string }): SkillFile => ({
  path: 'skills/group/good-skill/SKILL.md',
  dirName: 'good-skill',
  ...overrides,
});

const fm = (body: string) => `---\n${body}\n---\n# heading\n`;

describe('parseFrontmatter', () => {
  it('parses plain scalars', () => {
    const p = parseFrontmatter(fm('name: good-skill\ndescription: does a thing'));
    expect(p.ok).toBe(true);
    expect(p.fields).toEqual({ name: 'good-skill', description: 'does a thing' });
  });

  it('strips matching quotes', () => {
    const p = parseFrontmatter(fm('name: "good-skill"\ndescription: \'quoted # not a comment\''));
    expect(p.fields.name).toBe('good-skill');
    expect(p.fields.description).toBe('quoted # not a comment');
  });

  it('truncates plain scalars at a ` #` comment, exactly as a YAML loader would', () => {
    const p = parseFrontmatter(fm('description: real value # trailing comment'));
    expect(p.fields.description).toBe('real value');
  });

  it('keeps `#` with no preceding whitespace (C#, issue#42)', () => {
    const p = parseFrontmatter(fm('description: works with C#42'));
    expect(p.fields.description).toBe('works with C#42');
  });

  it('parses a literal block scalar (`|`) preserving newlines, clipping to one trailing newline', () => {
    const p = parseFrontmatter(fm('description: |\n  line one\n  line two\n\n  line three'));
    expect(p.fields.description).toBe('line one\nline two\n\nline three\n');
  });

  it('parses a strip-chomped literal block (`|-`) with no trailing newline', () => {
    const p = parseFrontmatter(fm('description: |-\n  line one\n  line two'));
    expect(p.fields.description).toBe('line one\nline two');
  });

  it('folds a `>-` block: single newlines become spaces, blank lines survive', () => {
    const p = parseFrontmatter(fm('description: >-\n  one\n  two\n\n  three'));
    expect(p.fields.description).toBe('one two\nthree');
  });

  it('handles CRLF input', () => {
    const p = parseFrontmatter('---\r\nname: good-skill\r\ndescription: fine\r\n---\r\nbody\r\n');
    expect(p.ok).toBe(true);
    expect(p.fields.name).toBe('good-skill');
  });

  it('rejects a missing frontmatter block', () => {
    const p = parseFrontmatter('# just markdown\n');
    expect(p.ok).toBe(false);
    expect(p.detail).toMatch(/very start/);
  });

  it('rejects an unterminated block', () => {
    const p = parseFrontmatter('---\nname: x\n');
    expect(p.ok).toBe(false);
    expect(p.detail).toMatch(/never closed/);
  });

  it('rejects a leading BOM', () => {
    const p = parseFrontmatter('﻿---\nname: x\n---\n');
    expect(p.ok).toBe(false);
    expect(p.detail).toMatch(/BOM/);
  });
});

describe('checkSkill', () => {
  const good = fm(`name: good-skill\ndescription: |\n  A perfectly reasonable description.`);

  it('passes a clean skill', () => {
    expect(checkSkill(skill({ text: good }))).toEqual([]);
  });

  it('flags a missing name', () => {
    const f = checkSkill(skill({ text: fm('description: fine') }));
    expect(f.map((x) => x.rule)).toEqual(['name-missing']);
  });

  it('flags a missing description', () => {
    const f = checkSkill(skill({ text: fm('name: good-skill') }));
    expect(f.map((x) => x.rule)).toEqual(['description-missing']);
  });

  it('flags a name over 64 chars', () => {
    const long = 'a'.repeat(65);
    const f = checkSkill(skill({ dirName: long, text: fm(`name: ${long}\ndescription: fine`) }));
    expect(f.map((x) => x.rule)).toEqual(['name-too-long']);
  });

  it('flags bad name charsets but allows interior double hyphens', () => {
    for (const bad of ['Upper-Case', '-leading', 'trailing-', 'spa ce']) {
      const f = checkSkill(skill({ dirName: bad, text: fm(`name: ${bad}\ndescription: fine`) }));
      expect(f.map((x) => x.rule), bad).toContain('name-charset');
    }
    const ok = checkSkill(skill({ dirName: 'a--b', text: fm('name: a--b\ndescription: fine') }));
    expect(ok).toEqual([]);
  });

  it('flags a name that does not match its directory', () => {
    const f = checkSkill(skill({ dirName: 'other-dir', text: good }));
    expect(f.map((x) => x.rule)).toEqual(['name-dir-mismatch']);
  });

  it('flags a description over 1024 chars as an error', () => {
    const text = fm(`name: good-skill\ndescription: |\n  ${'x'.repeat(DESCRIPTION_MAX + 1)}`);
    const f = checkSkill(skill({ text }));
    expect(f.map((x) => x.rule)).toEqual(['description-too-long']);
    expect(f[0].severity).toBe('error');
  });

  it('flags the 900–1024 headroom band as a warning only', () => {
    const text = fm(`name: good-skill\ndescription: |\n  ${'x'.repeat(DESCRIPTION_WARN + 1)}`);
    const f = checkSkill(skill({ text }));
    expect(f.map((x) => x.rule)).toEqual(['description-near-limit']);
    expect(f[0].severity).toBe('warn');
  });

  it('counts the YAML-parsed value, not the raw indented block', () => {
    // 1020 content chars would read as >1024 with raw two-space indents.
    const lines = Array.from({ length: 10 }, () => 'y'.repeat(102)).join('\n  ');
    const text = fm(`name: good-skill\ndescription: |-\n  ${lines}`);
    const f = checkSkill(skill({ text }));
    // 10 lines × 102 + 9 newlines = 1029 → over; proves indent is stripped but newlines count.
    expect(f.map((x) => x.rule)).toEqual(['description-too-long']);
  });

  it('reports unparseable frontmatter as a single finding', () => {
    const f = checkSkill(skill({ text: '# no frontmatter at all\n' }));
    expect(f.map((x) => x.rule)).toEqual(['frontmatter']);
  });
});

describe('checkAll', () => {
  it('flags duplicate names across skills, once per offender', () => {
    const a = skill({ path: 'skills/a/dup/SKILL.md', dirName: 'dup', text: fm('name: dup\ndescription: one') });
    const b = skill({ path: 'skills/b/dup/SKILL.md', dirName: 'dup', text: fm('name: dup\ndescription: two') });
    const f = checkAll([a, b]).filter((x) => x.rule === 'name-duplicate');
    expect(f).toHaveLength(2);
    expect(f[0].message).toContain('2 skills');
  });

  it('sorts findings by path then rule', () => {
    const bad1 = skill({ path: 'skills/z/bad/SKILL.md', dirName: 'bad', text: fm('name: bad') });
    const bad2 = skill({ path: 'skills/a/worse/SKILL.md', dirName: 'worse', text: fm('description: only') });
    const f = checkAll([bad1, bad2]);
    expect(f.map((x) => x.path)).toEqual(['skills/a/worse/SKILL.md', 'skills/z/bad/SKILL.md']);
  });
});

describe('toDecision', () => {
  const err = { rule: 'description-too-long', severity: 'error' as const, path: 'p', message: 'm.' };
  const warn = { rule: 'description-near-limit', severity: 'warn' as const, path: 'p', message: 'm.' };

  it('errors (exit 1) when any error finding exists', () => {
    const d = toDecision(7, [err, warn]);
    expect(d.status).toBe('error');
    expect(d.error?.code).toBe('E_SKILL_INVALID');
    expect(d.data).toMatchObject({ skills: 7, errors: 1, warnings: 1 });
    expect(d.next_action).toContain('p');
  });

  it('degrades (exit 0) on warnings only', () => {
    const d = toDecision(7, [warn]);
    expect(d.status).toBe('degraded');
    expect(d.next_action).toMatch(/headroom/);
  });

  it('is ok when clean', () => {
    expect(toDecision(7, []).status).toBe('ok');
  });
});
