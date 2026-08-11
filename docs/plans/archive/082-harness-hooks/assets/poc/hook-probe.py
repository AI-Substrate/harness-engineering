#!/usr/bin/env python3
"""Record, from INSIDE the Cursor hook process, whether the daemon is reachable.

The agent's shell is sandboxed. The hook runner may or may not be — nobody has
measured it. If the hook can reach the sockets when the shell cannot, then the
hook is the place to do the daemon work, and the sandbox stops mattering.

Appends one line per invocation to /tmp/hook-probe.log. Never touches stdin, so
it can be chained ahead of the real hook command without disturbing it.
"""

import os
import socket
import sys
from datetime import datetime
from pathlib import Path

LOG = Path("/tmp/hook-probe.log")
BASE = Path(os.path.expanduser("~")) / ".git-ai" / "internal" / "daemon"


def connect(path: Path) -> str:
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(2)
        s.connect(str(path))
        s.close()
        return "OK"
    except Exception as e:  # noqa: BLE001 — the errno IS the result
        return f"FAIL[{type(e).__name__}:{getattr(e, 'errno', '?')}]"


def main() -> int:
    phase = sys.argv[1] if len(sys.argv) > 1 else "?"
    parts = [
        datetime.now().isoformat(timespec="seconds"),
        f"phase={phase}",
        f"sandbox={os.environ.get('CURSOR_SANDBOX', 'unset')}",
        f"ppid={os.getppid()}",
        f"control={connect(BASE / 'control.sock')}",
        f"trace2={connect(BASE / 'trace2.sock')}",
    ]
    with LOG.open("a") as f:
        f.write(" ".join(parts) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
