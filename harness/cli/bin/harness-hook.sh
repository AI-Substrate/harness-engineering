#!/bin/sh
# harness-hook.sh - resolve a node interpreter at FIRE time, then run the CLI.
#
# WHY THIS EXISTS. A hook entry used to name an absolute interpreter path captured
# from process.execPath at install time. That path is the least stable thing in the
# entry: `nvm use` repoints it, `nvm uninstall` deletes the version directory, a
# homebrew upgrade retires /opt/homebrew/Cellar/node/<version>/, a devcontainer
# rebuild swaps a system node for an nvm one. MEASURED: a WSL devcontainer's entry
# named /usr/local/bin/node while node was actually at
# /usr/local/share/nvm/versions/node/v24.19.0/bin/node. The script was present the
# whole time. And because a hook exits 0 and prints nothing by contract, the failure
# was SILENT - it reported nowhere, on any surface, for as long as it lasted.
#
# WHAT IS PRECEDENTED HERE AND WHAT IS NOT. Shipping a wrapper that resolves at exec
# time is mainstream: pyenv, volta, asdf and mise are all built on it, and npm's own
# cmd-shim generates three per binary (.cmd, .ps1, and a POSIX shim) which resolve
# node relative to themselves and fall back to PATH. SOURCING a version manager from
# inside a wrapper is attested nowhere - the shim-shippers are version managers and
# never need to, and husky (the closest analogue: a node CLI invoked from hooks)
# explicitly declined and hands it to a user-populated init file instead.
#
# So the order below does the PRECEDENTED things first and treats anything novel as a
# last resort. Each step records WHICH step resolved it, so the novel steps can be
# deleted on evidence rather than argued about.
#
# POSIX sh, deliberately. Not bash: a hook is spawned by whatever the agent uses, and
# on a minimal container /bin/sh may be dash. Nothing here may need bash.

set -u

# CORE UTILITIES MUST RESOLVE EVEN IF PATH IS HOSTILE, or the failure path cannot
# report its own failure. This script uses dirname/date/mkdir/sed/mv, and a hook is
# spawned by whatever environment the agent happens to hand us. MEASURED while
# testing this file: with a deliberately broken PATH the script died at exit 127
# before reaching `record_failure` and wrote NOTHING - reproducing, in the very code
# written to remove silent failure, the silent failure it removes.
#
# Appending (never replacing) keeps the caller's own PATH first, so step 2 still
# measures what the agent actually provides rather than what we bolted on.
PATH="${PATH:-}:/usr/bin:/bin:/usr/sbin:/sbin"
export PATH

# shellcheck disable=SC1007  # `CDPATH= cmd` is a deliberate env prefix, not an assignment
HARNESS_HOOK_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
HARNESS_SCRIPT="$HARNESS_HOOK_DIR/harness.js"

# The cache and the failure log live under the USER'S HOME, never in the repository
# being observed. `hook-payload.ts` requires that the hook leave no trace in the tree
# the agent is working in, and a test pins it. It is also correct on the merits: the
# interpreter is a property of the MACHINE, not of a checkout, so a per-repo cache
# would re-resolve in every clone to reach the same answer.
HARNESS_STATE_DIR="${HOME:-/tmp}/.harness/hooks"
HARNESS_CACHE="$HARNESS_STATE_DIR/interpreter"
HARNESS_FAILLOG="$HARNESS_STATE_DIR/interpreter-failures.log"

# The lowest node this CLI runs on. A cached-but-ancient interpreter resolves
# successfully and then fails inside node, one layer below anything that could
# explain it - so the cache stores the version and this is what it is compared to.
HARNESS_MIN_NODE=22

# ---------------------------------------------------------------------------
# record_failure - the cheapest and most valuable line in this file.
#
# When no interpreter can be found, the shell is the only thing still running: node
# is by definition unavailable, so nothing written in TypeScript can report it. This
# is why the failure is recorded HERE.
#
# IT IS DELIBERATELY NOT THE FIRE JOURNAL. fires.jsonl has exactly one writer
# (FileHookJournal) and one schema. A shell writer emitting the same records would
# make two writers of one schema with no contract between them - the writer-shape
# defect class this project has already paid for once. So this is a separate file
# with a deliberately trivial fixed-field format that no one could mistake for the
# journal.
# ---------------------------------------------------------------------------
record_failure() {
  mkdir -p "$HARNESS_STATE_DIR" 2>/dev/null || return 0
  printf '%s\tno-interpreter\t%s\t%s\n' \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || echo unknown)" \
    "${1:-}" \
    "${PATH:-}" \
    >>"$HARNESS_FAILLOG" 2>/dev/null || true
}

# usable <path> - is this a node we can actually run, and new enough?
usable() {
  [ -n "${1:-}" ] || return 1
  [ -x "$1" ] || return 1
  _v=$("$1" -e 'process.stdout.write(String(process.versions.node.split(".")[0]))' 2>/dev/null) || return 1
  [ -n "$_v" ] || return 1
  [ "$_v" -ge "$HARNESS_MIN_NODE" ] 2>/dev/null || return 1
  RESOLVED_VERSION="$_v"
  return 0
}

# ---------------------------------------------------------------------------
# STEP 0 - the cache. One read and one exec test on the happy path.
#
# A STALE-BUT-WORKING CACHE IS ACCEPTABLE, and that is what makes this safe. We are
# not resolving the PROJECT's node - we are resolving AN interpreter able to run OUR
# CLI. So a cache that keeps pointing at a perfectly good node after `nvm use`
# switched the shell's default is not wrong, it is stable. Do not "improve" this into
# tracking the project's node version; that reintroduces every hard invalidation
# question this design avoids.
# ---------------------------------------------------------------------------
RESOLVED=""
RESOLVED_STEP=""
RESOLVED_VERSION=""
# Tracked SEPARATELY from RESOLVED_STEP, and that separation is the point: the cache
# stores the step that ORIGINALLY resolved the interpreter (`path`, `manager-shim`,
# …) and we must preserve it, because "which step is earning its keep across the
# fleet" is the question that decides whether the unprecedented steps survive. A
# first attempt reused RESOLVED_STEP to mean both "how was it found" and "was it
# cached", so a cache hit never looked like one and the file was rewritten on EVERY
# fire - measured: the cache churned between two consecutive runs. That is a write
# per hook, twice per tool call, on a path whose whole promise is that it is
# read-only when warm.
FROM_CACHE=0

if [ -r "$HARNESS_CACHE" ]; then
  _cached=$(sed -n 's/^path=//p' "$HARNESS_CACHE" 2>/dev/null | head -n 1)
  if usable "$_cached"; then
    RESOLVED="$_cached"
    RESOLVED_STEP=$(sed -n 's/^step=//p' "$HARNESS_CACHE" 2>/dev/null | head -n 1)
    [ -n "$RESOLVED_STEP" ] || RESOLVED_STEP=unknown
    FROM_CACHE=1
    # THE CACHED PATH CAN STAY VALID WHILE ITS RECORDED VERSION GOES STALE, and the
    # stale value is the dangerous half. MEASURED on an nvm box: the cached path was
    # a symlink recorded as version=24; the symlink was repointed at v22; `usable`
    # passed (executable, still >= the minimum) so the entry was accepted and never
    # rewritten - leaving the cache asserting a node version that no longer existed
    # there.
    #
    # The PATH staying is correct and deliberate (stale-but-working is the whole
    # point). The VERSION being wrong is not: `hooks status` reports this file, so a
    # false field here is a false fact on an operator's screen - the exact class of
    # invisible wrongness this plan exists to remove. `usable` has already computed
    # the true version, so correcting it costs one comparison and a rare write, and
    # the resolution STEP is preserved because the path did not change.
    _cached_version=$(sed -n 's/^version=//p' "$HARNESS_CACHE" 2>/dev/null | head -n 1)
    [ "$_cached_version" = "$RESOLVED_VERSION" ] || FROM_CACHE=0
  fi
fi

if [ -z "$RESOLVED" ]; then
  # STEP 1 - a user-owned init file, sourced first so it can override everything.
  # husky's model, and the one pattern the ecosystem HAS converged on for this
  # problem. It exists for the setups we cannot anticipate.
  _init="${XDG_CONFIG_HOME:-$HOME/.config}/harness/init.sh"
  if [ -r "$_init" ]; then
    # shellcheck disable=SC1090
    . "$_init" 2>/dev/null || true
    _c=$(command -v node 2>/dev/null || true)
    if usable "$_c"; then RESOLVED="$_c"; RESOLVED_STEP=init; fi
  fi
fi

if [ -z "$RESOLVED" ]; then
  # STEP 2 - PATH. The most likely to succeed and the cheapest: the agent invoking
  # this hook is itself usually a node process, so the environment it spawns us into
  # generally already carries a working node. The original defect was NOT an empty
  # PATH - it was an entry that named an interpreter explicitly and never consulted
  # PATH at all.
  _c=$(command -v node 2>/dev/null || true)
  if usable "$_c"; then RESOLVED="$_c"; RESOLVED_STEP=path; fi
fi

if [ -z "$RESOLVED" ]; then
  # STEP 3 - relative to ourselves. npm's own shim trick: a package installed into
  # <prefix>/lib/node_modules/... has its interpreter at <prefix>/bin/node. Free for
  # us, because this wrapper ships inside the package and therefore knows where it
  # was installed.
  _p="$HARNESS_HOOK_DIR"
  while [ "$_p" != "/" ] && [ -n "$_p" ]; do
    _parent=$(dirname -- "$_p")
    if [ "$(basename -- "$_p")" = "node_modules" ] && [ "$(basename -- "$_parent")" = "lib" ]; then
      _c="$(dirname -- "$_parent")/bin/node"
      if usable "$_c"; then RESOLVED="$_c"; RESOLVED_STEP=relative-to-self; fi
      break
    fi
    _p="$_parent"
  done
fi

if [ -z "$RESOLVED" ]; then
  # STEP 4 - stable per-manager shim directories. These exist for four of the five
  # managers and are the managers' OWN supported entry points, so using them is the
  # precedented path rather than a workaround.
  #
  # nvm is absent from this list ON PURPOSE: it has no stable path by default
  # ($NVM_DIR/current exists only when NVM_SYMLINK_CURRENT=true), which is exactly
  # why the machine that reported this bug is the one this step cannot help.
  for _c in \
    "${VOLTA_HOME:-$HOME/.volta}/bin/node" \
    "${MISE_DATA_DIR:-$HOME/.local/share/mise}/shims/node" \
    "${ASDF_DATA_DIR:-$HOME/.asdf}/shims/node" \
    "${FNM_DIR:-$HOME/.fnm}/aliases/default/bin/node"
  do
    if usable "$_c"; then RESOLVED="$_c"; RESOLVED_STEP=manager-shim; break; fi
  done
fi

if [ -z "$RESOLVED" ]; then
  # STEP 5 - conventional install locations. Last of the cheap checks.
  for _c in /usr/local/bin/node /opt/homebrew/bin/node /usr/bin/node; do
    if usable "$_c"; then RESOLVED="$_c"; RESOLVED_STEP=well-known; break; fi
  done
fi

# STEP 6 - SOURCING A VERSION MANAGER IS DELIBERATELY NOT IMPLEMENTED YET.
#
# It is the only unprecedented step in this design and it is the expensive one
# (sourcing nvm is reported in the hundreds of milliseconds, and a hook fires twice
# per tool call). It is therefore gated on a measurement that has not been taken:
# whether PATH alone already resolves in the environment a hook is actually spawned
# into on the machine that reported the fault. If it does, this step is never needed
# and must not be written; if it does not, that measurement is what justifies it.
# The `step=` field written below is what will answer that question from real
# machines rather than from argument.

if [ -z "$RESOLVED" ]; then
  # Nothing found. Record it - in shell, because there is no node to record it with -
  # and exit 0 REGARDLESS on the FIRE path. A hook must never break the agent it
  # observes.
  #
  # CHECK MODE IS THE ONE EXCEPTION, and it is deliberate: `hooks status` is an
  # operator asking a question, not an agent mid-tool-call, so it is the one caller
  # that MUST be told the truth by exit code. Silence is the right answer to an agent
  # and the wrong answer to a person.
  record_failure "no usable node >= $HARNESS_MIN_NODE"
  if [ "${1:-}" = "--harness-hook-check" ]; then
    echo "step=none"
    exit 1
  fi
  exit 0
fi

# Write the cache atomically. Hooks fire in parallel - plan 082 measured three
# concurrent tool calls and ~38 invocations in a single run - so a partial write from
# one process could be read by another. temp+rename makes the swap atomic, the same
# discipline the journal already uses.
if [ "$FROM_CACHE" -eq 0 ]; then
  mkdir -p "$HARNESS_STATE_DIR" 2>/dev/null && {
    _tmp="$HARNESS_CACHE.$$"
    {
      printf 'path=%s\n' "$RESOLVED"
      printf 'version=%s\n' "$RESOLVED_VERSION"
      printf 'step=%s\n' "$RESOLVED_STEP"
      printf 'at=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || echo unknown)"
    } >"$_tmp" 2>/dev/null && mv -f "$_tmp" "$HARNESS_CACHE" 2>/dev/null || rm -f "$_tmp" 2>/dev/null
  } || true
fi

# CHECK MODE - what `hooks status` invokes instead of stat-ing this file.
#
# WHY STATUS MUST INVOKE RATHER THAN STAT. A wrapper that exists but cannot find an
# interpreter is indistinguishable, to `Test-Path`/`fs.exists`, from one that works.
# That is the false green this whole plan exists to remove, one layer up: before the
# wrapper, status checked the script and never the interpreter; after it, status would
# check the wrapper and never its resolution. Invoking is the only thing that answers
# the question actually being asked - CAN THIS RUN.
#
# IT IS AFFORDABLE BY DEFAULT, and that is why it is not gated behind a flag like the
# InvocationProbe is. Everything above this line is pure shell: no node is started, so
# the cost is a fork rather than a CLI boot. The probe's default-off reasoning does not
# transfer, and "symmetry" is not a reason to disable a check that costs nothing.
#
# On Windows it earns a second keep: a .ps1 blocked by execution policy fails HERE,
# visibly, where a stat would have reported the file present and healthy.
if [ "${1:-}" = "--harness-hook-check" ]; then
  printf 'path=%s\nversion=%s\nstep=%s\n' "$RESOLVED" "$RESOLVED_VERSION" "$RESOLVED_STEP"
  exit 0
fi

exec "$RESOLVED" --no-warnings "$HARNESS_SCRIPT" "$@"
