import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * T001 — Frozen contract-snapshot sensor (plan 024 Phase 1; AC-08, Finding 01).
 *
 * The byte-stable `--hook / --event / --hooks / --json` contract is OWNED by the
 * `eng-harness-flow` skill and defined ONCE in its routing engine
 * (`skills/eng-harness-flow/references/00-routing.md`). `the-flow` (Phase 3) and
 * any other host flow MIRROR this contract; drift silently breaks them — that is
 * the CD-02 blast radius (Finding 01).
 *
 * This is a TWO-CHECKPOINT blocking gate:
 *   - Checkpoint 1 (HERE): freeze the hook-contract bytes. Created + committed +
 *     green on UNMODIFIED `main` BEFORE any other Phase-1 task. Re-run in Phase 3
 *     (task 3.1) — any drift fails this snapshot.
 *   - Checkpoint 2 (added in T015): freeze the NEW `harness flow` Envelope `data`
 *     shapes (`create`/`show`/`event`) the-flow will consume.
 *
 * The `the-flow` `harness-seams.md` mirror is verified MANUALLY cross-repo (that
 * file is not vendored in this repo, so it cannot be a CI gate — see AC-08).
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const CONTRACT_SOURCE = join(REPO_ROOT, 'skills/eng-harness-flow/references/00-routing.md');

/**
 * Extract a markdown `##`/`###` section by a substring of its heading line, up to
 * (but not including) the next `##`/`###` heading. Substring-matched (not exact)
 * so a cosmetic heading edit — backtick placement, trailing words — doesn't break
 * the sensor for the wrong reason; gross drift still shows up in the byte snapshot.
 */
function section(md: string, headingIncludes: string): string {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => /^#{2,3} /.test(l) && l.includes(headingIncludes));
  if (start === -1) throw new Error(`contract heading not found: "${headingIncludes}"`);
  let end = start + 1;
  while (end < lines.length && !/^#{2,3} /.test(lines[end])) end++;
  return lines.slice(start, end).join('\n').trimEnd();
}

describe('contract: --hook/--event/--hooks/--json byte-stable surface (T001 checkpoint 1)', () => {
  const md = readFileSync(CONTRACT_SOURCE, 'utf8');
  const lifecycleHooks = section(md, 'Lifecycle hooks');
  const routingEnvelope = section(md, 'routing envelope');
  const hooksManifest = section(md, 'discovery manifest');

  it('still defines the closed set of five lifecycle hooks', () => {
    for (const hook of ['pre-flight', 'pre-coding', 'coding', 'post-coding', 'post-flight']) {
      expect(lifecycleHooks).toContain(hook);
    }
  });

  it('routing envelope still carries the additive `hook` field', () => {
    expect(routingEnvelope).toContain('"hook"');
  });

  it('discovery manifest is still Shape A (top-level manifest_version)', () => {
    expect(hooksManifest).toContain('"manifest_version": 1');
  });

  it('freezes the full hook-contract bytes (re-run in Phase 3 task 3.1)', () => {
    const frozen = [
      '=== --hook/--event/--hooks/--json contract — frozen snapshot (plan 024 AC-08) ===',
      '=== source: skills/eng-harness-flow/references/00-routing.md ===',
      '',
      lifecycleHooks,
      '',
      routingEnvelope,
      '',
      hooksManifest,
    ].join('\n');
    expect(frozen).toMatchSnapshot();
  });

  // Checkpoint 2 — baselined as the FINAL Phase-1 act in T015 (acts/flow.ts wiring),
  // once `harness flow create/show/event` return real Envelopes to freeze.
  it.todo('checkpoint 2: freeze harness flow Envelope data shapes (create/show/event) — added in T015');
});
