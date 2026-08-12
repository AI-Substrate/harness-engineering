#!/usr/bin/env python3
"""Print environment facts and local daemon connectivity for this machine."""

import hashlib
import os
import platform
import socket
import sys
import tempfile
from pathlib import Path

WIN = platform.system() == "Windows"


def resolve(name: str) -> tuple[Path, str]:
    internal = Path(os.path.expanduser("~")) / ".git-ai" / "internal"
    digest = hashlib.sha256(str(internal).encode()).hexdigest()[:16]
    if WIN:
        return Path(rf"\\.\pipe\git-ai-{digest}-{name}"), "windows-named-pipe"
    direct = internal / "daemon" / f"{name}.sock"
    if len(str(direct)) >= 100:
        short = "trace" if name == "trace2" else name
        return Path(tempfile.gettempdir()) / f"git-ai-d-{digest}" / f"{short}.sock", "relocated-long-path"
    return direct, "direct"


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
    print(f"=== environment + daemon connectivity [{label}] ===")
    print(f"platform      : {platform.system()} {platform.machine()}")
    print(f"HOME          : {os.environ.get('HOME') or os.environ.get('USERPROFILE')}")
    print(f"TMPDIR        : {os.environ.get('TMPDIR') or tempfile.gettempdir()}")
    print(f"cwd           : {os.getcwd()}")
    for k in ("CURSOR_SANDBOX", "CURSOR_CONVERSATION_ID", "CURSOR_TRACE_ID"):
        print(f"{k:<14}: {os.environ.get(k, '(unset)')}")

    # BOTH channels. They fail independently and cause different damage:
    #   control -> the pre-command human checkpoint
    #   trace2  -> the daemon ever learning a commit happened
    for name in ("control", "trace2"):
        path, branch = resolve(name)
        exists = path.exists() if not WIN else "(n/a for named pipe)"
        print(f"--- {name}")
        print(f"  resolve     : {branch}")
        print(f"  path        : {path}")
        print(f"  exists      : {exists}")
        print(f"  connect()   : {connect(path)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
