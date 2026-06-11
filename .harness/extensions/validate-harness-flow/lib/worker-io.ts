import type { VerbContext } from '@ai-substrate/engineering-harness/contract';

/**
 * Package-internal I/O helpers for `validate-harness-flow` (plan 014 T012 —
 * split from the flat single-file form; proves AC-14 in production: the entry
 * imports this module via `./lib/worker-io.ts`).
 *
 * Same guardrails as the entry (Constitution P2/P8): no `node:*` imports — all
 * side effects via `ctx.exec` / `ctx.fs`.
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
    await ctx.exec('sleep', ['0.3']);
  }
  return null;
}

/** Write `content` to `path` with NO shell re-parsing of the content (argv-only). */
export async function writeFile(ctx: VerbContext, path: string, content: string): Promise<boolean> {
  const r = await ctx.exec('bash', ['-c', 'printf "%s" "$2" > "$1"', 'writeFile', path, content]);
  return r.ok;
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

/** Copy one file into destDir (mkdir -p first). Returns true on success. */
export async function copyInto(ctx: VerbContext, src: string, destDir: string): Promise<boolean> {
  if (!ctx.fs.exists(src)) return false;
  const mk = await ctx.exec('mkdir', ['-p', destDir]);
  if (!mk.ok) return false;
  const cp = await ctx.exec('cp', [src, destDir]);
  return cp.ok;
}
