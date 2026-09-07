import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../../../harness/cli/src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../harness/cli/src/adapters/env/fake-env.js';
import { FakeExec } from '../../../harness/cli/src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../../harness/cli/src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../../harness/cli/src/adapters/git/fake-git.js';
import { buildVerbContext } from '../../../harness/cli/src/services/extensions/verb-context.js';
import flowEval from './extension.js';
import { loadScenario } from './scenario.js';
import { pdfCapability } from './pdf-capability.js';
import { renderMarkdownFromReportJson } from './report.js';
import type { ResolveContext } from './resolvers.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const scenario = join(repo, 'live-testing/scenarios/builder-team-md-to-pdf');
const temporary: string[] = [];
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('Builder cohort source and packaging', () => {
  it('loads the new versioned bundle without altering historical bundles', () => {
    const disk = { exists: existsSync, readText: (path: string) => existsSync(path) ? readFileSync(path, 'utf8') : null };
    expect(loadScenario('builder-team-md-to-pdf', disk, join(repo, 'live-testing/scenarios')).ok).toBe(true);
    for (const slug of ['md-to-pdf', 'md-to-pdf-flow', 'dd-native-builder']) expect(loadScenario(slug, disk, join(repo, 'live-testing/scenarios')).ok).toBe(true);
  });
  it('prepares from local product bytes and boots an isolated clone without exposing evaluator files', () => {
    const temp = mkdtempSync(join(tmpdir(), 'builder-consumer-')); temporary.push(temp);
    const staged = join(temp, 'stage');
    const sources: Record<string, string> = {
      'package/package.json': JSON.stringify({ name: '@ai-substrate/engineering-harness', version: '1.0.0', type: 'module', dependencies: {} }),
      'package/harness/cli/bin/harness.js': "console.log('local-packaged-cli');",
      'package/.dd/schemas/builder/plan/schema.json': JSON.stringify({ $id: 'builder/plan', type: 'object' }),
    };
    for (const name of ['builder', 'eng-harness-flow', 'eng-harness-0-harnessability-assessment']) sources[`package/skills/${name}/SKILL.md`] = `# ${name} locally packaged source`;
    for (const [path, text] of Object.entries(sources)) { mkdirSync(dirname(join(staged, path)), { recursive: true }); writeFileSync(join(staged, path), text); }
    const archive = join(temp, 'product.tgz');
    execFileSync('tar', ['-czf', archive, '-C', staged, ...Object.keys(sources)]);
    const out = join(temp, 'consumer');
    const retained = join(temp, 'retained');
    const preparation = JSON.parse(execFileSync(process.execPath, [join(scenario, 'prepare-consumer.mjs'), '--package', archive,
      '--dependencies', join(temp, 'dependencies'), '--out', out, '--evidence', retained], { encoding: 'utf8' }));
    expect(preparation.base_sha).toMatch(/^[a-f0-9]{40}$/);
    expect(preparation.package_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(readFileSync(join(out, 'node_modules/@ai-substrate/engineering-harness/.dd/schemas/builder/plan/schema.json'), 'utf8')).toBe(sources['package/.dd/schemas/builder/plan/schema.json']);
    expect(existsSync(join(out, 'live-testing'))).toBe(false);
    expect(existsSync(join(out, 'docs/plans/098-builder-team-lifecycle'))).toBe(false);
    expect(readdirSync(join(out, '.claude/skills')).sort()).toEqual(['builder', 'eng-harness-0-harnessability-assessment', 'eng-harness-flow']);
    const clone = join(temp, 'worker');
    execFileSync('git', ['clone', '--quiet', out, clone]);
    expect(existsSync(join(clone, 'node_modules'))).toBe(false);
    execFileSync(process.execPath, [join(clone, 'setup.mjs')]);
    expect(execFileSync(process.execPath, [join(clone, 'node_modules/.bin/harness')], { encoding: 'utf8' }).trim()).toBe('local-packaged-cli');
    expect(() => execFileSync(process.execPath, [join(scenario, 'prepare-consumer.mjs'), '--package', archive,
      '--dependencies', join(temp, 'dependencies'), '--out', out, '--evidence', retained], { stdio: 'pipe' })).toThrow();
    // Accept the shipped schema bytes, never evaluator/private files in or beside that namespace.
    for (const [index, forbidden] of ['package/.dd/schemas/builder/plan/private-notes.md', 'package/live-testing/scenarios/private/assertions.json'].entries()) {
      mkdirSync(dirname(join(staged, forbidden)), { recursive: true });
      writeFileSync(join(staged, forbidden), 'private evaluation material');
      const forbiddenArchive = join(temp, `forbidden-${index}.tgz`);
      execFileSync('tar', ['-czf', forbiddenArchive, '-C', staged, ...Object.keys(sources), forbidden]);
      const blockedOut = join(temp, `blocked-consumer-${index}`);
      const blockedEvidence = join(temp, `blocked-evidence-${index}`);
      expect(() => execFileSync(process.execPath, [join(scenario, 'prepare-consumer.mjs'), '--package', forbiddenArchive,
        '--dependencies', join(temp, 'dependencies'), '--out', blockedOut, '--evidence', blockedEvidence], { stdio: 'pipe' })).toThrow('archive contains non-product paths');
      expect(existsSync(blockedOut)).toBe(false);
      expect(existsSync(blockedEvidence)).toBe(false);
    }
  });
  it('preserves native source/provenance and unknown telemetry through report, ledger and rerender', async () => {
    const fs = new FakeFs({
      '/evaluator/live-testing/scenarios/native/scenario.json': JSON.stringify({ slug: 'native', title: 'Native', task: 'task', base: { repo: '.', ref: 'a'.repeat(40) },
        subject: { harness: 'omp', model: 'configured-model' }, flow: { mode: 'builder', stages: [] }, prompts: { subject: 's.md', orchestrator: 'o.md' }, assertions: 'assertions.json' }),
      '/evaluator/live-testing/scenarios/native/assertions.json': JSON.stringify({ scenario: 'native', assertions: [{ id: 'N', type: 'native-evidence-complete', source: 'native', params: {} }] }),
      '/evaluator/harness/cli/bin/harness.js': '',
    });
    const exec = new FakeExec({ 'pij-rs list --json': { code: 0, stdout: JSON.stringify({ ok: true, data: { seats: [] } }) } });
    const ctx = buildVerbContext({ fs, fsWrite: fs, exec, env: new FakeEnv(), git: new FakeGit({ isRepo: true, branch: 'test' }), clock: new FakeClock('2026-09-05T00:00:00Z') },
      { cwd: '/evaluator', args: { action: 'score' }, options: { scenario: 'native', session: 'pij-subject', worktree: '/subject', evidenceSource: 'native' } });
    const output = await flowEval.run(ctx);
    expect(output.status).toBe('ok');
    expect((output.data as any).telemetry).toEqual({ available: false, segments: null });
    expect(exec.calls.some((call) => call.args[0] === 'telemetry')).toBe(false);
    const reportPath = fs.writes.find((path) => path.endsWith('/report.json'))!;
    const report = JSON.parse(fs.readText(reportPath)!);
    expect(report.provenance.evidence.source).toBe('flowspace');
    expect(report.deterministic.results[0]).toMatchObject({ source: 'native', status: 'unknown' });
    expect(renderMarkdownFromReportJson(report)).toMatchObject({ ok: true, md: expect.stringContaining('native turns are not telemetry segments') });
    const ledger = JSON.parse(fs.readText('/evaluator/.harness/live-testing/native/ledger.jsonl')!.trim());
    expect(ledger.provenance.evidence.source).toBe('flowspace');
    expect(ledger.telemetry_summary).toBeNull();
    expect(ledger.duration_s).toBeNull();
  });
});

describe('independent artifact lane', () => {
  it.each([
    [{ verdict: 'fail', reason: 'canned PDF', outputs: [] }, 1, 'fail'],
    [{ verdict: 'unknown', reason: 'missing inspector', outputs: [] }, 2, 'unknown'],
    [{ verdict: 'pass', reason: 'one output', outputs: [{}] }, 0, 'fail'],
    [{ verdict: 'pass', reason: 'fresh inputs', outputs: [{}, {}], executed_files: ['/subject/render.ts'] }, 0, 'pass'],
  ] as const)('does not turn missing or nonworking output into process success', async (report, code, expected) => {
    const rc: ResolveContext = { evidence: null, worktree: '/subject', fs: new FakeFs(), pdfProbe: { script: '/trusted/pdf-probe.py', output: '/retained/pdf' },
      exec: async () => ({ ok: code === 0, code, stdout: JSON.stringify(report), stderr: '' }) };
    expect((await pdfCapability(rc)).verdict).toBe(expected);
    if (expected === 'pass') expect(rc.capabilityFiles).toEqual(['/subject/render.ts']);
  });
});
