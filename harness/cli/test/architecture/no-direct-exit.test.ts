import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...tsFiles(full));
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('architecture — single exit point', () => {
  it('only output/exit.ts calls process.exit in production source', () => {
    // cwd is harness/cli. exit.ts is the sole place the process terminates;
    // everything else must route through exitWithEnvelope (companion F006).
    const offenders = tsFiles('src')
      .filter((f) => !f.endsWith(join('output', 'exit.ts')))
      .filter((f) => /process\.exit\s*\(/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
