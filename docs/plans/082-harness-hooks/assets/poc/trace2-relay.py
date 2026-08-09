#!/usr/bin/env python3
"""POC: relay sandbox-written trace2 event files into the git-ai daemon socket.

WHY THIS EXISTS
  A sandboxed agent shell cannot connect() to the daemon's unix socket — measured
  as EPERM on both control.sock and trace2.sock under Cursor's seatbelt. It CAN
  write files. The Cursor hook runner, by contrast, is NOT sandboxed (measured:
  CURSOR_SANDBOX unset, both sockets OK), so it can connect.

  So: point trace2 at a DIRECTORY the sandboxed shell can write, and let the
  unsandboxed hook stream those files into the socket. The daemon cannot tell the
  difference — proven on commit 2144a4d3 with a complete line-level note.

WHY A DIRECTORY AND NOT A FILE
  git creates ONE FILE PER PROCESS when the trace2 target is a directory. A single
  shared file would interleave concurrent git processes mid-line and there is no
  framing to recover it. Per-process files also make the relay idempotent BY
  CONSTRUCTION: a file is streamed once, then moved to relayed/. There is no offset
  to track and no way to double-send.

WHAT THIS DOES NOT DO
  Windows. The daemon channel there is a named pipe, not an AF_UNIX socket; the
  file-writing half is identical but the replay needs a different client.
"""

import os
import shutil
import socket
import sys
from datetime import datetime
from pathlib import Path

HOME = Path(os.path.expanduser("~"))
SOCK = HOME / ".git-ai" / "internal" / "daemon" / "trace2.sock"
LOG = Path("/tmp/trace2-relay.log")


def log(msg: str) -> None:
    with LOG.open("a") as f:
        f.write(f"{datetime.now().isoformat(timespec='seconds')} {msg}\n")


def relay_one(path: Path) -> tuple[bool, str]:
    """Stream one trace2 event file into the daemon. Returns (ok, detail)."""
    try:
        data = path.read_bytes()
    except OSError as e:
        return False, f"unreadable: {e}"
    if not data:
        return True, "empty"
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(5)
        s.connect(str(SOCK))
        s.sendall(data)
        # The daemon reads to EOF. Half-close so it sees the end of the stream
        # rather than waiting on a connection we are about to drop.
        s.shutdown(socket.SHUT_WR)
        s.close()
    except Exception as e:  # noqa: BLE001 — the errno IS the result
        return False, f"{type(e).__name__}: {e}"
    return True, f"{len(data)} bytes, {data.count(10)} lines"


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    events = Path(sys.argv[1]).expanduser()
    if not events.is_dir():
        log(f"SKIP no event dir at {events}")
        return 0

    done = events / "relayed"
    done.mkdir(exist_ok=True)

    pending = sorted(p for p in events.iterdir() if p.is_file())
    if not pending:
        return 0

    for p in pending:
        ok, detail = relay_one(p)
        if ok:
            # Move only on success. A failed relay stays pending and is retried by
            # the next hook invocation — losing an event is worse than sending twice,
            # and per-process files make a resend a no-op for the daemon anyway.
            shutil.move(str(p), str(done / p.name))
            log(f"RELAYED {p.name} — {detail}")
        else:
            log(f"FAILED  {p.name} — {detail}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
