import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { SchemaFs } from '../../services/dd/schema/model.js';

/**
 * Errors that mean "there is no directory here", which is a legitimate answer to
 * the scan's probe rather than a failure: the walk uses a non-empty `readdir` to
 * decide what is a directory, so a plain file (`ENOTDIR`) and an absent path
 * (`ENOENT`) must both come back as `[]`.
 */
const NOT_A_DIRECTORY = new Set(['ENOENT', 'ENOTDIR']);

/**
 * `SchemaFs` over the real filesystem, keeping the one distinction the deep scan
 * depends on: **"I found nothing" and "I could not look" are different answers.**
 *
 * The shared `NodeFs.readdir` collapses *every* error to `[]`. That is right for
 * its own callers and wrong here. `scanRoot` reads an empty `readdir` as "no
 * entries", so a swallowed `ELOOP`/`ENAMETOOLONG`/`EACCES` silently becomes
 * "this root holds no schemas", and the act then reports a confident, false
 * `E410 schema-not-found` instead of `E416 scan-failed`. Review finding F002
 * reproduced exactly that with a symlink loop (`.dd/loop -> .`): the scan
 * returned no hits and no issues at all.
 *
 * So only the two "not a directory" codes stay benign; every other error
 * propagates, and `scanRoot`'s `try/catch` turns it into one honest
 * `scan-failed` issue for that root. A wrong answer becomes a reported one.
 *
 * This lives in `acts/` rather than `services/dd/schema/` on purpose: acts are
 * this CLI's composition root (`acts/doctor.ts` sets the precedent), which keeps
 * the schema service itself free of `node:*` and testable with fakes only.
 */
export class NodeSchemaFs implements SchemaFs {
  readdir(path: string): string[] {
    try {
      return readdirSync(path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== undefined && NOT_A_DIRECTORY.has(code)) return [];
      throw error;
    }
  }

  exists(path: string): boolean {
    return existsSync(path);
  }

  readText(path: string): string | null {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  }
}
