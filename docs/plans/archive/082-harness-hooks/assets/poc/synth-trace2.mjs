#!/usr/bin/env node
/**
 * Emit a SYNTHETIC trace2 stream to the git-ai daemon: "a git commit ran in repo X".
 *
 * THE BET
 *   The daemon's ownership rule 1 is a PRE-COMMAND REFLOG CURSOR it already holds.
 *   A real `git commit` stream carries NO sha (verified: argv is just
 *   ["git","commit","-q","-m",...]) — the daemon resolves the transition from its
 *   own cursor. So it may not need the real stream at all; it may only need to be
 *   TOLD a commit command ran, and it will consume the reflog entries itself.
 *
 *   If that holds, no trace2 redirection is needed anywhere: the hook detects the
 *   commit and synthesises this. That removes the one blocker in the relay design
 *   (repo-local trace2 config is ignored; only global/env work — both measured).
 *
 * IF IT FAILS
 *   That is the informative outcome too: it means the daemon validates the stream
 *   against something we did not fabricate, and the relay-the-real-file route is
 *   the only one. Say so rather than tuning fields until something sticks.
 *
 * Usage: node synth-trace2.mjs <repo-abs-path> [commit-message]
 */

import { createConnection } from 'node:net';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const repo = process.argv[2];
if (!repo) {
  console.error('usage: synth-trace2.mjs <repo-abs-path> [message]');
  process.exit(2);
}
const message = process.argv[3] ?? 'synthetic';

function channel(name) {
  const internal = join(homedir(), '.git-ai', 'internal');
  const digest = createHash('sha256').update(internal).digest('hex').slice(0, 16);
  if (process.platform === 'win32') return `\\\\.\\pipe\\git-ai-${digest}-${name}`;
  const direct = join(internal, 'daemon', `${name}.sock`);
  if (direct.length >= 100) {
    return join(tmpdir(), `git-ai-d-${digest}`, `${name === 'trace2' ? 'trace' : name}.sock`);
  }
  return direct;
}

// Shaped from a REAL captured commit stream, minus the events that are pure
// telemetry (regions, timings, child processes). If the daemon needs any of
// those, this fails and that is the finding.
const now = new Date();
const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.(\d{3})Z/, '.$1000Z');
const sid = `${stamp}-Hsynthet-P${process.pid.toString(16).padStart(8, '0')}`;
const iso = () => new Date().toISOString().replace('Z', '000Z');

const events = [
  { event: 'version', sid, thread: 'main', time: iso(), evt: '4', exe: '2.51.0' },
  {
    event: 'start',
    sid,
    thread: 'main',
    time: iso(),
    t_abs: 0.001,
    argv: ['git', 'commit', '-q', '-m', message],
  },
  {
    event: 'def_repo',
    sid,
    thread: 'main',
    time: iso(),
    file: 'repository.c',
    line: 242,
    repo: 1,
    worktree: repo,
  },
  { event: 'cmd_name', sid, thread: 'main', time: iso(), name: 'commit', hierarchy: 'commit' },
  { event: 'exit', sid, thread: 'main', time: iso(), t_abs: 0.02, code: 0 },
  { event: 'atexit', sid, thread: 'main', time: iso(), t_abs: 0.02, code: 0 },
];

const payload = Buffer.from(events.map((e) => JSON.stringify(e)).join('\n') + '\n');

const sock = createConnection({ path: channel('trace2') });
sock.on('error', (e) => {
  console.error(`connect failed: ${e.code} ${e.message}`);
  process.exit(1);
});
sock.on('connect', () => {
  sock.end(payload, () => {
    console.log(`sent ${events.length} synthetic events (${payload.length} bytes) sid=${sid}`);
    process.exit(0);
  });
});
