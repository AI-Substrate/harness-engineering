#!/usr/bin/env bash
# The human step: ONE human-only commit, then a 14-line UNCOMMITTED block.
# The uncommitted block is what makes the agent's next commit genuinely MIXED.
# Length matters: edge extension claims at most 3 lines from each end of a run,
# so a block longer than 6 always leaves an unclaimed middle. Padding does NOT
# help — padding is itself unattributed and joins the same run. See README §4.
set -euo pipefail
cd "${1:?usage: 01-human-step.sh <repo>}"

cat >> lib.mjs <<'EOF'

export function square(x) {
  return x * x;
}
EOF
printf '\n- `square(x)` added by a human script.\n' >> README.md
git add lib.mjs README.md
HARNESS_NO_TELEMETRY=1 git commit -q -m "feat: square (HUMAN script, no agent)"

cat >> lib.mjs <<'EOF'

export function summarise(values) {
  if (!Array.isArray(values)) {
    throw new TypeError("summarise expects an array");
  }
  const total = values.reduce((a, b) => a + b, 0);
  const count = values.length;
  return {
    total,
    count,
    mean: count === 0 ? 0 : total / count,
    min: count === 0 ? null : Math.min(...values),
    max: count === 0 ? null : Math.max(...values),
  };
}
EOF

echo "committed: $(git log --oneline -1)"
echo
echo "GROUND TRUTH — write this down BEFORE reading any note:"
cat -n lib.mjs | tail -20
echo
git status --short
