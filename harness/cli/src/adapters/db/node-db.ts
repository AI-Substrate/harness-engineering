import { createRequire } from 'node:module';
import type { DbPort, DbRow } from './db-port.js';

/**
 * Real {@link DbPort} over the built-in `node:sqlite`. `node:sqlite` is still
 * experimental, so importing it emits a one-time `ExperimentalWarning` — for a
 * SILENT telemetry sensor that must never touch a host command's stderr, the
 * module is loaded lazily through `createRequire` with `process.emitWarning`
 * muted for the duration of the load.
 *
 * Every failure mode (no `node:sqlite`, missing file, locked db, bad SQL) is
 * swallowed to `[]` — the sensor degrades to "no data", never an error.
 */

interface SqliteStatement {
  all(...params: readonly (string | number)[]): unknown[];
}
interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  close(): void;
}
interface SqliteModule {
  DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => SqliteDatabase;
}

let cached: SqliteModule | null | undefined;

/** Load `node:sqlite` once, with the experimental warning suppressed; null if unavailable. */
function loadSqlite(): SqliteModule | null {
  if (cached !== undefined) return cached;
  const original = process.emitWarning;
  process.emitWarning = () => {};
  try {
    cached = createRequire(import.meta.url)('node:sqlite') as SqliteModule;
  } catch {
    cached = null;
  } finally {
    process.emitWarning = original;
  }
  return cached;
}

export class NodeDb implements DbPort {
  query(dbPath: string, sql: string, params: readonly (string | number)[] = []): DbRow[] {
    const mod = loadSqlite();
    if (mod === null) return [];
    let db: SqliteDatabase | undefined;
    try {
      db = new mod.DatabaseSync(dbPath, { readOnly: true });
      return db.prepare(sql).all(...params) as DbRow[];
    } catch {
      return []; // missing / locked / corrupt / bad SQL → no data, never a throw
    } finally {
      try {
        db?.close();
      } catch {
        // ignore close failures — the read already returned
      }
    }
  }
}
