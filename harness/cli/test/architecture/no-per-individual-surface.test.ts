import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TELEMETRY_AUTHOR } from '../../src/adapters/git/git-write-port.js';

/*
Test Doc:
- Why: §T1 / AC-11 (Constitution P12) — telemetry MUST be team/repo-grained and NEVER store or
  surface a per-individual identity. The surveillance vector is reading the contributor's
  `git config user.email` (or name) and persisting/rendering it. This is the deterministic
  governance sensor that the docs (T008) describe: it fails if any src code path reads the
  configured user identity, so a future change that re-introduces per-individual attribution
  cannot pass silently.
- Contract: no `src/**` file reads `user.email`/`user.name` from git config; the telemetry
  orphan-commit identity is a fixed non-individual constant.
- Quality: upgrades AC-11 from doc-presence (inferential) to a code-path audit (deterministic).
*/

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../src');

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('governance: no per-individual identity surface (§T1, AC-11, P12)', () => {
  it('no src code reads the contributor identity from git config (user.email / user.name)', () => {
    // The surveillance vector: shelling out to READ the configured individual identity —
    // a quoted `'user.email'`/`'user.name'` spawn arg, or a `--format=%ae|%an|%ce|%cn`
    // identity-extraction string. Prose/comments that MENTION user.email (to say it's never
    // read) use backticks, not quotes, so they don't false-match — only real code does.
    const offenders: string[] = [];
    for (const file of tsFiles(srcDir)) {
      const text = readFileSync(file, 'utf8');
      if (/['"]user\.(email|name)['"]|--format=%[ac][en]\b/.test(text)) {
        offenders.push(file.slice(srcDir.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the telemetry orphan-commit identity is a fixed non-individual constant', () => {
    expect(TELEMETRY_AUTHOR.name).toBe('harness-telemetry');
    expect(TELEMETRY_AUTHOR.email).toBe('noreply@anthropic.com');
    expect(TELEMETRY_AUTHOR.email).toMatch(/^noreply@/);
  });

  it('ExecGitWrite forces the non-individual identity (env override) and never `git config`s user identity', () => {
    const src = readFileSync(join(srcDir, 'adapters/git/exec-git-write.ts'), 'utf8');
    expect(src).toContain('GIT_AUTHOR_EMAIL');
    expect(src).toContain('GIT_COMMITTER_EMAIL');
    expect(src).toContain('TELEMETRY_AUTHOR');
    // No real `git config user.email` read (a quoted 'config' arg followed by a quoted
    // 'user.email'/'user.name' arg) — the explanatory comment uses backticks, so it's safe.
    expect(src).not.toMatch(/['"]config['"]\s*,\s*['"]user\.(email|name)['"]/);
  });
});
