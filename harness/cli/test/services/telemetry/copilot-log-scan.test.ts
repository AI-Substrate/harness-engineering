import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import {
  copilotAdapter,
  copilotEventsPath,
  copilotLogsDir,
} from '../../../src/services/telemetry/adapters/copilot-adapter.js';
import type { HarnessSource } from '../../../src/services/telemetry/adapters/harness-adapter.js';

/**
 * Regression guard — `findProcessLog` must not read the whole log directory.
 *
 * WHY THIS EXISTS (measured, 2026-08-06). The original implementation looped over
 * every `process-*.log` in `~/.copilot/logs`, called `fs.readText` on each, and
 * substring-matched the session id. On a working developer machine that directory
 * was **15.25 GB across 50 files** (largest 3.23 GB), so a single `harness docs`
 * took **8.9 s** against **0.11 s** with telemetry disabled — a ~45x tax paid by
 * EVERY harness command from EVERY Copilot seat, including every `git commit`
 * (the post-commit hook shells `harness`). A CPU profile attributed 8.3 s of 9.1 s
 * to `readFileUtf8`/`readFileSync` under `findProcessLog`.
 *
 * Worse, 11.79 GB of those 15.25 GB sat in files ABOVE V8's ~512 MiB string
 * ceiling: `readFileSync(path, 'utf8')` throws `ERR_STRING_TOO_LONG` there and the
 * port swallows it to `null`, so that I/O bought a guaranteed miss. (Verified
 * directly against an 812 MB log: `THREW: ERR_STRING_TOO_LONG`.)
 *
 * The guard therefore pins three behaviours, stated as bytes materialised rather
 * than as any particular port call, so it survives a reasonable reimplementation:
 *  1. the right log is still found (token math unchanged);
 *  2. a log above the string ceiling is never materialised — it costs a stat;
 *  3. the scan stops at the newest match instead of draining the directory;
 *  4. a second extraction reuses the resolution instead of re-scanning.
 */

const REPO = '/repo';
const HOME = '/home/u';
const SESSION = 'sess-copilot-1';
const DIR = copilotLogsDir(HOME);

const EVENTS = readFileSync(new URL('./fixtures/copilot-events.jsonl', import.meta.url), 'utf8');
// Fixture is named `.txt` not `.log` because the repo .gitignore excludes `*.log`.
const PROCLOG = readFileSync(
  new URL('./fixtures/copilot-process-log.txt', import.meta.url),
  'utf8',
);

/** Real names+sizes observed in the 15.25 GB directory that motivated this guard. */
const HUGE = 'process-1785550658907-44962.log';
const STALE = 'process-1785282806510-9201.log';
const LIVE = 'process-1785977931087-34197.log';
const HUGE_BYTES = 3_391_000_000; // 3.23 GB — declared, never allocated.

/** A decoy carrying a DIFFERENT session id, so a match on it would be a real bug. */
const OTHER_SESSION_LOG = PROCLOG.split(SESSION).join('sess-someone-else');

const WINDOW = { since: 'session-start' as const, from: 0, to: 99 };

/**
 * readdir deliberately yields the monsters FIRST, so directory order alone cannot
 * make the implementation look well-behaved; only ordering by recency can.
 */
function logsFs(): FakeFs {
  const fs = new FakeFs(
    {
      [copilotEventsPath(HOME, SESSION)]: EVENTS,
      [`${DIR}/${HUGE}`]: 'placeholder — the declared size is what matters',
      [`${DIR}/${STALE}`]: OTHER_SESSION_LOG,
      [`${DIR}/${LIVE}`]: PROCLOG,
      [`${DIR}/unrelated.txt`]: 'noise',
    },
    { [DIR]: [HUGE, STALE, LIVE, 'unrelated.txt'] },
  );
  fs.reportedSizes.set(`${DIR}/${HUGE}`, HUGE_BYTES);
  fs.setMtime(`${DIR}/${HUGE}`, 1_000);
  fs.setMtime(`${DIR}/${STALE}`, 2_000);
  fs.setMtime(`${DIR}/${LIVE}`, 3_000); // the session Copilot is still appending to
  return fs;
}

function source(fs: FakeFs): HarnessSource {
  return {
    env: new FakeEnv({ COPILOT_AGENT_SESSION_ID: SESSION }, HOME),
    fs,
    repoRoot: REPO,
    harness: 'copilot-cli',
  };
}

/**
 * Every process log whose bytes were turned into a JS string, by whichever port
 * call. Asserting on this — not on `readText` specifically — keeps the guard about
 * the cost that actually hurt (materialising gigabytes) rather than about an API.
 */
function materialised(fs: FakeFs): string[] {
  return [
    ...fs.reads.filter((path) => path.includes('/process-')),
    ...fs.noFollowOps
      .filter((op) => op.op === 'read' && op.path.includes('/process-'))
      .map((op) => op.path),
  ];
}

describe('copilot process-log lookup is bounded (regression guard)', () => {
  it('still resolves THIS session log — token math is unchanged', () => {
    const fs = logsFs();
    const caps = copilotAdapter.extract({ ...source(fs), window: WINDOW });
    // Same hand-derived total the adapter's own fixture test pins.
    expect(caps.tokens?.total).toBe(260);
    expect(caps.models).toEqual({ 'claude-opus-4-8': { turns: 2, output_tokens: 95 } });
  });

  it('never materialises a log above the V8 string ceiling — it can only ever miss', () => {
    const fs = logsFs();
    copilotAdapter.extract({ ...source(fs), window: WINDOW });
    expect(materialised(fs)).not.toContain(`${DIR}/${HUGE}`);
  });

  it('stops at the newest matching log instead of draining the directory', () => {
    const fs = logsFs();
    copilotAdapter.extract({ ...source(fs), window: WINDOW });
    expect(materialised(fs)).toEqual([`${DIR}/${LIVE}`]);
  });

  it('reuses the resolution on a second extraction rather than re-scanning', () => {
    const fs = logsFs();
    const ctx = { ...source(fs), window: WINDOW };
    copilotAdapter.extract(ctx);
    const afterFirst = materialised(fs).length;
    copilotAdapter.extract(ctx);
    expect(materialised(fs).length).toBe(afterFirst);
  });

  it('does not let one session id resolve to another session log', () => {
    const fs = new FakeFs(
      {
        [copilotEventsPath(HOME, SESSION)]: EVENTS,
        [`${DIR}/${STALE}`]: OTHER_SESSION_LOG,
      },
      { [DIR]: [STALE] },
    );
    fs.setMtime(`${DIR}/${STALE}`, 2_000);
    const caps = copilotAdapter.extract({ ...source(fs), window: WINDOW });
    expect(caps.tokens ?? null).toBeNull();
  });
});
