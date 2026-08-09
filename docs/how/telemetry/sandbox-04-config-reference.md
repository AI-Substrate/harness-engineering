# Cursor sandbox configuration — where it lives, what it controls, and what F-11 actually was

**Recorded**: 2026-08-09 · **Seat**: `pij-respectable-clam` · **Why**: this was re-derived from
scratch twice, argued about once, and the answer was three small files nobody had opened.

> **This belongs in `docs/how/telemetry/` when the docs reorg lands.** It is parked in a plan
> folder because that is where it was found, not because that is where it belongs.

---

## 1. The three files, on macOS

All under `~/.cursor/`. All small, all plain JSON, all trivially readable — which matters,
because [#144](https://github.com/AI-Substrate/harness-engineering/issues/144) was filed with
"can we even read this?" as its blocking unknown. **We can.**

| file | key | what it controls |
|---|---|---|
| `permissions.json` | `terminalAllowlist` | which commands run **outside** the sandbox |
| `sandbox.json` | `networkPolicy.default` | whether network ops — **including unix-socket `connect()`** — are permitted |
| `cli-config.json` | `sandbox.mode`, `permissions.allow` | the **CLI** agent's sandbox, separate from the editor's |

**On this machine, 2026-08-09** (a machine deliberately configured for this work over two
days — do NOT treat as a default install):

```json
// ~/.cursor/permissions.json
{ "terminalAllowlist": ["git", "harness", "node"] }

// ~/.cursor/sandbox.json
{ "networkPolicy": { "default": "allow" } }

// ~/.cursor/cli-config.json (extract)
{ "sandbox": { "mode": "disabled", "networkAccess": "user_config_with_defaults" },
  "permissions": { "allow": ["Shell(ls)"], "deny": [] } }
```

**`~/Library/Application Support/Cursor/User/settings.json` contains NONE of this.** That is
the obvious place to look and it is the wrong one. Two people looked there first.

---

## 2. What F-11 actually was

`research-dossier.md` F-11 records: *"the socket was **reachable from inside the sandbox** in
one session (probe `connected` with `CURSOR_SANDBOX=seatbelt` set)"*, and
`collector/ingress.ts:21` cites it as the reason **env markers never decide a verdict — only
the probe outcome does.** That inference is correct and stands.

**But F-11 never said HOW, and the most likely answer is now visible:**

A unix-socket `connect()` is a network operation. `networkPolicy.default: "allow"` permits
it. So the socket was reachable **because this machine's network policy allows it** — not
because the sandbox is permissive by default.

**Two confounders, recorded so nobody re-reads F-11 as stronger than it is:**

1. The run happened in `~/temp/gitai-allowlist-test` — the name says an allowlist experiment.
   The run-1 prompt did not survive (only `CURSOR-RUN-3..7` are kept), so what was configured
   at that moment **cannot be recovered**.
2. `permissions.json` is dated 7 Aug **08:55**; run-1's socket listing shows **07:56**. The
   allowlist file post-dates the run, so the allowlist may NOT have been what made it
   reachable — leaving `networkPolicy` as the better candidate.

**Status: MEASURED for seatbelt, NOT measured for Cursor's own profile.** A peer confirmed
under macOS seatbelt that a unix-socket `connect()` **is** governed as a network operation:
under `deny network*` the connect returns `EPERM`, while `statSync` on the very same socket
path still succeeds. So the general mechanism — *a sandbox can make a socket visible and
still refuse the connect* — is now a measured fact, and it explains the shape we saw.

**What that does NOT establish is that Cursor blocks it.** Cursor's own sandbox profile is
not readable by us, so whether Cursor applies this policy, to which paths, and under which
setting remains inferred. The measured claim is narrower than "Cursor blocks the collector
socket", and it should not be restated as that. It is still untested by toggling
`networkPolicy` and re-probing, which is the experiment that would close the gap.

---

## 3. The question from that run that is STILL unanswered

The Cursor agent asked it in `run-1.md` and nobody answered:

> *"Why does the normal commit not reach the collector if the probe can connect to its
> socket?"*

**Probe `connected`, and the plain `git commit` still produced no note.** So socket
reachability was **necessary but not sufficient**, and whatever the remaining gap is, we have
never named it.

This matters directly to *"telemetry must work from inside Cursor with no external
intervention"*: making the socket reachable may not be enough on its own.

---

## 4. What this means for the buffer/nudge design

- **`harness commit` works inside the sandbox regardless**, because `GIT_TRACE2_EVENT=<file>`
  is a **filesystem** write, which the sandbox permits. Nothing touches the socket.
- **`nudge` replays the buffer into the collector's `af_unix` socket** (`nudge.ts:28`) — so it
  needs network permission, i.e. `networkPolicy`.
- Therefore **nudge-from-inside works on a machine like this one, and may not on a default
  install.** It is a configuration question, answerable by the probe we already ship.

**The shipped `next_action` is over-strong**: it says *"Run `harness doctor telemetry-nudge`
from an UNSANDBOXED shell"* unconditionally, when the probe could tell the user whether that
is actually necessary. Worth correcting.

---

## 5. What a doctor check should read (for #144)

Concrete, replacing the "establish readability first" unknown:

1. `~/.cursor/permissions.json` → is `git` in `terminalAllowlist`?
2. `~/.cursor/sandbox.json` → what is `networkPolicy.default`?
3. `~/.cursor/cli-config.json` → `sandbox.mode`.

**Absent ≠ permissive.** A default install may have none of these files, and a missing file
must produce **"cannot tell"** as a distinct third state — never a green and never an alarm.
Reuse the existing Cursor detection in `services/doctor/collector/agents.ts` (`~/.cursor`
marker); do not build a second detector.

---

## 6. The trade, recorded because it is not a pure win

`docs/how/telemetry/sandbox-02-workarounds-proven.md` notes the sandbox **protects `.git/config`
and `.git/hooks` from agent writes**, and calls that *"arguably a feature — the agent cannot
disable its own observation."*

Allowlisting `git` hands that back. Closing silent attribution loss and widening what a
sandboxed agent can do to git state are the same change.

---

## 7. How to settle §2 and §3 properly

The methodology already exists — `docs/how/telemetry/sandbox-03-validation-playbook.md`. One run
answers both:

1. Set `networkPolicy.default` to something other than `allow`, probe from inside → does the
   probe still report `connected`?
2. With the socket reachable, commit with plain `git` from inside → does a note appear? If
   not, §3's question is live and reachability is genuinely insufficient.
3. Nudge from **inside**, with no external shell → does the buffer drain?

**(3) is the acceptance test for "no external intervention".** Until it is run, that
requirement is unproven in both directions.
