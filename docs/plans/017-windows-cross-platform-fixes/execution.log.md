# Execution Log — 017 windows-cross-platform-fixes

**Plan**: [windows-cross-platform-fixes-plan.md](./windows-cross-platform-fixes-plan.md) (v1.1.0, READY)
**Mode**: Simple — single phase, inline tasks T000–T015
**Started**: 2026-06-10
**Skill**: plan-6-v2-implement-phase-companion (companion: `code-review-companion` via minih — [protocol](https://github.com/AI-Substrate/minih/blob/main/docs/how/companion-mode.md))

## Pre-phase

### T000 — Harness boot (pre-implement seam)

| Check | Result | Evidence |
|---|---|---|
| Boot | ✅ healthy | `just test` → **380 passed (380)**, 828ms; coverage 91.69% stmts |
| Interact | ✅ | `npx --no-install harness doctor --json` → `status: ok` |
| Observe | ✅ | JSON envelope returned, parseable |

Verdict: **healthy** → proceed. Harness router installed (`~/.claude/skills/eng-harness-flow`); seam satisfied via the plan's pinned T000 boot commands (Boot→Interact→Observe), logged here.

### Companion boot

`minih run code-review-companion` backgrounded at 09:47 with `GH_TOKEN` exported; companion oriented on the 017 plan directory within ~40s (streamed output confirms it located the plan). Run ID recorded at briefing below.

## Task entries

(appended per task — sha, evidence, companion ping, findings)

### T001 + T002 — helper tests (RED) → helper (GREEN)

- **RED evidence**: `npx vitest run test/services/shared/posix-path.test.ts` → `Test Files 1 failed` (module `src/services/shared/posix-path.js` not yet present). Committed together with the GREEN implementation so every commit stays suite-green; RED state recorded here instead.
- **GREEN evidence**: 37/37 tests pass. Includes the raw-Node hazard pin `posix.normalize('//server/share') === '/server/share'` and the UNC guard counterpart in every normalize-based helper op.
- Helper surface: `toPosix`, `posixNormalize`, `posixJoin`, `posixDirname`, `posixRelative`, `isWithin`, `dedupeKey(p, caseInsensitive = IS_WIN32)` — normalize/join-only, `resolve` forbidden by docstring (Finding 03); case-folding is an explicit parameter (Finding 04, P3).
- `arch-check` → `status: ok` after adding the module.
- **Discovery**: `harness arch-check` must run from the **repo root** — extensions are discovered under `<cwd>/.harness/extensions`, so invoking from `harness/cli` yields E108 `too many arguments` (the verb never registers). Also: the verb takes no `--json` flag — JSON envelope is the default stdout shape. The plan's T002 done-when wrote `arch-check --json`; actual invocation is `npx --no-install harness arch-check` from root.

### T003 — FakeFs separator tolerance

- `mkdirp` splits on `/[\\/]/` and registers ancestors in canonical POSIX form; `readdir` tolerates Windows-shaped probes (POSIX-canonical key fallback for the seeded map, normalized prefix match for mkdirp-created children, child-name split on either separator).
- 6 new unit tests (backslash, slash-equivalence, UNC in both shapes, Windows-shaped probes, end-to-end UNC list). fake-fs suite 18/18; **full suite 423/423**.
- Design note: registered state is canonical POSIX, probes are tolerant — `exists()` untouched (post-T004–T006 all service probes are POSIX; scope kept to the two plan-named sites).

### T004 — discovery.ts → POSIX (single POSIX origin)

- `node:path` import removed entirely; `toPosix(proc.cwd())` at the boundary; all joins via `posixJoin`; local `isWithin` deleted in favour of the helper (POSIX-space `'../'` literal); dedupe keyed by `dedupeKey` (POSIX-normalized, win32 case-fold default).
- Header doc now declares discovery the **single POSIX origin** — downstream (doctor/instructions/registry) receives POSIX `entryPath`/`folder`/rejected `path` and never re-normalizes per site.
- Read-verified: `grep -E "from 'node:path'|join\(|relative\(|resolve\(|sep"` → zero native hits. Suite 423/423.

### T005 — record-service + scaffold-service → POSIX

- record: `toPosix(proc.cwd())` boundary (also fixes the `unconfigured` message's surfaced cwd); `posixJoin` for harnessDir/dir/fileAbs/`relPath` (envelope `:184` + write-failure message `:179` + exhaustion message). `ensureTemp` (shared/temp.ts) deliberately untouched — physical scratch-dir path, not surfaced; FakeFs tolerance covers its mixed-separator joins under Windows-shaped cwds.
- scaffold: `posixJoin(toPosix(proc.cwd()), …)` for dirAbs; `relPath`/`relInstructions` in POSIX space — envelope `.harness/extensions/<name>/...` literal.
- Both files: zero `node:path` imports. Suite 423/423.

### T006 — doctor-service + instructions-service → POSIX

- doctor `checkConventions`: `posixDirname(entryPath)`, `posixJoin(folder, 'instructions.md')`, `posixRelative(toPosix(cwd), folder)` for the repo-relative `next_action`; temp-hygiene probe via `posixJoin(toPosix(cwd), …)`.
- doctor `renderDoctorText` `:291`/`:300`: **both sides** of `dirname(entryPath) === c.folder` now `posixDirname` vs POSIX-computed `c.folder` — the partial-normalization hazard validate-v2 flagged is closed.
- instructions `:36`: `posixJoin(posixDirname(entryPath), 'instructions.md')` — surfaced briefing path forward-slash on every OS.
- AC-2 sweep: zero `node:path` imports across all five services. Suite 423/423.

### T007 — path-safe test assertions

- `extensions.test.ts:91` → two-segment form `posix.join(posix.basename(posix.dirname(p)), posix.basename(p))`; `:235` → `posix.basename(c.folder)`.
- Suite-wide `split('/')` sweep: only remaining hits are **git URL** splits in `.harness/extensions/{validate-harness-flow,validate-harnessability}/extension.ts` — URLs are forward-slash by definition, not filesystem paths; out of AC-5 scope, left untouched.
- Biome reflowed the long mapper line. Suite 423/423.

### T008 — Windows-shape sensor (the CI-leg replacement)

- `test/services/windows-shape.test.ts` — 11 tests, all `FakeProcess.cwd()='C:\repo'` (plus a `'c:\work/repo'` mixed-separator/lower-drive variant), FakeFs seeded with **post-`toPosix` keys**. Surfaces: discovery candidates/rejected (incl. manifest `../escape` containment on drive-letter paths), record `data.path` + unconfigured-cwd message + exhaustion message, scaffold `path`/`instructionsPath` + write keys, doctor convention `folder`/`next_action` + the `renderDoctorText` `:291` pairing (8-space arrow indent proves the both-sides-POSIX match), instructions resolution + a discovery→instructions pipeline wiring test.
- **Revert-proof (sensor proven)**: temporarily reverted the discovery boundary to the pre-017 native form (`const base = join(proc.cwd(), ...EXTENSIONS_DIR)`, native `node:path` import) → sensor failed **1 failed | 10 passed** (`normalizes a mixed-separator, lower-case-drive cwd at the boundary`); restored → 11/11. Honest nuance: the pure-backslash cases were partially self-healed by defense-in-depth (`posixJoin` converts segments on the way in, T003 FakeFs tolerates the probe), but the boundary's **drive-letter case normalization is unique to `toPosix`** and its loss is caught deterministically. The sensor fails on boundary regressions — exactly the class that shipped the original 40 failures.
- Full suite **434/434** (50 files).

### T009 — shell-free EPIPE test + Windows-safe npm guard

- Early-close test rewritten with Node primitives: `spawn(process.execPath, [distEntry, 'docs', id, '--no-extensions'])`, read to first `\n`, `stdout.destroy()` (the `head -1` analogue), await `close`. Asserts the CLI's documented behaviour — first line delivered + stderr free of `EPIPE|Error:` — **not** a blanket exit-0 (the old form asserted *head's* pipeline status). Parent-side `stdout.on('error')` swallowed (destroyed-pipe noise).
- Build guard: `execFileSync(win32 ? 'npm.cmd' : 'npm', ['run','build'], { shell: win32 })` — works on win32 instead of being skipped.
- Done-when nuance: zero `bash`/`head` **invocations** remain; 3 grep hits are comments documenting the old form (kept deliberately as context). Suite 434/434.

### T010 — gen-docs hygiene (prerequisite of T011)

- `console.log` → `console.error` (stdout is data — the line runs inside the `prepack` lifecycle).
- biome via `execFileSync(process.execPath, ['node_modules/@biomejs/biome/bin/biome', …])` with `existsSync` guard + try/catch — missing OR failing biome warns to stderr, never breaks the build.
- Evidence: `npm run build` stdout = npm's own banners only (script output zero); `check:docs` exit 0, `docs-content.ts` **byte-identical** (no diff); **`npm pack --json --dry-run | jq -r '.[0].filename'` → `harness-engineering-0.1.0.tgz`, jq exit 0** — the exact pipeline that parse-errored before this fix (Finding 01, verified live at plan time).

### T011 — package-smoke repair

- `ci.yml`: `TARBALL="$(npm pack --json | jq -r '.[0].filename')"` + loud `[[ "$TARBALL" == *.tgz ]]` guard (any future stdout leak fails visibly, never silently); flat `legacy.ts` fixture created between the boom heredoc and the doctor invocation — the E143 greps (`:169-170`) and `harness legacy` unknown-command check (`:173-178`) now exercise a fixture that actually exists.
- **Local replication of the full repaired script: ALL GREEN** — real `npm pack`, consumer-style `--omit=dev` install into a temp dir, doctor greps (E143 + `unsupported flat layout`) hit, `harness legacy` correctly refused, `harness hello` (jiti `.ts` fixture) exit 0. CI proof lands at T014's push.

### T012 — .gitattributes

- `* text=auto eol=lf` landed. Zero-churn re-proven at commit time: `git add --renormalize .` modified nothing; `git ls-files --eol` shows only `i/lf` / `i/-text` (binary). `git status` clean immediately after the commit.

### T013 — idiom encoded

- `idioms.md` § 11 "Logical paths are POSIX on every OS" — logical vs physical, boundary-conversion DO/DON'T (native join + `posix.resolve` hazards), the stdout-is-data corollary, cross-references to the helper docstring and the Windows-shape sensor. Matches the helper docstring's allowed surface.
