import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface PackageManifest {
  version: string;
}

/**
 * Read the CLI version from the shipped repo-root `package.json`. Kept out of
 * `index.ts` (which stays free of `node:fs`) — this is a bootstrap concern, not
 * business logic. npm always ships `package.json` in the tarball; from
 * `harness/cli/dist/version.js` it is three levels up — a path that holds both
 * in-repo and when installed via npx.
 */
export function readVersion(): string {
  const manifestUrl = new URL('../../../package.json', import.meta.url);
  const manifest = JSON.parse(readFileSync(fileURLToPath(manifestUrl), 'utf8')) as PackageManifest;
  return manifest.version;
}
