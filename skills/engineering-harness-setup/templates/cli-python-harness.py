#!/usr/bin/env python3
# foundations: first-principles#15, #21, #22, patterns-that-work#P11-P14
"""
Minimal repo-local engineering harness CLI.

This CLI is intentionally small. It provides a discoverable front door for the
project harness and wraps commands configured in harness/cli/commands.json. All
subcommands emit envelopes that conform to harness/templates/cli-envelope.schema.json
(when the template is materialised) — see the print_envelope() helper.

Process exit codes (per FR-04):
  0 = pass (status: pass)
  1 = fail (status: fail or others not in {pass, unconfigured})
  2 = unconfigured (status: unconfigured)
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
HARNESS_DIR = ROOT / "harness"
CONFIG_PATH = HARNESS_DIR / "cli" / "commands.json"
ONBOARD_DOC_PATH = HARNESS_DIR / "skills" / "onboard-agent-session.md"
MAGIC_WAND_PROMPT_PATH = HARNESS_DIR / "templates" / "magic-wand-prompt.md"

# --- Envelope helpers --------------------------------------------------------

ERROR_CODES = {
    "OK", "UNCONFIGURED", "AUTH_MISSING", "TIMEOUT", "INVALID_ARGS",
    "DEPENDENCY_MISSING", "HEALTH_CHECK_FAILED", "BUILD_FAILED",
    "TEST_FAILED", "PLACEHOLDER_LEAK", "UNKNOWN",
}

STATUSES = {
    "pass", "fail", "unconfigured", "degraded",
    "dry-run", "running", "skipped", "unknown",
}


def _exit_code_for(status: str) -> int:
    if status in {"pass", "dry-run", "skipped"}:
        return 0
    if status in {"unconfigured", "degraded"}:
        return 2
    return 1


def print_envelope(
    command: str,
    status: str,
    *,
    data: dict | None = None,
    error_code: str | None = None,
    error_message: str | None = None,
    next_action: str | None = None,
    messages: list[str] | None = None,
    as_json: bool = False,
) -> int:
    """Print a CLI envelope to stdout and return the process exit code."""
    assert status in STATUSES, f"invalid status: {status}"
    if error_code is not None:
        assert error_code in ERROR_CODES, f"invalid error.code: {error_code}"

    payload: dict[str, Any] = {"command": command, "status": status}
    if data is not None:
        payload["data"] = data
    if error_code or error_message:
        err: dict[str, Any] = {
            "code": error_code or "UNKNOWN",
            "message": error_message or "(no message)",
        }
        if next_action:
            err["next_action"] = next_action
        payload["error"] = err
    if messages:
        payload["messages"] = messages

    if as_json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        label = command
        print(f"[{status}] {label}")
        for line in messages or []:
            print(f"- {line}")
        if "error" in payload:
            print(f"error.code: {payload['error']['code']}")
            print(f"error.message: {payload['error']['message']}")
            if next_action:
                print(f"next: {next_action}")

    return _exit_code_for(status)


# --- Config helpers ----------------------------------------------------------

def load_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        return {}
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def command_string(name: str) -> str:
    cfg = load_config()
    return str((cfg.get("commands") or {}).get(name, "")).strip()


# --- Self-check: no placeholder leaks ---------------------------------------

_PLACEHOLDER_RE = re.compile(r"\{\{[A-Z_][A-Z0-9_]*\}\}")


def assert_no_placeholder_leaks() -> tuple[bool, list[str]]:
    """Return (ok, offending_paths). Called by validate at the end."""
    leaks: list[str] = []
    for rel in [HARNESS_DIR / "cli" / "commands.json", ROOT / "docs" / "project-rules" / "engineering-harness.md", ROOT / "AGENTS.md"]:
        if rel.exists() and _PLACEHOLDER_RE.search(rel.read_text(encoding="utf-8")):
            leaks.append(str(rel.relative_to(ROOT)))
    return (not leaks, leaks)


# --- Subcommands -------------------------------------------------------------

def cmd_doctor(args: argparse.Namespace) -> int:
    config_exists = CONFIG_PATH.exists()
    cfg = load_config()

    def command_slots(config: dict[str, Any]) -> tuple[list[str], list[str]]:
        configured_slots: list[str] = []
        unconfigured_slots: list[str] = []
        for name, value in (config.get("commands") or {}).items():
            if str(value).strip():
                configured_slots.append(name)
            else:
                unconfigured_slots.append(name)
        return configured_slots, unconfigured_slots

    configured, unconfigured = command_slots(cfg)

    deadline = time.monotonic() + (args.wait or 0)
    while True:
        # If --wait, retry doctor until config is loadable AND at least one command is configured.
        if config_exists and configured:
            break
        if time.monotonic() >= deadline:
            break
        time.sleep(1)
        # Re-load in case the user just finished editing config.json.
        cfg = load_config()
        config_exists = CONFIG_PATH.exists()
        configured, unconfigured = command_slots(cfg)

    health = cfg.get("health") or {}
    health_url = str(health.get("url", "")).strip()

    messages = [
        f"Repository root: {ROOT}",
        f"Harness command map: {'found' if config_exists else 'missing'} at {CONFIG_PATH}",
    ]
    if configured:
        messages.append("Configured commands: " + ", ".join(sorted(configured)))
    if unconfigured:
        messages.append("Unconfigured commands: " + ", ".join(sorted(unconfigured)))
    messages.append("Health URL: " + (health_url or "not configured"))

    status = "pass" if config_exists and configured else ("degraded" if config_exists else "unconfigured")
    error_code = None
    error_message = None
    if status == "unconfigured":
        error_code = "UNCONFIGURED"
        error_message = "harness/cli/commands.json is missing"
    elif status == "degraded":
        error_code = "DEPENDENCY_MISSING"
        error_message = "config loaded but no commands are configured yet"

    return print_envelope(
        "doctor",
        status,
        data={"configured": configured, "unconfigured": unconfigured, "health_url": health_url},
        error_code=error_code,
        error_message=error_message,
        next_action="Run validate --dry-run, then encode missing commands one at a time." if status != "pass" else None,
        messages=messages,
        as_json=args.json,
    )


def _run_shell(name: str, *, dry_run: bool, as_json: bool, quiet: bool = False) -> int:
    cmd = command_string(name)
    if not cmd:
        return print_envelope(
            name,
            "unconfigured",
            error_code="UNCONFIGURED",
            error_message=f"No command configured for '{name}' in harness/cli/commands.json.",
            next_action=f"Set commands.{name} in harness/cli/commands.json.",
            as_json=as_json,
        )

    if dry_run:
        return print_envelope(
            name, "dry-run",
            data={"would_run": cmd},
            messages=[f"Would run: {cmd}"],
            as_json=as_json,
        )

    effective_quiet = quiet or as_json
    completed = subprocess.run(
        cmd,
        shell=True,
        cwd=ROOT,
        stdout=subprocess.DEVNULL if effective_quiet else None,
        stderr=subprocess.DEVNULL if effective_quiet else None,
    )
    if completed.returncode == 0:
        return print_envelope(name, "pass", data={"ran": cmd}, as_json=as_json)
    err_code = "BUILD_FAILED" if name == "build" else ("TEST_FAILED" if name == "test" else "UNKNOWN")
    return print_envelope(
        name, "fail",
        data={"ran": cmd, "exit_code": completed.returncode},
        error_code=err_code,
        error_message=f"'{cmd}' exited with code {completed.returncode}.",
        as_json=as_json,
    )


def cmd_wrapped(name: str):
    def runner(args: argparse.Namespace) -> int:
        return _run_shell(name, dry_run=args.dry_run, as_json=args.json)
    return runner


def cmd_run(args: argparse.Namespace) -> int:
    """`run` is long-running. It refuses to spawn the child without --execute."""
    cfg = load_config()
    run_command = command_string("run")
    if not run_command:
        return print_envelope(
            "run",
            "unconfigured",
            error_code="UNCONFIGURED",
            error_message="No command configured for 'run' in harness/cli/commands.json.",
            next_action="Set commands.run to the repo's supported start command.",
            as_json=args.json,
        )
    if not (cfg.get("permissions") or {}).get("allow_run", False) and not args.execute:
        return print_envelope(
            "run", "dry-run",
            data={"would_run": run_command},
            messages=[
                "run is long-running and is dry-run by default.",
                "Pass --execute to actually start the product, or set permissions.allow_run=true.",
            ],
            as_json=args.json,
        )
    return _run_shell("run", dry_run=args.dry_run, as_json=args.json)


def cmd_health(args: argparse.Namespace) -> int:
    cfg = load_config()
    health_cfg = cfg.get("health") or {}
    url = str(health_cfg.get("url", "")).strip()
    timeout = int(health_cfg.get("timeout_seconds", 30))
    expected = int(health_cfg.get("expected_status", 200))

    if not url:
        if command_string("health"):
            return _run_shell("health", dry_run=args.dry_run, as_json=args.json, quiet=getattr(args, "quiet", False))
        return print_envelope(
            "health", "unconfigured",
            error_code="UNCONFIGURED",
            error_message="No health URL or commands.health configured in harness/cli/commands.json.",
            next_action="Add health.url or commands.health, then re-run.",
            as_json=args.json,
        )

    if args.dry_run:
        return print_envelope(
            "health", "dry-run",
            data={"would_request": url, "timeout_seconds": timeout},
            as_json=args.json,
        )

    start = time.time()
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            status_code = response.getcode()
            elapsed_ms = int((time.time() - start) * 1000)
            ok = status_code == expected
            return print_envelope(
                "health", "pass" if ok else "fail",
                data={"url": url, "http_status": status_code, "elapsed_ms": elapsed_ms},
                error_code=None if ok else "HEALTH_CHECK_FAILED",
                error_message=None if ok else f"expected {expected}, got {status_code}",
                as_json=args.json,
            )
    except Exception as exc:
        return print_envelope(
            "health", "fail",
            data={"url": url, "exception": str(exc)},
            error_code="HEALTH_CHECK_FAILED",
            error_message=f"Failed to reach {url}: {exc}",
            next_action="Check whether the product is running and whether the health URL is correct.",
            as_json=args.json,
        )


def cmd_validate(args: argparse.Namespace) -> int:
    """Layered validation. Reads `validation.<tier>` from config (AC-11).

    Notably: `validate` NEVER invokes `run` under any tier — long-running boot
    is locked behind explicit --execute on `run` itself (AC-15).
    """
    cfg = load_config()
    tier = args.tier
    steps = (cfg.get("validation") or {}).get(tier, [])
    if not steps:
        return print_envelope(
            "validate", "unconfigured",
            error_code="UNCONFIGURED",
            error_message=f"validation.{tier} is empty or missing in harness/cli/commands.json.",
            next_action=f"Add steps to validation.{tier} in harness/cli/commands.json.",
            as_json=args.json,
        )

    def call_step(fn):
        if not args.json:
            return fn()
        with contextlib.redirect_stdout(io.StringIO()):
            return fn()

    results: list[dict[str, Any]] = []
    overall_status = "pass"
    for step in steps:
        if step == "run":
            # AC-15: validate never invokes run.
            results.append({"step": step, "status": "skipped", "reason": "validate never invokes run; use --execute on run directly"})
            continue
        if step == "doctor":
            code = call_step(lambda: cmd_doctor(argparse.Namespace(json=False, wait=0)))
        elif step == "health":
            code = call_step(lambda: cmd_health(argparse.Namespace(json=False, dry_run=args.dry_run, quiet=args.json)))
        else:
            code = call_step(lambda: _run_shell(step, dry_run=args.dry_run, as_json=False, quiet=args.json))
        results.append({"step": step, "exit_code": code})
        if code == 1:
            overall_status = "fail"
        elif code == 2 and overall_status == "pass":
            overall_status = "degraded"

    # Final self-check: no placeholder leaks (AC-7).
    leaks_ok, leaks = assert_no_placeholder_leaks()
    if not leaks_ok:
        return print_envelope(
            "validate", "fail",
            data={"tier": tier, "results": results, "leaks": leaks},
            error_code="PLACEHOLDER_LEAK",
            error_message=f"Found unsubstituted placeholders in: {', '.join(leaks)}",
            next_action="Resolve placeholders or remove the affected templates before claiming validation.",
            as_json=args.json,
        )

    return print_envelope(
        "validate", overall_status,
        data={"tier": tier, "results": results},
        error_code="DEPENDENCY_MISSING" if overall_status == "degraded" else None,
        error_message="One or more validation steps are unconfigured." if overall_status == "degraded" else None,
        next_action="Configure the missing command slots in harness/cli/commands.json or remove them from the selected validation tier." if overall_status == "degraded" else None,
        as_json=args.json,
    )


def cmd_fft(args: argparse.Namespace) -> int:
    """Alias for `validate --tier proof` (FR-NEW-5)."""
    ns = argparse.Namespace(tier="proof", dry_run=args.dry_run, json=args.json)
    return cmd_validate(ns)


def cmd_onboard(args: argparse.Namespace) -> int:
    """Read the onboarding doc and print it. The CLI does NOT contain a hardcoded checklist (AC-9)."""
    if not ONBOARD_DOC_PATH.exists():
        return print_envelope(
            "onboard", "unconfigured",
            error_code="UNCONFIGURED",
            error_message=f"{ONBOARD_DOC_PATH.relative_to(ROOT)} is missing.",
            next_action="Run engineering-harness-setup to materialise the onboarding guide.",
            as_json=args.json,
        )
    content = ONBOARD_DOC_PATH.read_text(encoding="utf-8")
    if args.json:
        return print_envelope(
            "onboard", "pass",
            data={"path": str(ONBOARD_DOC_PATH.relative_to(ROOT)), "content": content},
            as_json=True,
        )
    print(content)
    return 0


def cmd_magic_wand(args: argparse.Namespace) -> int:
    """Read the magic-wand prompt template and echo it (AC-14 byte-identity)."""
    if not MAGIC_WAND_PROMPT_PATH.exists():
        # Inline canonical wording as a last-resort fallback.
        prompt = (
            "If you had a magic wand, what ONE thing would you change to make the next run "
            "easier, safer, faster, higher quality, or better proven? Be concrete — name a command, "
            "flag, output field, fixture, diagnostic, template, sensor, check, or workflow change."
        )
    else:
        content = MAGIC_WAND_PROMPT_PATH.read_text(encoding="utf-8")
        # Extract the line that begins with "If you had a magic wand,".
        prompt = next(
            (line.strip().lstrip("> ").strip() for line in content.splitlines()
             if "If you had a magic wand, what ONE thing" in line),
            "",
        )
    if args.json:
        return print_envelope("magic-wand", "pass", data={"prompt": prompt}, as_json=True)
    print(prompt)
    print()
    print("Back-pressure companion: What did the agent or reviewer have to infer that the harness should have proved?")
    print()
    print("Route reviewed candidates through docs/harness.")
    return 0


# --- argparse wiring ---------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    json_requested = "--json" in argv
    argv = [arg for arg in argv if arg != "--json"]

    parser = argparse.ArgumentParser(prog="harness", description="Repo-local engineering harness CLI")
    parser.add_argument("--json", action="store_true", help="Emit JSON envelopes on stdout")
    sub = parser.add_subparsers(dest="cmd")

    p_doctor = sub.add_parser("doctor", help="Check harness readiness and configuration")
    p_doctor.add_argument("--wait", type=int, default=0, help="Retry doctor for up to <sec> seconds while config or commands are missing")
    p_doctor.set_defaults(func=cmd_doctor)

    for name in ["install", "boot", "build", "test", "lint", "typecheck", "format_check", "observe", "smoke", "arch", "security", "schema", "codeql", "seed"]:
        p = sub.add_parser(name, help=f"Run configured '{name}' command")
        p.add_argument("--dry-run", action="store_true", help="Show command without running it")
        p.set_defaults(func=cmd_wrapped(name))

    p_run = sub.add_parser("run", help="Start the product (long-running; dry-run by default)")
    p_run.add_argument("--dry-run", action="store_true", help="Show command without running it")
    p_run.add_argument("--execute", action="store_true", help="Actually spawn the long-running child process")
    p_run.set_defaults(func=cmd_run)

    p_health = sub.add_parser("health", help="Check configured health URL")
    p_health.add_argument("--dry-run", action="store_true", help="Show health request without running it")
    p_health.set_defaults(func=cmd_health)

    p_validate = sub.add_parser("validate", help="Run layered validation")
    p_validate.add_argument("--tier", choices=["fast", "quick", "proof"], default="quick", help="Validation tier (default: quick)")
    p_validate.add_argument("--dry-run", action="store_true", help="Show steps without running them")
    p_validate.set_defaults(func=cmd_validate)

    p_fft = sub.add_parser("fft", help="Alias for validate --tier proof (Full Fat Test)")
    p_fft.add_argument("--dry-run", action="store_true", help="Show steps without running them")
    p_fft.set_defaults(func=cmd_fft)

    p_onboard = sub.add_parser("onboard", help="Print the harness/skills/onboard-agent-session.md content")
    p_onboard.set_defaults(func=cmd_onboard)

    p_magic = sub.add_parser("magic-wand", help="Print the harness improvement prompt")
    p_magic.set_defaults(func=cmd_magic_wand)

    args = parser.parse_args(argv)
    args.json = bool(args.json or json_requested)
    if not hasattr(args, "func"):
        parser.print_help()
        return 0
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
