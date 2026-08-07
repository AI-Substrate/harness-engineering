# The git-ai collector handover

Harness **stopped collecting its own telemetry**. AI-attribution collection now
belongs to [git-ai](https://github.com/git-ai-project/git-ai) (Apache-2.0), which
harness installs from a pinned, SHA-256-verified release and hooks up on its own
terms.

This page covers what changed, what harness no longer captures, what git-ai
captures instead, how the pin and its upgrade work, what the trace2 guard does
and why, and — deliberately, at the end and in plain words — the thing v1 cannot
prove.

> **Disabled, not deleted.** Every capture, publish and housekeeping path is
> intact behind one gate. v2 migrates; it does not rebuild.

---

## What changed in one minute

| | before | after |
|---|---|---|
| Who captures | harness, on every verb | git-ai, via agent hooks |
| Default | capture ON, `HARNESS_NO_TELEMETRY=1` to stop | **capture OFF in code** |
| Published refs | `refs/harness-telemetry/*` | unchanged and still readable |
| Attribution grain | per-session counts | per-line, per-commit authorship notes |
| Install surface | none | one pinned binary at `~/.git-ai/bin/git-ai` |

### Capture is off by default

The switch moved out of the environment and into code
(`services/telemetry/capture-gate.ts`). A shipped harness with a clean
environment captures nothing at **all three** enforcement points — capture,
publish, and the exit-time housekeeping that used to auto-push on `checks`.

```bash
# nothing to do — this is the default
harness checks            # captures nothing, publishes nothing, nudges nothing

# opt back in for a session that wants the old behaviour
HARNESS_TELEMETRY_CAPTURE=1 harness checks
```

`HARNESS_NO_TELEMETRY=1` still works and still wins: an operator who turned
telemetry off machine-wide cannot have it switched back on by a stray project
env.

### Reading is untouched

The **read** path is deliberately ungated. The already-published
`refs/harness-telemetry/*` stay queryable exactly as before:

```bash
harness telemetry ls      --repo <url>
harness telemetry pull    --repo <url> --session <id> --out ./pulled
harness telemetry report  ./pulled
```

A test asserts those modules never import the capture gate, so a future change
cannot quietly make old evidence unreadable.

---

## What harness no longer captures

Counts-only segments per command: tokens, tools, skills, subagents, files
touched, plan links, model/branch/timecode, flow-stage markers, gate verdicts.
None of it is produced on a default install.

**What that costs, stated rather than glossed:**

- **Fleet lineage goes dark.** pij seat identity and subagent parentage are not
  in git-ai's model. Ruled and accepted for v1.
- **Copilot CLI loses model and token data.** git-ai records
  `model: "unknown"` for Copilot CLI (observed live, not predicted), and Copilot
  CLI emits no OTEL — so no tokens, no cost, no latency. This is the sharpest
  measurable regression in the swap.
- **No semantic or flow capture.** Gates, findings, chores, phases, agent/human
  time — explicitly out of scope for v1.

## What git-ai captures instead

Per-commit authorship notes at `refs/notes/ai`, schema `authorship/3.0.0`, with
**line-level ranges** per file per session, plus a local metrics store. The
capabilities harness never had:

- **Line-level attribution** tied to an agent session id and the human author.
- **Shell-written files.** git-ai attributes files created by a `Bash` tool call
  through a pre/post filesystem stat-diff — a file written by `printf > calc.py`
  is still attributed to the agent that ran the shell.
- **Broad agent coverage.** Twelve agents get transcript ingestion, sixteen get
  hook-based file attribution, six cloud platforms get post-hoc commit-author
  fingerprinting.

> **The session-id join survives.** `pij`'s bound session id and git-ai's
> recorded session id are the same UUID for both Claude Code and Copilot CLI. v2
> lineage is reconstructable after the fact, provided the pij registry is kept.

---

## The pin, and how to move it

`harness/cli/src/services/doctor/collector/pin.ts` is **data**: one release tag,
one SHA-256 for each of the six published artifacts
(macos/linux/windows × x64/arm64), and the expected note schema version. It has
no imports and no logic, and a test asserts no other source file names the
version — so a version bump is a one-file diff.

```ts
version: 'v1.6.21',
expect_schema_version: 'authorship/3.0.0',
artifacts: { 'macos-arm64': { file: 'git-ai-macos-arm64', sha256: '78990a…' }, … }
```

**The install path never writes the pin.** A downloader that can re-pin on
mismatch does not have a pin — it would "fix" the exact event the digest exists
to catch. Regeneration is a separate command, and it is **all-or-nothing**: if
any one of the six artifacts fails to fetch or hash, the existing manifest is
left byte-untouched, because a five-of-six manifest silently carries one stale
digest that no reviewer can see.

The note schema rides in the same literal on purpose: **binary drift and note
FORMAT drift then arrive in the same diff**, and a reviewer approves both or
neither.

### How the download is verified

1. Fetch to a **temp** file — never to the final path.
2. Read the bytes **back off disk** and hash them with Node's `crypto`. No
   `shasum`, `sha256sum` or `certutil` anywhere: one code path on all six
   platforms.
3. Compare against the pin. A mismatch installs nothing, leaves no partial file,
   and reports **both** digests.
4. Set the executable bit, **then** rename atomically into place — so an
   interrupted upgrade can never leave a half-written or non-executable binary.

Every transport failure is named rather than collapsed into "download failed":
non-2xx status, a redirect that left the pinned host, connect/read timeout, and
a short or interrupted write each abort, clean up, and say which one happened.
An unsupported platform/arch is reported as unsupported and installs nothing —
never the x64 artifact on the theory that it will probably run.

---

## The trace2 guard

`git-ai install-hooks` begins by running the equivalent of
`git config --global --remove-section trace2` and then writing its own two keys.
That is a **machine-wide** deletion: every repo on the box, not just yours. And
git-ai re-applies it on **every** invocation.

Harness does not use trace2 — but "we don't use it" does not make someone else's
config ours to give away. So, before **every** `install-hooks` call, first
install and every later re-check alike:

| global trace2 config | what harness does |
|---|---|
| **empty** | records that it was observed empty, then proceeds |
| **non-empty** | does **not** invoke `install-hooks` at all — warns, names the keys, prints manual instructions |
| **unreadable** | treated as non-empty (a guard that cannot read cannot report all clear) |

**Harness never deletes a trace2 config**, so there is nothing to consent to. If
you want the hooks on a machine that has trace2 configured, you do it yourself:

```bash
git config --global --get-regexp '^trace2\.' > ~/trace2-backup.txt
~/.git-ai/bin/git-ai install-hooks     # deletes the whole global trace2 section
```

Recording the *empty* observation matters as much as blocking the non-empty one:
an unrecorded empty is indistinguishable, a year later, from one that something
erased.

**Observed-empty is the sole automatic path — a re-check gets no extra latitude.**
After a successful install, git-ai's own `trace2.eventTarget`/`trace2.eventNesting`
are in the global config, so every later re-check observes *non-empty* and stops:
new coding harnesses are still **detected and reported**, but the hooks are not
re-installed for them, and you get the manual instructions above instead.

That is deliberate. An earlier version permitted a re-install when every key
present was one git-ai itself writes *and* workspace state recorded a verified
install of our own. It was removed in review, for a reason worth keeping written
down: that state file is a gitignored, unvalidated JSON file in the workspace,
not bound to your home or your git config. Copying it forges the condition. And
with no bad actor at all — harness installs once, you later set your **own**
`trace2.eventTarget`, a re-check matches the key *name*, trusts the stale record,
and `install-hooks` deletes your whole section. **A key name plus an old local
record cannot establish ownership of a mutable, machine-wide git value.** This
could only come back if git-ai offered a non-destructive hook operation.

**A blocked re-check never revokes coverage it already proved.** The guard
refuses *before* git-ai is invoked, so nothing on the machine changed — and
nothing we say about the machine may change either. The block is recorded as a
separate `last_attempt`; the `hooks` record keeps naming the agents that are
genuinely hooked and genuinely still collecting. So the sequence *install →
Cursor appears → blocked re-check* ends on `hooks-incomplete` naming **Cursor**,
not on `cli-only-trace2` claiming no attribution is collected at all. The two
verdicts below mean different things and stay different: doing what the row told
you to do must never make the report *less* accurate than not doing it.

When git-ai does run and the outcome is bad (`failed`, `unverified`), coverage is
**not** carried forward — the machine may have changed underneath us, and prior
coverage is no longer proven.

### Why we never run their `install.sh`

Their installer edits shell rc files, prepends to `PATH`, symlinks a `git` shim,
**and calls `install-hooks` itself** — which would seize trace2 before we could
look at it. Doing our own download-and-verify is the only reason the guard above
can exist.

### What `install-hooks` still does, disclosed up front

Ours is the decision to run it. These are its terms:

- resets the **global** git `trace2` section and writes its own keys;
- stops and restarts the git-ai background daemon;
- rewrites each detected agent's config file in place, reformatting it and
  discarding JSONC comments — **git-ai keeps no backups**;
- runs `uninstall_skills` whenever `--skills` is absent, so it removes git-ai
  skill links on every invocation — see the skills guard below;
- **cannot be scoped to chosen agents** — there is no per-agent selector, so it
  hooks every coding harness it detects in one shot (ten of them on the dogfood
  machine);
- installs a **VS Code extension** into both Code and Code-Insiders and rewrites
  both `settings.json` files;
- does **not** instrument agents that are already running — a live session stays
  uninstrumented until it restarts, and its prior work is attributed to the
  human.

> **Their safety flag fails open.** `install-hooks` ignores unrecognised
> arguments (`_ => {}`), so `--help`, `--dryrun`, `--dry_run` and
> `--dry-run=1` all perform a **real, silent, machine-wide install** —
> `--help` did exactly that on the dogfood machine. Harness therefore passes
> exactly `install-hooks` and nothing else, and verifies the outcome by
> **re-reading the global git config** afterwards rather than trusting an exit
> code. A test asserts no forbidden spelling can reach git-ai as an argument.
>
> **And the re-read decides.** git-ai always writes `trace2.eventTarget` when it
> installs hooks, so that key's presence afterwards is the evidence. The check
> compares the **exact** config key, not a prefix of it — `trace2.eventTarget_custom`
> is not proof that `trace2.eventTarget` was written. If the key is absent,
> unreadable, or only near-matched, the hooks are recorded as `unverified` —
> never `installed`, and never silently upgraded by a zero exit. Evidence that is
> recorded and then ignored is not evidence.

### The skills guard — the same shape as trace2

git-ai manages three skills — `ask`, `prompt-analysis`, `git-ai-search` — as
symlinks under each agent's skills directory, and it is destructive in **both**
directions: without `--skills` it runs `uninstall_skills` and removes whatever is
at those paths; with `--skills` it installs over them. There is no flag value
that is safe, so the flag is not the decision.

Before invoking `install-hooks`, harness inspects all nine paths —
`~/.agents/skills/<n>`, `~/.cursor/skills/<n>` and
`$CLAUDE_CONFIG_DIR|~/.claude/skills/<n>` for each of the three names — with
`lstat`, which does not follow the final component:

- **absent or a symlink** → git-ai's own territory, nothing of yours to lose;
- **a real directory or file** → do **not** invoke at all. Name the path, print
  the manual command, and leave it alone;
- **unclassifiable** → treated as content. A path we could not read is never
  reported as free space.

`CLAUDE_CONFIG_DIR` is honoured because git-ai honours it (`utils.rs:430`);
guarding `~/.claude` on a machine whose Claude config lives at `~/.claude-alt`
would report safety about a directory git-ai never touches, which is worse than
no guard at all.

Same principle as trace2: **inspect, and decline to destroy.** The destructive
path is made unreachable rather than chosen.

---

## Running it

The collector rides on `harness doctor`, and the split is deliberate:

```bash
# the REPORT — a bounded read plus ONE read-only ingress probe (connect + destroy,
# never a byte sent); invokes nothing and mutates nothing (doctor's P7 rule)
harness doctor

# RECOVERY — the one collector-mutating verb, and it only ever runs when typed
harness doctor telemetry-nudge [--buffer <path>]

# the LIFECYCLE — the only ways anything is downloaded, executed or written
harness doctor --install-collector    # fetch + verify the pin, then hooks (guards first)
harness doctor --recheck-collector    # detect a coding harness that appeared later
                                      # (blocked by a guard? existing hooks are untouched)

# maintainer only: hash all six artifacts for a tag and print a reviewable pin
harness doctor --regenerate-collector-pin v1.6.22 [--pin-out /tmp/pin.ts]
```

A plain `harness doctor` never installs anything. Nothing is implied.

---

## What doctor reports

`harness doctor` gains a `gitai-collector` row. It is a pure filesystem read over
the state the install wrote down — it never invokes git-ai — and, like every
doctor row, it **warns and never blocks**.

| verdict | meaning |
|---|---|
| `healthy` | pinned binary present and hash-matching, hooks installed, daemon pid file present, note schema as pinned |
| `cli-only-trace2` | **CLI installed, hooks NEVER installed because trace2 is present** — no attribution is being collected. Its own state: not healthy, not a failed install, not "could not determine". Unreachable once an install has been verified: a later block cannot demote proven coverage to this |
| `cli-only-skills` | CLI installed, hooks not installed because real content sits where git-ai keeps its skill links |
| `hooks-incomplete` | hooks are installed and collecting, **and** a coding harness appeared afterwards whose edits are not being attributed. Names the harness. When a re-check was blocked by a guard, `next_action` is the manual `git-ai install-hooks` command rather than "re-run the re-check", which we already know is blocked |
| `ingress-blocked` | everything a filesystem can see is fine, **and this process cannot reach the collector socket** — the connect was denied while the socket file exists. See [Sandbox attribution](#sandbox-attribution-when-the-collector-cannot-see) below |
| `degraded` | binary no longer matches the pin, hooks failed, hooks are `unverified` (a zero exit that left no evidence), or a note-schema mismatch |
| `not-installed` | nothing installed, or an unsupported platform |
| `could-not-determine` | we could not read what we needed — **never** rendered as healthy, never folded into "no data" |

Absent is not green; empty is not clean.

Two further rows ride alongside it, and both are **read-only**:

| row | what it says |
|---|---|
| `attribution-at-risk` | commits on this branch with no `refs/notes/ai` entry — **unattributed**, which is not a claim that they are AI-authored. Reports `unproven` rather than `clean` when the ingress could not be reached |
| `commit-guidance` | whether `AGENTS.md` carries the managed commit-guidance block. Warns; never edits the file |

---

## Sandbox attribution: when the collector cannot see

git-ai has exactly **one ingress** — git's trace2 events over a unix socket. An
agent command sandbox treats a unix-socket `connect()` as a network operation and
denies it. When that happens git **silently disables trace2**, the commit lands
with no authorship note, and git-ai's recovery ladder can later attest those
lines as **known-human**.

That last step is what makes this worth a feature rather than a footnote: the
output is a **confident wrong number, not a gap**, and no filesystem-level health
signal can see it. The binary is installed. The hooks are on. The daemon is
running. Everything reads green, and the answer is wrong.

A controlled investigation established two more things that shape the response:

- Which commands get sandboxed is **command-shape dependent** — a standalone
  `git commit` ran unsandboxed and attributed, while the compound
  `git add … && git commit …` an agent writes by default was sandboxed and lost.
- It is also **non-deterministic across sessions**: identical compound shapes ran
  unsandboxed in a later session with no configuration change.

So no editor configuration is a reliable fix. Detection and a safe commit path
have to live in the harness.

### The probe verdict

Harness answers "can this process reach the ingress?" the only way that is
honest — it **tries**, with a bounded (<1s) connect that is destroyed the moment
it settles and **never sends a byte**:

| outcome | meaning |
|---|---|
| `connected` | the ingress is reachable; trace2 will flow |
| `denied` | the connect was refused while the socket exists — the **sandbox signature** |
| `refused` | a stale socket with nothing listening |
| `absent` | no socket file; the daemon is not running |
| `timeout` | the connect neither settled nor failed inside the bound |
| `error:<code>` | anything else, reported with its code rather than flattened |

**Environment markers never decide.** `CURSOR_SANDBOX` and friends may appear in
the warning text to *explain* a blocked probe, and that is all. The socket was
observed **reachable from inside a sandbox** with those markers set — a
marker-driven verdict would have called that healthy session blocked.

### The two safe commit shapes

```bash
# VERIFIED OR NAMED — probe, commit, then prove attribution landed (or buffer it)
harness commit "<message>" -- <path> [<path>…]

# RECOVERY — replay buffered events; run from an UNSANDBOXED shell
harness doctor telemetry-nudge
```

`harness commit` is one simple command with no chaining, because compound shapes
are what fall into the sandbox. It probes first, then:

- **ingress reachable** → commits with **no** trace2 override, then waits
  (bounded) for the `refs/notes/ai` note and reports whether it landed.
- **anything else** → commits with trace2 buffered to a file under the gitignored
  `.harness/temp/`, and names both that buffer and the recovery command.

When the configured target is already a plain file, `harness commit` writes two
records beside its work: the commit sha **tagged with this repository's identity**
in a `<target>.shas` sidecar, and the target path itself in the repo-local
`.harness/temp/trace2/known-targets`. The first is what lets a later drain
confirm *only* this repo's commits out of a machine-global buffer; the second is
what lets the drain touch that path at all after the prescribed reconfiguration.

Only an **absolute path** counts as a file target. git's disabled forms (`0`,
`false`), its stderr/fd forms (`1`, `2`, `true`, `3`–`9`) and any relative path
send no drainable events at all, so they take the buffered branch rather than
being called a buffer that will never exist.

A commit that succeeds but whose sha cannot be read back is reported **degraded
with an unknown sha** — never as a failure. It really happened; saying otherwise
invites a re-run and a double commit.

Those branches are **mutually exclusive**, not belt-and-braces: `GIT_TRACE2_EVENT`
*replaces* the configured socket target rather than adding to it, so setting the
buffer on a healthy ingress would divert events away from the collector.

It never rolls back, never blocks, never swallows git's exit code, and stages
**explicit pathspecs only**.

### The nudge

`harness doctor telemetry-nudge` replays buffered events into the collector — a
mechanism proven end-to-end: the daemon cannot distinguish a replayed stream from
live traffic. Its lifecycle is deliberate:

1. **Rotate first** — the live buffer is renamed to a timestamped segment before
   a byte is read, so a concurrent `git` can never race a truncation.
2. **Replay the whole segment** — the daemon reconstructs state from the event
   stream, so a filtered replay is a corrupted story.
3. **Delete only on full confirmation — of *this repository's* commits** — the
   segment goes only when every commit its **sidecar** names *and this repository
   owns* carries a note. Identity comes from the sidecar `harness commit` writes
   and from nowhere else: git's trace2 stream names no commit sha, and its
   `start` event carries git's own argv, so scanning the payload would let a
   `Revert <sha>` message enrol an unrelated historical commit. A
   partly-confirmed segment is **retained intact** (never partially rewritten)
   and listed for an explicit retry; a segment with no sidecar is
   `unconfirmable` and is kept, never deleted on a vacuous confirmation.
4. **Foreign commits are handed off, never accused** — a `file` target is
   machine-global, so one buffer collects commits from *every* repository on the
   box. Each sidecar line therefore records the **git common dir** that made the
   commit (the common dir, not the worktree root, because `refs/notes/ai` is
   shared across linked worktrees — so a sibling worktree's commit is genuinely
   confirmable here). Foreign entries are replayed with the rest (the daemon
   attributes each commit in its own repo), but they are never confirmed here —
   `git notes` cannot resolve another repo's commit, so "still missing a note"
   would be a structural impossibility reported as a finding. They are reported
   as *replayed and handed off*, they never appear as unattributed commits in
   this repo, and they never block deletion.
5. **Enumerate every run** — nothing carries state between invocations, so each
   run lists `segment-*.jsonl` beside the buffer and reports **every** one still
   on disk with a retry pointer. A run that leaves any segment *this repository
   still owes* is `retained`, never a healthy "no buffer, nothing to do". A
   segment whose commits are all another repository's is named, not owned.

v1 **never automatically re-replays** a retained segment. A live-daemon spike did
find duplicate replay to be idempotent — notes came back byte-identical and the
notes ref did not grow — but that is one observation on one daemon, which is not
enough to make an unattended retry loop safe across daemon restarts and
multi-repo interleaving. The conservative behaviour ships; the evidence is
recorded for a future plan.

The nudge never fails a doctor run, and every no-op path — no buffer, empty
buffer, unreachable socket, non-`af_unix` target, a `--buffer` outside the repo,
a filesystem error — is a report rather than an error. When the ingress is
unreachable it **does not rotate**, because rotating would cost the buffer for
nothing.

`--buffer` is resolved against the repo and **contained**: this verb renames and
can delete what it is handed, so it accepts only three roots — a path inside the
repository, one beside the trace2 file target your git config names *right now*,
or one beside a file target **the harness itself recorded** buffering into
(`.harness/temp/trace2/known-targets`, gitignored). Anything else is refused,
untouched. The third root is authorization **by record**, not by shape: an
arbitrary absolute path is still refused, because nothing wrote it down.

When `trace2.eventTarget` names a **plain file**, the drain is a *two-step* and
the order is load-bearing: point the target back at the git-ai socket first —
while it names a file there is no ingress to replay into, so the nudge would
simply skip — then run it with `--buffer <that file>`. The recorded-target root
is what makes that second step *executable*: once the reconfiguration lands, the
old file is no longer the configured target, and only the harness's own record
still vouches for it.

### What is and is not promised

- **Guaranteed**: a `harness commit` is never *silent* about attribution. It
  either verifies the note landed, or names the buffer and the recovery command.
- **Not guaranteed**: delivery. A blocked ingress is blocked. Buffered events
  reach the collector only when the nudge runs somewhere that can reach the
  socket, and commits made before git-ai was installed will never gain a note.

Detection is **read-only throughout**: `doctor` and `checks` probe (connect and
destroy, no bytes), enumerate, and name `harness doctor telemetry-nudge` — they
never run it. Recovery happens only when it is explicitly invoked.

### Windows

git's `af_unix` trace2 target is Unix-only, so on Windows the resolver simply
never yields a socket to probe and the whole path is a platform-guarded no-op.
Windows is *must-not-break* here, not *must-work*.

---

## The open design question v1 does not close

**Harness cannot prove that collection is actually happening.** Doctor reports
that the collector is *configured*, and stops there. That is a deliberate refusal,
not an omission.

There is no reliable signal available today:

- `git ai status --json` reports only the **current uncommitted working log**,
  which git-ai **deletes at commit**. A perfectly healthy collector therefore
  reads empty immediately after any commit — so "no recent checkpoint" cannot
  distinguish a broken collector from a clean tree.
- Its `time_ago` field is a **human string** ("2 minutes ago"), not a timestamp,
  so it cannot be compared, thresholded, or reasoned about.
- A **daemon liveness check would pass for every silent-failure mode git-ai
  has.** On the dogfood machine, 52 already-running Claude Code processes were
  live, healthy, and completely uninstrumented, because hooks only take effect
  after a restart.

Shipping a check that cannot tell a broken collector from a clean tree would be
the exact defect this repo keeps killing: a system reporting a conclusion it did
not reach. So v1 **records the gap** instead, doctor says
`could-not-determine` where it cannot determine, and the healthy verdict
explicitly says *configured*, never *collecting*.

Closing this needs something git-ai does not expose today — a durable
last-checkpoint timestamp, or a per-session capture receipt. That is v2 work,
and it is written down here so it cannot be closed silently.

---

## Related

- [Harness telemetry](./telemetry.md) — the capture path this handover disabled,
  and the read path it left alone.
- [Pull published telemetry from remote repositories](./telemetry-pull.md) — how
  the existing 123 published refs stay queryable.
- [Harness telemetry § Authorship attribution](./telemetry.md#authorship-attribution--then-and-now)
  — the archived join method, its bias, and the trade made by line ranges.
