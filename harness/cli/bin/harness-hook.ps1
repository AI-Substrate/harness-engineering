# harness-hook.ps1 - resolve a node interpreter at FIRE time, then run the CLI.
#
# The PowerShell twin of harness-hook.sh. Read that file's header for why this
# exists; only the Windows-specific differences are noted here.
#
# ASCII ONLY, INCLUDING COMMENTS. A non-ASCII byte (an em dash is the usual culprit)
# makes PS 5.1 report "The string is missing the terminator" against the WRONG line
# and blame quoting - an hour lost to a character you cannot see.
#
# EXECUTION POLICY - MEASURED, not assumed. On a Windows 11 host with
# CurrentUser=RemoteSigned and no policy flag anywhere in the chain:
#   a plain shipped .ps1                  -> RUNS (exit 0)
#   the same file carrying Mark-of-the-Web -> BLOCKED, "is not digitally signed"
# npm-extracted files carry no MOTW (verified: the installed harness.ps1 shim has no
# Zone.Identifier stream), so a shipped wrapper runs. If one ever acquires MOTW it is
# blocked, and under the hook contract that block is SILENT - which is why
# `hooks status` must INVOKE this file rather than merely stat it.
# LIMIT: one box, LocalMachine=Undefined. An enterprise AllSigned machine policy is
# unmeasured and would behave differently.
#
# NOTE THE DIVERGENCE FROM THE POSIX TWIN, deliberately: npm's own cmd-shim has
# different resolution in its .cmd and .ps1 variants (npm/cmd-shim#51 - the ps1 shim
# expects node.exe on PATH while the cmd shim falls back to node). Parity between two
# shell dialects is not free, so these two files are tested separately and neither is
# inferred from the other.

$ErrorActionPreference = 'SilentlyContinue'

$HookDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$Script  = Join-Path $HookDir 'harness.js'

# Under the user's profile, never inside the observed repository: the hook must leave
# no trace in the tree the agent is working in (hook-payload.ts, pinned by a test),
# and the interpreter is a property of the machine rather than of a checkout.
$StateDir = Join-Path $env:USERPROFILE '.harness\hooks'
$Cache    = Join-Path $StateDir 'interpreter'
$FailLog  = Join-Path $StateDir 'interpreter-failures.log'

$MinNode = 22

function Write-Failure([string]$kind, [string]$reason, [string]$context) {
  # Recorded HERE because when the no-interpreter path runs there is by definition no
  # node, so nothing written in TypeScript could report it. Deliberately NOT the fire
  # journal: fires.jsonl has exactly one writer and one schema, and a second writer in
  # another language with no contract between them is the writer-shape defect class this
  # project has already paid for once. Separate file, trivial fixed fields.
  #
  # THE KIND IS A PARAMETER AS OF #180, for the reason written up in the POSIX twin:
  # once the fire path swallows the child's streams, this file is the ONLY place a
  # post-node boot failure can be seen at all. Field shape is unchanged
  # (`<utc>`t`<kind>`t`<reason>`t`<context>`), so existing no-interpreter lines parse.
  #
  # THE FOURTH FIELD IS PER-KIND CONTEXT. `no-interpreter` passes $env:PATH, because
  # the path we searched IS the evidence when nothing was found. `cli-failed` passes
  # the resolved interpreter instead: node was found, so PATH answers nothing, while
  # the binary that ran is what reproduces the failure. MEASURED on Windows PowerShell
  # 5.1 - a cli-failed line carrying the full machine PATH ran to ~500 characters, and
  # a hook fires twice per tool call.
  try {
    New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
    # DOUBLE-QUOTED, because PowerShell does NOT process backtick escapes inside
    # SINGLE quotes - a single-quoted "`t" is a literal backtick followed by a t.
    # Measured on Windows: the recorded line read `2026-08-13T15:39:44Z`tno-interpreter`
    # verbatim, so the one field separator in the one file that reports a total
    # failure to find node was itself broken.
    $line = "{0}`t{1}`t{2}`t{3}" -f `
      (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ'), $kind, $reason, $context
    Add-Content -Path $FailLog -Value $line -Encoding ASCII
  } catch { }
}

function Test-Usable([string]$candidate) {
  if ([string]::IsNullOrWhiteSpace($candidate)) { return $false }
  if (-not (Test-Path -LiteralPath $candidate)) { return $false }
  try {
    # `--version`, NOT `-e '<script>'`. MEASURED on Windows PowerShell 5.1: it strips
    # the inner double quotes when passing an argument to a native binary, so
    # `-e '...split(".")[0]...'` reached node as `.split(.)[0]` and died with
    # `SyntaxError: Unexpected token '.'`. Every candidate then failed this check, so
    # THE WRAPPER RESOLVED NOTHING ON WINDOWS - and it failed quietly, falling through
    # to the failure recorder and exiting 0, which is correct behaviour concealing a
    # total failure to work. Caught only by executing it on Windows; it parsed clean
    # and was ASCII-verified on a Mac.
    $raw = & $candidate --version 2>$null
    if ($raw -notmatch '^v?(\d+)\.') { return $false }
    $major = $Matches[1]
    if ([int]$major -lt $MinNode) { return $false }
    $script:ResolvedVersion = $major
    return $true
  } catch { return $false }
}

$Resolved        = ''
$ResolvedStep    = ''
$ResolvedVersion = ''
$FromCache       = $false

# STEP 0 - cache. A stale-but-working cache is ACCEPTABLE and that is what makes this
# safe: we resolve AN interpreter able to run OUR CLI, never the project's node. Do
# not "improve" this into tracking a project's node version.
if (Test-Path -LiteralPath $Cache) {
  $lines = Get-Content -LiteralPath $Cache
  $cached = ($lines | Where-Object { $_ -like 'path=*' } | Select-Object -First 1) -replace '^path=', ''
  if (Test-Usable $cached) {
    $Resolved = $cached
    $step = ($lines | Where-Object { $_ -like 'step=*' } | Select-Object -First 1) -replace '^step=', ''
    $ResolvedStep = if ($step) { $step } else { 'unknown' }
    $FromCache = $true
  }
}

# STEP 1 - a user-owned init file, first so it can override everything. husky's model,
# the one pattern the ecosystem has converged on for this problem.
if (-not $Resolved) {
  $init = Join-Path $env:USERPROFILE '.config\harness\init.ps1'
  if (Test-Path -LiteralPath $init) {
    try { . $init } catch { }
    $c = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (Test-Usable $c) { $Resolved = $c; $ResolvedStep = 'init' }
  }
}

# STEP 2 - PATH. Cheapest and most likely: the agent invoking this hook is usually
# itself a node process, so its child generally already carries a working node. The
# original defect was never an empty PATH - it was an entry that named an interpreter
# explicitly and never consulted PATH at all.
if (-not $Resolved) {
  $c = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (Test-Usable $c) { $Resolved = $c; $ResolvedStep = 'path' }
}

# STEP 3 - relative to ourselves. MEASURED ON LINUX to be the step that rescues an
# nvm machine whose PATH has no node at all: a globally installed package lives
# INSIDE the node installation that owns it, at <prefix>/lib/node_modules/..., so
# <prefix>/bin/node is the exact interpreter that installed us. On Windows the global
# prefix is laid out differently (%APPDATA%\npm), so this is tried and allowed to
# miss rather than assumed.
if (-not $Resolved) {
  $p = $HookDir
  while ($p -and (Split-Path -Parent $p)) {
    $parent = Split-Path -Parent $p
    if ((Split-Path -Leaf $p) -eq 'node_modules') {
      foreach ($rel in @('node.exe', 'bin\node.exe', '..\node.exe')) {
        $c = Join-Path $parent $rel
        if (Test-Usable $c) { $Resolved = $c; $ResolvedStep = 'relative-to-self'; break }
      }
      break
    }
    $p = $parent
  }
}

# STEP 4 - stable per-manager shim directories, the managers' own supported entry
# points. Unlike POSIX nvm (which has NO stable path unless NVM_SYMLINK_CURRENT is
# set), nvm-windows DOES expose one via its symlink, so it is included here and the
# manager tier covers every common Windows manager.
if (-not $Resolved) {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Volta\bin\node.exe'),
    (Join-Path $env:LOCALAPPDATA 'mise\shims\node.exe'),
    (Join-Path $env:APPDATA 'fnm\aliases\default\node.exe'),
    'C:\nvm\nodejs\node.exe'
  )
  if ($env:NVM_SYMLINK) { $candidates += (Join-Path $env:NVM_SYMLINK 'node.exe') }
  foreach ($c in $candidates) {
    if (Test-Usable $c) { $Resolved = $c; $ResolvedStep = 'manager-shim'; break }
  }
}

# STEP 5 - conventional install locations.
if (-not $Resolved) {
  foreach ($c in @('C:\Program Files\nodejs\node.exe', 'C:\Program Files (x86)\nodejs\node.exe')) {
    if (Test-Usable $c) { $Resolved = $c; $ResolvedStep = 'well-known'; break }
  }
}

# STEP 6 - sourcing a version manager is deliberately NOT implemented, here or in the
# POSIX twin. It is the only unprecedented step in this design, and Linux measurement
# suggests step 3 already covers the case it was meant for. The step= field below is
# what will decide, from real machines, whether it is ever needed.

$CheckMode = ($args.Count -gt 0 -and $args[0] -eq '--harness-hook-check')

# FIRE MODE - the failure branch that starts AFTER node does (#180).
#
# Everything above covers the case where NO interpreter is found: exit 0 to a fire,
# exit 1 to a checker. It covers nothing that happens once node STARTS. The two call
# sites at the foot of this file captured $LASTEXITCODE and exited with it, so an
# interpreter that resolves and then cannot boot the CLI - a half-written dist/, a
# bad import, a parse error - reached the agent as a NON-ZERO PRE-TOOL HOOK, which
# every agent reads as a DENIAL of the tool call.
#
# THE WINDOWS BLAST RADIUS IS EVERY AGENT, NOT ONE, AND IT ONLY BECAME SO AT 9d3ea8e4.
# Before that commit this file was reachable by github-copilot alone, through its
# `powershell` field. Since #177 the Windows `command` for ALL FIVE agents is
# `powershell.exe -NoProfile -File harness-hook.ps1`, so a boot-failure leak in THIS
# dialect blocks tool calls for claude-code, cursor, gemini, droid and windsurf too.
# That is why this dialect is fixed in the same change as its POSIX twin rather than
# after it.
#
# THE SUPPRESSION IS NOT NEW POLICY. `acts/hooks.ts` already declares fire "EXIT 0,
# ALWAYS, AND SILENT" on every path; this is the last layer that can still honour
# that when the CLI is too broken to honour it itself. A fire's observable is the
# journal, never stdout, so nothing legitimate is discarded.
#
# SCOPED BY THE FIRST TWO ARGUMENTS, AND THE NARROWNESS IS THE POINT: swallowing
# unconditionally would be simpler and would silently kill `hooks status` and
# `--harness-hook-check`, the surfaces whose whole job is to report that something
# is wrong. Agent gets silence, operator gets the truth.
$FireMode = ($args.Count -gt 1 -and $args[0] -eq 'hooks' -and $args[1] -eq 'fire')

# The agent slug, for the failure record below. `hooks fire <agent> --phase ...`, so
# it is args[2] when present. Computed here rather than inline because a missing index
# inside an expandable string yields an empty field, and an unlabelled empty field in a
# fixed-format log is the kind of thing that gets read as "no agent" rather than "we
# did not know".
$FireAgent = if ($args.Count -gt 2) { $args[2] } else { 'unknown' }

if (-not $Resolved) {
  Write-Failure 'no-interpreter' "no usable node >= $MinNode" $env:PATH
  # CHECK MODE IS THE ONE CALLER TOLD THE TRUTH BY EXIT CODE. `hooks status` is an
  # operator asking a question; a hook fire is an agent mid-tool-call. Silence is the
  # right answer to the agent and the wrong answer to the person.
  if ($CheckMode) { Write-Output 'step=none'; exit 1 }
  exit 0   # a hook must never break the agent it observes
}

# Atomic write - hooks fire in parallel (082 measured 3 concurrent tool calls, ~38
# invocations per run), so a partial write from one process must never be read by
# another. Skipped entirely on a cache hit: the warm path is read-only.
#
# THE SWAP IS DONE IN TWO BRANCHES BECAUSE THE ONE-LINER IS NOT PORTABLE. The obvious
# form, [System.IO.File]::Move($tmp, $Cache, $true), takes a THREE-ARGUMENT overload
# that only exists on .NET Core 3.0+. Windows PowerShell 5.1 runs on .NET Framework
# and has only the two-argument Move, so it threw
#   Cannot find an overload for "Move" and the argument count: "3".
# and the catch below swallowed it: NO CACHE WAS EVER WRITTEN ON WINDOWS, silently,
# while every other behaviour looked correct. Measured on a real Windows 11 host; pwsh
# 7 on macOS has the overload, so a Mac could not see it.
#
# Move (2-arg) is atomic within a volume but REFUSES an existing destination; Replace
# is atomic AND overwrites but REQUIRES one. Try the create case first and fall back,
# rather than testing for existence: a Test-Path would leave a window in which another
# concurrent fire creates the file between the check and the move.
#
# [NullString]::Value, NOT $null, for Replace's backup argument. PowerShell converts
# $null to an EMPTY STRING when binding a .NET string parameter, and .NET rejects it:
#   The value cannot be an empty string. (Parameter 'path')
# So the fallback branch threw, the outer catch swallowed it, and the cache was still
# never written - the SAME silent-swallow shape as the overload bug this block was
# being fixed for, reintroduced by its own fix. Caught because the fix was executed
# rather than reasoned about.
if (-not $FromCache) {
  try {
    New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
    $tmp = "$Cache.$PID"
    $body = @(
      "path=$Resolved",
      "version=$ResolvedVersion",
      "step=$ResolvedStep",
      ("at=" + (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ'))
    ) -join "`n"
    [System.IO.File]::WriteAllText($tmp, $body + "`n", [System.Text.ASCIIEncoding]::new())
    try {
      [System.IO.File]::Move($tmp, $Cache)
    } catch {
      [System.IO.File]::Replace($tmp, $Cache, [NullString]::Value)
    }
  } catch { try { Remove-Item -LiteralPath $tmp -Force } catch { } }
}

# CHECK MODE - what `hooks status` invokes instead of stat-ing this file.
#
# A wrapper that exists but cannot find an interpreter is indistinguishable, to a
# Test-Path, from one that works. That is the false green this plan exists to remove,
# one layer up. Invoking is the only thing that answers CAN THIS RUN.
#
# ON WINDOWS IT EARNS A SECOND KEEP: a .ps1 blocked by execution policy fails HERE,
# visibly, where a stat would report the file present and healthy. MOTW-marked scripts
# are blocked under RemoteSigned (measured), and npm delivery does not mark them
# (measured across 13 installed .ps1 files) - but "does not today" is not "cannot", and
# this is what would catch it.
#
# Affordable by default: everything above starts no node, so the cost is a process
# spawn rather than a CLI boot.
if ($CheckMode) {
  Write-Output "path=$Resolved"
  Write-Output "version=$ResolvedVersion"
  Write-Output "step=$ResolvedStep"
  exit 0
}

# STDIN DOES NOT SURVIVE THIS HOP ON WINDOWS POWERSHELL 5.1, SO WE DO NOT ASK IT TO.
#
# MEASURED, wrapper alone in a real git repo, no agent involved: Copilot's payload
# reaches this script (299 bytes PRE / 423 POST, captured), the args arrive intact,
# node starts - and node's stdin is EMPTY. The CLI then finds no repoRoot, returns at
# the repo guard, and writes nothing: exit 0, no stderr, zero journal lines. That
# silence read as "the hook never fired" and cost a day of platform archaeology.
#
# WE DO NOT PIPE, EITHER. `$payload | & node` re-encodes: PowerShell 5.1 redirects as
# UTF-16LE and writes to native commands using $OutputEncoding, which defaults to
# ASCII - so every non-ASCII byte becomes `?`, and the wire bytes that the CLI's
# `headHex` exists to name would be destroyed by the very hop meant to deliver them.
# A BOM that silently "fixes" itself in transit is the class of defect this plan removes.
#
# So: copy the raw stream to a temp file and name it. Byte for byte, no decode.
#
# `$input` MUST NOT APPEAR ANYWHERE IN THIS FILE, AND THE REASON IS NOT STYLE.
#
# MEASURED, and it is the strangest thing this plan found: merely MENTIONING `$input`
# makes PowerShell pre-read stdin into the pipeline before the script runs, so
# [Console]::OpenStandardInput() then reads ZERO bytes. Two scripts, identical but for
# one line that NEVER EXECUTES:
#
#   $s = [Console]::OpenStandardInput(); $m = New-Object System.IO.MemoryStream
#   $s.CopyTo($m); Write-Output $m.Length
#                                                       -> 24 bytes
#   ...same, plus:  if ($false) { $null = @($input) }    ->  0 bytes
#
# It is bound at parse time, not at execution, so a dead branch drains the stream just
# as thoroughly as a live one. This cost a green end-to-end run: the fallback was added
# to cover a pipeline shape and silently broke the shape that already worked.
#
# The two sources are therefore MUTUALLY EXCLUSIVE - byte-exact OS stream, or `$input`,
# never both - and the OS stream wins: it is what a REAL agent uses (proven on Windows,
# where an instrumented shim read copilot's payload through [Console]::In), and it is the
# only one that preserves the wire bytes the parser exists to describe.
#
# CONSEQUENCE FOR ANYONE TESTING THIS BY HAND: `Get-Content x | & harness-hook.ps1` is a
# POWERSHELL pipeline, not an OS redirect, and on 5.1 it leaves IsInputRedirected FALSE -
# so it reproduces nothing and reports a false failure. Use an OS-level redirect, e.g.
#   cmd /c "powershell -NoProfile -File harness-hook.ps1 <args> < payload.json"

# $Code STARTS AT 0 AND ONLY THE OPERATOR PATH OVERWRITES IT. That is the whole
# fail-open mechanism, expressed as a default rather than as a branch: every way of
# leaving this file without an explicit operator-path assignment - a child that
# exits non-zero, a child that never starts, a .NET exception out of the spill -
# lands on `exit 0`. A later author adding a third invocation shape inherits the
# safe answer instead of having to remember it.
$Code = 0

if ([Console]::IsInputRedirected) {
  $Spill = [System.IO.Path]::Combine(
    [System.IO.Path]::GetTempPath(),
    "harness-hook-$([Guid]::NewGuid().ToString('N')).payload")
  try {
    $StdIn = [Console]::OpenStandardInput()
    $Out = [System.IO.File]::Create($Spill)
    try { $StdIn.CopyTo($Out) } finally { $Out.Dispose() }
    # `*> $null` IS A REDIRECTION, NOT A PIPELINE, AND THAT DISTINCTION IS LOAD-BEARING
    # HERE. The header above forbids piping the payload because PS 5.1 re-encodes
    # across a pipeline (UTF-16LE in, $OutputEncoding=ASCII out) and would destroy the
    # wire bytes this spill exists to preserve. A redirection operator changes where
    # the child's OUTPUT goes and touches neither its stdin nor its argument binding -
    # and on this branch stdin has already been drained to $Spill and named by
    # `--hook-input-file`, so there is nothing left for it to disturb. Do NOT "simplify"
    # either of these to `| Out-Null`.
    if ($FireMode) {
      & $Resolved --no-warnings $Script @args --hook-input-file $Spill *> $null
      # See the POSIX twin for why swallowing without recording rebuilds the defect one
      # layer up. `fire` is contractually exit-0-always, so a non-zero here cannot mean
      # "the hook declined" - only that the CLI failed to run. Zero writes when healthy.
      if ($LASTEXITCODE -ne 0) { Write-Failure 'cli-failed' "exit=$LASTEXITCODE agent=$FireAgent" $Resolved }
    } else {
      & $Resolved --no-warnings $Script @args --hook-input-file $Spill
      $Code = $LASTEXITCODE
    }
  } catch {
    # A FIRE SWALLOWS ITS OWN FAILURES TOO. $ErrorActionPreference = 'SilentlyContinue'
    # does NOT suppress a TERMINATING error, and two live ones reach here: `&` on a
    # $Resolved that vanished between Test-Usable and this line throws
    # CommandNotFoundException, and the spill throws IOException on a full or
    # unwritable temp. Either would end the script at exit 1 - a denied tool call
    # produced by the wrapper's own plumbing rather than by the CLI. The operator path
    # rethrows, unchanged: a person still sees the error and the non-zero exit.
    if (-not $FireMode) { throw }
    Write-Failure 'cli-failed' "$($_.Exception.GetType().Name) agent=$FireAgent" $Resolved
  } finally {
    # The hook leaves no trace. Best-effort by design: a failure to clean up must
    # never become an agent-visible error (`$ErrorActionPreference` is already
    # SilentlyContinue, and `-Force` covers a read-only temp). `finally` runs on the
    # fire path and the operator path alike, so the always-exit-0 branch above does
    # not leak the spill.
    Remove-Item -LiteralPath $Spill -Force -ErrorAction SilentlyContinue
  }
} else {
  # No redirected stdin - a hand-run or a probe. Reading a console would BLOCK, which
  # inside an agent's tool loop is worse than any silence.
  try {
    if ($FireMode) {
      & $Resolved --no-warnings $Script @args *> $null
      if ($LASTEXITCODE -ne 0) { Write-Failure 'cli-failed' "exit=$LASTEXITCODE agent=$FireAgent" $Resolved }
    } else {
      & $Resolved --no-warnings $Script @args
      $Code = $LASTEXITCODE
    }
  } catch {
    if (-not $FireMode) { throw }
    Write-Failure 'cli-failed' "$($_.Exception.GetType().Name) agent=$FireAgent" $Resolved
  }
}
exit $Code
