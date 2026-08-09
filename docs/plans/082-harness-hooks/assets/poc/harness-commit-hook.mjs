#!/usr/bin/env node
/**
 * POC of a first-class `harness hooks` commit relay.
 *
 * WHAT IT SOLVES (all measured on this machine, 2026-08-09)
 *   A sandboxed agent shell cannot connect() to the git-ai daemon — EPERM on both
 *   sockets under Cursor's seatbelt. So a sandboxed `git commit` never reaches the
 *   daemon and NO note is written. Not a misattribution: total loss.
 *
 *   The hook runner is NOT sandboxed:
 *     shell : CURSOR_SANDBOX=seatbelt  control=REFUSED  trace2=REFUSED
 *     hook  : CURSOR_SANDBOX=unset     control=OK       trace2=OK
 *
 * HOW IT WORKS
 *   A real `git commit` trace2 stream carries NO sha — argv is literally
 *   ["git","commit","-q","-m",...]. The daemon resolves the transition from a
 *   reflog cursor it already holds (ingestion spec, ownership rule 1). So it does
 *   not need the real stream; it only needs to be TOLD a commit command ran.
 *   Proven: commit c8217d1 had no note until 6 synthetic events were sent, then a
 *   complete line-level one.
 *
 *   Therefore NOTHING about the machine's git config changes. No trace2
 *   redirection (repo-local config and includeIf are both IGNORED by trace2 —
 *   measured), no sandbox setting, no security trade.
 *
 * DETECTION — why HEAD, not the command string
 *   Matching "git commit" in the command text misses compound chains and fires on
 *   any text that merely mentions it. Instead: PRE records HEAD, POST compares. We
 *   emit ONLY when the new HEAD's first parent IS the old HEAD — a genuine new
 *   commit. A checkout, reset or rebase moves HEAD too, and emitting "commit" for
 *   those would make the daemon consume the wrong reflog entry. Failing to emit
 *   loses a note; emitting wrongly writes a FALSE one, which is worse.
 *
 * KNOWN-UNKNOWN
 *   Staleness: the daemon's cursor must predate the commit. Proven at ~2s. The
 *   ceiling is unmeasured; past it the spec says the daemon fails closed, so the
 *   failure mode is a missing note, not a wrong one.
 */

import { createConnection } from 'node:net';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const PHASE = (process.argv[2] ?? 'POST').toUpperCase();
const STATE = join(homedir(), '.harness', 'commit-hook-state.json');
const LOG = join(tmpdir(), 'harness-commit-hook.log');

const log = (m) => {
  try {
    appendFileSync(LOG, `${new Date().toISOString()} [${PHASE}] ${m}\n`);
  } catch {
    /* a hook must never break the agent it observes */
  }
};

function git(repo, args) {
  try {
    return execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function readState() {
  try {
    return JSON.parse(readFileSync(STATE, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(s) {
  try {
    mkdirSync(dirname(STATE), { recursive: true });
    writeFileSync(STATE, JSON.stringify(s, null, 2));
  } catch (e) {
    log(`state write failed: ${e.message}`);
  }
}

/** Mirrors git-ai DaemonConfig::from_internal_dir (v1.6.21). */
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

function emitCommitEvent(repo, message) {
  return new Promise((resolve) => {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.(\d{3})Z/, '.$1000Z');
    const sid = `${stamp}-Hharness-P${process.pid.toString(16).padStart(8, '0')}`;
    const iso = () => new Date().toISOString().replace('Z', '000Z');
    const events = [
      { event: 'version', sid, thread: 'main', time: iso(), evt: '4', exe: '2.51.0' },
      { event: 'start', sid, thread: 'main', time: iso(), t_abs: 0.001, argv: ['git', 'commit', '-q', '-m', message] },
      { event: 'def_repo', sid, thread: 'main', time: iso(), file: 'repository.c', line: 242, repo: 1, worktree: repo },
      { event: 'cmd_name', sid, thread: 'main', time: iso(), name: 'commit', hierarchy: 'commit' },
      { event: 'exit', sid, thread: 'main', time: iso(), t_abs: 0.02, code: 0 },
      { event: 'atexit', sid, thread: 'main', time: iso(), t_abs: 0.02, code: 0 },
    ];
    const payload = Buffer.from(events.map((e) => JSON.stringify(e)).join('\n') + '\n');
    const sock = createConnection({ path: channel('trace2') });
    sock.setTimeout(5000, () => {
      sock.destroy();
      resolve({ ok: false, detail: 'timeout' });
    });
    sock.on('error', (e) => resolve({ ok: false, detail: `${e.code}: ${e.message}` }));
    sock.on('connect', () => sock.end(payload, () => resolve({ ok: true, detail: `sid=${sid}` })));
  });
}

async function main() {
  let payload = {};
  try {
    const raw = readFileSync(0, 'utf8');
    if (raw.trim()) payload = JSON.parse(raw);
  } catch {
    /* payload is best-effort */
  }

  const repo = process.env.HARNESS_HOOK_REPO ?? payload.workspace_roots?.[0];
  if (!repo) return;

  const head = git(repo, ['rev-parse', 'HEAD']);
  if (!head) return;

  const state = readState();
  const prev = state[repo];

  if (PHASE === 'PRE') {
    state[repo] = head;
    writeState(state);
    return;
  }

  if (!prev) {
    // First sighting — record a baseline and emit nothing. Never guess on the
    // first run; a baseline we did not observe cannot prove a transition.
    state[repo] = head;
    writeState(state);
    log(`baseline ${head.slice(0, 8)} (no prior state)`);
    return;
  }

  if (prev === head) return; // nothing moved

  const parent = git(repo, ['rev-parse', `${head}^`]);
  if (parent !== prev) {
    // HEAD moved, but not by one commit on top of where we were. Checkout,
    // reset, rebase, or several commits at once. Emitting "commit" here could
    // make the daemon claim the wrong reflog entry, so record and stay silent.
    log(`HEAD ${prev.slice(0, 8)} -> ${head.slice(0, 8)} but parent=${(parent ?? 'none').slice(0, 8)} — NOT a simple commit, skipping`);
    state[repo] = head;
    writeState(state);
    return;
  }

  const message = git(repo, ['log', '-1', '--format=%s']) ?? 'commit';
  const { ok, detail } = await emitCommitEvent(repo, message);
  log(`commit ${prev.slice(0, 8)} -> ${head.slice(0, 8)} tool=${payload.tool_name ?? '?'} emit=${ok ? 'OK' : 'FAIL'} ${detail}`);
  state[repo] = head;
  writeState(state);
}

main().catch((e) => log(`FATAL ${e.stack}`));
