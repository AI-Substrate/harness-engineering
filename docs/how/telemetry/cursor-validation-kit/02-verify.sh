#!/usr/bin/env bash
# Verify: await the daemon FIRST, then read notes and cross-check against the
# archived working logs. A trace id in the note but NOT in a checkpoint log was
# minted by commit-time recovery, not observed. See README §3.
set -euo pipefail
cd "${1:?usage: 02-verify.sh <repo>}"

echo "=== await (never check without this — you will race the daemon) ==="
git-ai await 2>&1 | tail -2

echo; echo "=== commits ==="; git log --oneline
echo; echo "=== notes ==="
for sha in $(git log --format=%h); do
  printf '\n--- %s  %s\n' "$sha" "$(git log -1 --format=%s "$sha")"
  git notes --ref=ai show "$sha" 2>/dev/null || echo "  (no note)"
done

echo; echo "=== archived working logs — checkpoint KINDS per parent ==="
for d in .git/ai/working_logs/old-*; do
  [ -f "$d/checkpoints.jsonl" ] || continue
  printf '\n--- %s\n' "$(basename "$d")"
  python3 - "$d/checkpoints.jsonl" <<'PY'
import json,sys
for line in open(sys.argv[1]):
    o=json.loads(line)
    a=o.get('agent_id') or {}
    print('   kind=%-10s trace=%-18s agent=%s' % (
        o.get('kind'), o.get('trace_id'), a.get('tool') if isinstance(a,dict) else a))
PY
done

echo; echo "Cross-check: any trace id in a NOTE but absent above was RECOVERY-minted."
