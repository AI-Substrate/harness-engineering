# How agent telemetry actually reaches a git note — and what breaks it

**Written**: 2026-08-09. **Source checkout**: `~/github/git-ai` @ `7df7e2069`, **v1.6.22**.
**Provenance**: every mechanism claim is tagged `VERIFIED-AT-SOURCE (<file>:<line>)`,
`MEASURED` (observed on this machine, today), or `INHERITED` (earlier analysis, not
re-checked). Vendor spec quotes are verbatim.

> **VERSION SKEW — read this before trusting any source citation below.** The source on disk
> is **v1.6.22**. The daemon that actually produced our notes reports
> **`"git_ai_version": "1.6.21"`** (`MEASURED` — read out of the note on `33573abe`), which is
> also what our collector pins. **So every `VERIFIED-AT-SOURCE` tag here describes 1.6.22
> source while the behaviour we observe comes from a 1.6.21 daemon.** They agree everywhere we
> checked, but a source read is not a behaviour observation, and if the two ever disagree this
> is the first thing to suspect.

---

## 0. THE REQUIREMENT — this comes before the mechanism, because it decides which fix is right

Jordan, verbatim:

> *"The reason we got stuck in all this work is that very workaround for Cursor. It's what
> drove us to this point now. Our customer must have Cursor telemetry working **without having
> to do large customisations to the machine** — hence harness installs and manages git-ai for
> them."*

**This is the acceptance criterion for the whole feature**, and everything below should be read
against it. It is why harness installs and manages git-ai — pinned and digest-verified, hooks
installed — instead of handing the customer a configuration task.

It also settles which of the two known escapes (§3) is the product and which is background:

| escape | verdict |
|---|---|
| **allowlist** (`~/.cursor/permissions.json`) | **NOT the answer.** It is a machine customisation — the thing the requirement forbids — **and it does not reliably work**: it survives only a lone allowlisted command, and agents write `&&`-chained commands by default. A remedy that demands configuration *and then fails under normal use* is not a remedy. **Diagnostic context only.** |
| **buffer + nudge** (`harness commit`) | **This IS the product.** Zero machine configuration: the buffer is a filesystem write the sandbox already permits, and harness owns both capture and recovery. |

**The recommended path is `harness commit` plus a drain. The allowlist is background.** Any
doc implying "allowlist git and you are fine" is wrong twice over — it is a customisation, and
`&&` defeats it.

---

## 1. THE COMPLETE CHAIN — five links, each able to fail alone

```
1. edit           agent edits a file
2. working log    ~/.cursor/hooks.json preToolUse/postToolUse -> `git-ai checkpoint cursor`
                  -> LOCAL line-level ledger.  FILESYSTEM WRITE — survives a sandbox.
3. commit detect  git emits trace2 -> af_unix socket -> daemon.  NETWORK OP — a sandbox blocks it.
                  Detection alone is NOT enough: the daemon also needs EXACTNESS (§2)
                  or it FAILS CLOSED.
4. note written   daemon projects the ledger onto the committed tree -> refs/notes/ai
5. note pushed    daemon detects YOUR `git push` via trace2 and pushes refs/notes/ai as a
                  SIDE EFFECT.  You never push notes yourself.
```

### The two channels, and why conflating them caused three investigations

**Channel A is link 2** — the hook. A **filesystem write**; it survives a sandbox.
**Channel B is links 3–5** — the daemon, over a socket. This is what a sandbox breaks.

> A sandbox can leave the **working log** intact while breaking the **note**. "No note" does
> not mean "nothing was captured" — it usually means Channel B did not close while Channel A
> quietly kept working.

`VERIFIED-AT-SOURCE` — the Cursor hook surface is `~/.cursor/hooks.json`, hooks `preToolUse`
and `postToolUse`, and it was **already documented** in
[our own agent-coverage review](./gitai-03-agent-coverage.md) before being "discovered" again.

### Link 5 is the one nobody had written down

`VERIFIED-AT-SOURCE (src/daemon.rs:1273, fn apply_push_side_effect)` — the daemon watches for
*your* push and pushes `refs/notes/ai` as a side effect of it.

**So a blocked sandbox costs you TWICE**: link 3 (no note for this commit) *and* link 5
(previously written notes never leave the machine). That second cost is invisible locally —
everything looks fine until someone else fetches.

Guards, `VERIFIED-AT-SOURCE (src/daemon.rs:1287-1298)`: the side effect is skipped for
`--dry-run`, `-d`/`--delete`, and `--mirror`.
`VERIFIED-AT-SOURCE (src/git/sync_authorship.rs:333, push_authorship_notes)`: it fetches and
merges the remote tracking ref first, then pushes **without force** — fast-forward required,
retried on non-fast-forward — so a diverged notes ref self-heals rather than clobbering.

### The happy path, MEASURED on our own branch

`MEASURED` today on `s077/suite-portability` — the first time we have demonstrated the full
chain on our own work rather than in a throwaway:

```
33573abe   .github/workflows/windows.yml
             s_6b8a25b7716dd8::t_4b2687a1e8fd83   243,245-271
           tool: github-copilot-cli · model: "unknown"
```

Read `243,245-271` closely: **line 244 is NOT claimed.** Discontiguous, sub-hunk attribution
on a real agent commit — that is per-line resolution doing exactly what it promises, on a file
a human and an agent both touched. All six recent commits carried notes; all four pushed ones
were confirmed present on the **remote** notes ref.

`model: "unknown"` for `github-copilot-cli` is the known gap already recorded as **DG-7c** —
noted here so nobody re-reports it as a new finding.

---

## 2. EXACTNESS, NOT REACHABILITY — the answer to the three-day-old question

The open question was recorded in
[the sandbox config reference](./sandbox-04-config-reference.md): *"Why does the normal commit
not reach the collector if the probe can connect to its socket?"* — probe `connected`, plain
`git commit`, still no note. We had never named the remaining gap.

**The vendor's own spec names it.** `VERIFIED-AT-SOURCE
(~/github/git-ai/docs/daemon-trace2-ingestion-spec.md)`, quoted verbatim:

> `:16-19` — "Stock trace2 does not include created commit SHAs or complete ref-update OIDs
> for most commands. A delayed trace2 root saying "git commit ran in repo X with argv Y, exit
> 0" identifies *that a command ran*, not *which reflog entries it produced*. Attribution
> requires the latter."

So trace2 tells the daemon *a command happened*. It does not tell it *which commit*. The
daemon has to establish that itself, and the spec sets a hard bar:

> `:21-30` — "**Ownership rule.** A ref-moving command's transitions are exact if and only if
> at least one of:
> 1. **Pre-command cursor** — the daemon held a reflog cursor (byte offset + anchor) for the
>    relevant ref from *before* the command; entries appended after the cursor, matching the
>    command's expected transition shape, belong to it.
> 2. **Immutable argv OIDs** — the command line itself contains full OIDs sufficient to
>    identify the operation (e.g. `merge --squash <sha>`, `update-ref ref <new> <old>`,
>    `cherry-pick <sha1> <sha2>`)."

And when neither holds:

> `:32-35` — "Otherwise the command is **not exact**: the daemon must fail closed for
> attribution (no guessed authorship, no note migration) and may only use the command as a
> *future baseline* — observe the current reflog ends so the *next* command is exact."

The spec also records what was tried and rejected, which is why no clever workaround is
waiting to be found:

> `:37-40` — "Banned as ownership proof (each was tried and failed; see Postmortem): reflog
> timestamps (seconds-resolution, not causally tied to a trace2 root), commit/reflog message
> matching (messages collide), latest-HEAD guessing, and daemon-ingress "start" offsets
> captured after the fact."

### Therefore

**A plain `git commit` produces a note only if the daemon already held a cursor for that ref.**
Socket reachability is **necessary and not sufficient** — and this is *why*. It is not a
mystery, an unlucky race, or an undiscovered sandbox rule. It is the documented, deliberate
fail-closed behaviour of the collector.

### Corollaries that explain things we have already observed

- **The first commit in a fresh repo gets no note.** No cursor existed, so the command is not
  exact, so the daemon fails closed and sets a baseline. We observed exactly this on a seed
  commit and treated it as a symptom. It is the specified behaviour.
- **A daemon restart drops cursors**, so the next commit *per ref* is not exact. That is a far
  simpler explanation of an intermittent "lost" commit than anything about the shell.
- **Fail-closed means a missing note is not evidence of a broken socket.** The two produce the
  same observable, and only one of them is a fault.

### The fail-closed state is TRANSIENT — and here is the control the corpus never had

`MEASURED` 2026-08-09, in a throwaway repo, on a seed commit made by **a plain shell script
with no agent anywhere near it**:

| when | `git notes --ref=ai show <seed>` |
|---|---|
| t+0 | `error: no note found` — the exactness fail-closed of §2 |
| t+~40 min | a **blanket `h_…` known-human note** over the whole commit, naming the commit's real git author |

Two things follow, and the second is the important one.

**1. "No note" is not a terminal state.** A later stage attests the commit as blanket
known-human. So *when* you look changes what you see, and both readings were available within
one hour on one commit. Any check that treats "no note" as a verdict — ours included — is
reading a race. This is why `git-ai await` belongs at step 0 of every verification (§4), and
why a run must not conclude "a note appeared later, so something fixed itself".

**2. This is the first time we have observed the blanket-human path on a GENUINELY human
commit.** Every "outside the agent" commit in the historical runs was another AI in a
terminal, so the corpus had no control for real human authorship. Here there was no agent at
all, and git-ai produced a **correct** `h_` attestation naming the right author.

> **And that is exactly what makes the wrong case dangerous.** The same machinery that
> correctly stamps a real human commit as human will stamp an AI commit as human when the
> event never arrived — with the same confidence, the same shape, and no signal that it
> guessed. A correct fabrication and an incorrect one are indistinguishable from the note. It
> is the missing half of the F-03 story: we had only ever seen this path get it wrong, and now
> we have seen it get it right, which tells us the mechanism is not broken — it is
> *underdetermined by its inputs*.

---

## 3. THE SANDBOX FAILURE MODE, AND ITS TWO ESCAPES

**Why it breaks:** inside the Cursor sandbox a unix-socket `connect()` is a **network
operation** and is blocked, so the trace2 event is never delivered. **Links 3 and 5 both
fail.** Link 2 still works, because it is a filesystem write.

That asymmetry is the whole story: **the edit data survives while the commit event is lost.**

### Escape (a) — the allowlist, and why `&&` defeats it

`terminalAllowlist` runs a command OUTSIDE the sandbox, but **only when the allowlisted binary
is the entire invocation**. `git commit -m x` escapes; `git add . && git commit -m x` is a
compound shell line, so the shell runs it and the sandbox applies.

**Agents write chained commands by default.** So "just allowlist git" does not survive normal
agent behaviour — and that, plus the §0 requirement, is the core argument for detection living
in the harness rather than in IDE config. **Diagnostic context, not the recommended path.**

### Escape (b) — the nudge: fake the event from a file

`harness commit` points `GIT_TRACE2_EVENT` at a **FILE** rather than the socket. The
filesystem write is permitted, so the event is **captured instead of lost**.
`harness doctor telemetry-nudge` then replays those exact bytes into the daemon's `af_unix`
socket from an unsandboxed context — the daemon cannot distinguish the replay from live
traffic.

**POSIX only.** On Windows the ingress is a **named pipe** — a live ingress, not a drainable
buffer — so there is nothing to replay (plan 075).

### Telling which one happened — `harness commit --json`

Under `data`: `probe` (`connected` | `denied` | …), `mode` (`direct-verified` |
`harness-buffered` | `file-buffered` | `ingress-unverified`), `verify` (`landed` | `missing` |
`skipped`), and `buffer`.

> **`probe: denied` + `mode: harness-buffered` is the sandbox caught in the act** —
> attribution **deferred, not lost**.

---

## 4. THE FIRST-CLASS VERIFICATION METHOD — three layers

Full commands, and the caveats that make each layer mean something, live in
[the validation playbook](./sandbox-03-validation-playbook.md#the-three-layer-verification).
The shape:

```bash
git-ai await                      # 0. ALWAYS FIRST — removes the async race
git-ai status --json              # 1. LOCAL, UNCOMMITTED — pre-commit only
git notes --ref=ai show <sha>     # 2. LOCAL, COMMITTED
git fetch origin '+refs/notes/ai:refs/notes/_syncprobe'   # 3. SYNCED — per commit
```

**`git-ai await` is the fix for a three-day-old problem.** Every prior run raced the daemon and
had to guess whether "no note" meant *failed* or *not yet*. It belongs at step 0 of every
check.

---

## 5. LAYERING — why the F-04 argument was never resolvable

There are **two mechanisms at different layers**, and conflating them is what made our own
corpus contradict itself:

| layer | question it decides |
|---|---|
| **sandbox / command shape** | does the trace2 event **reach the daemon at all**? |
| **exactness / reflog cursor** | does a **received** event produce a note? |

**Both are real.** Run 7's "identical shapes behaved differently" is explicable at *either*
layer — so it is not evidence against the sandbox mechanism. It is evidence that **nobody
isolated the layers.** That is why the contradiction was never resolvable with the runs we
have, and why the experiment named in §6 has to hold one layer fixed.

---

## 6. F-04 — DOWNGRADED

> **HYPOTHESIS — explains the observations, derived from the vendor spec, NOT yet tested here.**

F-04 held that *compound/chained shell commands run sandboxed while standalone ones do not* —
i.e. that **command shape** determines whether attribution survives. It carries **High**
confidence in `docs/plans/074-sandbox-attribution/assets/research-dossier.md` and is stated
causally in shipped prose in [the collector handover](../gitai-collector.md).

**What can be stated flatly:** F-04's High confidence is **not supportable**. It was
contradicted by run 7 and again by shipped-code validation, and was never re-adjudicated. A
mechanism contradicted twice and never re-tested does not remain High.

**What is only a hypothesis:** the cursor model explains the same observations more simply.
Exactness depends on **daemon history** — prior commands on that ref, daemon uptime, restarts
— **not on command shape**. Two sessions issuing byte-identical commands would diverge exactly
as observed, which is precisely the "non-determinism across sessions" that F-05 recorded and
could not explain.

**The experiment that would settle it**, and which nobody has run: issue the *same command
shape twice* — once with a **warm cursor** (a prior commit on that ref, daemon up throughout)
and once **after a daemon restart**. If the warm run attributes and the post-restart run does
not, command shape is irrelevant and F-04 is dead. If shape still predicts the outcome, the
cursor model is insufficient and F-04 deserves a re-test rather than a downgrade.

Until that runs, **both** readings stay on the table and neither should be written as fact.

---

## 7. Attribution mechanics verified at source today

These were checked against the Rust, not inherited:

- `EDGE_EXTENSION_MAX_LINES = 3` — `VERIFIED-AT-SOURCE
  (src/authorship/attribution_recovery.rs:22)`.
- `is_ai_attestation(author) = author != "human" && !author.starts_with("h_")` —
  `VERIFIED-AT-SOURCE (:1697-1699)`. **Permissive by construction: anything not explicitly
  human counts as AI.**
- `edge_recovery_for_run` — `VERIFIED-AT-SOURCE (:1642)`. The mechanic is **run-edge, not
  proximity**: it takes a run of contiguous *unattributed* lines and inspects `line(first-1)`
  and `line(last+1)`. Previous line AI → the first 3 are claimed; next line AI → the last 3;
  both, same session → up to 6.

  **Padding between human and AI lines does NOT help.** The padding is itself unattributed, so
  it joins the same run rather than separating anything. Only run **length** creates an
  unclaimed middle.

---

## 7a. The mixed-commit boundary — MEASURED 2026-08-09, live Cursor, `networkPolicy` absent

The plain scorecard. Evidence repo: `~/temp/gitai-mixed-20260809` (four commits, notes read
directly; historical `c835cd97` in `~/temp/gitai-allowlist-test`).

| case | result |
|---|---|
| AI-only commit | **works** — exact agent lines (`9f2d574`: 4-11 claimed, human 1-3 not) |
| human-only commit | **works** — blanket `h_`, correct (`5acdaec`, `09f4ec6`; note arrives late, ~40 min) |
| two AGENTS, one commit | **works** — separated per session (`c835cd97`, cursor vs claude) |
| human + AI, ONE commit | **BROKEN** — human lines absorbed into the agent session. Measured twice (`df4d45c` heredoc, `b3a18af` python) — the edit mechanism is irrelevant |

In plain words: **if people commit their own work separately, the numbers are trustworthy.
When a human edits alongside an agent and the agent commits it all together, the AI gets
credit for the human's lines — silently, in the AI-inflating direction.**

### The mechanism — the checkpoint layer is CORRECT; absorption happens at commit-time recovery

Run 3's archived working log (`.git/ai/working_logs/old-df4d45c…/checkpoints.jsonl`) holds
exactly two checkpoints: `Human t_04c9…` (the pre-Write baseline — it **did** capture the
human lines) and `AiAgent t_da7b…` (Cursor's diff — `halve()` only, lines 50-54). Cursor
claimed only its own work. The note's other two trace ids (`t_98cc…` 35-46, `t_52c3…` 47-49)
appear in **no checkpoint log** — they were minted by the recovery ladder at commit (47-49 is
exactly the 3-line edge extension; 35-46 a larger recovery claim, solver unidentified).

Why recovery is allowed to do this: a plain `Human` checkpoint is a **diff base, not an
attestation** — `post_commit.rs:50` excludes Human checkpoints from projection
(`VERIFIED-AT-SOURCE`). Only two claims are durable: `s_` (agent) and `h_` (**KnownHuman** —
defined upstream as *observed being typed in an IDE with the git-ai extension installed*,
carrying `{editor, editor_version, extension_version}`). Everything else is unknown, and in a
mixed commit unknown lines are recovery fodder — asymmetric toward AI by design (§7).

Diagnostic that generalises: **a trace id present in the note but absent from the archived
working log was minted by recovery, not observed by any checkpoint.**

Also `VERIFIED-AT-SOURCE`: Cursor's `beforeSubmitPrompt` human hook is **legacy and rejected
outright** (`checkpoint_agent/presets/cursor.rs:55-60`) — only `preToolUse`/`postToolUse`
exist now. git-ai's own docs: no heuristics, no filewatchers — explicit checkpoints only.

### Why an earlier test "worked" — two different architectures

The remembered success (`scratch/cursor-attribution-kit/human-edit.py`, 93.4%/6.6%, ground
truth to the line) was **harness telemetry, not git-ai**. Harness never claims unobserved
lines — human share is the *residual* (total − agent). git-ai actively *recovers* unknown
lines. Same probe, opposite architectures, opposite results. "But it worked before" compares
two different systems.

### UNTESTED — named so nobody reports them as findings

- **Cross-file mixed commit** (human edits file X, agent edits file Y, committed together):
  predicted mostly-OK — edge extension is per-file and cannot reach a file the AI never
  touched; expected result is the human file **absent** from the note. Caveat: one recovery
  stage keys on file mtime inside the agent's shell-command windows and could claim a whole
  human file on a timestamp coincidence. Never observed.
- **The `known_human` lever**: `git-ai checkpoint known_human` (or the IDE extension) is the
  only durable human claim, so bracketing a human edit with it is the candidate fix for the
  broken row. If it yields an `h_` + `s_` mixed note, the gap is closable; if not, the
  limitation stands and must be disclosed to the customer.

---

## 8. What is still INHERITED

Everything in the sibling `gitai-0*` documents in this folder is `INHERITED` unless it carries
a `VERIFIED-AT-SOURCE` tag. Those were written on 2026-08-07 from analysis, **before the
source was available on this machine**, and they are point-in-time reads rather than a
maintained contract. Re-verify before relying on a specific `file:line`.

---

## See also

- [Validating telemetry capture inside a sandboxed agent](./validating-telemetry-capture-in-sandboxed-agents.md)
  — the scenario that exercises both channels and fails them independently.
- [Sandbox config reference](./sandbox-04-config-reference.md) — the settings, and what is
  measured versus inferred.
- [git-ai attribution algorithm](./gitai-05-attribution-algorithm.md) — the fuller (INHERITED)
  algorithm write-up.
- [git-ai agent coverage](./gitai-03-agent-coverage.md) — the installer surface per agent,
  including the Cursor hook entry that Channel A depends on.
