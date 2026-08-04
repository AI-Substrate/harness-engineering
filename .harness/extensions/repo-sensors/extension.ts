import {
  defineExtension,
  type SensorReading,
  type SensorRunContext,
} from '@ai-substrate/engineering-harness/contract';

const HARNESS_BIN = 'harness/cli/bin/harness.js';
const DEFAULT_TIMEOUT_MS = 30_000;
const SUITE_TIMEOUT_MS = 60_000;
const COVERAGE_TARGET = 80;
/**
 * A ROLLED telemetry ref carries exactly three blobs (`manifest.json`,
 * `session.logs.jsonl`, `session.metrics.jsonl`). The threshold sits well above
 * that so an in-flight per-seq ref is not nagged about, while the legacy
 * unrolled shape — thousands of `<seq>.json` blobs — is impossible to miss.
 */
const TELEMETRY_REF_FILE_LIMIT = 16;
/** Offenders named in the report; the rest are counted, never silently dropped. */
const TELEMETRY_REF_REPORT_CAP = 5;
const TODO_TARGET = 20;
const DEBT_MARKERS = ['TO' + 'DO', 'FIX' + 'ME', 'HA' + 'CK'];
const INTERNAL_LOCK_PATTERN =
  'packagefeedproxy\\.microsoft\\.io|ms-feed-|vsassets\\.io|[?&](sig|se)=';

const SUITE_WATCH = [
  'harness/cli/src/**/*.{ts,tsx}',
  'harness/cli/test/**/*.ts',
  '.harness/extensions/**/*.{ts,tsx,js,mjs,cjs}',
  'harness/cli/vitest.config.ts',
  'package.json',
  'package-lock.json',
];

function commandMeasurement(
  label: string,
  command: string,
  args: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): (ctx: SensorRunContext) => Promise<SensorReading> {
  return async (ctx) => {
    const result = await ctx.exec(command, args, { timeoutMs });
    return {
      state: result.ok ? 'pass' : 'fail',
      details: result.ok ? `${label} passed` : `${label} failed (exit ${result.code})`,
      report: [
        `Measurement: ${label}`,
        `Local command: ${command} ${args.join(' ')}`,
        `Result: ${result.ok ? 'passed' : `failed with exit ${result.code}`}`,
      ].join('\n'),
    };
  };
}

function coverageReportsDirectory(ctx: SensorRunContext, sensor: string): string {
  const repoRoot = ctx.cwd.replace(/[\\/]+$/, '');
  return `${repoRoot}/.harness/temp/sensors/coverage/${sensor}`;
}

async function runFullSuite(ctx: SensorRunContext, sensor: string) {
  return ctx.exec(
    'npm',
    [
      'test',
      '--',
      `--coverage.reportsDirectory=${coverageReportsDirectory(ctx, sensor)}`,
    ],
    { timeoutMs: SUITE_TIMEOUT_MS },
  );
}

async function fullTestSuite(ctx: SensorRunContext): Promise<SensorReading> {
  const result = await runFullSuite(ctx, 'tests');
  return {
    state: result.ok ? 'pass' : 'fail',
    details: result.ok ? 'full test suite passed' : `full test suite failed (exit ${result.code})`,
    report: [
      'Measurement: full test suite',
      'Local command: npm test',
      `Result: ${result.ok ? 'passed' : `failed with exit ${result.code}`}`,
    ].join('\n'),
  };
}

function harnessVerbMeasurement(
  verb: string,
): (ctx: SensorRunContext) => Promise<SensorReading> {
  return async (ctx) => {
    // `verb` may name a sub-verb (`dd doctor`); split it into argv so commander
    // sees two words rather than one unmatched argument.
    const result = await ctx.exec('node', [HARNESS_BIN, ...verb.split(' '), '--json'], {
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
    let status: 'ok' | 'degraded' | 'unconfigured' | 'error';
    try {
      const envelope = JSON.parse(result.stdout) as { status?: unknown };
      status =
        envelope.status === 'ok' ||
        envelope.status === 'degraded' ||
        envelope.status === 'unconfigured' ||
        envelope.status === 'error'
          ? envelope.status
          : result.ok
            ? 'ok'
            : 'error';
    } catch {
      status = result.ok ? 'ok' : 'error';
    }

    const state =
      status === 'ok' ? 'pass' : status === 'degraded' ? 'warn' : status === 'unconfigured' ? 'skip' : 'fail';
    return {
      state,
      details: `${verb}: ${status}`,
      report: [
        `Harness verb: ${verb}`,
        `Envelope status: ${status}`,
        `Process exit: ${result.code}`,
      ].join('\n'),
    };
  };
}

async function coverageBranch(ctx: SensorRunContext): Promise<SensorReading> {
  const result = await runFullSuite(ctx, 'coverage-branch');
  if (!result.ok) {
    return {
      state: 'fail',
      details: `coverage run failed (exit ${result.code})`,
      report: [
        'Measurement: independent branch-coverage run',
        'Local command: npm test',
        `Result: failed with exit ${result.code}`,
      ].join('\n'),
    };
  }

  const match = result.stdout.match(/Branches\s*:\s*([0-9]+(?:\.[0-9]+)?)%/);
  if (!match) {
    return {
      state: 'skip',
      details: 'branch coverage summary unavailable',
      report: [
        'Measurement: independent branch-coverage run',
        'Local command: npm test',
        'Result: tests passed, but no branch summary was present',
      ].join('\n'),
      guidance: 'Keep the branch summary enabled in the local test script, then rerun this sensor.',
    };
  }

  const score = Number(match[1]);
  return {
    state: score >= COVERAGE_TARGET ? 'pass' : 'warn',
    score,
    direction: 'higher',
    threshold: COVERAGE_TARGET,
    details: `${score.toFixed(2)}% branch coverage (target ${COVERAGE_TARGET}%)`,
    report: [
      'Measurement: independent branch-coverage run',
      'Local command: npm test',
      `Branch coverage: ${score.toFixed(2)}%`,
      `Target: ${COVERAGE_TARGET}%`,
    ].join('\n'),
  };
}

async function todoDebt(ctx: SensorRunContext): Promise<SensorReading> {
  const result = await ctx.exec(
    'git',
    ['grep', '-n', '-I', '-E', DEBT_MARKERS.join('|'), '--', '.'],
    { timeoutMs: DEFAULT_TIMEOUT_MS },
  );
  if (result.code !== 0 && result.code !== 1) {
    return {
      state: 'fail',
      details: `debt-marker scan failed (exit ${result.code})`,
      report: `Measurement: tracked debt annotations\nResult: git grep failed with exit ${result.code}`,
    };
  }

  const counts = Object.fromEntries(DEBT_MARKERS.map((marker) => [marker, 0])) as Record<
    string,
    number
  >;
  for (const marker of result.stdout.match(new RegExp(`\\b(?:${DEBT_MARKERS.join('|')})\\b`, 'g')) ?? []) {
    counts[marker] = (counts[marker] ?? 0) + 1;
  }
  const score = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return {
    state: score <= TODO_TARGET ? 'pass' : 'warn',
    score,
    direction: 'lower',
    threshold: TODO_TARGET,
    details: `${score} tracked debt markers (target ≤${TODO_TARGET})`,
    report: [
      'Measurement: tracked debt annotations',
      `Marker counts: ${DEBT_MARKERS.map((marker) => `${marker} ${counts[marker]}`).join(' · ')}`,
      `Target: no more than ${TODO_TARGET}`,
    ].join('\n'),
  };
}

async function lockHygiene(ctx: SensorRunContext): Promise<SensorReading> {
  const result = await ctx.exec(
    'git',
    ['grep', '-n', '-I', '-E', INTERNAL_LOCK_PATTERN, '--', 'package-lock.json'],
    { timeoutMs: DEFAULT_TIMEOUT_MS },
  );
  if (result.code !== 0 && result.code !== 1) {
    return {
      state: 'fail',
      details: `lock scan failed (exit ${result.code})`,
      report: `Measurement: internal registry URLs in package-lock.json\nResult: git grep failed with exit ${result.code}`,
    };
  }

  const score = result.stdout
    ? (result.stdout.match(new RegExp(INTERNAL_LOCK_PATTERN, 'gi')) ?? []).length
    : 0;
  return {
    state: score === 0 ? 'pass' : 'fail',
    score,
    direction: 'lower',
    threshold: 0,
    details: `${score} internal registry URLs in package-lock.json`,
    report: [
      'Measurement: internal registry URLs in package-lock.json',
      `Matches: ${score}`,
      'Expected: public registry URL form only',
    ].join('\n'),
  };
}

/**
 * Watch the size of every `refs/harness-telemetry/**` tree.
 *
 * A 17,566-file legacy ref sat in this repo undetected from June because NOTHING
 * watched ref tree size. This sensor's job is to make that visible, NOT to make it
 * red: an oversized ref is a `warn` forever if that is the honest state (the June
 * ref is a known, accepted offender and will trip this by design). It never
 * returns `fail` — a historical ref is not a broken build.
 */
async function telemetryRefSize(ctx: SensorRunContext): Promise<SensorReading> {
  const listed = await ctx.exec(
    'git',
    ['for-each-ref', '--format=%(refname)', 'refs/harness-telemetry'],
    { timeoutMs: DEFAULT_TIMEOUT_MS },
  );
  if (!listed.ok) {
    return {
      state: 'skip',
      details: 'telemetry refs unreadable (no git repo or no refs)',
      report: [
        'Measurement: file count of every refs/harness-telemetry/** tree',
        'Local command: git for-each-ref refs/harness-telemetry',
        `Result: git exited ${listed.code} — nothing measured`,
      ].join('\n'),
      guidance: 'Run this sensor inside a git repository that captures harness telemetry.',
    };
  }

  const refs = listed.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('refs/harness-telemetry/'));

  const offenders: { ref: string; files: number }[] = [];
  let unreadable = 0;
  for (const ref of refs) {
    const tree = await ctx.exec('git', ['ls-tree', '-r', '--name-only', ref], {
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
    if (!tree.ok) {
      unreadable += 1;
      continue;
    }
    const files = tree.stdout.split('\n').filter((line) => line.trim().length > 0).length;
    if (files > TELEMETRY_REF_FILE_LIMIT) offenders.push({ ref, files });
  }
  offenders.sort((a, b) => b.files - a.files);

  const named = offenders
    .slice(0, TELEMETRY_REF_REPORT_CAP)
    .map((o) => `${o.ref} (${o.files} files)`);
  const rest = offenders.length - named.length;
  return {
    // WARN, never fail: naming the offender is the whole job.
    state: offenders.length === 0 ? 'pass' : 'warn',
    score: offenders.length,
    direction: 'lower',
    threshold: 0,
    details: `${offenders.length}/${refs.length} telemetry ref(s) over ${TELEMETRY_REF_FILE_LIMIT} files`,
    report: [
      'Measurement: file count of every refs/harness-telemetry/** tree',
      'Local command: git for-each-ref + git ls-tree -r --name-only',
      `Refs measured: ${refs.length}${unreadable > 0 ? ` (${unreadable} unreadable)` : ''}`,
      `Threshold: more than ${TELEMETRY_REF_FILE_LIMIT} files (a rolled ref carries 3)`,
      offenders.length === 0
        ? 'Oversized refs: none'
        : `Oversized refs: ${named.join(' · ')}${rest > 0 ? ` · +${rest} more` : ''}`,
    ].join('\n'),
  };
}

export default defineExtension({
  name: 'repo-sensors',
  summary: 'Fast deterministic health signals for this repository.',
  description:
    'Wraps the repository’s existing local gates and derives three score-bearing hygiene signals without network resolution or raw-output persistence.',
  sensors: {
    tests: {
      summary: 'Run the full Vitest suite with coverage.',
      watch: [...SUITE_WATCH],
      timeoutMs: SUITE_TIMEOUT_MS,
      guidance: 'Run `npm test`, fix the failing test, and rerun this sensor.',
      run: fullTestSuite,
    },
    'skills-check': {
      summary: 'Validate every tracked skill against the Agent Skills frontmatter contract.',
      watch: ['skills/**/*.md', '.harness/extensions/skills-check/**/*.ts'],
      timeoutMs: DEFAULT_TIMEOUT_MS,
      guidance: 'Run `node harness/cli/bin/harness.js skills-check --json` and fix the finding.',
      run: harnessVerbMeasurement('skills-check'),
    },
    typecheck: {
      summary: 'Typecheck the harness CLI without emitting build output.',
      watch: [
        'harness/cli/src/**/*.{ts,tsx}',
        'harness/cli/tsconfig.json',
        'package.json',
        'package-lock.json',
      ],
      timeoutMs: DEFAULT_TIMEOUT_MS,
      guidance: 'Run the local TypeScript command and fix the reported type error.',
      run: commandMeasurement('TypeScript typecheck', 'node', [
        'node_modules/typescript/bin/tsc',
        '--noEmit',
        '-p',
        'harness/cli/tsconfig.json',
      ]),
    },
    lint: {
      summary: 'Run the repository’s read-only Biome lint and format check.',
      watch: ['harness/cli/**/*.{ts,tsx,json}', 'biome.json', 'package.json', 'package-lock.json'],
      timeoutMs: DEFAULT_TIMEOUT_MS,
      guidance: 'Run `npm run lint`, fix the authored issue, and rerun this sensor.',
      run: commandMeasurement('Biome check', 'npm', ['run', 'lint']),
    },
    'arch-check': {
      summary: 'Run the repository’s dependency-cruiser architecture verb.',
      watch: [
        'harness/cli/src/**/*.{ts,tsx}',
        '.dependency-cruiser.cjs',
        '.harness/extensions/arch-check/**/*.ts',
      ],
      timeoutMs: DEFAULT_TIMEOUT_MS,
      guidance: 'Run `node harness/cli/bin/harness.js arch-check --json` and review each rule finding.',
      run: harnessVerbMeasurement('arch-check'),
    },
    'docs-drift': {
      summary: 'Prove the generated CLI documentation bundle matches its curated sources.',
      watch: [
        'docs/**/*.md',
        'harness/cli/src/services/docs/**/*.{ts,json}',
        'scripts/gen-docs.mjs',
      ],
      timeoutMs: DEFAULT_TIMEOUT_MS,
      guidance: 'Run `npm run gen:docs`, review the generated diff, and rerun the drift guard.',
      run: commandMeasurement('generated docs drift guard', 'npm', ['run', 'check:docs']),
    },
    'flows-drift': {
      summary: 'Prove generated flow schemas, templates, and fixtures match their sources.',
      watch: [
        'docs/plans/**/*.md',
        'harness/cli/src/services/flow/**/*.{ts,json}',
        'scripts/gen-flows.mjs',
        'scripts/flow-fixtures.mjs',
      ],
      timeoutMs: DEFAULT_TIMEOUT_MS,
      guidance: 'Run `npm run gen:flows`, review the generated diff, and rerun the drift guard.',
      run: commandMeasurement('generated flows drift guard', 'npm', ['run', 'check:flows']),
    },
    'doctrine-parity': {
      summary: 'Check the harness chore/seam doctrine mirror against the located the-flow source.',
      watch: ['skills/eng-harness-flow/SKILL.md', 'scripts/doctrine-parity.mjs'],
      timeoutMs: DEFAULT_TIMEOUT_MS,
      guidance: 'Run `npm run check:doctrine-parity` and reconcile the two doctrine blocks.',
      run: commandMeasurement('doctrine parity guard', 'npm', ['run', 'check:doctrine-parity']),
    },
    'windows-check': {
      summary: 'Run the repository’s cross-platform extension-source scanner.',
      watch: ['.harness/extensions/**/*.{ts,js,mjs,cjs}'],
      timeoutMs: DEFAULT_TIMEOUT_MS,
      guidance: 'Run `node harness/cli/bin/harness.js windows-check --json` and fix the reported portability hazard.',
      run: harnessVerbMeasurement('windows-check'),
    },
    'coverage-branch': {
      summary: 'Measure branch coverage from an independent bounded full-suite run.',
      watch: [...SUITE_WATCH],
      timeoutMs: SUITE_TIMEOUT_MS,
      guidance: 'Add focused branch tests before raising the coverage target.',
      run: coverageBranch,
    },
    'todo-debt': {
      summary: 'Count tracked debt annotations; lower is better.',
      watch: [
        'harness/cli/src/**/*.{ts,tsx}',
        'harness/cli/test/**/*.ts',
        '.harness/extensions/**/*.{ts,tsx,js,mjs,cjs}',
        'skills/**/*.md',
        'scripts/**/*.{ts,js,mjs,cjs}',
        'docs/**/*.md',
        '*.md',
      ],
      timeoutMs: DEFAULT_TIMEOUT_MS,
      guidance: 'Resolve or convert stale debt annotations into owned work items.',
      run: todoDebt,
    },
    'dd-doctor': {
      summary: 'Sweep every deterministic document at infinite validation radius.',
      // The watch set is snapshotted when the scheduler is built, so it names both
      // halves of what a dd finding can come from: the documents themselves, and
      // the schema packages that decide whether those documents are valid. A
      // schema edit can redden a document nobody touched.
      watch: ['**/*.dd.json', '.dd/schemas/**/*.{json,ts}', '.harness/.dd/schemas/**/*.{json,ts}'],
      timeoutMs: DEFAULT_TIMEOUT_MS,
      guidance:
        'Run `node harness/cli/bin/harness.js dd doctor --json` and fix the owning document named in each finding.',
      run: harnessVerbMeasurement('dd doctor'),
    },
    'lock-hygiene': {
      summary: 'Require public-form package-lock URLs with no internal feed or signed CDN hosts.',
      watch: ['package.json', 'package-lock.json'],
      timeoutMs: DEFAULT_TIMEOUT_MS,
      guidance: 'Regenerate only the intended lock topology and normalize resolved URLs to public form.',
      run: lockHygiene,
    },
    'telemetry-ref-size': {
      summary: 'Name any refs/harness-telemetry tree that never rolled; warn only, never a gate failure.',
      watch: [
        'harness/cli/src/services/telemetry/**/*.ts',
        '.githooks/post-commit',
      ],
      timeoutMs: DEFAULT_TIMEOUT_MS,
      guidance:
        'Inspect the named ref (`git ls-tree -r --name-only <ref> | wc -l`). A rolled ref carries 3 files; an unrolled legacy ref is expected to stay listed here.',
      run: telemetryRefSize,
    },
  },
});
