# Fix task — `harness flow` rejects any **relative** `--path` with `E303` (escapes repo root)

**Plan**: 024-first-class-flow-system · **Type**: fix (follow-up to the shipped CLI — not a new plan)
**Found**: 2026-06-19, via a Windows hand-off bug report while exercising the plan-031/032 port · **Branch**: stay on the current working branch (`026-flow-nav-rail-zone`, no new branch)
**Verified against**: CLI source in `harness/cli/src/` (upstream `AI-Substrate/harness-engineering`); reproduced cross-platform, not Windows-specific
**Status**: ✅ **fixed + tested this session** (see Implementation Record)

---

## Summary (one line)

Every `harness flow` verb that takes `--path` (and `render --output`) **rejected a relative in-repo path** — even one naming the exact location the default would write to — with `E303 "flow write path escapes the repo root"`, because a relative `--path` was passed into the `isWithin` containment check **without first being resolved against `repoRoot`**. Absolute in-repo paths and slug/default both worked; only explicit *relative* paths failed — an inconsistency the CLI help (`--path … must be in-repo`) contradicts.

## Root cause

A relative `--path` reached `isWithin(absoluteRoot, relativePath)` un-anchored. `posixRelative("/repo", ".harness/flows/x.json")` → `"../../…/.harness/flows/x.json"` → starts with `../` → guard returns false → `E303`. Both the slug branch and the default path build an **absolute** path via `posixJoin(repoRoot, …)`, which is why slug/default worked and explicit relative `--path` did not.

Three sites shared the identical pattern:

1. `harness/cli/src/services/flow/flow-service.ts` — `createFlow()` (the `create` write path): `opts.path ? toPosix(opts.path) : posixJoin(repoRoot, FLOWS_DIR, …)`.
2. `harness/cli/src/acts/flow.ts` — `resolveFlowPath()` (the read/mutate path: show/rail/nav/status/chores/render-input/…): `if (opts.path) return { ok: true, path: toPosix(opts.path) }`.
3. `harness/cli/src/acts/flow.ts` — `render --output` containment (`toPosix(opts.output)` before `isWithin`) — the same defect class on a different flag; included for consistency so relative `--path` and relative `--output` behave alike.

## The fix

New shared helper in `harness/cli/src/services/shared/posix-path.ts` — `resolveInRepo(rawPath, repoRoot)`: anchors a **relative** path against `repoRoot` (via `posixJoin`, never the module-forbidden `posix.resolve`); an **already-absolute** logical path (leading `/`, UNC `//`, or a drive root `C:/` — matched by `/^([A-Za-z]:)?\//`) passes through unchanged. Containment (`isWithin`) still runs **after** resolution, so a `../escape` still resolves to an out-of-repo absolute and is still correctly refused with `E303`. Applied at all three sites above.

## Empirical proof (behaviour matrix — locked by the new tests)

| case | before | after fix |
|---|---|---|
| `--path ".harness/flows/demo.json"` (rel, fwd-slash) | E303 | **ok** — resolves to `/repo/.harness/flows/demo.json` |
| `--path ".harness\flows\demo.json"` (rel, back-slash) | E303 | **ok** (separator handling holds) |
| `--path "scratch/demo.json"` (rel, nested) | E303 | **ok** |
| `--path "../escape.json"` (escape) | E303 | **E303** (still refused ✓) |
| `flow rail --path ".harness/flows/demo.json"` (read path) | E303 | **ok** — renders the rail |
| `--path "C:/repo/.harness/flows/demo.json"` (abs) | ok | ok (unchanged) |

---

## Implementation Record (2026-06-19, branch `026-flow-nav-rail-zone`)

Implemented inline (no new flow, no new branch).

| Scope | What landed |
|---|---|
| [CLI] `posix-path.ts` | New `resolveInRepo(rawPath, repoRoot)` exported helper (POSIX-space, UNC/drive-aware, `posixJoin`-based — honours the module's "no `posix.resolve` on logical paths" rule). |
| [CLI] `flow-service.ts` | `createFlow()` resolves a relative `--path` via `resolveInRepo` before containment. |
| [CLI] `acts/flow.ts` | `resolveFlowPath()` (all read/mutate verbs + render input) and `render --output` resolve relative paths via `resolveInRepo` before containment. |
| [tests] `posix-path.test.ts` | 8 unit cases for `resolveInRepo` (relative/nested/win-shaped anchored; absolute/drive/UNC pass-through; `../` escape resolves out-of-repo and `isWithin` refuses it; in-repo relative passes `isWithin`). |
| [tests] `flow-service.test.ts` | 3 cases in the T007 containment block: relative in-repo `--path` writes + `data.path` is absolute; win-shaped relative `--path` works; relative `../` escape still → E303. |
| [tests] `acts/flow.test.ts` | 2 integration cases: create + read-back (`rail`) both via a relative `--path` (the report's headline read-path bug); relative `../` escape on `--path` still → E303. |

**Verification**: `tsc --noEmit` clean; full CLI suite green (**975/975**, +13 new from this fix); the three touched test files run 99/99.

**Not committed** (standing "commit only when asked" rule).

## Notes / constraints

- **No new branch** — landed on the current working branch.
- This is purely a [CLI] fix — no skill-doc edits were needed (the help text already advertised relative in-repo `--path` as valid; the fix makes the behaviour match the docs).
- The hand-off report (a Windows host on a downstream fork) applied the fix locally, proved it, then **reverted** in the fork so this upstream fix ports back with no conflict. This repo **is** that upstream.
