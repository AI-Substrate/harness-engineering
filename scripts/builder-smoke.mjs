import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ErrorCodes } from '../harness/cli/dist/output/error-codes.js';

// Real CLI + real Git. Native dispatch/composition/close acceptance is a separate
// live scenario; this smoke never substitutes a scripted peer for that proof.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packedMode = process.argv.includes('--packed');
let packageRoot = repository;
let bin = join(packageRoot, 'harness/cli/bin/harness.js');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'builder-smoke-')));
const seed = join(root, 'seed');
const home = join(root, 'empty-home');
let packageIntegrity;
const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  XDG_CONFIG_HOME: join(home, 'config'),
  XDG_CACHE_HOME: join(home, 'cache'),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  HARNESS_NO_EXTENSIONS: '1',
  HARNESS_TELEMETRY_CAPTURE: '0',
};
const checks = [];
let complete = false;

function command(executable, args, cwd) {
  const result = spawnSync(executable, args, {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  assert.equal(result.signal, null, `${executable} was interrupted: ${result.signal}`);
  return result;
}

function git(cwd, ...args) {
  const result = command('git', ['-c', 'core.hooksPath=', ...args], cwd);
  assert.equal(result.status, 0, `git ${args.join(' ')}\n${result.stderr}`);
  return result.stdout.trim();
}

function cli(cwd, args, expectedExit = 0) {
  const result = command(process.execPath, [bin, ...args, '--json'], cwd);
  let envelope;
  try {
    envelope = JSON.parse(result.stdout);
  } catch {
    throw new Error(`CLI emitted no JSON envelope: ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  }
  assert.equal(result.status, expectedExit, `${args.join(' ')}\n${JSON.stringify(envelope)}\n${result.stderr}`);
  assert.equal(envelope.status, expectedExit === 0 ? 'ok' : expectedExit === 2 ? 'unconfigured' : 'error', JSON.stringify(envelope));
  return envelope;
}

function assertBootstrap(planPath) {
  const assets = join(dirname(planPath), 'assets');
  assert.ok(existsSync(planPath), 'canonical plan exists');
  assert.ok(existsSync(join(assets, 'tasks/phase-1/tasks.dd.json')), 'phase task scaffold exists');
  for (const relative of [
    'backpressure.dd.json',
    'team/coder-packet.template.md',
    'team/reviewer-packet.template.md',
    'team/model-settings.template.json',
  ]) assert.ok(existsSync(join(assets, relative)), `bootstrap includes ${relative}`);
  assert.ok(existsSync(join(assets, 'impl-guide.dd.json')), 'initialization delegates the separate guide to its owning command');
}

try {
  assert.ok(process.argv.slice(2).every((argument) => argument === '--packed'), 'only --packed is supported');
  mkdirSync(home);
  if (packedMode) {
    const npmCli = process.env.npm_execpath;
    assert.ok(npmCli, 'Run packed mode through npm run smoke:builder:packed so the local npm CLI is explicit');
    // The caller has already built the candidate. Do not let pack silently
    // rebuild another source state or mix lifecycle prose into its JSON.
    const packed = command(process.execPath, [npmCli, 'pack', '--ignore-scripts', '--json', '--pack-destination', root], repository);
    assert.equal(packed.status, 0, packed.stderr);
    const metadata = JSON.parse(packed.stdout);
    assert.equal(metadata.length, 1);
    assert.equal(metadata[0].name, '@ai-substrate/engineering-harness');
    assert.match(metadata[0].filename, /\.tgz$/);
    const tarball = resolve(root, metadata[0].filename);
    assert.equal(dirname(tarball), root, 'pack output stays in the owned fixture');
    packageIntegrity = metadata[0].integrity;
    const consumer = join(root, 'consumer');
    mkdirSync(consumer);
    writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'builder-smoke-consumer', private: true, type: 'module' }));
    // Match the repository package-smoke contract: a real consumer install,
    // without development dependencies or any global harness/skill install.
    const installed = command(process.execPath, [npmCli, 'install', '--omit=dev', '--no-audit', '--no-fund', '--package-lock=false', tarball], consumer);
    assert.equal(installed.status, 0, installed.stderr);
    packageRoot = join(consumer, 'node_modules/@ai-substrate/engineering-harness');
    bin = join(packageRoot, 'harness/cli/bin/harness.js');
    assert.ok(existsSync(bin), 'installed package contains its own CLI');
    checks.push('fresh-packed-consumer-empty-home');
  }
  mkdirSync(seed);
  git(seed, 'init', '--initial-branch=main');
  git(seed, 'config', 'user.name', 'Harness fixture');
  git(seed, 'config', 'user.email', 'harness-fixture@example.invalid');
  writeFileSync(join(seed, 'seed.txt'), 'Builder CLI smoke source\n');
  git(seed, 'add', '--', 'seed.txt');
  git(seed, 'commit', '-m', 'Seed the isolated Builder smoke');
  const sourceSha = git(seed, 'rev-parse', 'HEAD');

  const help = command(process.execPath, [bin, 'help', '--no-json'], seed);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /builder\s+architecture-enabled team delivery/);
  const briefing = cli(seed, ['instructions', 'builder']);
  assert.match(briefing.data.instructions, /assets\/impl-guide\.dd\.json/);
  assert.match(briefing.data.instructions, /full sealed source SHA/);
  const unsupportedInjection = cli(seed, ['instructions', 'builder', '--inject'], 2);
  assert.match(unsupportedInjection.next_action, /only defined for commit guidance/);
  assert.equal(existsSync(join(seed, 'AGENTS.md')), false, 'Builder briefing never injects the commit-only block');
  const docs = command(process.execPath, [bin, 'docs', 'harness-builder'], seed);
  assert.equal(docs.status, 0, docs.stderr);
  assert.match(docs.stdout, /impl-guide\.dd\.json/);
  checks.push('public-human-help', 'bundled-builder-briefing', 'commit-only-injection-refusal', 'bundled-builder-docs');
  const reservedName = cli(seed, ['new', 'builder'], 1);
  assert.equal(reservedName.error.code, ErrorCodes.SCAFFOLD_NAME_RESERVED);
  assert.match(reservedName.next_action, /\bbuilder\b/);
  assert.equal(existsSync(join(seed, '.harness/extensions/builder')), false, 'core Builder cannot be scaffolded as an extension');
  checks.push('core-builder-name-is-reserved');

  for (const kind of ['clone', 'worktree']) {
    const workspace = join(root, `managed-${kind}`);
    const args = [
      'builder', 'new', `smoke-${kind}`, '--workspace', workspace,
      '--kind', kind, '--actor', 'smoke-pm', '--base', sourceSha,
      '--phase', 'Implementation',
    ];
    const created = cli(seed, args).data;
    assert.equal(created.allocation.value.owner, 'harness');
    assert.equal(created.allocation.value.kind, kind);
    assert.equal(realpathSync(created.allocation.value.root), realpathSync(workspace));
    assert.equal(created.allocation.value.base_sha, sourceSha);
    assert.equal(git(workspace, 'rev-parse', 'HEAD'), sourceSha);
    assert.equal(lstatSync(join(workspace, '.git')).isDirectory(), kind === 'clone');
    assertBootstrap(created.plan);
    const flow = JSON.parse(readFileSync(created.flow, 'utf8'));
    assert.equal(flow.nodes.length, 12);
    assert.ok(flow.nodes.some((node) => node.id === 'impl-guide'));

    cli(workspace, ['builder', 'guide', created.plan, '--init']);
    assertBootstrap(created.plan);
    const guidePath = join(dirname(created.plan), 'assets/impl-guide.dd.json');
    const guideBytes = readFileSync(guidePath);
    cli(workspace, ['builder', 'guide', created.plan, '--init']);
    assert.deepEqual(readFileSync(guidePath), guideBytes, 'reinitialization preserves the authored guide');
    const readiness = cli(workspace, ['builder', 'ready', created.plan], 1);
    assert.equal(readiness.error.code, ErrorCodes.BUILDER_NOT_READY);
    assert.equal(readiness.error.details.status, 'not-ready');

    const coderBrief = join(dirname(created.plan), 'assets/team/coder-packet.template.md');
    writeFileSync(coderBrief, 'User-authored briefing remains authoritative.\n');
    const repeated = cli(seed, args).data;
    assert.equal(repeated.allocation.value.id, created.allocation.value.id);
    assert.equal(readFileSync(coderBrief, 'utf8'), 'User-authored briefing remains authoritative.\n');
    assert.deepEqual(readFileSync(guidePath), guideBytes);
    const escalation = cli(workspace, [
      'builder', 'adopt', created.plan, '--owner', 'external', '--actor', 'smoke-pm',
    ], 1);
    assert.equal(escalation.error.code, ErrorCodes.BUILDER_OWNERSHIP);
    assert.ok(existsSync(workspace), 'refused ownership change leaves the workspace intact');
    checks.push(`real-${kind}-scaffold`, `${kind}-guide-single-owner`, `${kind}-retry-preserves-customization`, `${kind}-unsealed-refusal`, `${kind}-ownership-refusal`);
  }

  const external = join(root, 'external');
  git(root, 'clone', '--no-hardlinks', seed, external);
  cpSync(join(packageRoot, '.dd/schemas/builder'), join(external, '.dd/schemas/builder'), { recursive: true });
  cli(external, ['plan', 'new', 'adopted', '--ordinal', '71', '--phase', 'Implementation']);
  const adoptedPlan = join(external, 'docs/plans/071-adopted/plan.dd.json');
  const authored = join(dirname(adoptedPlan), 'assets/team/coder-packet.template.md');
  mkdirSync(dirname(authored), { recursive: true });
  writeFileSync(authored, 'Existing external briefing\n');
  const beforePlan = readFileSync(adoptedPlan);
  const adopted = cli(external, ['builder', 'adopt', adoptedPlan, '--owner', 'external', '--actor', 'smoke-adopter']).data;
  assert.equal(adopted.allocation.value.owner, 'external');
  assert.equal(adopted.allocation.value.ordinal, 71);
  assert.deepEqual(readFileSync(adoptedPlan), beforePlan);
  assert.equal(readFileSync(authored, 'utf8'), 'Existing external briefing\n');
  const adoptedGuide = join(dirname(adoptedPlan), 'assets/impl-guide.dd.json');
  assert.equal(existsSync(adoptedGuide), false, 'adoption records provenance without authoring an unrelated guide');
  cli(external, ['builder', 'guide', adoptedPlan, '--init']);
  assert.ok(existsSync(adoptedGuide), 'explicit guide initialization consumes the packaged capability');
  checks.push('external-adoption-preserves-identity-and-content', 'explicit-guide-initialization');

  complete = true;
  process.stdout.write(`${JSON.stringify({ status: 'ok', mode: packedMode ? 'packed-consumer' : 'source', package_integrity: packageIntegrity, scope: 'public briefings, workspace, bootstrap, guide, readiness and ownership CLI contracts', checks }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`Builder smoke failed; isolated evidence retained at ${root}\n${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
} finally {
  if (complete) rmSync(root, { recursive: true, force: true });
}
