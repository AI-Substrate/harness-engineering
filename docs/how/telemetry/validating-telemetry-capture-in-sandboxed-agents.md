# Validating telemetry capture inside a sandboxed agent

**Status**: drafted for `docs/how/telemetry/`. Ready to land.
**Scope**: agent-neutral. Cursor is the worked example because it is the one we have field data
for; the procedure applies to any coding agent that runs commands in a sandbox.

**Provenance convention.** Claims about collector behaviour are marked **VERIFIED-AT-SOURCE** with
`file:line` where they were read from the git-ai source (`~/github/git-ai`, v1.6.22), or
**INHERITED** where they come from an analysis document or a run report and were not confirmed at
source. An inherited mechanism is a hypothesis; treat the two differently.

---

## 1. What this validates, and what it does not

The thing worth proving is not that the collector is *reachable*. It is that the collector can
**tell AI-written code from human-written code**.

> A collector that attributes **every** commit passes a reachability probe and fails the
> requirement completely.

Reachability is necessary and it is not the product. A connection test that returns green tells
you a socket accepted a connect; it tells you nothing about whether the resulting record is
*true*. This document is built around discrimination, and treats reachability as one input to it.

Two things follow, and they shape everything below:

- **Attribution resolves per line, not per commit** — git-ai can separate human from AI *within a
  single commit*. So the sharpest test is a mixed commit (§2 step 4), not an alternation of whole
  commits.
- **The failure that matters is a wrong answer, not a missing one.** A blocked ingress does not
  merely lose data; it causes AI-written lines to be attested as **human** (§3.2). A missing note
  is visibly missing. A wrong one is not.

## 2. The scenario — interleaved, not seed-then-agent

```
  1. the AGENT makes edits and commits        -> expect attributed to the agent
  2. a SCRIPT makes edits and commits         -> negative control
  3. the AGENT makes more edits and commits   -> expect attributed to the agent
  4. the AGENT writes some lines AND a script/human writes others,
     committed TOGETHER                       -> the note must SPLIT them, per line
```

**Why alternation, and not a single human seed commit followed by agent work:** a collector that
starts attributing everything after the first observed event would pass a seed-then-agent test.
It would record the seed as human, then mark every subsequent commit as AI — including commits it
never actually observed — and look perfect. Alternation is what proves attribution tracks the
**actual author of each commit** rather than a point in time after which everything is assumed to
be the agent.

**Why step 4 is the real test, and steps 1–3 are not enough:** whole-commit alternation can still
be passed by a collector that only knows **who was active when each commit happened**. Such a
collector never has to attribute a single line, and it would score full marks on steps 1–3.
Step 4 is the only step that cannot be passed by session-level bookkeeping, because a mixed commit
has one timestamp, one author, one session — and two truths inside it. **Attribution is
line-level, and step 4 is the step that actually tests the product claim.**

Practical notes for step 4, because the setup decides what it measures:

- Put both sets of lines in the **same file** where you can, so the split cannot be done by
  filename alone. A per-file split is a weaker result than a per-hunk one — record which you built.
- **Whoever runs `git commit` owns the session.** Do it both ways if you have the budget: once
  committed by the agent, once by the script. If the note tracks the committer's session rather
  than the lines, the two runs disagree — and that disagreement is the finding.
- Write down the true line-to-author map **before** you look at the note. Deciding afterwards
  which lines "were really the agent's" is how a wrong result gets read as a right one.

Requirements on step 2 that are easy to get wrong:

- The script commits must be **plain `git` from a normal shell, with no agent involved**. If the
  agent runs the script, the agent's session is what the collector sees.
- They must be **genuinely different edits** — not a re-run of the same file — so that a
  content-similarity heuristic cannot get them right by accident.

## 3. The proof — three stages that fail independently

| # | claim | proven by | what a failure means |
|---|---|---|---|
| 1 | **recorded** | notes exist in `refs/notes/ai` | capture is broken — see §4 for the causes actually observed |
| 2 | **discriminated** | agent lines and human/script lines are attributed differently — **including inside one mixed commit** (§2 step 4) | worse than no attribution: a confident wrong answer, see §3.2 |
| 3 | **pushed** | the notes ref reaches a **real network remote** | local success with remote silence — the push is a separate blocked surface |

Record → drain → push are **three independent failure surfaces**. Each can fail alone, and a pass
at one says nothing about the next. Report the **per-commit table**, not a pass/fail: a missing
note on an agent commit and an unexpected note on a script commit are equally findings.

### 3.1 Stage 2 — attribution resolves PER LINE, inside a single commit

**The discriminator is not whether a note exists. It is whether the note splits a commit's lines
between authors correctly.**

git-ai attributes at line level, and can separate human from AI **within the same commit**. This
is measured from real notes, not inferred: 186 notes in this repo, of which **62 carry more than
one session, and one carries six**.

The note format — `git notes --ref=ai show <sha>`:

```
<path>
  s_<14hex>::t_<14hex> 2-3,5-13,16-17,20-26,29-37     # AI: session::checkpoint + LINE RANGES
  h_<14hex> 4,14-15                                    # known-human (see §3.2 — often fabricated)
---
{ "schema_version": "authorship/3.0.0", "git_ai_version": "1.6.21",
  "base_commit_sha": "<sha>",
  "prompts": {},
  "sessions": { "s_<hex>": { "agent_id": {"tool":"cursor","id":"<uuid>","model":"<model>"},
                             "human_author": "Name <email>" } },
  "humans":  { "h_<hex>": { "author": "Name <email>" } } }   # ONLY present when an h_ exists
```

**Ranges are discontiguous.** A real range reads `159-162,167` or `2-3,65-90,218-399` — claiming
some lines and leaving others in the same file unclaimed. So granularity is genuinely sub-file
**and sub-hunk**, and a mixed commit can be checked line by line.

Two cautions when reading a note:

- `human_author` inside a `sessions` entry is **not** a human attribution — it is the human the
  *agent* was working for. Human line claims live in `humans` / `h_`, which is a different thing.
- `model: "unknown"` may be a genuine unknown, or it may be the weakest recovery stage
  (`recover_commit_metadata`) inventing a session id to claim leftover lines. Observed in the
  wild here. Do not read it as a confirmed session.

A whole-commit test — "this commit has a note, that one doesn't" — is a weaker check that a
session-bookkeeping collector passes without ever attributing a line.

**A correction worth stating plainly, because the mistake is easy to make and was made here.**
`known-human` (`h_`) is **not** evidence that human work gets human notes. It is mostly the
**recovery ladder's terminal stage** — see §3.2. Do not build a discriminator on its presence.

**Known gap**: the corpus has never tested a genuinely human-or-script commit with no agent
anywhere in the session. Every "outside the agent" commit in the record was made by another AI in
a terminal. **We have never observed what git-ai does with genuinely human-authored lines.**
Record what you observe; do not score it against an assumption.

### 3.1.1 The prediction for the mixed commit — falsifiable, stated in advance

The blanket-human stage fires on this predicate — **VERIFIED-AT-SOURCE**,
`attribution_recovery.rs:661`:

```rust
fn should_recover_remaining_as_known_human(authorship_log: &AuthorshipLog) -> bool {
    for entry in ... {
        if entry.hash.starts_with("h_") { return true; }
        has_ai_attribution |= is_ai_attestation(&entry.hash);
    }
    !has_ai_attribution
}
```

It fires when the commit has **no AI attestation at all**, or when it **already contains an `h_`**.

**So for §2 step 4, predict this and hold the run to it:** in a mixed commit where the AI lines
*are* attributed, `has_ai_attribution` is true and no `h_` exists, so blanket recovery returns
**false** — the human lines should be **ABSENT from the note entirely**, *not* attested `h_`.

**Absent and `h_`-attested are different results and only one is correct.** If the human lines
come back `h_`, something else added it, and that is a finding.

Corroboration: **none of this repo's 186 notes contains a single `h_`** — consistent with a
history where every commit carried AI attestation, so the terminal stage never fired.

> ⚠️ **FALSIFIED BY MEASUREMENT, 2026-08-09.** The prediction above was run twice in live
> Cursor (`~/temp/gitai-mixed-20260809`, commits `df4d45c` and `b3a18af`) and the human lines
> came back **neither absent nor `h_`** — they were **absorbed into the agent session as
> `s_`**, via commit-time recovery (edge extension plus a larger recovery claim; two of the
> note's three trace ids exist in no checkpoint log). The edit mechanism was irrelevant —
> shell heredoc and python file IO behaved identically. The reasoning above was sound about
> the *blanket-`h_`* stage (it did not fire) and blind to the *recovery* stages that claim
> unattributed lines **for the AI**.
>
> **A runner of this scenario should now EXPECT absorption** in the same-file mixed commit and
> verify against it, not rediscover it. Full mechanism, scorecard, and the two still-untested
> cases (cross-file mixed; the `known_human` lever): `gitai-06-two-channel-model.md` §7a.
> Verification move that generalises: a trace id in the note that is absent from
> `.git/ai/working_logs/old-<parent>/checkpoints.jsonl` was minted by recovery, not observed.

### 3.1.2 Edge extension — why the human block must be 12+ lines

An earlier stage, `recover_adjacent_edges` (`attribution_recovery.rs:1170`), extends AI
attestation into unattributed lines. Its mechanics decide how you must **build** the mixed commit,
and the obvious design — "pad the gap between human and AI lines" — does not work.

**How it actually works** — **VERIFIED-AT-SOURCE**, `edge_recovery_for_run`,
`attribution_recovery.rs:1642`:

It takes a **run of contiguous unattributed lines** (`unknown_lines_by_file` → `contiguous_runs`,
`:1560`/`:1615`) and inspects only that run's **immediate neighbours** — `prev = line(first-1)`,
`next = line(last+1)`:

| neighbours | claimed |
|---|---|
| `prev` is AI, `next` is not | **first 3** lines of the run |
| `next` is AI, `prev` is not | **last 3** lines of the run |
| both AI **and the same session** | 3 from each end — up to **6** (deduped, so a short run is wholly claimed) |
| both AI but **different sessions** | **nothing** — no arm matches, no edge recovery at all |

`EDGE_EXTENSION_MAX_LINES = 3` (`:22`).

**Why padding does not help.** Blank or filler lines between the human and AI blocks are
themselves unattributed, so they join the **same run**. The run still abuts an AI line and the
first 3 are still taken. **Separation is not the lever — run length is.**

**A run longer than 6 always has an unclaimed middle.** So:

> **Make the human block 12+ lines.** Up to 6 lines get claimed by edge extension (3 at each end),
> and the middle survives with a clear margin.

**Treat this as a better test, not a workaround.** A 12+ line human block lets one commit observe
**both** behaviours at once: the edge extension firing on the first and last 3 lines, *and* the
middle surviving unclaimed. Designing the heuristic out would have measured neither.

**Optional second case, now that the mechanism is known**: sandwich a human block between **two
different agents'** lines. Per the table above that should produce **no** edge recovery at all —
another sharp, cheap prediction.

**The asymmetry is real and permissive** (`is_ai_attestation`, `:1697`):

```rust
fn is_ai_attestation(author: &str) -> bool {
    author != CheckpointKind::Human.to_str() && !author.starts_with("h_")
}
```

Anything not explicitly human counts as AI. So AI attestation extends into unknown lines and human
attestation never does — systematic AI over-report, by construction.

### 3.2 The stakes — the danger is a wrong answer, not a missing one

The failure this whole sandbox question exists to prevent is **not** "no note". A missing note is
visibly missing; someone notices, and `attribution-at-risk` lists it.

The real failure is a **fabricated human claim**. When a commit reaches git-ai with no AI
attestation, the recovery ladder's terminal stage mints `h_<hash(committer)>` for *all* remaining
unknown lines — a confident wrong number that no filesystem-level signal can see. Nothing looks
broken. The repo reports human authorship of AI-written code.

**And this is wider than the sandbox.** The trigger is *"no AI attestation on this commit"*, not
*"a sandbox blocked something"* — that much is **VERIFIED-AT-SOURCE** from the predicate above. It
therefore fires for:

- a sandboxed commit whose trace2 never reached the collector
- a **daemon restart** mid-session — the original F-03 reproduction *(INHERITED)*
- an unhooked or unrecognised agent session
- an ordinary human commit in a repo with no IDE extension

A verified **unsandboxed** commit in the field corpus also received an `h_` *(INHERITED — from the
audit, not re-confirmed here)*. So do not frame this as a sandbox problem: **any commit with no AI
attestation gets a fabricated human claim.** That is both more ordinary and more serious than the
sandbox framing suggests.

It also contradicts the published standard, which defines `h_` as lines *"explicitly observed
being typed by a human in an IDE with the git-ai extension installed… distinct from 'untracked'"*
*(INHERITED)*. Absent that extension, "untracked" is silently promoted to "observed human".

**So the blocked-case falsifier is explicit, and it is the most important check in this document:**

> After a run with the ingress deliberately blocked: **do the agent's lines come back as `h_`?**

If yes, that is the failure mode as it occurs in the field. Run it, and report the answer either
way — including which of the triggers above your run actually exercised.

## 4. What the field runs established about why capture fails

Seven prompt iterations and seven run reports exist. Do not re-derive them. The short version of
what they cost:

1. **It is not the socket being unreachable.** A probe connected from inside a sandbox with
   `CURSOR_SANDBOX=seatbelt` set. Every theory resting on a blocked connect died there.
2. **It is not the environment.** An unfiltered dump showed only `GIT_HTTP_PROXY` /
   `GIT_HTTPS_PROXY` — no `GIT_TRACE2_EVENT`, no `GIT_CONFIG_GLOBAL`, no `GIT_CONFIG_NOSYSTEM`.
3. **It is not the git config.** `trace2.eventTarget` resolved correctly from `~/.gitconfig`,
   proven with `--show-origin --show-scope`.
4. **It is not hooks.** `.git/hooks/` was empty in the repo where the failure reproduced.
5. **It is whether the invoking command ran inside the sandbox at all.** Two commits, same
   session, minutes apart: a standalone `git commit -m "…"` was attributed; a chained
   `git add … && git commit -m "$(cat <<'EOF' …)"` produced no daemon event whatsoever.

Mechanism, as far as it is understood: a command that does not match the allowlist runs inside the
sandbox; a sandboxed `git` fails its `connect()` to the unix socket and then **silently disables
trace2 for the whole process**. Delivery is all-or-nothing — not a partial write, not a rejected
event, no error.

**Operational consequence, and the reason this belongs in harness rather than in IDE config:**
the standard remedy — "allowlist `git`" — does not survive normal agent behaviour, because agents
write chained commands by default. A user can configure everything correctly and still lose all
attribution with no warning.

### 4.1 The open question — do not write as if this is settled

Run 6 isolated command shape with four commits differing only in form, and the environment
reported the standalone one as outside the sandbox and the three compound ones as sandboxed —
confirming the model above.

**Run 7 then contradicted it.** Three deliberately compound commands were reported as running
**outside** the sandbox, with no commands rewritten. That run was never adjudicated, and the
corpus ends there.

So the honest status is: **named, then destabilised, never closed.** The sandboxing decision is
not reliably reproducible from command shape alone. A run that reproduces the split is a
**finding**, not a failed test. Any document or tool that presents "compound commands get
sandboxed" as a rule is overstating the evidence.

This is why the procedure below does not depend on that heuristic — see §5.

## 5. Getting a sandboxed command — and never assuming you got one

The best available lever is a wrapper whose **first word does not match the allowlist**:

```sh
sh -c 'git add lib.mjs && git commit -m "plain git, sandboxed"'
```

`sh` is not allowlisted, so this *should* run inside the sandbox, and in the field run it did. The
agent must be told explicitly not to "fix" it by unwrapping. Correspondingly, an unwrapped command
is the unsandboxed path — a bare `harness --version` was confirmed exempted by the allowlist.

**But do not call this deterministic, and do not build a verdict on it.** Sandbox placement by
command shape was contradicted by run 7 and again by later validation, was never adjudicated, and
is still asserted causally in shipped prose at high confidence. **Shape-based placement is
unreliable in both directions, and that includes `sh -c`.**

### 5.1 MANDATORY per-run control

**Immediately before any step whose meaning depends on being sandboxed, prove the sandbox is
engaged in that same session:**

```sh
node probe-socket.cjs      # a bare, non-allowlisted probe
# REQUIRED: {"outcome":"denied", ... "code":"EPERM"}
```

If that probe **connects**, the sandbox is not engaged and the step it was gating is **void** —
not a pass, not a finding, void. Re-run it.

This is a control **per run, per gated step** — not a one-time setup check. Assumed sandbox
placement is precisely what run 7 broke, and a stale assumption from earlier in the same session is
not evidence.

**Have the agent label every command sandboxed / not-sandboxed.** That labelling is half the
experiment; without it a null result cannot be told from an unengaged sandbox.

## 6. The demonstrated asymmetry — what a good run looks like

This is the thesis in one run, and it has been observed end to end:

| step | command | observed |
|---|---|---|
| plain git, sandboxed | `sh -c 'git add … && git commit …'` | commit succeeds, **no note** — silently unattributed |
| harness commit, sandboxed | `sh -c '… harness commit "…" lib.mjs'` | `mode: harness-buffered`, `probe: denied`, `verify: skipped`, `buffer: <path>`, and the envelope **names the recovery command** |
| recovery, unsandboxed | `harness doctor telemetry-nudge` | replayed 12,466 bytes, recovered the buffered commit, retained nothing |
| at-risk after | `harness doctor --json` | the buffered commit is gone from the list; **the plain commit is still there** |

The plain path loses the work silently. The harness path loses nothing and tells you how to get it
back. The plain commit is *never* recovered — that is the cost being measured.

## 7. Instrument notes — two traps that will waste a run

### 7.1 `harness doctor` does not report the ingress probe

`harness doctor` performs the ingress probe, but its result is only visible through the
`gitai-collector` row, and that row is a rung ladder that **short-circuits earlier**. When harness
has no record of installing the git-ai binary, the row returns `could-not-determine` from
`collector/health.ts:112`, while the `ingress-blocked` verdict lives at `collector/health.ts:327`
— after it. The probe outcome does not affect the provenance rung, so **a blocked ingress and a
reachable one print the same `could-not-determine`.**

**This is evidenced, not theoretical.** `ingress-blocked` has **never fired in the field**. In the
one live blocked run, doctor returned `could-not-determine` and it was ticked green as "honest".
The mechanism is visible in the code: the `base` object sets `ingress: deps.ingress ?? null`
(`health.ts:211`), but `undetermined()` builds its own return value **without `base` and without
`ingress`** — so on that path the probe reading is dropped from the output entirely. A field run
report says exactly that from the outside: *"The JSON contained no field or layer named
`ingress`."*

**Use `harness commit --json` instead.** It performs its own ingress read and reports
`data.probe`, `data.mode`, `data.buffer` and `data.verify` as first-class fields.

(`harness doctor --install-collector` clears the provenance rung and makes doctor's ingress row
reachable — but it mutates collector state, so do it before the baseline or not at all.)

### 7.2 Stage 3 requires a REAL network remote

**A push to a local bare repo is a filesystem operation, not a network one.** The sandbox governs
network operations (§8), so a local-bare-repo remote sails through a sandbox that would block
every real push — certifying the opposite of the truth.

Stage 3 therefore requires a genuine remote over **https or ssh to a real host**. The local bare
repo is the obvious convenient choice and it is precisely the wrong one.

## 8. Mechanism — what a sandbox does to a unix socket

Measured directly under macOS **seatbelt** (`sandbox-exec`), stated at its proven width:

| condition | profile | outcome |
|---|---|---|
| unsandboxed | *(none)* | connected |
| network denied | `(version 1)(allow default)(deny network*)` | **denied, EPERM** |
| network denied, narrower | `(version 1)(allow default)(deny network-outbound)` | denied, EPERM |
| network allowed | `(version 1)(allow default)` | connected |
| network denied, filesystem write | `(version 1)(allow default)(deny network*)` | **write succeeds** |

So **seatbelt does govern a unix-domain-socket `connect()` as a network operation.** Under the
same deny profile, `statSync` on the socket still succeeds and TCP is also EPERM — the refusal is
network policy, not filesystem policy. A profile can also carve out a single socket by path while
still denying everything else.

**Limits of that result — do not let it travel further than it goes:**

- It does **not** license any claim about the agent's own sandbox profile, which we cannot read.
- `terminalAllowlist` is the agent's own mechanism. It has no seatbelt equivalent and was **not**
  tested. Nothing here supports or refutes "an allowlisted command runs outside the sandbox".
- **Softest claim, carried forward deliberately**: the filesystem-write row ran under
  `(allow default)`, so filesystem access was wide open by construction. It shows the buffer
  survives a **network**-denying sandbox. It does **not** show the buffer survives *any* sandbox —
  a profile that also restricts filesystem writes could break the buffer, and this test would not
  have caught it.

### 8.1 The agent's sandbox is not plain seatbelt

Worth knowing before transferring any seatbelt result to a real agent. Cursor's sandbox helper
runs an **HTTP/SOCKS proxy** with allow/deny lists (`__CURSOR_SANDBOX_ENV_RESTORE` exports
`HTTP_PROXY`/`SOCKS_PROXY` to `127.0.0.1` ports, observed in two separate run reports), plus a
**UNIX socket forwarder**, a decision log, and a strict mode that forces network to deny.

Its `networkPolicy.default` accepts exactly `allow` | `deny` — measured, by feeding the parser a
bogus value and reading the error. Two related traps:

- A **preflight** check accepts a garbage policy value with exit 0. A green preflight is **not**
  evidence a policy took effect.
- If the effective policy has `networkAccess: false`, a perfectly valid `"deny"` is **discarded
  wholesale**. The silent-ignore path is this one, not a typo.

**Hypothesis, explicitly not established**: the socket forwarder is a plausible mechanism for a
unix socket being reachable inside a sandbox where plain seatbelt gives EPERM. Untested. It is a
lead, not an explanation.

## 9. Running it

### 9.0 First step — confirm the note schema version

The schema in §3.1 is measured from real notes, so this is a **version check**, not a blocking
unknown:

```sh
SHA=$(git notes --ref=ai list | head -1 | awk '{print $2}')
git notes --ref=ai show "$SHA"
```

Confirm the JSON tail still reads `"schema_version": "authorship/3.0.0"`. If it has moved, re-read
the format section of §3.1 against the new one before scoring anything — the line-range syntax is
what stage 2 depends on.

### 9.0.1 Record the BASE RATE — before and after

Every run so far has measured **what the code does when blocked, not how often a block occurs**.
Nobody has answered the second question, and it decides how much more of this is worth building.

The instrument already exists and prints an honest number:

```sh
harness doctor --json | python3 -c "import json,sys;[print(l['detail']) for l in json.load(sys.stdin)['data']['layers'] if l['name']=='attribution-at-risk']"
```

Record it **before** the scenario and **again after**. On one repo where this investigation ran it
reported **26 of 41 commits unattributed**.

**Record the WINDOW with the number, or the number is meaningless.** The at-risk row scores only
*commits ahead of `merge-base(HEAD, origin/main)`, capped at 200* — so on a branch that is level
with its remote the window is **empty and "clean" is vacuously true**. Measured here while writing
this: `attribution-at-risk` reported `clean — every commit in this window carries a refs/notes/ai
entry`, while `origin/main..HEAD` contained **0 commits**, against 692 commits and 186 notes in the
repo. A green there said nothing at all.

So capture both:

```sh
git rev-list --count origin/main..HEAD    # the window the number was scored over
git notes --ref=ai list | wc -l           # notes in the repo, for context
```

### 9.1 Preconditions

- Collector daemon up; `git config --global --get trace2.eventTarget` resolves to the socket.
  **`trace2.eventTarget` in repo-local config is ignored** — git reads trace2 settings from system
  and global config only.
- A throwaway repo. `trace2.eventTarget` is global, so a throwaway repo exercises the same
  collector; the harness buffer is cwd-scoped (`<cwd>/.harness/temp/trace2/buffer.jsonl`) so it
  stays clean.
- **Make one ordinary commit in that repo, from a NORMAL shell, before step 1 — and expect it to
  have NO note.** (Added 2026-08-09, from the vendor spec; see
  [the two-channel model](./gitai-06-two-channel-model.md#2-exactness-not-reachability--the-answer-to-the-three-day-old-question).)
  This is not tidiness, it is a precondition the scenario silently depends on. Attribution is
  exact only if the daemon held a **pre-command reflog cursor** for the ref, or the argv carried
  immutable OIDs — and a plain `git commit` carries none
  (`daemon-trace2-ingestion-spec.md:21-35`). In a fresh repo the branch ref does not exist before
  the first commit, so no cursor can exist, the command is **not exact**, and the daemon **fails
  closed**: no note, by specification, with a perfectly healthy socket.

  **So without a seed commit, step 1 produces no note whether or not the sandbox is engaged** —
  and the run would read the collector working as designed as a capture failure, most likely
  blaming the sandbox. The seed commit is what gives the daemon its cursor.

  **The seed's own note goes through TWO states, and BOTH are a PASS** (`MEASURED` 2026-08-09,
  corrected from an earlier draft of this precondition that predicted only the first):

  | when | what `git notes --ref=ai show <seed>` says |
  |---|---|
  | immediately | `error: no note found` — the exactness fail-closed, as described above |
  | ~40 min later | a **blanket `h_…` known-human note** covering the whole commit, naming the commit's real git author |

  **Neither is a capture failure.** Anyone checking immediately sees one thing and anyone
  checking later sees another — both readings were available within the same hour on the same
  commit. A validation run must not record either as a finding, and must not treat "a note
  appeared later" as evidence that something was fixed in between.
- A **real** remote configured for stage 3 (§7.2).
- Record the baseline note count before starting.
- Restart the agent fully after any sandbox-config edit — policy is read at session start.

### 9.2 Clauses to preserve in the agent prompt, near-verbatim

These two came out of the field runs and both exist because a run was lost without them:

> **The tamper clause** — *"do not inspect or try to fix anything about authorship attribution — a
> collector is being observed and touching it invalidates the run."*

> **The no-workaround clause** — if a command is refused or blocked, report the refusal verbatim
> and stop that step. Do not retry it another way, unwrap it, or substitute an equivalent. **The
> refusal is the measurement.** An agent that quietly routes around a block destroys the signal.

Also require, per command: the verbatim output, the exit code, and whether the environment
reported it **sandboxed or outside the sandbox**. And an *"Anything I noticed"* section — in the
field runs that section repeatedly named the real variable before the analyst did, including a
substituted `rg` for `grep` and a dropped `head -20`. A silently rewritten command is exactly how
a diagnostic lies to you.

Withhold the hypothesis from the agent. An agent that knows which outcome is wanted has a reason
to help it along.

### 9.3 What to capture

Per commit: SHA, who made it (agent / script / **both**), sandboxed or not, whether a note exists,
and **what the note says** — tool, model, session, and which line ranges it assigns to whom.

For the **mixed commit** (§2 step 4), record the split explicitly: which lines you know the agent
wrote, which lines you know the script wrote, and which way the note actually assigned each —
including whether the human lines were **absent**, **`h_`-attested**, or **absorbed as `s_`** —
the measured outcome is absorption (§3.1.1's falsification note), so score against that and treat
a *different* result as the finding. Note the **length of the human block** you built and whether
its middle survived while its first/last 3 lines were claimed (§3.1.2), and check each note trace
id against the archived working log — recovery-minted ids are the absorption signature. That row
is the product claim; a summary verdict on it is not usable evidence.

For the **blocked run** (§3.2), record the one answer that matters: **did the agent's lines come
back as `h_`?** — and which trigger the run actually exercised (sandbox, daemon restart, unhooked
session).

For **every gated step**, the §5.1 control result: did the bare probe return EPERM in that same
session, immediately beforehand? A step without its control is void, not a finding.

The **base rate** before and after, each with its window size (§9.0.1).

Then the three stage verdicts, and the notes-ref push result against the real network remote.

## 10. What a run still cannot settle

- **Non-determinism is real.** Run 6 and run 7 disagree about whether identical command shapes get
  sandboxed. If everything comes back attributed, the sandbox may simply not have engaged this
  session — say so plainly; that is a finding about reproducibility, not a pass.
- **A pass is scoped to this machine, this agent version, and this collector version.** The proxy
  and forwarder machinery is version-specific; an update can change the answer without any config
  changing.
- **Correctness is tested only as far as your own line map goes.** Step 4 checks the split against
  the true author of each line *that you recorded in advance*. It does not verify anything about
  lines you did not track, about attribution in commits outside the scenario, or about the model
  and session metadata being accurate rather than merely present.
- **We have never seen genuinely human-authored lines attributed.** Every non-agent commit in the
  corpus was made by another AI in a terminal (§3.1). Until step 2 runs with a real script and a
  real human, the human side of every claim here is an expectation, not an observation.
