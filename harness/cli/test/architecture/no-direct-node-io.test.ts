import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Resolve from THIS file's location, not cwd — the suite must read true from any
// invocation directory (plan 014 orchestrator retro OH-001).
const CLI_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...tsFiles(full));
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const FORBIDDEN = [
  /from\s+['"]node:fs['"]/,
  /from\s+['"]node:child_process['"]/,
  // `node:net` added by plan 082 tk-0001. Until then this guard was BLIND to it: a service
  // importing node:net passed `just checks` with the suite reporting "0 offender(s)", so the
  // plan's G3 note claiming this guard already covered socket I/O was false. Socket I/O belongs
  // behind `SocketRelayPort` (src/adapters/net/socket-probe-port.ts, plan 074) exactly as fs and
  // child_process belong behind their ports.
  /from\s+['"]node:net['"]/,
];

describe('architecture — services keep Node I/O behind ports', () => {
  it('no service imports node:fs, node:child_process or node:net directly (KF-06)', () => {
    // Side-effecting Node I/O lives only in adapters (NodeFs, NodeExec, NodeProcess, ExecGit,
    // NodeSocketProbe); services depend on the ports, never the raw modules. node:path/node:url
    // (pure) are allowed.
    // Narrow exception: the GENERATED docs data module embeds documentation prose verbatim — a doc
    // that quotes `from 'node:fs'` must not false-trip this guard. Only that one known generated
    // data artifact is exempt (a `@generated` header alone is NOT enough — scope the escape hatch
    // so a future hand-or-generated service can't smuggle real node:fs in, companion F001).
    const GENERATED_DATA_ALLOWLIST = [join('src', 'services', 'docs', 'docs-content.ts')];
    const examined = tsFiles(join(CLI_ROOT, 'src', 'services'));
    const offenders = examined
      .filter((file) => !GENERATED_DATA_ALLOWLIST.some((allowed) => file.endsWith(allowed)))
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        return FORBIDDEN.some((pattern) => pattern.test(source));
      })
      .map((file) => relative(CLI_ROOT, file));

    // Corpus assertion is correct HERE: only the walk narrows, and a one-entry
    // allowlist cannot zero it. Adjudicated per-guard, not applied uniformly.
    expect(examined.length).toBeGreaterThan(0);
    console.error(
      `no-direct-node-io — examined ${examined.length} service file(s), ${offenders.length} offender(s)`,
    );

    expect(offenders).toEqual([]);
  });
});
