set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

# List available recipes.
default:
    @just --list

# List the skill discoverable from this working tree via Vercel's skills CLI.
list-skills:
    @npx skills@latest add "$(pwd)" -l

# Install the repo skill project-local to supported CLIs from this working tree.
install-skills-local:
    @npx skills@latest add "$(pwd)" \
        -a claude-code \
        -a codex \
        -a opencode \
        -a github-copilot \
        -a pi \
        -y

# Install the repo skill globally to supported CLIs from this working tree.
install-skills-global:
    @npx skills@latest add "$(pwd)" \
        -a claude-code \
        -a codex \
        -a opencode \
        -a github-copilot \
        -a pi \
        -g \
        -y

# Install the repo skill globally from this working tree, matching the tools repo command name.
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
# Build the CLI (docs + tsc) and (re)link `harness` globally to this working tree.
build:
    npm run build
    npm link --ignore-scripts
    @echo "Linked: $(command -v harness) -> this working tree. Try: harness docs"

# Auto-fix lint + safe fixes on the CLI source.
fix:
    npx biome check --write harness/cli

# Format the CLI source in place.
format:
    npx biome format --write harness/cli

# Run the CLI unit tests with coverage (report-only).
test:
    cd harness/cli && npx vitest run --coverage

# fix -> format -> test (the engineering loop).
fft: fix format test

# Generate a fresh throwaway test repo (for real agent/manual extension testing); prints its path.
test-repo dest="":
    @bash scripts/new-test-repo.sh "{{dest}}"
