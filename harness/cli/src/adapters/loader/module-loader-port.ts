/**
 * Module-loader port — turns an extension file on disk into its default export.
 *
 * `.ts`/`.tsx` go through jiti (full transpile, like pi's loader); `.js`/`.mjs`/
 * `.cjs` use a plain dynamic `import()` (no transpile — the fast path). Injected
 * so the registry/discovery logic is unit-testable with `FakeModuleLoader` and
 * never touches jiti or the real module system (WS-A Decision 1/4).
 */
export interface ModuleLoaderPort {
  /** Import by absolute path and return the module's default export. */
  load(absPath: string): Promise<unknown>;
}
