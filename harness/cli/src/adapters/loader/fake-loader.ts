import type { ModuleLoaderPort } from './module-loader-port.js';

/**
 * Deterministic module loader for tests. Seeded with `{ absPath: defaultExport }`;
 * records every requested path on `loads` (fakes over mocks). To simulate a load
 * failure, script an `Error` for the path — `load` rejects with it. An unscripted
 * path also rejects (the registry treats a load rejection as `failed`/E140).
 */
export class FakeModuleLoader implements ModuleLoaderPort {
  readonly loads: string[] = [];

  constructor(private readonly scripts: Record<string, unknown> = {}) {}

  load(absPath: string): Promise<unknown> {
    this.loads.push(absPath);
    if (!(absPath in this.scripts)) {
      return Promise.reject(new Error(`No module scripted for ${absPath}`));
    }
    const entry = this.scripts[absPath];
    if (entry instanceof Error) {
      return Promise.reject(entry);
    }
    return Promise.resolve(entry);
  }
}
