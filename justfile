set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

# List available recipes.
default:
    @just --list

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
