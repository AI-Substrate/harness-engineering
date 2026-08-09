#!/usr/bin/env python3
"""Write a file as a HUMAN would — no agent env survives into this process.

git-ai identifies an agent from the environment its hook runs in. A plain script
whose env carries no agent markers is, to every adapter, a person typing. This
scrubs the markers at import so every subprocess inherits the clean env too.

Usage:
  python3 seed-human.py <repo>          write HUMAN.md with numbered lines
  python3 seed-human.py <repo> --check  prove the env is clean, write nothing
"""

import os
import subprocess
import sys
from pathlib import Path

SCRUB_EXACT = {
    "AI_AGENT",
    "AGENT_TRANSCRIPTS",
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_SESSION_ID",
    "COPILOT_AGENT_SESSION_ID",
    "CURSOR_CONVERSATION_ID",
}
SCRUB_PREFIXES = ("CLAUDE_", "CURSOR_", "COPILOT_")

REMOVED = []
for _k in list(os.environ):
    if _k in SCRUB_EXACT or _k.startswith(SCRUB_PREFIXES):
        REMOVED.append(_k)
        del os.environ[_k]

# Each line is uniquely identifiable, so the note can be read line by line
# instead of trusting a total. A count tells you something moved; an identity
# tells you WHICH line moved.
LINES = [f"HUMAN-LINE-{i:02d} written by a person, not an agent\n" for i in range(1, 9)]


def main() -> int:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    repo = Path(sys.argv[1]).resolve()
    check = "--check" in sys.argv

    print(f"scrubbed: {sorted(REMOVED) or '(env was already clean)'}")
    probe = subprocess.run(
        [sys.executable, "-c",
         "import os;k=[x for x in os.environ if x.startswith(('CLAUDE_','CURSOR_','COPILOT_'))"
         " or x in {'AI_AGENT','CLAUDECODE','AGENT_TRANSCRIPTS'}];"
         "print('LEAKED:'+','.join(k) if k else 'CLEAN')"],
        capture_output=True, text=True,
    )
    verdict = probe.stdout.strip()
    print(f"subprocess env: {verdict}")
    if verdict != "CLEAN":
        print("ABORT — an agent marker survived; this would not read as human.")
        return 1
    if check:
        return 0

    target = repo / "HUMAN.md"
    target.write_text("# Written by hand\n\n" + "".join(LINES))
    print(f"wrote {target} ({len(LINES)} identifiable lines)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
