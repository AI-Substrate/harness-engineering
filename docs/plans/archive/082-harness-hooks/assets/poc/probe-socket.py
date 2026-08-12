#!/usr/bin/env python3
"""Report how git-ai's hook would RESOLVE and REACH its daemon control channel.

Run it twice: once from a normal shell, once from inside the agent's shell tool.
The DIFFERENCE between the two runs is the finding. Either run can succeed —
that is deliberate; a probe that cannot report success only measures itself.

Mirrors git-ai daemon.rs DaemonConfig::from_internal_dir at v1.6.21:
  unix     <internal_dir>/daemon/control.sock
           ...unless that path is >= 100 chars, in which case it relocates to
           <tempdir>/git-ai-d-<first16 of sha256(internal_dir)>/control.sock
  windows  \\\\.\\pipe\\git-ai-<first16 of sha256(internal_dir)>-control

internal_dir comes from HOME, so a sandbox that rewrites HOME (or TMPDIR on the
long-path branch) makes the hook compute a channel that never existed. That
failure is INDISTINGUISHABLE from a permission denial unless you print the path.
"""

import hashlib
import os
import platform
import socket
import sys
import tempfile
from pathlib import Path

WIN = platform.system() == "Windows"


def resolve() -> tuple[Path, str]:
    internal = Path(os.path.expanduser("~")) / ".git-ai" / "internal"
    digest = hashlib.sha256(str(internal).encode()).hexdigest()[:16]
    if WIN:
        return Path(rf"\\.\pipe\git-ai-{digest}-control"), "windows-named-pipe"
    direct = internal / "daemon" / "control.sock"
    if len(str(direct)) >= 100:
        return Path(tempfile.gettempdir()) / f"git-ai-d-{digest}" / "control.sock", "unix-relocated-long-path"
    return direct, "unix-direct"


def connect(path: Path) -> str:
    try:
        if WIN:
            with open(path, "r+b", buffering=0):
                return "CONNECTED"
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(3)
        s.connect(str(path))
        s.close()
        return "CONNECTED"
    except Exception as e:  # noqa: BLE001 — the errno IS the result
        return f"REFUSED ({type(e).__name__}: {e})"


def main() -> int:
    label = sys.argv[1] if len(sys.argv) > 1 else "unlabelled"
    path, branch = resolve()
    print(f"=== git-ai control-channel probe [{label}] ===")
    print(f"platform      : {platform.system()} {platform.machine()}")
    print(f"HOME          : {os.environ.get('HOME') or os.environ.get('USERPROFILE')}")
    print(f"TMPDIR        : {os.environ.get('TMPDIR') or tempfile.gettempdir()}")
    print(f"cwd           : {os.getcwd()}")
    for k in ("CURSOR_SANDBOX", "CURSOR_CONVERSATION_ID", "CURSOR_TRACE_ID"):
        print(f"{k:<14}: {os.environ.get(k, '(unset)')}")
    print(f"resolve branch: {branch}")
    print(f"control path  : {path}")
    print(f"path exists   : {path.exists() if not WIN else '(n/a for named pipe)'}")
    print(f"connect()     : {connect(path)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
