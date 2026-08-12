#!/usr/bin/env node
/**
 * POC of a first-class `harness hooks` relay, as a Cursor postToolUse hook.
 *
 * THE PROBLEM (measured, 2026-08-09, this machine)
 *   The agent's shell runs under Cursor's seatbelt sandbox, where a unix-socket
 *   connect() is treated as network and refused: EPERM on BOTH the git-ai daemon
 *   sockets. So a sandboxed `git commit` never reaches the daemon and NO note is
 *   written — not a misattribution, a total loss.
 *
 *   The hook runner is NOT sandboxed. Measured in the same minute:
 *     shell : CURSOR_SANDBOX=seatbelt  control=REFUSED  trace2=REFUSED
 *     hook  : CURSOR_SANDBOX=unset     control=OK       trace2=OK
 *
 * THE MECHANISM
 *   Point git's trace2 at a DIRECTORY the sandboxed shell can write (it can write
 *   the workspace), then have this hook stream those event files into the daemon
 *   from its unsandboxed context. The daemon cannot tell the difference — proven
 *   here on commit 6a5003c, which had no note until the relay ran and then had a
 *   complete line-level one.
 *
 * WHY NODE, AND WHY THIS IS THE PORTABLE HALF
 *   net.createConnection({path}) speaks AF_UNIX on posix AND Windows named pipes
 *   through the same API. `nc -U` has no Windows equivalent; this does. The pipe
 *   NAME is derived exactly as git-ai's DaemonConfig::from_internal_dir does.
 *
 * WHY A DIRECTORY, NOT A FILE
 *   git writes ONE FILE PER PROCESS to a directory target. A shared file would
 *   interleave concurrent git processes mid-line with no framing to recover it.
 *   Per-process files also make this idempotent BY CONSTRUCTION: stream once, then
 *   move to relayed/. No offset to track, no way to double-send.
 *
 * WHAT IS NOT YET TRUE
 *   - Windows is UNVERIFIED end to end. The pipe path is derived from source, not
 *     observed, and nobody has confirmed Cursor's hook runner is unsandboxed there.
 *   - trace2 config is resolved BEFORE repo discovery, so repo-local .git/config is
 *     IGNORED (measured). Only global/system config or GIT_TRACE2_EVENT work. Who
 *     sets that, and at what scope, is the open design question this POC does not
 *     answer.
 */

import { createHash } from 'node:crypto';
import { createConnection } from 'node:net';
import { appendFileSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const LOG = join(tmpdir(), 'harness-trace2-hook.log');
const WIN = process.platform === 'win32';

function log(msg) {
  try {
    appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* a hook must never fail loudly enough to break the agent */
  }
}

/** Mirrors git-ai DaemonConfig::from_internal_dir (v1.6.21). */
function daemonChannel(name) {
  const internal = join(homedir(), '.git-ai', 'internal');
  const digest = createHash('sha256').update(internal).digest('hex').slice(0, 16);
  if (WIN) return `\\\\.\\pipe\\git-ai-${digest}-${name}`;
  const direct = join(internal, 'daemon', `${name}.sock`);
  // git-ai relocates when the path would exceed the sun_path limit.
  if (direct.length >= 100) {
    const short = name === 'trace2' ? 'trace' : name;
    return join(tmpdir(), `git-ai-d-${digest}`, `${short}.sock`);
  }
  return direct;
}

function send(channel, buf) {
  return new Promise((resolve) => {
    const sock = createConnection({ path: channel });
    const done = (ok, detail) => {
      sock.destroy();
      resolve({ ok, detail });
    };
    sock.setTimeout(5000, () => done(false, 'timeout'));
    sock.on('error', (e) => done(false, `${e.code ?? e.name}: ${e.message}`));
    sock.on('connect', () => {
      // Half-close so the daemon sees EOF rather than waiting on a socket we are
      // about to drop.
      sock.end(buf, () => done(true, `${buf.length} bytes`));
    });
  });
}

async function main() {
  // Cursor delivers the hook payload on stdin. workspace_roots[0] tells us which
  // checkout this tool call belongs to — we do not guess from cwd, because the
  // hook runner's cwd is not the agent's.
  let payload = {};
  try {
    const raw = readFileSync(0, 'utf8');
    if (raw.trim()) payload = JSON.parse(raw);
  } catch (e) {
    log(`payload unreadable: ${e.message}`);
  }

  const root = process.env.HARNESS_TRACE2_ROOT ?? payload.workspace_roots?.[0];
  if (!root) {
    log('SKIP no workspace root in payload');
    return;
  }

  const events = join(root, '.trace2-events');
  let pending;
  try {
    pending = readdirSync(events)
      .map((n) => join(events, n))
      .filter((p) => statSync(p).isFile())
      .sort();
  } catch {
    return; // no events dir yet — nothing to relay, and that is not an error
  }
  if (pending.length === 0) return;

  const channel = daemonChannel('trace2');
  const done = join(events, 'relayed');
  mkdirSync(done, { recursive: true });

  for (const file of pending) {
    const buf = readFileSync(file);
    if (buf.length === 0) continue;
    const { ok, detail } = await send(channel, buf);
    if (ok) {
      // Move ONLY on success. A failed relay stays pending for the next hook —
      // losing a commit event is worse than sending one twice.
      renameSync(file, join(done, file.split(/[\\/]/).pop()));
      log(`RELAYED ${file} — ${detail} (tool=${payload.tool_name ?? '?'})`);
    } else {
      log(`FAILED  ${file} — ${detail}`);
    }
  }
}

main().catch((e) => log(`FATAL ${e.stack}`));
