import type { ExecPort } from '../exec/exec-port.js';
import type { VersionLookupPort } from './version-lookup-port.js';

/**
 * Real version lookup — shells `npm view <pkg> version --json` via the injected
 * `ExecPort` (so the only child spawn stays in `NodeExec`). Reads the PUBLIC npm
 * registry — no auth needed for a public package (FX001); cwd only lets npm pick
 * up a project `.npmrc` if one is present.
 *
 * Never throws: a non-zero exit (not-found, registry unreachable) or unparseable
 * output maps to null so the update check degrades silently (AC9).
 */
export class NodeVersionLookup implements VersionLookupPort {
  constructor(
    private readonly exec: ExecPort,
    private readonly pkg: string,
    private readonly cwd: string,
  ) {}

  async latest(): Promise<string | null> {
    const result = await this.exec.run('npm', ['view', this.pkg, 'version', '--json'], {
      cwd: this.cwd,
    });
    if (!result.ok) return null;
    return parseNpmVersion(result.stdout);
  }
}

/**
 * `npm view pkg version --json` emits a JSON-encoded string for a single match
 * ("0.2.0") or a JSON array when several versions resolve — take the last.
 * Anything else (empty, non-JSON) ⇒ null (unknown, not an error).
 */
function parseNpmVersion(stdout: string): string | null {
  const text = stdout.trim();
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'string') return parsed;
    if (Array.isArray(parsed) && parsed.length > 0) {
      const last = parsed[parsed.length - 1];
      return typeof last === 'string' ? last : null;
    }
    return null;
  } catch {
    return null;
  }
}
