#!/usr/bin/env node
/**
 * Doctrine-parity drift guard (plan 040, Phase 5; AC-09/10).
 *
 * Asserts the `doctrine-parity:039` block — the single source of truth for the harness
 * chore/seam shape — is byte-identical in the in-repo mirror
 * (`skills/eng-harness-flow/SKILL.md`, always present) and the-flow's canonical
 * `references/harness-seams.md` (a SEPARATE user-global skill, absent in CI).
 *
 *   the-flow block found + identical  → ok   (exit 0)
 *   the-flow block found + differs    → fail (exit 1, with a diff)
 *   the-flow NOT locatable            → SKIP (exit 0, never fail — C1/AC-09: eng-harness-flow
 *                                              must not depend on the-flow at runtime)
 *
 * The-flow is resolved at candidate deploy paths, in order:
 *   1. `$HARNESS_THE_FLOW_DIR`  (override: a the-flow dir, or a direct `*.md` file)
 *   2. `~/.agents/skills/the-flow/references/harness-seams.md`
 *   3. `~/.claude/skills/the-flow/references/harness-seams.md`
 *
 * The drift LOGIC is the pure core in
 * `harness/cli/src/services/doctrine-parity/doctrine-parity.ts` (unit-tested with
 * fixtures, never the real `~/.agents`); this script is the thin path-resolver + I/O
 * shell. The core is TS, loaded through `jiti` (the repo's own TS loader — no prior
 * `npm run build` needed), mirroring how `flow-fixtures.mjs` drives a TS pipeline.
 *
 * `--check` is accepted for `check:*` symmetry; this guard is read-only either way.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inRepoPath = join(repoRoot, 'skills/eng-harness-flow/SKILL.md');
const corePath = join(repoRoot, 'harness/cli/src/services/doctrine-parity/doctrine-parity.ts');
const inRepoLabel = 'skills/eng-harness-flow/SKILL.md';

if (!existsSync(inRepoPath)) {
  console.error(`doctrine-parity: in-repo mirror not found at ${inRepoPath} — run from the repo root.`);
  process.exit(1);
}

const jiti = createJiti(import.meta.url, { moduleCache: false });
const core = await jiti.import(corePath);

const theFlowPath = core.resolveTheFlowSeamsPath({
  env: process.env,
  home: homedir(),
  exists: existsSync,
});

const result = core.evaluateParity({
  inRepoText: readFileSync(inRepoPath, 'utf8'),
  inRepoLabel,
  theFlowText: theFlowPath ? readFileSync(theFlowPath, 'utf8') : null,
  theFlowPath,
});

const tag = { ok: 'ok', skip: 'SKIP', fail: 'FAIL', error: 'ERROR' }[result.verdict];
console.error(`doctrine-parity: ${tag} — ${result.message}`);
if (result.diff) console.error(result.diff);
process.exit(result.exitCode);
