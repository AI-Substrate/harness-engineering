import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const root = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Usage: proof-recipe.mjs <new-output-directory>');
const source = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' });
assert.equal(source.status, 0, 'The example needs its source Git checkout for provenance');
const sourceSha = source.stdout.trim();
const sourceFiles = ['contracts.mjs', 'parser.mjs', 'renderer.mjs', 'compose.mjs', 'cli.mjs', 'verify.mjs'];
const sourceDigests = Object.fromEntries(sourceFiles.map((file) => [file, createHash('sha256').update(readFileSync(join(here, file))).digest('hex')]));
// No existing corpus is ever overwritten. A failure leaves its evidence available for inspection.
mkdirSync(root);
const receipts = [];
function run(command, args, expected = 0) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 30000 });
  const receipt = { command, args, cwd: root, source_sha: sourceSha, source_digests: sourceDigests, exit_code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', recorded_at: new Date().toISOString() };
  receipts.push(receipt);
  writeFileSync(join(root, 'receipts.json'), `${JSON.stringify(receipts, null, 2)}\n`);
  assert.ifError(result.error);
  assert.equal(result.status, expected, JSON.stringify(receipt));
  return receipt;
}
const dd = (...args) => run(process.execPath, [join(repo, 'node_modules/.bin/ddocs'), ...args, '--json']);
function seed(path, schema, sections) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `${JSON.stringify({ dd: { schema }, sections: Object.entries(sections).map(([name, value]) => ({ name, value })), references: [] }, null, 2)}\n`);
}
function section(path, name) {
  return JSON.parse(readFileSync(join(root, path), 'utf8')).sections.find((entry) => entry.name === name).value;
}
function append(path, sectionName, value, prefix) {
  dd('add', `${path}#${sectionName}`, JSON.stringify(value), '--mint', prefix);
  return section(path, sectionName).at(-1).id;
}

for (const name of ['plan', 'backpressure', 'execution-log']) {
  const destination = join(root, '.dd/schemas/builder', name, 'schema.json');
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(join(repo, '.dd/schemas/builder', name, 'schema.json'), destination);
}
const plan = 'plan.dd.json';
const pressure = 'assets/backpressure.dd.json';
const log = 'assets/execution-log.dd.json';
const tasks = 'assets/tasks/phase-1/tasks.dd.json';
seed(plan, 'builder/plan', { meta: { title: 'Executable proof recipe', status: 'ready' }, summary: 'Exercise real injected conversion and link its observed proof.', acceptance_criteria: [], phases: [] });
seed(tasks, 'builder/plan', { meta: { title: 'Recipe implementation', status: 'ready' }, summary: 'Prove the assembled conversion.', tasks: [], done_when: {} });
mkdirSync(join(root, 'assets'), { recursive: true });
for (const [name, path] of [['backpressure', pressure], ['execution-log', log]]) copyFileSync(join(here, '../templates', `${name}.template.json`), join(root, path));
// These seed meta links are plan-relative for their normal assets/ location.
const phase = append(plan, 'phases', { title: 'Implementation', state: 'unchecked', tasks: 'assets/tasks/phase-1/tasks.dd.json#tasks' }, 'ph');
const ac = append(plan, 'acceptance_criteria', { claim: 'The composed CLI normalizes lines and escapes output without losing UTF-8 bytes.', state: 'unchecked' }, 'ac');
const bp = append(pressure, 'rows', { criterion: ac, phase, mode: 'EXISTS', tier: 'computational', proof: 'RUN: node skills/builder/examples/verify.mjs --case composition', state: 'unchecked', probe: 'The shipped injected services and real filesystem CLI scenario.' }, 'bp');
const task = append(tasks, 'tasks', { title: 'Exercise conversion', phase, state: 'unchecked', satisfies: [`../../../plan.dd.json#acceptance_criteria/${ac}`] }, 'tk');
dd('set', `${tasks}#done_when/${task}`, '[]', '--value-json');
dd('add', `${tasks}#done_when/${task}`, JSON.stringify({ assertion: 'Real CLI output is escaped and byte count is correct.', state: 'unchecked', pressure: `../../backpressure.dd.json#rows/${bp}` }), '--mint', 'dw');
const assertion = section(tasks, 'done_when')[task][0].id;
dd('set', `${tasks}#tasks/${task}/done`, `tasks.dd.json#done_when/${task}`);
dd('set', `${plan}#meta/backpressure`, 'assets/backpressure.dd.json#rows');
dd('set', `${plan}#acceptance_criteria/${ac}/pressure`, `assets/backpressure.dd.json#rows/${bp}`);
dd('set', `${pressure}#meta/certainty`, 'Confident');
dd('set', `${pressure}#meta/basis_sha`, createHash('sha256').update(readFileSync(join(root, plan))).digest('hex'));
const evidence = run(process.execPath, [join(here, 'verify.mjs'), '--case', 'composition']);
const entry = append(log, 'entries', { at: evidence.recorded_at, text: `${evidence.command} ${evidence.args.join(' ')}; cwd=${root}; exit=${evidence.exit_code}; receipts.json; ${evidence.stdout.trim()}`, links: [`../plan.dd.json#acceptance_criteria/${ac}`, `backpressure.dd.json#rows/${bp}`] }, 'lg');
dd('set', `${plan}#acceptance_criteria/${ac}/proven_by`, `assets/execution-log.dd.json#entries/${entry}`);
dd('set', `${pressure}#rows/${bp}/receipt`, `execution-log.dd.json#entries/${entry}`);
dd('set', `${pressure}#rows/${bp}/state`, 'checked');
dd('set', `${tasks}#done_when/${task}/${assertion}/proven_by`, `../../execution-log.dd.json#entries/${entry}`);
dd('set', `${tasks}#done_when/${task}/${assertion}/state`, 'checked');
dd('set', `${tasks}#tasks/${task}/state`, 'checked');
dd('set', `${plan}#phases/${phase}/state`, 'checked');
dd('set', `${plan}#acceptance_criteria/${ac}/state`, 'checked');
dd('set', `${pressure}#meta/certainty`, 'Proven');
// Factual progress changed bytes; refresh the surveyed binding only after inspecting the final facts.
assert.equal(section(plan, 'acceptance_criteria')[0].claim, 'The composed CLI normalizes lines and escapes output without losing UTF-8 bytes.');
dd('set', `${pressure}#meta/basis_sha`, createHash('sha256').update(readFileSync(join(root, plan))).digest('hex'));
for (const path of [plan, pressure, tasks, log]) {
  dd('validate', path);
  dd('build', path, '--check');
}
for (const address of [`${plan}#acceptance_criteria/${ac}/pressure`, `${plan}#acceptance_criteria/${ac}/proven_by`, `${tasks}#done_when/${task}/${assertion}/pressure`]) dd('get', address);
assert.equal(section(plan, 'acceptance_criteria')[0].proven_by, `assets/execution-log.dd.json#entries/${entry}`);
assert.equal(section(tasks, 'done_when')[task][0].pressure, `../../backpressure.dd.json#rows/${bp}`);
const beforeRefusal = readFileSync(join(root, pressure), 'utf8');
run(process.execPath, [join(repo, 'node_modules/.bin/ddocs'), 'set', `${pressure}#meta/certainty`, 'Strong', '--json'], 1);
assert.equal(readFileSync(join(root, pressure), 'utf8'), beforeRefusal, 'A schema-refused mutation must not alter the survey');
console.log(JSON.stringify({ status: 'passed', root, criteria: [ac], pressure: [bp], proven_by: [entry], receipts: join(root, 'receipts.json'), boundary: 'Recipe and actual example behavior only; not live peer/reviewer acceptance.' }));
