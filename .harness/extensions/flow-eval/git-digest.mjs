import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const [root, sha, path] = process.argv.slice(2);
if (!root || !/^[a-f0-9]{40}$/.test(sha ?? '') || !path) process.exit(2);
const result = spawnSync('git', ['show', `${sha}:${path}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
if (result.status !== 0 || result.error) {
  process.stderr.write(String(result.error ?? result.stderr));
  process.exit(result.status ?? 1);
}
process.stdout.write(JSON.stringify({ sha256: createHash('sha256').update(result.stdout).digest('hex') }));
