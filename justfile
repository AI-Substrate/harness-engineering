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
# Refuse to repoint the machine-global link from a linked worktree. "Root checkout
# only" was policy in a comment; a comment is a remembered chore, not a control —
# and the steal it warns about happened three times in one night while everyone
# agreed with the policy. In the root checkout `git rev-parse --git-dir` is `.git`;
# in a worktree it is a path under `.git/worktrees/`, so this is exact, not a guess.
_require-root-checkout:
    @test "$(git rev-parse --git-dir)" = ".git" || { \
        echo "REFUSED: this is a linked worktree, not the root checkout."; \
        echo "  The global \`harness\` must be linked from the root checkout so the machine"; \
        echo "  serves main, not whatever branch a worktree happens to be on."; \
        echo "  Build here instead: just build   (then: node harness/cli/dist/index.js ...)"; \
        exit 1; }

# Point the global `harness` at this working tree (root checkout only).
link: _require-root-checkout
    npm link --ignore-scripts
    @echo "Linked: $(command -v harness) -> this working tree. Try: harness docs"

# Install the harness CLI globally from THIS working tree (npm link).
# Builds first (gen:docs + tsc -> dist), then symlinks `harness` onto your PATH
# at $(npm prefix -g)/bin, pointing at harness/cli/bin/harness.js. The link is
# LIVE: re-run this (or `just build`) after changes to refresh the dist it serves.
# Undo with `just uninstall-cli`.
install-cli: _require-root-checkout
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

# Run the CLI unit tests with coverage (report-only). FAST scope by default —
# the 12 slow files (see SLOW_TESTS in harness/cli/vitest.config.ts) are skipped,
# which is ~81% of the runtime for 5% of the tests. Every fast run prints what it
# skipped. Use `just test-all` before pushing; CI always runs everything.
test:
    cd harness/cli && npx vitest run --coverage

# The 12 slow files ONLY (real git, fixture repos, PTY). Rarely needed directly —
# `just test-all` is usually what you want.
test-heavy:
    cd harness/cli && HARNESS_TEST_SCOPE=slow npx vitest run

# The FULL suite — the same scope CI gates on. Run before pushing.
test-all:
    cd harness/cli && HARNESS_TEST_SCOPE=all npx vitest run --coverage

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

# Dispatch CI on a branch. CI NO LONGER auto-runs on a PR-branch push (see the
# `on:` block in .github/workflows/ci.yml) — the required `ci-verdict` status is
# absent until someone asks for it, so an untested PR stays unmergeable.
#
# The footgun this recipe exists to close: `workflow_dispatch` tests the sha that
# is ON THE REMOTE, not the one in your working tree, and the verdict binds to
# THAT sha. Dispatch with unpushed commits and you get a green verdict against
# code you did not write — so this refuses when they disagree.
#
# Dispatch CI on a branch (default: current) — CI does not auto-run on push.
ci ref="":
    @r="{{ref}}"; r="${r:-$(git rev-parse --abbrev-ref HEAD)}"; \
    head="$(git rev-parse --abbrev-ref HEAD)"; \
    git fetch --quiet origin "$r" 2>/dev/null \
      || { echo "no origin/$r — push the branch first: git push -u origin $r"; exit 1; }; \
    remote="$(git rev-parse FETCH_HEAD)"; \
    if [ "$r" = "$head" ] && [ "$(git rev-parse HEAD)" != "$remote" ]; then \
      echo "REFUSING: local HEAD $(git rev-parse --short HEAD) != origin/$r $(git rev-parse --short FETCH_HEAD)."; \
      echo "CI would test the remote sha and the required check would bind to it. Push first."; \
      exit 1; \
    fi; \
    echo "==> dispatching CI on $r @ $(git rev-parse --short FETCH_HEAD)"; \
    gh workflow run ci.yml --ref "$r"; \
    echo "==> watch: gh run list --workflow=ci.yml --branch $r"

# Generate a fresh throwaway test repo (for real agent/manual extension testing); prints its path.
test-repo dest="":
    @bash scripts/new-test-repo.sh "{{dest}}"

# ---------------------------------------------------------------------------
# POST-MERGE DEPLOY — one command, so it stops being a memory exercise.
#
# Jordan's standing instruction: after EVERY merged PR, the machine must be put
# back on main — latest source, built CLI, global link pointing at main, skills
# deployed. Each of those four was already possible and all four depended on
# someone remembering. Tonight the skills half was THREE WEEKS STALE and it cost
# a whole plan: a Jul-15 builder authored plan 072 for a tool that reads Aug-4
# plans, and `harness plan ready` answered E400 on its own plan. Eleven green
# `harness checks` runs never mentioned it — `check:doctrine-parity` guards the
# mirrored doctrine block, not deploy freshness.
#
# The link step is the one with teeth: a linked WORKTREE silently redirects every
# other seat's `harness` call to an in-flight, possibly-broken build, and nothing
# in the envelope reveals which binary answered. See docs/project-rules/rules.md.
local-deploy: _require-root-checkout
    @echo "==> 1/5 sync main"
    git fetch origin main --quiet
    git merge --ff-only origin/main
    @echo "==> 2/5 build"
    npm run build
    @echo "==> 3/5 link global at main"
    npm link --ignore-scripts
    @echo "==> 4/5 deploy skills"
    @just install-skills-from-source
    @echo "==> 5/5 PROVE the global is main, not a worktree"
    @just verify-global-link

# Assert the machine-global `harness` resolves inside the ROOT checkout.
#
# A rule that must be remembered is not a control — the same failure mode as the
# stale skills this recipe exists to prevent. `doctor`'s version-skew layer does
# NOT catch this: it reported "running 0.13.0 matches the repo (no stale install
# shadowing)" while the global pointed into a worktree, because the version
# matched. Version identity is not path identity.
verify-global-link:
    @resolved="$(readlink -f "$(command -v harness 2>/dev/null)" 2>/dev/null || true)"; \
    root="$(git rev-parse --show-toplevel)"; \
    if [ -z "$resolved" ]; then \
        echo "NOT-PROBEABLE: no global \`harness\` on PATH — absence is not a pass."; exit 1; \
    fi; \
    case "$resolved" in \
        *-worktrees/*) echo "FAIL: global \`harness\` resolves INSIDE A WORKTREE:"; \
                       echo "  $resolved"; \
                       echo "  Every seat's \`harness\` call is running that in-flight build."; \
                       echo "  Fix from the root checkout: just local-deploy"; exit 1;; \
    esac; \
    case "$resolved" in \
        "$root"/*) echo "OK: global harness -> $resolved";; \
        *)         echo "FAIL: global \`harness\` resolves OUTSIDE this checkout:"; \
                   echo "  $resolved"; \
                   echo "  expected under: $root"; exit 1;; \
    esac
