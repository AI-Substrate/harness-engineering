import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Resolve from THIS file's location, not cwd — the suite must read true from any
// invocation directory (plan 014 orchestrator retro OH-001). This test lives at
// harness/cli/test/architecture/, so four levels up is the repo root.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

// .harness/history.md was retired in plan 020 Phase 3 — the harness-change record
// ledger (.harness/records/harness-change/) is the harness changelog now. This guard
// turns the doc sweep into a deterministic regression gate (AC-8, KF-04): no live doc
// or skill may instruct reading or writing the removed file. The migration record and
// the harness-change type's own source comments legitimately name the retired path, so
// .harness/records (committed records) and .harness/temp (observe scratch) are excluded.
const SCAN_DIRS = ['skills', 'docs/how', '.harness'].map((d) => join(REPO_ROOT, d));
const EXCLUDED_DIRS = [join('.harness', 'records'), join('.harness', 'temp')];
const HISTORY_REF = /\.harness\/history\.md/;

function mdFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (EXCLUDED_DIRS.some((excluded) => full.includes(excluded))) continue;
    if (entry.isDirectory()) {
      out.push(...mdFiles(full));
    } else if (entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

describe('architecture — .harness/history.md is retired (plan 020 Phase 3)', () => {
  it('no doc or skill references the removed .harness/history.md ledger (AC-8)', () => {
    // A live reference would instruct an agent to read/write a file that no longer
    // exists. The harness-change record ledger replaces it; this guard converts that
    // doc rot into a deterministic failure instead of an eyeball checklist.
    const offenders = SCAN_DIRS.flatMap(mdFiles)
      .filter((file) => HISTORY_REF.test(readFileSync(file, 'utf8')))
      .map((file) => relative(REPO_ROOT, file));
    expect(offenders).toEqual([]);
  });
});
