import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  ExecResult,
  SensorRunContext,
} from '@ai-substrate/engineering-harness/contract';
import { scanText } from '../windows-check/lib/rules.js';
import extension from './extension.js';

interface ExecCall {
  command: string;
  args: string[];
  timeoutMs: number | undefined;
}

const EXPECTED_SENSORS = [
  'tests',
  'skills-check',
  'typecheck',
  'lint',
  'arch-check',
  'docs-drift',
  'flows-drift',
  'doctrine-parity',
  'windows-check',
  'coverage-branch',
  'todo-debt',
  'lock-hygiene',
];

function result(code: number, stdout = '', stderr = ''): ExecResult {
  return { code, stdout, stderr, ok: code === 0 };
}

function fakeContext(
  respond: (command: string, args: string[]) => ExecResult | Promise<ExecResult> = () => result(0),
  cwd = '/repo',
): { context: SensorRunContext; calls: ExecCall[] } {
  const calls: ExecCall[] = [];
  return {
    calls,
    context: {
      cwd,
      async exec(command, args = [], options) {
        calls.push({ command, args, timeoutMs: options?.timeoutMs });
        return respond(command, args);
      },
    },
  };
}

function sensors() {
  const declarations = extension.sensors;
  if (!declarations) throw new Error('repo-sensors declaration is missing');
  return declarations;
}

describe('repo real sensors', () => {
  it('declares the exact bounded twelve-sensor set', () => {
    const declarations = sensors();

    expect(Object.keys(declarations)).toEqual(EXPECTED_SENSORS);
    for (const declaration of Object.values(declarations)) {
      expect(declaration.watch?.length).toBeGreaterThan(0);
      expect(declaration.timeoutMs).toBeGreaterThan(0);
      expect(declaration.timeoutMs).toBeLessThanOrEqual(180_000);
      expect(declaration.guidance).toBeTruthy();
    }
    expect(declarations['todo-debt'].watch).not.toContain('**/*.{ts,tsx,js,mjs,cjs,md}');
    expect(declarations['todo-debt'].watch?.some((glob) => glob.includes('/dist/'))).toBe(false);
  });

  it('uses only local commands and never persists raw child output', async () => {
    const fake = fakeContext((command, args) => {
      if (command === 'git' && args.includes('package-lock.json')) return result(1);
      if (command === 'git') return result(0, 'src/a.ts:1:TODO one\nsrc/b.ts:2:FIXME two');
      if (command === 'npm' && args[0] === 'test') {
        return result(0, 'RAW_SECRET_SHOULD_NOT_PERSIST\nBranches : 81.25% ( 10/12 )');
      }
      if (command === 'node' && args[0] === 'harness/cli/bin/harness.js') {
        return result(0, JSON.stringify({ status: 'ok', data: { raw: 'not copied' } }));
      }
      return result(0, 'RAW_SECRET_SHOULD_NOT_PERSIST');
    });

    const readings = [];
    for (const declaration of Object.values(sensors())) {
      readings.push(await declaration.run(fake.context));
    }

    expect(fake.calls).toHaveLength(12);
    expect(fake.calls.every((call) => call.command !== 'npx')).toBe(true);
    expect(fake.calls.every((call) => !call.args.some((arg) => /^(?:install|audit|exec)$/.test(arg)))).toBe(
      true,
    );
    expect(JSON.stringify(readings)).not.toContain('RAW_SECRET_SHOULD_NOT_PERSIST');
    expect(readings.every((reading) => reading.details === undefined || reading.details.length <= 80)).toBe(
      true,
    );
  });

  it('runs both full suites together without clobbering their owned coverage artifacts', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'repo-sensors-'));
    let started = 0;
    let active = 0;
    let maxActive = 0;
    let releaseTogether = (): void => undefined;
    const together = new Promise<void>((resolve) => {
      releaseTogether = resolve;
    });
    const fake = fakeContext(async (_command, args) => {
      const reportsArg = args.find((arg) => arg.startsWith('--coverage.reportsDirectory='));
      if (reportsArg === undefined) throw new Error('missing coverage reports directory');
      const directory = reportsArg.slice('--coverage.reportsDirectory='.length);
      const sensor = directory.endsWith('/tests') ? 'tests' : 'coverage-branch';
      const score = sensor === 'tests' ? 61.25 : 83.75;
      started += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (started === 2) releaseTogether();
      await together;
      rmSync(directory, { force: true, recursive: true });
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, 'coverage-summary.json'), JSON.stringify({ sensor, score }));
      active -= 1;
      return result(0, `Branches : ${score}% ( isolated output )`);
    }, repoRoot);

    try {
      const [testsReading, coverageReading] = await Promise.all([
        sensors().tests.run(fake.context),
        sensors()['coverage-branch'].run(fake.context),
      ]);
      expect(maxActive).toBe(2);
      expect(testsReading).toMatchObject({ state: 'pass' });
      expect(coverageReading).toMatchObject({ state: 'pass', score: 83.75 });

      const directories = fake.calls.map((call) => {
        const reportsArg = call.args.find((arg) =>
          arg.startsWith('--coverage.reportsDirectory='),
        );
        expect(reportsArg).toBeDefined();
        return reportsArg?.slice('--coverage.reportsDirectory='.length) ?? '';
      });
      expect(directories).toHaveLength(2);
      expect(new Set(directories).size).toBe(2);
      expect(directories.every((directory) => isAbsolute(directory))).toBe(true);
      expect(directories.every((directory) => directory.startsWith(`${repoRoot}/.harness/temp/`))).toBe(
        true,
      );

      const artifacts = directories.map((directory) =>
        JSON.parse(readFileSync(join(directory, 'coverage-summary.json'), 'utf8')),
      ) as Array<{ sensor: string; score: number }>;
      expect(artifacts).toEqual([
        { sensor: 'tests', score: 61.25 },
        { sensor: 'coverage-branch', score: 83.75 },
      ]);
      expect(coverageReading.score).toBe(artifacts[1]?.score);
      expect(coverageReading.score).not.toBe(artifacts[0]?.score);
      expect(readFileSync(new URL('../../../.gitignore', import.meta.url), 'utf8')).toContain(
        '.harness/temp/',
      );
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
    expect(existsSync(repoRoot)).toBe(false);
  });

  it('measures branch coverage independently and degrades honestly without a summary', async () => {
    const measured = fakeContext(() => result(0, 'Branches : 79.50% ( 795/1000 )'));
    await expect(sensors()['coverage-branch'].run(measured.context)).resolves.toMatchObject({
      state: 'warn',
      score: 79.5,
      direction: 'higher',
      threshold: 80,
    });
    expect(measured.calls).toEqual([
      {
        command: 'npm',
        args: [
          'test',
          '--',
          '--coverage.reportsDirectory=/repo/.harness/temp/sensors/coverage/coverage-branch',
        ],
        timeoutMs: 60_000,
      },
    ]);

    const missing = fakeContext(() => result(0, 'tests passed without a coverage table'));
    await expect(sensors()['coverage-branch'].run(missing.context)).resolves.toMatchObject({
      state: 'skip',
      details: 'branch coverage summary unavailable',
    });
  });

  it('maps local harness envelopes without scraping their prose', async () => {
    const fake = fakeContext(() =>
      result(0, JSON.stringify({ status: 'degraded', next_action: 'RAW_ACTION' })),
    );

    const reading = await sensors()['arch-check'].run(fake.context);

    expect(reading).toMatchObject({ state: 'warn', details: 'arch-check: degraded' });
    expect(JSON.stringify(reading)).not.toContain('RAW_ACTION');
  });

  it('reports score-bearing debt and lock hygiene decisions', async () => {
    const debt = fakeContext(() =>
      result(0, Array.from({ length: 21 }, (_, index) => `src/${index}.ts:1:TODO debt`).join('\n')),
    );
    await expect(sensors()['todo-debt'].run(debt.context)).resolves.toMatchObject({
      state: 'warn',
      score: 21,
      direction: 'lower',
      threshold: 20,
    });

    const lock = fakeContext(() =>
      result(0, 'package-lock.json:4:https://packagefeedproxy.microsoft.io/npm/example'),
    );
    await expect(sensors()['lock-hygiene'].run(lock.context)).resolves.toMatchObject({
      state: 'fail',
      score: 1,
      direction: 'lower',
      threshold: 0,
    });
  });

  it('is clean under the existing Windows extension-source rules before staging', () => {
    const source = readFileSync(new URL('./extension.ts', import.meta.url), 'utf8');

    expect(scanText('.harness/extensions/repo-sensors/extension.ts', source)).toEqual([]);
  });
});
