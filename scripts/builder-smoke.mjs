import { createHash } from 'node:crypto';
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

function compositionWarnings() {
  // Seeded import evidence isolates the real composition CLI/Git path. This
  // fixture does not claim native dispatch, review, or live lane acceptance.
  const cwd = join(root, 'composition');
  git(root, 'clone', '--no-hardlinks', seed, cwd);
  git(cwd, 'checkout', '-b', 'builder/warnings');
  git(cwd, 'config', 'user.name', 'Harness fixture');
  git(cwd, 'config', 'user.email', 'harness-fixture@example.invalid');
  cpSync(join(packageRoot, '.dd/schemas/builder'), join(cwd, '.dd/schemas/builder'), { recursive: true });
  const planDir = 'docs/plans/001-warnings';
  const planPath = `${planDir}/plan.dd.json`;
  const guidePath = `${planDir}/assets/impl-guide.dd.json`;
  const teamDir = `${planDir}/assets/team`;
  const save = (path, data) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`);
  };
  const doc = (schema, sections) => ({
    dd: { schema }, sections: Object.entries(sections).map(([name, value]) => ({ name, value })),
  });
  const digest = (path) => ({
    path, sha256: createHash('sha256').update(readFileSync(join(cwd, path))).digest('hex'),
  });
  const check = {
    id: 'vd-0001', description: 'Read the actual composed worker file',
    command: process.execPath,
    args: ['--input-type=module', '-e',
      "import{readFileSync}from'node:fs';if(readFileSync('worker.txt','utf8')!=='composed\\n')process.exit(7);console.log('composed bytes checked');"],
    cwd: '.', timeout_ms: 10000,
  };
  const unit = (id, role, paths) => ({
    id, name: id, role, responsibility: 'Warning fixture', paths, reads: [],
    interface: 'File content', depends_on: [], wave: 0, acceptance: [], proof: ['#checks/vd-0001'],
  });
  save(planPath, doc('builder/plan', {
    meta: { title: 'Warning fixture', status: 'ready' },
    summary: 'Exercise real composition checks despite ownership-map deviations.',
    acceptance_criteria: [],
  }));
  save(guidePath, doc('builder/impl-guide', {
    meta: { title: 'Warning fixture guide', plan: '../plan.dd.json#meta', version: 1 },
    architecture: { principles: 'Exercise real committed bytes', composition_root: 'worker.txt', contracts: [] },
    fan_out: { decision: 'coders', rationale: 'Seeded imported-worker fixture, not a live fleet' },
    capabilities: [],
    units: [unit('tk-0001', 'pm', ['integration.mjs']), unit('tk-0002', 'coder', ['worker.txt'])],
    baseline: { files: ['seed.txt'], proof: [], receipt: 'team/baseline.dd.json' },
    isolation: { mode: 'clone-per-coder', allocation_owner: 'external', note: 'Fixture only' },
    roles: [], checks: [check],
    composition: { owner: 'tk-0001', order: ['tk-0002'], steps: ['Check composed bytes'], proof: ['#checks/vd-0001'] },
    review: { when: 'Not exercised by this fixture', inputs: [], proof: [] },
  }));
  save('worker.txt', 'before\n');
  save(`${teamDir}/fixture-review.txt`, 'Seeded baseline reference; not an executed review.\n');
  git(cwd, 'add', '--', '.dd', 'docs', 'worker.txt');
  git(cwd, 'commit', '-m', 'Seed committed warning scenario');
  const baselineSha = git(cwd, 'rev-parse', 'HEAD');
  const recordedAt = new Date().toISOString();
  save(`${teamDir}/baseline.dd.json`, doc('builder/team', { baseline: {
    record_type: 'baseline', id: 'baseline-fixture', recorded_at: recordedAt,
    source_sha: baselineSha, plan: digest(planPath), guide: digest(guidePath),
    files: [digest('seed.txt')], checks: [], review: digest(`${teamDir}/fixture-review.txt`),
  } }));
  save(`${teamDir}/composition.dd.json`, doc('builder/team', { composition: {
    record_type: 'composition', id: 'composition-fixture', recorded_at: recordedAt,
    baseline: digest(`${teamDir}/baseline.dd.json`), integration_sha: baselineSha,
    units: [{ unit_id: 'tk-0002', peer_id: 'fixture-worker', workspace: cwd,
      commit_sha: baselineSha, packet_sha256: '0'.repeat(64), baseline_sha: baselineSha }],
    files: [], checks: [],
  } }));
  const packetPath = `${teamDir}/packet-fixture.dd.json`;
  save(packetPath, doc('builder/packet', { packet: {
    record_type: 'packet', id: 'packet-fixture', recorded_at: recordedAt, nonce: 'fixture-correlation',
    source_sha: baselineSha, unit: unit('tk-0002', 'coder', ['worker.txt']),
    plan: digest(planPath), guide: digest(guidePath),
    baseline: digest(`${teamDir}/baseline.dd.json`), allocation: digest(`${teamDir}/fixture-review.txt`),
    workspace: cwd, parent: 'fixture-pm',
    requested: { role: 'coder', harness: 'omp', model: 'fixture-only', source: {
      harness: 'guide', model: 'guide', effort: 'guide',
    } },
    forbidden: [], instructions: ['You own worker.txt. Your job is to produce the tested content.'],
  } }));
  const packetDigest = digest(packetPath).sha256;
  save('.serena/smoke-metadata', 'Runtime-created metadata is not an acknowledgement gate.\n');
  const startup = cli(cwd, ['builder', 'self-check', packetPath, '--sha256', packetDigest]).data.self_check;
  assert.deepEqual(startup.warnings, []);
  assert.equal(startup.observed.packet_sha256, packetDigest);
  assert.equal(startup.observed.root, cwd);
  assert.equal(startup.observed.source_sha, baselineSha);
  const mismatched = cli(cwd, ['builder', 'self-check', packetPath, '--sha256', '0'.repeat(64)]).data.self_check;
  assert.ok(mismatched.warnings.some((warning) => warning.code === 'packet-digest-mismatch'));
  assert.equal(mismatched.observed.packet_sha256, packetDigest);
  const wrongRoot = cli(seed, ['builder', 'self-check', join(cwd, packetPath), '--sha256', packetDigest]).data.self_check;
  assert.ok(wrongRoot.warnings.some((warning) => warning.code === 'root-mismatch'));
  assert.equal(wrongRoot.observed.root, seed);
  assert.equal(readFileSync(join(cwd, '.serena/smoke-metadata'), 'utf8'),
    'Runtime-created metadata is not an acknowledgement gate.\n');
  // The next scenario uses this fixture as the PM checkout; remove only metadata
  // this smoke created, not consumer files or the packet evidence.
  rmSync(join(cwd, '.serena'), { recursive: true });
  checks.push('advisory-self-check-with-startup-metadata', 'self-check-digest-warning', 'self-check-root-warning');
  save('worker.txt', 'composed\n');
  save('extra.txt', 'PM work outside the map\n');
  git(cwd, 'add', '--', 'worker.txt', 'extra.txt');
  git(cwd, 'commit', '-m', 'Compose across mapped ownership');
  const candidate = git(cwd, 'rev-parse', 'HEAD');
  const moved = cli(cwd, ['builder', 'self-check', packetPath, '--sha256', packetDigest]).data.self_check;
  assert.ok(moved.warnings.some((warning) => warning.code === 'source-mismatch'));
  assert.equal(moved.observed.source_sha, candidate);
  assert.equal(moved.expected.source_sha, baselineSha);
  checks.push('self-check-commit-warning');
  const result = cli(cwd, ['builder', 'compose', planPath, '--verify', candidate]);
  const warnings = [
    { file: 'extra.txt', owning_unit: 'unmapped', stage: 'verify' },
    { file: 'worker.txt', owning_unit: 'tk-0002', stage: 'verify' },
  ];
  assert.deepEqual(result.data.composition.value.warnings, warnings);
  assert.equal(result.data.composition.value.checks[0].exit_code, 0);
  assert.equal(result.data.composition.value.checks[0].stdout.trim(), 'composed bytes checked');
  const readable = readFileSync(join(cwd, teamDir, 'composition.dd.md'), 'utf8');
  assert.ok(readable.includes('worker.txt') && readable.includes('tk-0002') && readable.includes('unmapped'),
    'reviewer-visible receipt includes the files and mapped owners');
  save('worker.txt', 'broken\n');
  git(cwd, 'add', '--', 'worker.txt');
  git(cwd, 'commit', '-m', 'Keep actual proof failure visible');
  const red = cli(cwd, ['builder', 'compose', planPath, '--verify', git(cwd, 'rev-parse', 'HEAD')], 1);
  assert.equal(red.error.code, ErrorCodes.BUILDER_PROOF);
  const receipt = JSON.parse(readFileSync(join(cwd, teamDir, 'composition.dd.json'), 'utf8')).sections[0].value;
  assert.equal(receipt.checks[0].exit_code, 7);
  assert.deepEqual(receipt.warnings, warnings, 'red proof retains ownership observations');
  checks.push('real-git-composition-warnings', 'rendered-warning-owners', 'real-check-failure-with-warnings');
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

  compositionWarnings();

  complete = true;
  process.stdout.write(`${JSON.stringify({ status: 'ok', mode: packedMode ? 'packed-consumer' : 'source', package_integrity: packageIntegrity, scope: 'public briefings, workspace, bootstrap, guide, readiness and ownership CLI contracts', checks }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`Builder smoke failed; isolated evidence retained at ${root}\n${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
} finally {
  if (complete) rmSync(root, { recursive: true, force: true });
}
