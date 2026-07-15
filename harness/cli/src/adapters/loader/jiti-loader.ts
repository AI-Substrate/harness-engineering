import { fileURLToPath, pathToFileURL } from 'node:url';
import { createJiti } from 'jiti';
import type { ModuleLoaderPort } from './module-loader-port.js';

const TS_FILE = /\.(ts|tsx)$/;
const CONTRACT_SPECIFIER = '@ai-substrate/engineering-harness/contract';
const CONTRACT_MODULE = fileURLToPath(
  new URL(
    `../../services/extensions/contract.${import.meta.url.endsWith('.ts') ? 'ts' : 'js'}`,
    import.meta.url,
  ),
);

/**
 * Real module loader — the ONLY place `jiti` is imported.
 *
 * `.ts`/`.tsx` load through jiti with `moduleCache: false` (pi-parity): full TS
 * transpile (enums, etc.) and each extension resolves its own `node_modules`.
 * `.js`/`.mjs`/`.cjs` skip jiti entirely via native dynamic `import()`. Both
 * return the module's **default** export (a module with no default → `undefined`,
 * which the registry then rejects as a malformed export — never the namespace).
 */
export class JitiLoader implements ModuleLoaderPort {
  private jiti: ReturnType<typeof createJiti> | undefined;

  private getJiti(): ReturnType<typeof createJiti> {
    if (!this.jiti) {
      this.jiti = createJiti(import.meta.url, {
        moduleCache: false,
        // Consumer repos need no package/self-link: TS extensions always resolve
        // the public factory to THIS running core's contract module.
        alias: { [CONTRACT_SPECIFIER]: CONTRACT_MODULE },
      });
    }
    return this.jiti;
  }

  async load(absPath: string): Promise<unknown> {
    if (TS_FILE.test(absPath)) {
      return this.getJiti().import(absPath, { default: true });
    }
    const mod = (await import(pathToFileURL(absPath).href)) as { default?: unknown };
    return mod.default;
  }
}
