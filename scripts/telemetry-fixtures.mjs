#!/usr/bin/env node
/**
 * Telemetry real-fixture golden generator + drift checker (plan 037, Phase 3; AC-07).
 *
 * The committed goldens under
 * `harness/cli/test/services/telemetry/fixtures/real/<surface>/<instance>/`
 * (`expected-segment.json` + `invariants.json` + the T005 OTLP pair
 * `expected-otlp-logs.jsonl` / `expected-otlp-metrics.jsonl`) are DERIVED artifacts —
 * never hand-edited. Each is produced by driving the real, scrubbed `raw.*` bytes through
 * that surface's telemetry adapter → `serializeSegment` (→ `segmentToOtlpLogs` /
 * `rollupToOtlpMetrics` for the OTLP pair). That construction — the
 * FakeFs/FakeEnv/FakeDb wiring, and the throwaway `node:sqlite` rebuild that proves
 * the copilot-vscode SQL round-trip — lives ONCE, in the golden suites:
 *
 *   - test/services/telemetry/real-capture.e2e.test.ts        (claude · copilot-cli · cursor)
 *   - test/services/telemetry/copilot-vscode-sqlite.int.test.ts (copilot-vscode SQL round-trip)
 *
 * These suites own the raw-to-current construction once, so there is NO second copy
 * of the per-surface builders to drift out of sync (the hazard AC-07 exists to guard
 * against). The committed Segment-2.4/OTLP-v0.1 outputs are now frozen compatibility
 * evidence: the suites compare current 2.5/v0.2 output after projecting only approved
 * versioned metadata.
 *
 *   default   fail closed: legacy corpus regeneration is permanently disabled.
 *   --check   re-derive current output and compare it with the frozen Segment/OTLP
 *             corpus plus invariants. This is what `check:telemetry-fixtures` wires
 *             into CI. Goldens are machine-independent by construction (the scrub
 *             normalizes every machine path/identity token), so the check is
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

if (!check) {
  console.error(
    'telemetry-fixtures: legacy Segment-2.4/OTLP-v0.1 goldens are frozen; regeneration is disabled. Run `npm run check:telemetry-fixtures` to verify compatibility.',
  );
  process.exit(1);
}

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
  const dir = join(realRoot, surface, instance);
  // Every instance owns a segment golden AND its derived OTLP goldens (T005):
  // the same drift guard now covers the OTLP serializer over the real corpus.
  const goldenPresent =
    existsSync(join(dir, 'expected-segment.json')) &&
    existsSync(join(dir, 'expected-otlp-logs.jsonl')) &&
    existsSync(join(dir, 'expected-otlp-metrics.jsonl'));
  const referenced = suiteText.includes(`${surface}/${instance}`) || suiteText.includes(instance);
  return !goldenPresent || !referenced;
});
if (uncovered.length > 0) {
  console.error(
    'telemetry-fixtures: these committed real fixture instances have NO drift-guard coverage:',
  );
  for (const u of uncovered) console.error(`  - ${u.surface}/${u.instance}`);
  console.error(
    'Each instance needs `expected-segment.json` + `expected-otlp-logs.jsonl` + ' +
      '`expected-otlp-metrics.jsonl` AND a golden-suite case that loads it; ' +
      'legacy corpus additions require a separately reviewed versioned migration.',
  );
  process.exit(1);
}

const env = { ...process.env };

try {
  // cwd = harness/cli so vitest.config.ts + the suite-relative paths resolve.
  execFileSync(process.execPath, [vitestEntry, 'run', ...SUITES], {
    cwd: cliDir,
    stdio: 'inherit',
    env,
  });
} catch {
  console.error(
    'telemetry-fixtures: DRIFT — current output is not compatible with the frozen Segment-2.4/OTLP-v0.1 corpus. Fix the current compatibility behavior; do not rewrite the legacy goldens.',
  );
  process.exit(1);
}

console.error(
  `telemetry-fixtures: checked ${SUITES.length} frozen compatibility suite(s); ` +
    `${listInstances().length} committed instance(s) all covered.`,
);
