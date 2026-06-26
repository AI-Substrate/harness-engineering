#!/usr/bin/env node
/**
 * Telemetry real-fixture golden generator + drift checker (plan 037, Phase 3; AC-07).
 *
 * The committed goldens under
 * `harness/cli/test/services/telemetry/fixtures/real/<surface>/<instance>/`
 * (`expected-segment.json` + `invariants.json`) are DERIVED artifacts — never
 * hand-edited. Each is produced by driving the real, scrubbed `raw.*` bytes through
 * that surface's telemetry adapter → `serializeSegment`. That construction — the
 * FakeFs/FakeEnv/FakeDb wiring, and the throwaway `node:sqlite` rebuild that proves
 * the copilot-vscode SQL round-trip — lives ONCE, in the golden suites:
 *
 *   - test/services/telemetry/real-capture.e2e.test.ts        (claude · copilot-cli · cursor)
 *   - test/services/telemetry/copilot-vscode-sqlite.int.test.ts (copilot-vscode SQL round-trip)
 *
 * both of which mint their golden (+ `invariants.json`) under `REGEN_GOLDEN=1`. This
 * script is the single entry point that drives them — so there is NO second copy of
 * the per-surface segment builders to drift out of sync (the very hazard AC-07 exists
 * to guard against). It deliberately reuses the suites rather than re-importing
 * `dist/` and duplicating the builders (incl. the sqlite dance); see the Phase 3
 * execution log for the decision record.
 *
 *   default   regenerate every golden + `invariants.json` (runs the suites with
 *             `REGEN_GOLDEN=1`, which writes then asserts — so it always passes).
 *   --check   re-derive each segment and assert it matches the committed golden /
 *             invariants (runs the suites plainly; their deep-equal assertions exit
 *             non-zero on ANY drift). This is the half `check:telemetry-fixtures`
 *             wires into CI. Goldens are machine-independent by construction (the
 *             scrub normalizes every machine path/identity token), so the check is
 *             deterministic across machines.
 *
 * Both modes first ENUMERATE every committed `fixtures/real/<surface>/<instance>/`
 * and fail if any instance lacks a golden + a suite reference (review F005) — so the
 * living corpus can't grow a fixture dir that no drift assertion ever touches.
 *
 * Runs the repo-hoisted vitest entry directly via `node` (no `.bin` shim — matches
 * `flow-fixtures.mjs`, deterministic across npm majors and cross-platform), with
 * cwd = `harness/cli` so `vitest.config.ts` resolves. No prior `npm run build` is
 * needed: the suites import from `src/` through vitest's TS pipeline.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliDir = join(repoRoot, 'harness/cli');
const vitestEntry = join(repoRoot, 'node_modules/vitest/vitest.mjs');
const check = process.argv.includes('--check');

// The two golden suites that own ALL four surfaces' raw→segment construction.
const SUITES = [
  'test/services/telemetry/real-capture.e2e.test.ts',
  'test/services/telemetry/copilot-vscode-sqlite.int.test.ts',
];

const realRoot = join(cliDir, 'test/services/telemetry/fixtures/real');

if (!existsSync(vitestEntry)) {
  console.error(`telemetry-fixtures: vitest entry not found at ${vitestEntry} — run \`npm install\` first.`);
  process.exit(1);
}
for (const suite of SUITES) {
  if (!existsSync(join(cliDir, suite))) {
    console.error(`telemetry-fixtures: golden suite missing: ${suite}`);
    process.exit(1);
  }
}

/** Every committed `fixtures/real/<surface>/<instance>/` dir. */
function listInstances() {
  const out = [];
  let surfaces = [];
  try {
    surfaces = readdirSync(realRoot, { withFileTypes: true });
  } catch {
    return out; // no corpus yet → nothing to enumerate
  }
  for (const s of surfaces) {
    if (!s.isDirectory()) continue;
    let instances = [];
    try {
      instances = readdirSync(join(realRoot, s.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const i of instances) if (i.isDirectory()) out.push({ surface: s.name, instance: i.name });
  }
  return out;
}

// FUTURE-PROOF the living corpus (review F005): the corpus grows by ADDING instance
// dirs alongside existing ones, but the guard's drift assertions only fire for
// instances a suite actually loads. So before delegating, assert every committed
// instance is BOTH golden-bearing AND referenced by a suite — otherwise a new
// fixture dir could be committed and `check:telemetry-fixtures` would pass blind.
const suiteText = SUITES.map((s) => {
  try {
    return readFileSync(join(cliDir, s), 'utf8');
  } catch {
    return '';
  }
}).join('\n');
const uncovered = listInstances().filter(({ surface, instance }) => {
  const goldenPresent = existsSync(join(realRoot, surface, instance, 'expected-segment.json'));
  const referenced = suiteText.includes(`${surface}/${instance}`) || suiteText.includes(instance);
  return !goldenPresent || !referenced;
});
if (uncovered.length > 0) {
  console.error(
    'telemetry-fixtures: these committed real fixture instances have NO drift-guard coverage:',
  );
  for (const u of uncovered) console.error(`  - ${u.surface}/${u.instance}`);
  console.error(
    'Each instance needs an `expected-segment.json` AND a golden-suite case that loads it ' +
      '(regenerate via `npm run gen:telemetry-fixtures`), or remove the orphan dir.',
  );
  process.exit(1);
}

const env = { ...process.env };
if (!check) env.REGEN_GOLDEN = '1';

try {
  // cwd = harness/cli so vitest.config.ts + the suite-relative paths resolve.
  execFileSync(process.execPath, [vitestEntry, 'run', ...SUITES], {
    cwd: cliDir,
    stdio: 'inherit',
    env,
  });
} catch {
  console.error(
    check
      ? 'telemetry-fixtures: DRIFT — a committed golden no longer matches its re-derived segment. Re-run `npm run gen:telemetry-fixtures` and commit the result.'
      : 'telemetry-fixtures: regeneration failed (see the vitest output above).',
  );
  process.exit(1);
}

console.error(
  `telemetry-fixtures: ${check ? 'checked' : 'regenerated'} ${SUITES.length} golden suite(s); ` +
    `${listInstances().length} committed instance(s) all covered.`,
);
