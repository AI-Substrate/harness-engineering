import { pathToFileURL } from 'node:url';
import { createJiti } from 'jiti';
import type { ModuleLoaderPort } from './module-loader-port.js';

const TS_FILE = /\.(ts|tsx)$/;

/**
 * Real module loader — the ONLY place `jiti` is imported.
 *
 * `.ts`/`.tsx` load through jiti with `moduleCache: false` (pi-parity): full TS
 * transpile (enums, etc.) and each extension resolves its own `node_modules`.
 * `.js`/`.mjs`/`.cjs` skip jiti entirely via native dynamic `import()`. Both
 * return the module's **default** export.
 */
export class JitiLoader implements ModuleLoaderPort {
  private jiti: ReturnType<typeof createJiti> | undefined;

  private getJiti(): ReturnType<typeof createJiti> {
    if (!this.jiti) {
      this.jiti = createJiti(import.meta.url, { moduleCache: false });
    }
    return this.jiti;
  }

  async load(absPath: string): Promise<unknown> {
    if (TS_FILE.test(absPath)) {
      return this.getJiti().import(absPath, { default: true });
    }
    const mod = (await import(pathToFileURL(absPath).href)) as { default?: unknown };
    return mod.default ?? mod;
  }
}
