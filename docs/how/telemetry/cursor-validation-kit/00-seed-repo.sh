#!/usr/bin/env bash
# Seed the validation repo with ONE human commit made by a plain script (no agent).
# The seed is deliberately noteless at first — see README §1. That is a PASS.
set -euo pipefail

R="${1:-$HOME/temp/gitai-validation-$(date +%Y%m%d)}"
rm -rf "$R"; mkdir -p "$R"; cd "$R"

git init -q
# Use your real identity: the blanket-h_ note names the commit's git author.
git config user.name  "$(git config --global user.name)"
git config user.email "$(git config --global user.email)"

printf '# Attribution test\n\nScratch repo for validating git-ai line-level attribution.\n' > README.md
printf 'export function ident(x) {\n  return x;\n}\n' > lib.mjs

git add README.md lib.mjs
HARNESS_NO_TELEMETRY=1 git commit -q -m "seed: baseline made by a HUMAN script, no agent involved"

echo "repo:  $R"
git log --oneline
echo
echo "global trace2 target: $(git config --global --get trace2.eventTarget || echo '(unset — capture will not work)')"
echo "seed note (expect NONE right now, blanket h_ later — both are a PASS):"
git notes --ref=ai show HEAD 2>&1 | head -5 || true
