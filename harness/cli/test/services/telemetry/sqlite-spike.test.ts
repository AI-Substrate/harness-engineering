import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { NodeDb } from '../../../src/adapters/db/node-db.js';

/**
 * T009 (plan 1.8) — SQLite mechanism SPIKE / Phase-1 EXIT GATE.
 *
 * De-risks AC-04 BEFORE Phase 2 depends on it: build a throwaway `node:sqlite`
 * db WRITABLE (the `NodeDb` port itself is read-only), seed the copilot-vscode
 * `sessions`/`turns` shape, then read it back through the real read-only
 * `NodeDb` running the actual privacy-projecting SQL — proving (a) the
 * writable-build → read-only-read round-trip works, and (b) the raw message
 * text NEVER crosses the SQL boundary (only counts + flags + timestamp).
 */

const require = createRequire(import.meta.url);
const dir = mkdtempSync(join(tmpdir(), 'sqlite-spike-'));
const dbPath = join(dir, 'session-store.db');

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const SECRET_PROMPT = 'my super secret product idea about widgets';
const SECRET_REPLY = 'here is the confidential plan you asked for';

function seed(): void {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath); // writable — the port is read-only
  db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, updated_at INTEGER)');
  db.exec(
    'CREATE TABLE turns (session_id TEXT, turn_index INTEGER, user_message TEXT, assistant_response TEXT, timestamp INTEGER)',
  );
  db.prepare('INSERT INTO sessions (id, cwd, updated_at) VALUES (?, ?, ?)').run(
    'sess-1',
    '/home/dev/repo',
    1000,
  );
  const t = db.prepare(
    'INSERT INTO turns (session_id, turn_index, user_message, assistant_response, timestamp) VALUES (?, ?, ?, ?, ?)',
  );
  t.run('sess-1', 0, SECRET_PROMPT, SECRET_REPLY, 1_700_000_000_000);
  t.run('sess-1', 1, 'one two three', null, 1_700_000_001_000);
  db.close();
}

// The PRIVACY-PROJECTING turns SQL: word count + presence flag computed in
// SQLite; raw message columns are NEVER selected (the AC-04 boundary).
const TURNS_SQL = [
  'SELECT turn_index,',
  "  (LENGTH(TRIM(user_message)) - LENGTH(REPLACE(TRIM(user_message), ' ', '')) + 1) AS words,",
  '  (assistant_response IS NOT NULL AND LENGTH(assistant_response) > 0) AS has_response,',
  '  timestamp',
  'FROM turns WHERE session_id = ? ORDER BY turn_index ASC',
].join('\n');

describe('sqlite spike — copilot-vscode round-trip (Phase-1 exit gate)', () => {
  it('resolves the session id by cwd through read-only NodeDb', () => {
    seed();
    const rows = new NodeDb().query(
      dbPath,
      'SELECT id FROM sessions WHERE cwd = ? ORDER BY updated_at DESC LIMIT 1',
      ['/home/dev/repo'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('sess-1');
  });

  it('projects turns to counts + flags + timestamp — raw text never crosses the boundary', () => {
    const rows = new NodeDb().query(dbPath, TURNS_SQL, ['sess-1']);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ turn_index: 0, words: 7, has_response: 1 });
    expect(rows[1]).toMatchObject({ turn_index: 1, words: 3, has_response: 0 });
    // The AC-04 privacy boundary: the message text is absent from the result set.
    const json = JSON.stringify(rows);
    expect(json).not.toContain(SECRET_PROMPT);
    expect(json).not.toContain(SECRET_REPLY);
    expect(json).not.toContain('widgets');
  });

  it('degrades to [] for a missing db (never throws)', () => {
    expect(new NodeDb().query(join(dir, 'nope.db'), 'SELECT 1')).toEqual([]);
  });
});
