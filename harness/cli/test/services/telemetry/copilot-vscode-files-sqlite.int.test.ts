import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { NodeDb } from '../../../src/adapters/db/node-db.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import {
  copilotVscodeAdapter,
  copilotVscodeStoreDbPaths,
  copilotVscodeUserRoots,
} from '../../../src/services/telemetry/adapters/copilot-vscode-adapter.js';
import type { HarnessContext } from '../../../src/services/telemetry/adapters/harness-adapter.js';

/**
 * Plan 066 Phase 2 — the `session_files` SQL against a REAL SQLite engine.
 *
 * The unit tests drive a FakeDb, which returns rows for any string and so cannot
 * fail on a typo, a column the live schema does not have, or the `no such table`
 * path an OLDER store takes. This rebuilds the store from the EXACT live DDL
 * (`UNIQUE(session_id, file_path)`, nullable `tool_name`/`turn_index`) plus a real
 * `chatEditingSessions/<id>/state.json` on disk, then reads it back through the
 * read-only `NodeDb` + real `NodeFs` — so the SQL and the fs lookup are proven,
 * not just their fakes.
 *
 * Tests MAY use `node:*` directly (the throwaway-db build) — only the SERVICES
 * stay ports-only (P2).
 */

const require = createRequire(import.meta.url);
const REPO = '/home/dev/repo';
const HOME = mkdtempSync(join(tmpdir(), 'vscode-files-'));
const SESSION = 'sess-066';
const WS_HASH = 'deadbeef';
const T0 = '2026-08-03T23:00:00.000Z';

const LIB = `${REPO}/demo/lib.mjs`;
const CLI = `${REPO}/demo/cli.mjs`;
const NOTES = `${REPO}/demo/notes.md`;

afterAll(() => rmSync(HOME, { recursive: true, force: true }));

interface WritableDb {
  exec(s: string): void;
  prepare(s: string): { run(...a: unknown[]): void };
  close(): void;
}

function openWritable(dbPath: string): WritableDb {
  mkdirSync(dirname(dbPath), { recursive: true });
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (p: string) => WritableDb;
  };
  return new DatabaseSync(dbPath); // writable — the NodeDb port is read-only
}

/** The live store's DDL, verbatim in shape: nullable tool columns + the UNIQUE key. */
function seedStore(env: FakeEnv, withFilesTable: boolean): void {
  const dbPath = copilotVscodeStoreDbPaths(env)[0];
  if (dbPath === undefined) throw new Error('no candidate store path');
  const db = openWritable(dbPath);
  db.exec(
    'CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, updated_at TEXT);' +
      'CREATE TABLE turns (session_id TEXT, turn_index INTEGER, user_message TEXT, assistant_response TEXT, timestamp TEXT);',
  );
  db.prepare('INSERT INTO sessions (id, cwd, updated_at) VALUES (?, ?, ?)').run(SESSION, REPO, T0);
  db.prepare('INSERT INTO sessions (id, cwd, updated_at) VALUES (?, ?, ?)').run(
    'other-sess',
    REPO,
    T0,
  );
  db.prepare(
    'INSERT INTO turns (session_id, turn_index, user_message, assistant_response, timestamp) VALUES (?, ?, ?, ?, ?)',
  ).run(SESSION, 0, 'w w w', 'ok', T0);

  if (withFilesTable) {
    db.exec(
      'CREATE TABLE session_files (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id),' +
        ' file_path TEXT NOT NULL, tool_name TEXT, turn_index INTEGER, first_seen_at TEXT, UNIQUE(session_id, file_path));',
    );
    const ins = db.prepare(
      'INSERT INTO session_files (session_id, file_path, tool_name, turn_index, first_seen_at) VALUES (?, ?, ?, ?, ?)',
    );
    // `turn_index` is NULL for every row, exactly as the live store writes it.
    ins.run(SESSION, LIB, 'apply_patch', null, T0);
    ins.run(SESSION, CLI, 'apply_patch', null, T0);
    ins.run(SESSION, NOTES, 'read_file', null, T0);
    ins.run(SESSION, `${REPO}/demo`, 'list_dir', null, T0);
    // Another session's rows must NEVER leak into this session's evidence.
    ins.run('other-sess', `${REPO}/demo/other.mjs`, 'apply_patch', null, T0);
  }
  db.close();
}

/** A real `state.json` on disk: `initialFileContents` = `[fileUri, hash]` pairs. */
function seedState(env: FakeEnv): void {
  const root = copilotVscodeUserRoots(env)[0];
  const path = `${root}/workspaceStorage/${WS_HASH}/chatEditingSessions/${SESSION}/state.json`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      initialFileContents: [
        [`file://${LIB}`, 'da39a3e'], // did not exist before → the agent WROTE it
        [`file://${CLI}`, '51ed966'], // had prior content → the agent EDITED it
      ],
      timeline: [],
    }),
  );
}

function ctx(env: FakeEnv): HarnessContext {
  return {
    env,
    fs: new NodeFs(),
    db: new NodeDb(),
    repoRoot: REPO,
    harness: 'copilot-vscode',
    sessionId: SESSION,
    window: { since: 'session-start', from: 0, to: 99 },
  };
}

describe('copilotVscodeAdapter — session_files against a real SQLite engine', () => {
  it('extracts tools + written/edited through the real NodeDb and NodeFs', () => {
    const env = new FakeEnv({}, join(HOME, 'with-files'));
    seedStore(env, true);
    seedState(env);
    const caps = copilotVscodeAdapter.extract(ctx(env));

    // The SQL parses against the live schema and scopes to THIS session — the
    // `other-sess` row is absent from both capabilities.
    expect(caps.tools).toEqual({ apply_patch: 2, read_file: 1, list_dir: 1 });
    expect(caps.files).toEqual({ written: [LIB], edited: [CLI] });
    expect(JSON.stringify(caps.files)).not.toContain('other.mjs');
  });

  it('no state.json on disk → every authored path degrades to edited', () => {
    const env = new FakeEnv({}, join(HOME, 'no-state'));
    seedStore(env, true);
    const caps = copilotVscodeAdapter.extract(ctx(env));
    // Order is the SQL's `first_seen_at, file_path` — deterministic across runs
    // even when a batch of touches shares one timestamp (as the live store does).
    expect(caps.files).toEqual({ written: [], edited: [CLI, LIB] });
  });

  it('an OLDER store with no session_files table → null caps, never a throw', () => {
    const env = new FakeEnv({}, join(HOME, 'old-store'));
    seedStore(env, false);
    // `no such table` is a real SQLite error here — the DbPort must absorb it.
    const caps = copilotVscodeAdapter.extract(ctx(env));
    expect(caps.files ?? null).toBeNull();
    expect(caps.tools ?? null).toBeNull();
    expect(caps.user_prompts).toEqual([3]); // the rest of the adapter still works
  });
});
