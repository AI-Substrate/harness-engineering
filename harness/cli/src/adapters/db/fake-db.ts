import type { DbPort, DbRow } from './db-port.js';

/** A query-aware row resolver: pick the rows for THIS `(sql, params)`, `[]` if none. */
export type FakeDbResolver = (sql: string, params: readonly (string | number)[]) => DbRow[];

/**
 * Test {@link DbPort}, recording every call. Two modes:
 *
 * - **Fixed (default)** — constructed with a `DbRow[]`, it returns those SAME rows
 *   for EVERY query, so a test can drive an adapter's "first candidate path that
 *   returns rows wins" logic without caring which platform db path was tried.
 *   Construct with `[]` (the default) to simulate a missing/empty store.
 * - **Query-aware** — constructed with a {@link FakeDbResolver}, it returns rows
 *   chosen per `(sql, params)`. Needed when one adapter issues MORE THAN ONE
 *   distinct query against the same db (e.g. the `copilot-vscode` adapter reads
 *   `sessions` then `turns`), which the fixed mode cannot tell apart.
 */
export class FakeDb implements DbPort {
  readonly calls: { dbPath: string; sql: string; params: readonly (string | number)[] }[] = [];
  private readonly resolve: FakeDbResolver;

  constructor(rows: DbRow[] | FakeDbResolver = []) {
    this.resolve = typeof rows === 'function' ? rows : () => rows;
  }

  query(dbPath: string, sql: string, params: readonly (string | number)[] = []): DbRow[] {
    this.calls.push({ dbPath, sql, params });
    return this.resolve(sql, params);
  }
}
