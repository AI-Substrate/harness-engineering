import type { VerbContext } from '@ai-substrate/engineering-harness/contract';

/**
 * Package-internal I/O helpers for `validate-harness-flow` (plan 014 T012 —
 * split from the flat single-file form; proves AC-14 in production: the entry
 * imports this module via `./lib/worker-io.ts`).
 *
 * Cross-platform (plan 031): NO `node:*` imports and NO POSIX shell-outs — all
 * side effects go through the portable verb contract (`ctx.exec` for real repo
 * commands, `ctx.fsWrite` for writes/copies, `ctx.clock.sleep` for poll waits).
 */

/** Newest run id for the slug, or null when there are no runs yet. */
export async function lastRunId(ctx: VerbContext, agentSlug: string): Promise<string | null> {
  const r = await ctx.exec('minih', ['last-run', agentSlug]);
  if (!r.ok) return null;
  try {
    const j = JSON.parse(r.stdout) as { data?: { runId?: string } };
    return j?.data?.runId ?? null;
  } catch {
    return null;
  }
}

/** Poll `minih last-run` until a run newer than `before` appears (≈3.6s cap). */
export async function captureNewRun(
  ctx: VerbContext,
  agentSlug: string,
  before: string | null,
): Promise<{ runId: string; runDir: string | null } | null> {
  for (let i = 0; i < 12; i++) {
    const r = await ctx.exec('minih', ['last-run', agentSlug]);
    if (r.ok) {
      try {
        const j = JSON.parse(r.stdout) as { data?: { runId?: string; runDir?: string } };
        const id = j?.data?.runId ?? null;
        if (id && id !== before) {
          return { runId: id, runDir: j?.data?.runDir ?? null };
        }
      } catch {
        // not JSON yet — keep polling
      }
    }
    await ctx.clock.sleep(300);
  }
  return null;
}

/** Write `content` to `path` via the portable write port (no shell). Returns true on success. */
export async function writeFile(ctx: VerbContext, path: string, content: string): Promise<boolean> {
  if (!ctx.fsWrite) return false;
  try {
    ctx.fsWrite.writeText(path, content);
    return true;
  } catch {
    return false;
  }
}

/** Read + parse a JSON file via the read-only fs port; null on any failure. */
export function readJson<T>(ctx: VerbContext, path: string): T | null {
  if (!ctx.fs.exists(path)) return null;
  const text = ctx.fs.readText(path);
  if (text == null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Copy one file into destDir (mkdir -p first). Returns true on success.
 *
 * When `confineRoot` is given, the source is treated as living inside an
 * UNTRUSTED clone: the copy is REFUSED unless the source's resolved real path
 * stays within `confineRoot`'s real path. A malicious clone can commit a fixed
 * artifact path (e.g. `.harness/reports/harnessability/latest.json`) as a
 * symlink to an absolute host path (`~/.ssh/id_rsa`, cloud creds); a plain copy
 * dereferences it and would exfiltrate the contents into the operator's tree
 * (CWE-59). The portable `ctx.fsWrite.copy` does realpath + containment + copy
 * as ONE operation (no skip-all on Windows, no check-then-copy TOCTOU); an
 * escaping symlink is refused (returns false).
 */
export async function copyInto(
  ctx: VerbContext,
  src: string,
  destDir: string,
  confineRoot?: string,
): Promise<boolean> {
  if (!ctx.fsWrite) return false;
  return ctx.fsWrite.copy(src, destDir, confineRoot !== undefined ? { confineRoot } : undefined);
}
