set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

# List available recipes.
default:
    @just --list

# List the skill discoverable from this working tree via Vercel's skills CLI.
list-skills:
    @npx skills@latest add "$(pwd)" -l

# Install THIS harness's skills project-local, the baked (harness) way. Builds
# first so `dist/` + the packaged-skills resolver are current, then runs
# `harness skills install`, which stages the baked `skills/` dir to a temp path
# and shells `npx skills add <local dir>` — NO GitHub access. Installs `builder`
# (+ the `the-flow` redirect) and the rest of the baked set for local use, and
# records the install in `.harness/skills.lock.json` so `harness update` can
# reconcile it later. This is how you refresh your own machine after editing a skill.
install-skills-local:
    npm run build
    node harness/cli/bin/harness.js skills install \
        --target claude-code \
        --target codex \
        --target opencode \
        --target github-copilot \
        --target pi

# Same, but a GLOBAL install (`--global`) for the same CLIs.
install-skills-global:
    npm run build
    node harness/cli/bin/harness.js skills install \
        --target claude-code \
        --target codex \
        --target opencode \
        --target github-copilot \
        --target pi \
        --global

# Install globally from this working tree (kept as the tools-repo-matching name).
install-skills-from-source: install-skills-global

# Diagnose skill deployment: canonical store, per-CLI views, and stale legacy stores.
doctor-skills:
    #!/usr/bin/env bash
    set -eu
    canonical="$HOME/.agents/skills"
    echo "Skills doctor"
    echo
    if [ -d "$canonical" ]; then
        count=$(ls "$canonical" | wc -l | tr -d ' ')
        echo "OK canonical store: $canonical ($count skills)"
    else
        echo "WARN canonical store missing: $canonical - run 'just install-skills-from-source'"
    fi
    echo
    echo "Per-CLI views:"
    for path in "$HOME/.claude/skills" "$HOME/.pi/skills"; do
        if [ -L "$path" ]; then
            echo "  OK $path -> $(readlink "$path") (whole-dir symlink)"
        elif [ -d "$path" ]; then
            symlinks=$(find "$path" -mindepth 1 -maxdepth 1 -type l 2>/dev/null | wc -l | tr -d ' ')
            real_dirs=$(find "$path" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
            if [ "$real_dirs" -eq 0 ] && [ "$symlinks" -eq 0 ]; then
                echo "  INFO $path is empty"
                continue
            fi
            if [ "$real_dirs" -eq 0 ]; then
                echo "  OK $path ($symlinks symlinked skills)"
                continue
            fi
            duplicates=""
            handlocal=""
            for d in $(find "$path" -mindepth 1 -maxdepth 1 -type d 2>/dev/null); do
                slug=$(basename "$d")
                if [ -e "$canonical/$slug" ]; then
                    duplicates="$duplicates $slug"
                else
                    handlocal="$handlocal $slug"
                fi
            done
            echo "  INFO $path: $symlinks symlinks + $real_dirs real subdirs"
            if [ -n "$duplicates" ]; then
                echo "      WARN duplicates of canonical (will drift):$duplicates"
                echo "      Fix per slug: rm -rf $path/<slug> && ln -s $canonical/<slug> $path/<slug>"
            fi
            if [ -n "$handlocal" ]; then
                echo "      OK hand-installed local-only (not in canonical):$handlocal"
            fi
        else
            echo "  INFO $path missing (CLI may not have initialized yet)"
        fi
    done
    echo
    echo "Orphan real-dir stores at legacy paths:"
    found=0
    for path in "$HOME/.copilot/skills" "$HOME/.codex/skills" "$HOME/.config/opencode/skills"; do
        if [ -e "$path" ] && [ ! -L "$path" ] && [ -d "$path" ]; then
            count=$(ls "$path" 2>/dev/null | wc -l | tr -d ' ')
            if [ "$count" -gt 0 ]; then
                echo "  WARN $path ($count entries) - likely orphan from older npx skills"
                echo "      Fix: rm -rf $path  (or: rm -rf $path && ln -s $canonical $path)"
                found=1
            fi
        fi
    done
    [ "$found" -eq 0 ] && echo "  OK none found"
    echo
    echo "Dangling symlinks under $HOME/.claude/skills:"
    if [ -d "$HOME/.claude/skills" ]; then
        dangling=$(find "$HOME/.claude/skills" -maxdepth 1 -type l ! -exec test -e {} \; -print 2>/dev/null || true)
        if [ -n "$dangling" ]; then
            echo "$dangling" | sed 's/^/  WARN /'
        else
            echo "  OK none"
        fi
    fi

# Compact a path with generate-codebase-md.sh into scratch/compacted/NNN-<slug>.md.
compact target="harness-foundations":
    @command -v generate-codebase-md.sh >/dev/null || { echo "generate-codebase-md.sh not found in PATH"; exit 1; }
    @mkdir -p scratch/compacted
    @target="{{target}}"; \
      safe_slug="$(basename "$target" | tr -cs 'A-Za-z0-9._-' '-' | sed 's/^-//; s/-$//')"; \
      next="$(python3 -c 'from pathlib import Path; import re; p=Path("scratch/compacted"); nums=[int(m.group(1)) for f in p.glob("*.md") for m in [re.match(r"^(\d{3})-", f.name)] if m]; print(f"{(max(nums) if nums else 0)+1:03d}")')"; \
      out="scratch/compacted/${next}-${safe_slug}.md"; \
      tmpdir="$(mktemp -d)"; \
      trap 'rm -rf "$tmpdir"' EXIT; \
      generate-codebase-md.sh "$tmpdir" "$target"; \
      mv "$tmpdir/codebase.md" "$out"; \
      echo "Wrote $out"; \
      git check-ignore -q "$out" && echo "Ignored by git: yes" || echo "Ignored by git: no"; \
      wc -l "$out"; \
      du -h "$out"

# --- Harness CLI engineering loop (Phase 1) ---
# Working dirs are explicit: biome runs from repo root (where biome.json lives);
# vitest runs from harness/cli (where vitest.config.ts lives).

# The global link lives OUTSIDE the npm `build`/`prepare` script on purpose:
# `prepare` runs for every npx/CI consumer, and `npm link` re-triggers `prepare`
# (→ recursion). The link uses `--ignore-scripts` so it reuses the dist we just
# built instead of rebuilding.
#
# Build the CLI (docs + tsc) for THIS working tree. Does NOT touch the global link.
#
# `build` used to run `npm link` too, which meant WHOEVER BUILT LAST CAPTURED THE
# GLOBAL `harness` FOR THE WHOLE MACHINE. A worktree rebuilding its own branch
# would silently repoint every seat's `harness`, and every git hook resolves its
# own repo root anyway, so the steal bought nothing and cost correctness. Observed
# live: the box ran a feature branch's build as `harness` for hours.
#
# Re-linking after a build was never needed: bin/harness.js is a LIVE SHIM
# (`import '../dist/index.js'`), so refreshing dist refreshes what the existing
# link already serves. Linking only matters when you want to CHANGE which tree is
# linked — which is `just link`, and belongs to the root checkout.
#
# Build this working tree's CLI (docs + tsc). Does NOT touch the global link.
build:
    npm run build

# Point the global `harness` at THIS working tree. Root checkout only, by policy:
# worktrees build with `just build` and invoke their own dist directly
# (`node harness/cli/dist/index.js …`) rather than repointing the machine.
# Verify at any time with: readlink -f "$(command -v harness)"
#
# Point the global `harness` at this working tree (root checkout only).
link:
    npm link --ignore-scripts
    @echo "Linked: $(command -v harness) -> this working tree. Try: harness docs"

# Install the harness CLI globally from THIS working tree (npm link).
# Builds first (gen:docs + tsc -> dist), then symlinks `harness` onto your PATH
# at $(npm prefix -g)/bin, pointing at harness/cli/bin/harness.js. The link is
# LIVE: re-run this (or `just build`) after changes to refresh the dist it serves.
# Undo with `just uninstall-cli`.
install-cli:
    npm run build
    npm link --ignore-scripts
    @command -v harness >/dev/null 2>&1 \
        && echo "✓ harness installed globally: $(command -v harness) — $(harness --version 2>/dev/null)" \
        || echo "⚠ linked at $(npm prefix -g)/bin/harness, but it is not on PATH. Add '$(npm prefix -g)/bin' to PATH, then reopen your shell."

# Remove the globally linked harness CLI (reverse of install-cli).
uninstall-cli:
    @npm rm -g harness-engineering >/dev/null 2>&1 \
        && echo "✓ removed global harness link." \
        || echo "harness was not linked (nothing to remove)."

# Auto-fix lint + safe fixes on the CLI source.
fix:
    npx biome check --write harness/cli

# Format the CLI source in place.
format:
    npx biome format --write harness/cli

# Run the CLI unit tests with coverage (report-only).
test:
    cd harness/cli && npx vitest run --coverage

# Regenerate the real telemetry-fixture goldens from the adapters (plan 037).
gen-telemetry-fixtures:
    npm run gen:telemetry-fixtures

# Drift guard: assert the committed telemetry goldens still match the adapters.
check-telemetry-fixtures:
    npm run check:telemetry-fixtures

# Lint authored markdown: markdownlint + in-repo links/anchors + mermaid syntax.
# Warn-launch: findings report as `degraded`/exit 0 (visible, non-blocking), so
# this never breaks the loop until authored docs are clean and the gate is promoted.
# Run via node (AGENTS.md: not npx) so it works from this working tree.
lint-md:
    node harness/cli/bin/harness.js markdown-lint

# Windows-compat lint: statically flag cross-platform anti-patterns in the
# extension verbs (POSIX shell-outs, /tmp, node:* in a verb, bare-.cmd launch).
# Warn-launch: findings report as `degraded`/exit 0 (visible, non-blocking), so
# this never breaks the loop until the verbs regress. By-construction proof of
# Windows compatibility with NO Windows runner (plan 031). Run via node (not npx).
windows-check:
    node harness/cli/bin/harness.js windows-check

# fix -> format -> test -> lint-md -> windows-check (the engineering loop).
fft: fix format test lint-md windows-check

# The mandated composite quality gate — the SAME command CI runs.
# Builds the core first (the bin + drift guards need dist/), then runs `harness checks`
# (tests+coverage, biome, typecheck, docs/flows/telemetry drift, arch/skills/markdown/windows).
checks:
    npm run build
    node harness/cli/bin/harness.js checks

# Install this clone's telemetry git hooks (sets core.hooksPath -> .githooks). ARMS BOTH:
#   pre-commit  — buffers ONE counts-only capture while HEAD is still the commit the work was
#                 based on, so file evidence anchors to the right commit (plan 068). Capture
#                 only: no sync, no push, no checks. Git HONOURS pre-commit's exit code, so
#                 that file is structurally exit-0 (`trap 'exit 0' EXIT`, `set -u` banned).
#                 Disarm just this one: export HARNESS_NO_TELEMETRY_PRECOMMIT=1
#   post-commit — runs ONLY `harness telemetry sync`, a counts-only push to
#                 refs/harness-telemetry/*, so each commit flushes buffered telemetry without
#                 the model having to remember. Git IGNORES its exit code.
# Neither is the old pre-push checks gate (no build, no tests, can't recurse: the sync push is
# --no-verify, and a capture cannot trigger a commit). `harness doctor` warns when the flush
# hook is missing and when the pre-commit hook's p95 goes over budget.
# Standalone + idempotent (NOT a build dependency — opt in once). Undo: `git config --unset core.hooksPath`.
install-hooks:
    @if ! git rev-parse --git-dir >/dev/null 2>&1; then \
        echo "… not a git checkout — skipping hook install"; \
    elif [ "$(git config --get core.hooksPath || true)" = ".githooks" ]; then \
        echo "✓ telemetry hooks already enabled (core.hooksPath=.githooks): pre-commit capture + post-commit flush."; \
    else \
        git config core.hooksPath .githooks && \
        echo "✓ telemetry hooks enabled (core.hooksPath=.githooks) — pre-commit buffers one capture, post-commit runs harness telemetry sync, on every commit."; \
    fi

# Generate a fresh throwaway test repo (for real agent/manual extension testing); prints its path.
test-repo dest="":
    @bash scripts/new-test-repo.sh "{{dest}}"
