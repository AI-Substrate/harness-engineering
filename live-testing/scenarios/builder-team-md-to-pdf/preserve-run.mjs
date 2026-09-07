import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { report: { type: 'string' }, out: { type: 'string' } }, strict: true });
if (!values.report || !values.out) throw new Error('--report <report.json> and --out <fresh retained directory> are required');
const reportPath = resolve(values.report);
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const evidence = report.provenance?.evidence;
if (evidence?.source !== 'flowspace' || !Array.isArray(evidence.peers) || !evidence.peers.length) throw new Error('report has no native peer/root provenance');
const out = resolve(values.out);
if (existsSync(out)) throw new Error('retention destination already exists');
for (const peer of evidence.peers) {
  const root = resolve(peer.root);
  if (out === root || out.startsWith(`${root}/`)) throw new Error('retained output must be outside every disposable root');
}
mkdirSync(out, { recursive: true });
cpSync(dirname(reportPath), join(out, 'evaluation'), { recursive: true, dereference: true });
const roots = [...new Set(evidence.peers.map((peer) => resolve(peer.root)))];
const archives = [];
for (let index = 0; index < roots.length; index++) {
  const root = roots[index];
  const archive = join(out, `workspace-${index}.tar.gz`);
  const bundle = join(out, `history-${index}.bundle`);
  execFileSync('git', ['bundle', 'create', bundle, '--all'], { cwd: root, stdio: 'pipe' });
  execFileSync('tar', ['-czf', archive, '--exclude=.git', '-C', root, '.'], { stdio: 'pipe' });
  // A readable archive and Git bundle, not a narrated preservation claim.
  execFileSync('tar', ['-tzf', archive], { stdio: 'pipe' });
  execFileSync('git', ['bundle', 'verify', bundle], { cwd: root, stdio: 'pipe' });
  archives.push({ root, archive, bundle });
}
const files = [];
function visit(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) visit(path);
    else files.push({ path: path.slice(out.length + 1), sha256: createHash('sha256').update(readFileSync(path)).digest('hex') });
  }
}
visit(out);
const receipt = { version: 1, report: reportPath, archives, files, complete: true };
writeFileSync(join(out, 'preservation.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt));
