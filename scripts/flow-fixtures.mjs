#!/usr/bin/env node
/**
 * Golden render-fixture generator + drift checker (plan 024, Phase 2; AC-06/AC-12).
 *
 * The goldens under `harness/cli/test/services/flow/fixtures/render/` are DERIVED
 * artifacts — never hand-edited. Each `<name>.json` is a CLI-shaped flow; its
 * committed sibling `<name>.md` is exactly what `harness flow render` emits for it.
 *
 *   default       regenerate every `<name>.md` from `<name>.json` (run after build).
 *   --check       re-render each fixture and assert it matches the committed `.md`
 *                 (`harness flow render --check`); a drift exits non-zero. This is
 *                 the half `check:flows` wires into CI.
 *
 * Runs the BUILT CLI bin (mirrors the package-smoke job: `node bin … `, never a
 * `.bin` shim — deterministic across npm majors). REQUIRES `npm run build` first
 * (the bin loads `dist/`); that's the "run `npm run build` before vitest" rule.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(repoRoot, 'harness/cli/bin/harness.js');
const fixtureDir = join(repoRoot, 'harness/cli/test/services/flow/fixtures/render');
const check = process.argv.includes('--check');

if (!existsSync(bin)) {
  console.error(`flow-fixtures: CLI bin not found at ${bin} — run \`npm run build\` first.`);
  process.exit(1);
}
if (!existsSync(fixtureDir)) {
  console.error(`flow-fixtures: no fixture dir at ${fixtureDir}.`);
  process.exit(1);
}

const fixtures = readdirSync(fixtureDir)
  .filter((f) => f.endsWith('.json'))
  .sort();

if (fixtures.length === 0) {
  console.error('flow-fixtures: no *.json fixtures found.');
  process.exit(1);
}

let drift = 0;
for (const json of fixtures) {
  const jsonPath = join(fixtureDir, json);
  const mdPath = join(fixtureDir, json.replace(/\.json$/, '.md'));
  const args = check
    ? ['flow', 'render', '--path', jsonPath, '--check', '--json']
    : ['flow', 'render', '--path', jsonPath, '--output', mdPath, '--json'];
  try {
    // cwd = repoRoot so the CLI's repo-containment (isWithin) accepts the --output path.
    execFileSync(process.execPath, [bin, ...args], { cwd: repoRoot, stdio: 'pipe' });
    if (!check) console.error(`flow-fixtures: wrote ${json.replace(/\.json$/, '.md')}`);
  } catch (err) {
    if (check) {
      drift += 1;
      console.error(`flow-fixtures: DRIFT in ${json} — re-run \`npm run gen:flow-fixtures\` and commit.`);
    } else {
      console.error(`flow-fixtures: failed to render ${json}: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  }
}

if (check && drift > 0) {
  console.error(`flow-fixtures: ${drift} fixture(s) drifted from their committed render.`);
  process.exit(1);
}
console.error(`flow-fixtures: ${check ? 'checked' : 'regenerated'} ${fixtures.length} fixture(s).`);
