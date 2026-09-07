import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

// Local files only: no installer, registry request, global update, or source checkout copy.
const { values } = parseArgs({ options: {
  package: { type: 'string' }, dependencies: { type: 'string' }, out: { type: 'string' }, evidence: { type: 'string' },
}, strict: true });
for (const key of ['package', 'dependencies', 'out', 'evidence']) if (!values[key]) throw new Error(`--${key} is required`);
const archive = resolve(values.package);
const dependencies = resolve(values.dependencies);
const out = resolve(values.out);
const evidence = resolve(values.evidence);
if (existsSync(out) || existsSync(evidence)) throw new Error('consumer and evidence destinations must be fresh');
if (evidence.startsWith(`${out}/`) || out.startsWith(`${evidence}/`)) throw new Error('consumer and retained evidence must be separate sibling roots');
const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
if (entries.some((entry) => !entry.startsWith('package/') || entry.split('/').includes('..') ||
  !/^package\/(?:package\.json|LICENSE|README\.md|harness\/cli\/(?:bin|dist)\/|skills\/)/.test(entry))) throw new Error('archive contains non-product paths');
mkdirSync(out, { recursive: true });
mkdirSync(evidence, { recursive: true });
const product = join(out, 'node_modules/@ai-substrate/engineering-harness');
mkdirSync(product, { recursive: true });
execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', product]);
const copied = new Map();
function copyDependency(name, from) {
  let search = from;
  let source;
  while (search !== dirname(search)) {
    const candidate = join(search, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) { source = candidate; break; }
    search = dirname(search);
  }
  source ??= join(dependencies, name);
  if (!existsSync(join(source, 'package.json'))) throw new Error(`missing locally installed runtime dependency ${name}`);
  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
  if (copied.has(name)) {
    if (copied.get(name) !== manifest.version) throw new Error(`conflicting local dependency versions for ${name}; supply a compatible dependency tree`);
    return;
  }
  const target = join(out, 'node_modules', name);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(realpathSync(source), target, { recursive: true, dereference: true });
  copied.set(name, manifest.version);
  for (const child of Object.keys(manifest.dependencies ?? {})) copyDependency(child, realpathSync(source));
  for (const child of Object.keys(manifest.optionalDependencies ?? {})) {
    if (existsSync(join(dependencies, child, 'package.json'))) copyDependency(child, realpathSync(source));
  }
  const bins = typeof manifest.bin === 'string' ? { [name.split('/').pop()]: manifest.bin } : manifest.bin ?? {};
  for (const [bin, path] of Object.entries(bins)) {
    mkdirSync(join(out, 'node_modules/.bin'), { recursive: true });
    const link = join(out, 'node_modules/.bin', bin);
    if (!existsSync(link)) symlinkSync(relative(dirname(link), join(target, path)), link);
  }
}
const manifest = JSON.parse(readFileSync(join(product, 'package.json'), 'utf8'));
for (const dependency of Object.keys(manifest.dependencies ?? {})) copyDependency(dependency, dirname(dependencies));
mkdirSync(join(out, 'node_modules/.bin'), { recursive: true });
symlinkSync('../@ai-substrate/engineering-harness/harness/cli/bin/harness.js', join(out, 'node_modules/.bin/harness'));
const installedSkills = [];
for (const skill of ['builder', 'eng-harness-flow', 'eng-harness-0-harnessability-assessment']) {
  const source = join(product, 'skills', skill);
  if (!existsSync(join(source, 'SKILL.md'))) throw new Error(`packaged source skill missing: ${skill}`);
  for (const directory of ['.claude/skills', '.agents/skills']) {
    const target = join(out, directory, skill);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target, { recursive: true, dereference: true });
  }
  installedSkills.push(skill);
}
const runtime = join(evidence, 'runtime');
cpSync(join(out, 'node_modules'), runtime, { recursive: true, verbatimSymlinks: true });
writeFileSync(join(out, 'setup.mjs'), `import { cpSync, existsSync } from 'node:fs';\nimport { fileURLToPath } from 'node:url';\nconst target = fileURLToPath(new URL('./node_modules', import.meta.url));\nif (!existsSync(target)) cpSync(${JSON.stringify(runtime)}, target, { recursive: true, verbatimSymlinks: true });\n`);
writeFileSync(join(out, 'package.json'), JSON.stringify({ name: 'document-workbench', private: true, type: 'module',
  scripts: { setup: 'node setup.mjs', harness: 'node_modules/.bin/harness' } }, null, 2));
writeFileSync(join(out, '.gitignore'), 'node_modules/\nscratch/\n.harness/live-testing/\n');
// Only operating instructions, never assertions, runbook, or evaluation-plan notes.
writeFileSync(join(out, 'AGENTS.md'), '# Operating this repository\n\nOn a fresh isolated checkout, run `node setup.mjs` to copy the pinned local runtime into this checkout (no network or global install). Use `node_modules/.bin/harness` as the engineering front door and `node_modules/.bin/ddocs` for deterministic documents. Builder and engineering-harness skills are installed locally under `.claude/skills` and `.agents/skills`. Do not install globally.\n');
for (const args of [['init'], ['config', 'user.name', 'Evaluation fixture'], ['config', 'user.email', 'fixture@example.invalid'], ['add', '--all'], ['commit', '-m', 'Seed isolated document workbench']]) execFileSync('git', args, { cwd: out, stdio: 'pipe' });
const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: out, encoding: 'utf8' }).trim();
cpSync(archive, join(evidence, 'product.tgz'));
const receipt = { version: 1, root: out, base_sha: base, package_sha256: createHash('sha256').update(readFileSync(archive)).digest('hex'),
  package_version: manifest.version, dependencies: Object.fromEntries(copied), installed_skills: installedSkills,
  native_evidence_positive_control: 'required before subject dispatch; recorded by evaluator, not this fixture' };
writeFileSync(join(evidence, 'preparation.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt));
