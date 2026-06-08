import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

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

const FORBIDDEN = [/from\s+['"]node:fs['"]/, /from\s+['"]node:child_process['"]/];

describe('architecture — services keep Node I/O behind ports', () => {
  it('no service imports node:fs or node:child_process directly (KF-06)', () => {
    // Side-effecting Node I/O lives only in adapters (NodeFs, NodeExec, NodeProcess, ExecGit);
    // services depend on the ports, never the raw modules. node:path/node:url (pure) are allowed.
    // Narrow exception: the GENERATED docs data module embeds documentation prose verbatim — a doc
    // that quotes `from 'node:fs'` must not false-trip this guard. Only that one known generated
    // data artifact is exempt (a `@generated` header alone is NOT enough — scope the escape hatch
    // so a future hand-or-generated service can't smuggle real node:fs in, companion F001).
    const GENERATED_DATA_ALLOWLIST = [join('src', 'services', 'docs', 'docs-content.ts')];
    const offenders = tsFiles(join('src', 'services'))
      .filter((file) => !GENERATED_DATA_ALLOWLIST.some((allowed) => file.endsWith(allowed)))
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        return FORBIDDEN.some((pattern) => pattern.test(source));
      })
      .map((file) => file.replace(`${process.cwd()}/`, ''));
    expect(offenders).toEqual([]);
  });
});
