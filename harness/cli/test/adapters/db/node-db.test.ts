import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { NodeDb } from '../../../src/adapters/db/node-db.js';

/**
 * NodeDb (plan 034 follow-on) — the read-only `node:sqlite` port behind Cursor
 * model attribution. Proves a real round-trip and that every failure mode
 * degrades to `[]` (never a throw), since a telemetry sensor must never break the
 * host command. A temp db is created with `node:sqlite` directly (the port itself
 * is read-only).
 */

const require = createRequire(import.meta.url);
const dir = mkdtempSync(join(tmpdir(), 'node-db-test-'));
const dbPath = join(dir, 'state.vscdb');

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function seed(): void {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)');
  const insert = db.prepare('INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)');
  insert.run('bubbleId:conv-1:a', JSON.stringify({ modelInfo: { modelName: 'composer-2.5' } }));
  insert.run('bubbleId:conv-1:b', JSON.stringify({ modelInfo: { modelName: 'composer-2.5' } }));
  insert.run('bubbleId:other:c', JSON.stringify({ modelInfo: { modelName: 'gpt-x' } }));
  db.close();
}

describe('NodeDb', () => {
  it('reads rows from a real sqlite db with a parameterized LIKE query', () => {
    seed();
    const rows = new NodeDb().query(dbPath, 'SELECT value FROM cursorDiskKV WHERE key LIKE ?', [
      'bubbleId:conv-1:%',
    ]);
    expect(rows).toHaveLength(2);
    expect(JSON.parse(rows[0].value as string).modelInfo.modelName).toBe('composer-2.5');
  });

  it('returns [] for a missing db file (never throws)', () => {
    expect(new NodeDb().query(join(dir, 'nope.vscdb'), 'SELECT 1')).toEqual([]);
  });

  it('returns [] for a bad query against a real db (never throws)', () => {
    expect(new NodeDb().query(dbPath, 'SELECT * FROM no_such_table')).toEqual([]);
  });
});
