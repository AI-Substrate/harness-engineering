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

/**
 * Copy one file into destDir (mkdir -p first). Returns true on success.
 *
 * When `confineRoot` is given, the source is treated as living inside an
 * UNTRUSTED clone: the copy is REFUSED unless the source's resolved real path
 * stays within `confineRoot`'s real path. A malicious clone can commit a fixed
 * artifact path (e.g. `.harness/reports/harnessability/latest.json`) as a
 * symlink to an absolute host path (`~/.ssh/id_rsa`, cloud creds); plain `cp`
 * dereferences it and would exfiltrate the contents into the operator's tree
 * (CWE-59). The realpath containment check lets only files genuinely inside the
 * clone subtree be copied; an escaping symlink is skipped (returns false).
 */
export async function copyInto(
  ctx: VerbContext,
  src: string,
  destDir: string,
  confineRoot?: string,
): Promise<boolean> {
  if (!ctx.fs.exists(src)) return false;
  if (confineRoot !== undefined) {
    // realpath both sides and assert src resolves under the clone root. Positional
    // argv only — never interpolate the paths into the bash string (injection).
    // Quoted "$2" keeps the root literal; only the trailing /* is a glob. A
    // realpath failure (missing tool / dangling link) exits non-zero ⇒ skip.
    const guard = await ctx.exec('bash', [
      '-c',
      'rp=$(realpath "$1" 2>/dev/null) || exit 3; rr=$(realpath "$2" 2>/dev/null) || exit 3; ' +
        'case "$rp/" in "$rr"/*) exit 0 ;; *) exit 4 ;; esac',
      'copyInto-confine',
      src,
      confineRoot,
    ]);
    if (!guard.ok) return false;
  }
  const mk = await ctx.exec('mkdir', ['-p', destDir]);
  if (!mk.ok) return false;
  const cp = await ctx.exec('cp', [src, destDir]);
  return cp.ok;
}
