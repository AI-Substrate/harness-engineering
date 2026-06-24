import type { DbPort, DbRow } from './db-port.js';

/**
 * Test {@link DbPort}. Returns its configured rows for EVERY query and records
 * each call, so a test can drive an adapter's "first candidate path that returns
 * rows wins" logic without caring which platform-specific db path was tried.
 * Construct with `[]` (the default) to simulate a missing/empty store.
 */
export class FakeDb implements DbPort {
  readonly calls: { dbPath: string; sql: string; params: readonly (string | number)[] }[] = [];

  constructor(private readonly rows: DbRow[] = []) {}

  query(dbPath: string, sql: string, params: readonly (string | number)[] = []): DbRow[] {
    this.calls.push({ dbPath, sql, params });
    return this.rows;
  }
}
