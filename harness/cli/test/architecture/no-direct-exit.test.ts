import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Resolve from THIS file's location, not cwd — the suite must read true from any
// invocation directory (plan 014 orchestrator retro OH-001).
const CLI_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

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
    // exit.ts is the sole place the process terminates; everything else must
    // route through exitWithEnvelope (companion F006).
    const examined = tsFiles(join(CLI_ROOT, 'src'));
    const offenders = examined
      .filter((f) => !f.endsWith(join('output', 'exit.ts')))
      .filter((f) => /process\.exit\s*\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(CLI_ROOT, f));

    // The WALK is the only stage here that can silently empty — the exclusion is
    // a single file and the regex is the verdict — so the corpus assertion is
    // the right place for this guard. That is NOT true of every guard in this
    // directory (see dd-core-isolation, where two narrowing stages sit after the
    // walk), which is why these are adjudicated per-guard rather than uniformly.
    expect(examined.length).toBeGreaterThan(0);
    console.error(
      `no-direct-exit — examined ${examined.length} file(s), ${offenders.length} offender(s)`,
    );

    expect(offenders).toEqual([]);
  });
});
