# Validating telemetry attribution inside a sandboxed agent harness

**Source**: 9 collaborative Cursor runs on macOS across plans 073/074, plus the seatbelt
mechanism measurement in [the sandbox config reference](./sandbox-04-config-reference.md).
Everything below is either something that worked or something that cost us hours.

**Audience**: an agent or engineer who has to prove that commits made *from inside an agent
harness* are attributed correctly — and who may be on a different OS from the one this was
written on.

## Scope — this is a GENERAL procedure, with Cursor as the worked example

The thing under test is not Cursor. It is any **sandboxed agent harness**: a tool that runs
your shell commands for you inside a restricted environment. The sandbox is what makes this
hard, because it can permit the command and still silently break the side-channel the
attribution depends on.

The procedure in §2 is harness-agnostic. Cursor appears throughout as the **worked example**,
because it is the one we ran nine times and measured.

**What has actually been tested, stated honestly:**

| harness | status |
|---|---|
| Cursor (macOS, Seatbelt) | **TESTED** — 9 runs; root cause found and proven |
| Cursor (Windows) | **NOT TESTED** — a different sandbox mechanism entirely; see §5 |
| VS Code + Copilot | **PARTIALLY** — a prompt exists and the general shape held; not run to completion |
| Claude Code · Codex · others | **NOT TESTED** — no runs, no measurements |

Do not read a step below as validated for a harness in the NOT TESTED rows. The methodology
should transfer; the *findings* do not. Where you need a harness-specific fact — which sandbox
it uses, how it spells a socket, whether it isolates the filesystem — establish it first, the
way §5 does for Windows, and write down what you established.

---

## 1. What you are actually testing

git-ai attributes commits by receiving **git's trace2 event stream**. If that stream does not
reach its daemon, the commit lands with **no attribution note**, and git-ai's recovery ladder may
then stamp the lines as **known-human**. So the failure is not "no data" — it is a **wrong
answer**, and every health signal stays green while it happens.

On macOS the cause was Cursor's Seatbelt sandbox blocking a unix-socket `connect()` — a
mechanism since MEASURED directly: under `deny network*` the connect returns `EPERM` while
`statSync` on the same socket path still succeeds, so the socket is *visible and unusable at
the same time*. That is the shape to look for in any sandbox, not just this one.

**On Windows the whole mechanism is different and largely unknown** — see §5. Do not assume
any macOS finding transfers, and do not assume another harness applies the same policy: the
general mechanism is measured, the per-harness policy is not.

---

## The three-layer verification

**This is the first-class method. Use it for every check, on every harness.** Three layers,
because a claim about one says nothing about the others — and a run that checks only layer 2
cannot tell "never captured" from "captured but never synced".

```bash
# 0. ALWAYS FIRST — removes the async race that invalidated every prior investigation
git-ai await
```

**`git-ai await` fixes a three-day-old problem.** The daemon reads trace2 asynchronously, so
every earlier run raced it and had to guess whether "no note" meant *failed* or *not yet*.
Nothing below is trustworthy without it. Put it at step 0 of every check, not just the first.

```bash
# 1. LOCAL, UNCOMMITTED — the working log
git-ai status --json
```

**CAVEAT that makes this layer nearly useless after a commit:** it reports only the CURRENT
uncommitted working log, which git-ai **deletes at commit**. So an empty result cannot
distinguish a broken collector from a clean tree. **Meaningful ONLY pre-commit** — do not use
it as a health check.

```bash
# 2. LOCAL, COMMITTED — the note exists in refs/notes/ai
git notes --ref=ai show <sha>        # raw: path + line ranges + JSON footer
git-ai show <rev>                    # or: git-ai log --notes
git notes --ref=ai list | wc -l
```

```bash
# 3. SYNCED — the note actually reached the REMOTE
git ls-remote <remote> 'refs/notes/*'
```

**Comparing local vs remote OID is NOT sufficient** — the two refs legitimately differ, so a
mismatch is not evidence of a sync failure. Only a per-commit check answers it:

```bash
git fetch origin '+refs/notes/ai:refs/notes/_syncprobe'
git notes --ref=_syncprobe show <sha>     # present => that commit's note IS on the remote
git update-ref -d refs/notes/_syncprobe   # clean up
```

**Why layer 3 exists at all:** you never push notes yourself. The daemon pushes
`refs/notes/ai` as a **side effect** of detecting *your* `git push`
(`VERIFIED-AT-SOURCE src/daemon.rs:1273`). So a sandbox that blocks the socket costs you
twice — the note for this commit, and the delivery of every note written earlier. Layer 3 is
the only layer that catches the second one, and it is invisible locally.

See [the mechanism doc](./gitai-06-two-channel-model.md) for the full five-link chain.

---

## 2. The methodology (this is the transferable part)

### 2.1 Set up a throwaway repo with a control

```
mkdir agent-telemetry-test && cd agent-telemetry-test
git init
# seed commit made OUTSIDE Cursor, from a normal shell:
git add . && git commit -m "chore: seed (made outside Cursor)"
```

Then check the seed got a note. **If the seed has no note, stop** — the collector isn't working on
this machine at all, and every later result would be noise. That one commit is your proof the
daemon is live *and* your baseline count.

### 2.2 Write the prompt to a FILE in the repo, not into the chat

Put the instructions in `CURSOR-RUN-1.md` at the repo root, then paste only:

> Read `CURSOR-RUN-1.md` and follow the instructions in the block between the horizontal rules,
> then write your report to `reports/run-1.md`.

Why: the prompt is version-able, re-runnable, and identical across runs. Pasting long instructions
into chat means you can never prove what was asked.

### 2.3 Make it a collaboration, not an extraction

The single highest-value change we made was **telling the Cursor agent what we were testing and
why**, and asking it to write a report back. Early runs kept it in the dark to avoid contaminating
results; that cost us — an agent that knows the theory notices the thing you didn't think to ask.

Two sections earn their keep in every report:

- **"Anything I noticed"** — this caught a substituted command (`rg` for `grep`) and, twice,
  the fact that a command ran differently from how it was written.
- **"Questions for Claude"** — the Cursor agent asked one question that reframed the entire
  investigation.

Reply to its report by appending a `## Reply from <you>` section to the same file. A real
back-and-forth beats scraping logs.

### 2.4 Demand verbatim output and a sandbox label per command

Every step must ask for:
1. the **exact command** as executed,
2. its **full output, verbatim** (not summarised),
3. whether the environment reported it **sandboxed or outside the sandbox**,
4. explicit `(no output)` rather than silent omission.

That per-command sandbox label is half the experiment. It is what finally explained our results.

### 2.5 Always include a control, in the same session

Our decisive run had two commits minutes apart in one session: a plain `git commit` (lost its
note) and a `harness commit` (buffered and recovered). Without the plain-git control, "the harness
path worked" is unfalsifiable — it could just mean nothing was blocking that day.

**A result without a control is not a result.** We wasted two runs learning this.

### 2.6 One variable at a time

When we tested command *shape*, we ran four empty commits differing only in shape (standalone,
trailing `&&`, leading `&&`, command substitution). That isolated the variable in one run. Mixed
changes across runs produced two days of contradictory findings.

### 2.7 Verify every claim yourself, from outside

The Cursor agent's report is evidence, not proof. After each run, from your own shell:

```
git log --oneline
git notes --ref=ai list          # count
git notes --ref=ai show <sha>    # the actual attribution
```

And check whether the daemon ever saw the commit at all — this distinguishes "delivered but
rejected" from "never delivered":

```
# macOS/Linux path; find the Windows equivalent first (§5)
grep 'op="commit"' ~/.git-ai/internal/daemon/logs/*.log | grep <repo-name>
```

---

## 3. Pitfalls that cost us real time

| Pitfall | What happened | Guard |
|---|---|---|
| **`cmd --help` exit-0 false positive** | Tested `harness commit --help && echo HAS` — commander prints top-level help and exits 0 for unknown subcommands, so it reported a verb that didn't exist | Never infer capability from an exit code; grep the actual output or the source |
| **Checking one SHA and generalising** | Declared "stale replay fails" after checking a single commit. Five others had in fact recovered | Check every commit, always print the full table |
| **Agent silently rewrites a command** | `rg` substituted for `grep`; a `head -20` dropped | Ask explicitly: "if any command was rewritten, merged or reshaped before execution, say so" |
| **Non-determinism read as a rule** | Compound commands were sandboxed in one session and unsandboxed in another with **identical config**. We nearly shipped "compound commands lose attribution" as a fact | Re-run any behavioural claim in a fresh session before believing it |
| **A fix's own premise is the next defect** | Three review rounds in a row, the bug was the previous fix's assumption (identity from text → from repo location → from harness dir). Each fix made the wrong claim smaller | When a fix rests on "X can never happen", test X directly. Prefer deleting a heuristic over narrowing it |
| **`--dry-run` that isn't** | `git ai install-hooks --help` performed a **full install** — its arg parser fails open (`_ => {}`) | Never run git-ai's install verbs "just to look". Assume they act |
| **Repo-local git config ignored** | `trace2.eventTarget` in `.git/config` does nothing — git reads trace2 from **system/global only** | Use the `GIT_TRACE2_EVENT` env var, or global config |

---

## 4. What we established on macOS (context, not gospel)

- git-ai has exactly **one ingress**: trace2 over a unix socket. No git shim, no post-commit hook,
  no daemon-less mode, no control-API verb for "a commit happened".
- Cursor's sandbox blocks that socket (`connect()` is treated as a network op by Seatbelt), while
  allowing file writes — so the *edit data* arrives and the *commit event* never does.
- Cursor's `terminalAllowlist` (in `~/.cursor/permissions.json`, run mode
  **Allowlist (with Sandbox)**) genuinely exempts matching commands from the sandbox — a bare
  `harness`, `git` or `node` ran outside it. **But** wrapping a command so its first word is not
  allowlisted (e.g. `sh -c '…'`) puts it back inside, which is how we forced the blocked path.
- Whether *compound* commands (`a && b`) match the allowlist is **not reproducible** — treat any
  claim about it as unproven.

---

## 5. Windows — establish these BEFORE running any Cursor test

**Nothing above about sandboxing is known to apply.** Cursor documents Seatbelt (macOS) and
Landlock/seccomp (Linux); we found **no documented Windows sandbox**. And the transport itself
differs — git's `af_unix` trace2 target is **Unix-only**, so git-ai's Windows build must use
something else (a named pipe is the likely candidate, unverified).

Run this **orientation pass first**, from a normal shell, before involving Cursor at all:

1. **Does attribution work here at all, unsandboxed?**
   Make a commit from a normal shell in a throwaway repo; does it get a `refs/notes/ai` note?
   If no — stop and report that. Nothing else is meaningful.
2. **What is the trace2 target on this machine?**
   `git config --global --get trace2.eventTarget` — is it `af_unix:…`, a named pipe, a file path?
   Record the literal value.
3. **Where are the daemon logs?** Find the Windows equivalent of
   `~/.git-ai/internal/daemon/logs/` so you can check whether a commit event ever arrived.
4. **Does Cursor report a sandbox at all?** Have Cursor run `cmd /c set` (or
   `Get-ChildItem Env:` in PowerShell) and look for any `CURSOR_SANDBOX`-like variable, and note
   whether its UI labels commands as sandboxed.

**Report those four answers before running any comparative test.** If there is no sandbox on
Windows, the interesting question changes entirely — from "does the sandbox break attribution" to
"does attribution work on Windows at all, and through what transport".

### Windows practicalities

- **Shell**: Cursor may use PowerShell or `cmd`. `&&` works in PowerShell 7+ and `cmd`, but the
  quoting differs — prefer single standalone commands, which sidesteps it entirely.
- **Paths**: use absolute paths in prompts; backslashes need care inside quoted strings.
- **The `sh -c` trick** from § 4 for forcing a sandbox may not exist. Find the local equivalent of
  "a command shape the allowlist won't match" — or report that you cannot force it.

---

## 6. Prompt template (adapt, keep the shape)

````markdown
# Cursor run N — <one-line purpose>

<context: what we already know, what is being tested, what was ruled out>
Baseline: <N> commits, <M> notes.

---

Paste the block below into Cursor's agent.

---

You are helping diagnose <the thing>. Another agent, outside Cursor, will read your report and
reply in the same file. Be precise, quote raw output verbatim, and say "unknown" rather than
guessing — a negative result is as valuable as a positive one.

Background you need: <the theory, honestly stated, including what has already been disproved>.

For EVERY command below, state whether your environment reported it sandboxed or outside the
sandbox. Quote all output verbatim; write `(no output)` rather than omitting it.

**Step 1 — <action>.** Run exactly:

```
<command>
```

Report: <exactly what you want back>.

**Step 2 — <the control>.** …

**Step N — write your report** to `reports/run-N.md` with: what you did, each step's verbatim
output, the sandbox label per command, an **Anything I noticed** section (approval prompts,
commands that were rewritten or reshaped, anything surprising — this section is the most valuable
part), and **Questions for the other agent**.

Do not try to fix the problem — we are diagnosing, not repairing, and a repair invalidates the run.
Do not edit anything outside <the allowed files>.
````

---

## 7. Checking the result (from your own shell, every time)

```bash
# per-commit attribution table — never spot-check one
for c in $(git log --format=%H); do
  git notes --ref=ai show $c >/dev/null 2>&1 \
    && echo "NOTE    $(git log -1 --format='%h %s' $c)" \
    || echo "MISSING $(git log -1 --format='%h %s' $c)"
done
```

Then read one note in full — attribution can be present but *wrong*:

```bash
git notes --ref=ai show <sha>
```

Look for `"tool"` and `"model"` in the sessions block. A note whose lines are attributed to
`h_<hash>` with a human author, when an agent wrote them, is the **worst** outcome — that is
AI work recorded as human work, and it looks perfectly healthy.

---

## 8. What to report back

1. The four Windows orientation answers (§ 5) — **first, before anything else**.
2. Per run: the prompt used, the agent's report file, and your own verification table.
3. Every claim marked as **proven** (you saw it), **inferred** (you reasoned it), or
   **unknown** — and never silently promote one to another.
4. Anything that contradicts this document. The macOS findings are context, not gospel, and a
   Windows result that disagrees is a finding, not a mistake.
