# Cursor validation kit — run it, don't re-derive it

**What this is:** the exact artifacts from the run of **2026-08-09**, which is the first time
anyone measured git-ai's human-vs-AI split inside a live Cursor session. Setup script, three
paste-ready agent prompts, the human-simulating script, and the verification commands — plus
**what each step actually produced**, so you verify against a recorded result instead of
discovering it again.

The *reasoning* behind the design lives in
[the scenario doc](../validating-telemetry-capture-in-sandboxed-agents.md). The *mechanism*
lives in [the two-channel model](../gitai-06-two-channel-model.md). **This file is the runbook.**

> **Read [`../README.md`](../README.md)'s read-order block first.** Three separate
> investigations re-derived the same facts by poking at the machine before reading the record.

---

## THERE IS NOW A VERB THAT DOES THIS — use it instead of the manual sequence

**`harness validate-attribution`** (plan 082, phase 4) is this runbook, executable. It captures the
baseline, censuses the relays, emits the in-sandbox probe, hands you the prompt, and then scores
the result — so the procedure is a measurement rather than a careful reading.

```bash
# from the harness tree, pointing AT the repo under test
harness validate-attribution --begin --repo /path/to/probe-repo
#   ... paste the prompt it prints into your agent ...
harness validate-attribution --end   --repo /path/to/probe-repo
```

**It runs FROM the harness tree and points AT the repo under test.** That is the opposite of what
most people expect — you are validating a repository, so you assume you stand in it. You do not.
Standing in the target repo gives `E149: no extensions are loadable`.

**Why prefer it over the sequence below.** Three separate runs on 2026-08-09/10 produced results
that *looked* conclusive and were not, and the verb refuses each of them by construction:

| what went wrong | how it looked | what the verb does |
|---|---|---|
| The hook could not parse its own arguments and had never fired | a correct note appeared — from git-ai's own channel | reads our journal; an absent fire is not a pass |
| **Two** relays could send the commit signal | a correct note appeared | censuses relays; refuses to certify with more than one |
| The sandbox precondition was measured once and carried forward | everything else was measured | requires the shell-side probe for **this** run |

The last one is the sharpest: the sandbox was genuinely engaged, the measurement was genuinely
correct — it just belonged to the *previous* run. A verdict resting on a precondition nobody
re-took is the failure this verb exists to make impossible.

**What it still cannot do**, stated so nobody over-reads a PASS: it cannot see a broken runtime,
cannot prove your agent actually invoked the hook, and cannot classify a stranger's script — an
unrecognised hook entry counts as a *possible* commit-signal relay until you declare otherwise with
`--acknowledge <substring>`, and that declaration is recorded in the evidence rather than inferred.

Full operator walkthrough, verdict meanings and limits:
[`../../../../.harness/extensions/validate-attribution/README.md`](../../../../.harness/extensions/validate-attribution/README.md).

**The manual sequence below remains authoritative for *why* each step exists**, and is the fallback
when the verb is unavailable — it lives in `.harness/extensions/`, so a consumer who installed the
harness without this repo's extension tree does not have it.

---

## 0. Preconditions

```bash
git-ai --version                       # the kit was proven against 1.6.21 (daemon) / 1.6.22 (source)
git config --global --get trace2.eventTarget   # must be af_unix:stream:<path> (or a Win32 pipe)
git-ai await                           # daemon reachable and idle
```

**Record your Cursor config before you touch it**, and restore it afterwards:

```bash
mkdir -p /tmp/cursor-config-snapshot && cp ~/.cursor/*.json /tmp/cursor-config-snapshot/
```

The three files that matter and what each controls are in
[`../sandbox-04-config-reference.md`](../sandbox-04-config-reference.md).
`~/Library/Application Support/Cursor/User/settings.json` contains **none** of it — two people
have lost time there.

**The hook logs are a free instrument.** `~/.cursor/hooks.json` pipes tool-use through `tee`, so
you can see whether the hook fired *independently* of whether a note appeared:

```bash
rm -f /tmp/cursor-hook-{pre,post}.jsonl /tmp/cursor-hook-err.log   # baseline before the run
```

Empty `pre/post` afterwards = Cursor never invoked the hook. Populated but no note = the
checkpoint data arrived and the commit event did not. That split is otherwise very hard to get.

---

## 1. Seed the repo

```bash
bash 00-seed-repo.sh          # creates ~/temp/gitai-validation-<date>, one HUMAN seed commit
```

**Expected, and it is a PASS both ways:** the seed commit is **noteless immediately after the
commit** (a fresh branch ref cannot have a pre-command reflog cursor, so the daemon fails closed
— see the two-channel model §2), and **acquires a blanket `h_` known-human note once the daemon
finishes its work**.

> **It is not a timer — it is the daemon's queue.** We first observed the seed note appear
> "~40 minutes later" and wrote that down as an indicative figure. Re-running this kit as a
> self-test showed the note present **immediately after `git-ai await`**, seconds after the
> commit. The earlier 40 minutes was simply how long it took someone to look again. **Run
> `git-ai await` and the state is deterministic** — which is why every check in §3 begins with
> it, and why "a note appeared later" is never evidence that something was fixed in between.

---

## 2. Run the sequence

| step | who | what | file |
|---|---|---|---|
| 1 | **Cursor** | adds `double`/`triple`, commits | [`CURSOR-PROMPT-1.md`](./CURSOR-PROMPT-1.md) |
| 2 | **you** | `git-ai await` then verify (§3) | — |
| 3 | **script** | human-only commit + a 14-line **uncommitted** block | [`01-human-step.sh`](./01-human-step.sh) |
| 4 | **Cursor** | appends `quadruple`, stages the **whole file**, commits | [`CURSOR-PROMPT-2.md`](./CURSOR-PROMPT-2.md) |
| 5 | **script** | `python3 human_edit.py` — 15-line `clamp()`, uncommitted | [`human_edit.py`](./human_edit.py) |
| 6 | **Cursor** | appends `halve`, stages whole file, commits | [`CURSOR-PROMPT-3.md`](./CURSOR-PROMPT-3.md) |

Steps 4 and 6 are the **mixed commits** — the only steps that test the product claim. Steps 5-6
repeat 3-4 with a different edit mechanism (python file IO vs shell heredoc) to rule the
mechanism in or out.

**Write the true line-to-author map down BEFORE reading any note.** Deciding afterwards which
lines "were really the agent's" is how a wrong result gets read as a right one.

**Prompt discipline, already baked into the three prompt files** — do not soften it:

- report the shell command **verbatim, including any `&&` chaining** (this is the F-04 variable)
- report refusals **verbatim rather than working around them** — the refusal *is* the measurement
- do **not** touch git-ai, harness, telemetry, or notes — *"a collector is being observed and
  touching it invalidates the run"*
- report **which line numbers you personally wrote** — the ground truth we score against

---

## 3. Verify

```bash
bash 02-verify.sh             # await, then per-commit note + working-log cross-check
```

Or by hand:

```bash
git-ai await                                  # ALWAYS FIRST — otherwise you race the daemon
git notes --ref=ai list                       # which commits carry notes
git notes --ref=ai show <sha>                 # the note: paths, line ranges, sessions
ls .git/ai/working_logs/                      # archived per parent-sha
python3 -c "import json;[print(json.loads(l).get('kind')) for l in open('.git/ai/working_logs/old-<parent>/checkpoints.jsonl')]"
```

**The diagnostic that generalises:** a trace id present in the **note** but absent from the
**archived working log** was minted by commit-time *recovery*, not observed by any checkpoint.
That is how you tell "the agent claimed it" from "the recovery ladder claimed it for the agent".

**Sync** (needs a real network remote — a local bare repo makes the push a filesystem op and
sails through a sandbox that would block a real one):

```bash
git fetch origin '+refs/notes/ai:refs/notes/_syncprobe'
git notes --ref=_syncprobe show <sha>         # present => that note reached the remote
git update-ref -d refs/notes/_syncprobe
```

---

## 4. What we measured — verify against this

Run of 2026-08-09, live Cursor 3.8.23, `gpt-5.6-terra`, **`~/.cursor/sandbox.json` removed**
(i.e. `networkPolicy` genuinely absent — the default-install state, not a customised machine).

| case | commit | result |
|---|---|---|
| human seed | `5acdaec` | noteless, then blanket `h_ 1-3` — **both a PASS** |
| **AI-only** | `9f2d574` | ✅ `s_…::t_… 4-11` `tool: cursor` — human's 1-3 correctly **not** claimed |
| **human-only** | `09f4ec6` | ✅ blanket `h_ 12-15` on `lib.mjs`, `h_ 4-5` on README |
| **mixed (heredoc)** | `df4d45c` | ❌ human lines **absorbed** into the agent session |
| **mixed (python)** | `b3a18af` | ❌ identical — **the edit mechanism is irrelevant** |

**The rule this establishes:** attribution is trustworthy **at commit granularity**. Separate
commits are correctly attributed in both directions. **A human + AI mixed commit over-counts AI**,
silently.

**Why**, and it is not what we assumed: the **checkpoint layer is correct** — run 3's archived log
holds a `Human` baseline (which *did* capture the human lines) and Cursor's minimal `AiAgent`
diff (`halve()` only). The absorption happens at **commit-time recovery**; two of the note's
three trace ids exist in no checkpoint log. A plain `Human` checkpoint is a **diff base, not an
attestation** (`post_commit.rs:50`); only `s_` and `h_` (KnownHuman) are durable claims, and
recovery is asymmetric toward AI by construction.

**Also measured:** Cursor ran `git add lib.mjs && git commit … && git rev-parse HEAD` — a
**double-chained compound command** — and it was **attributed anyway**, which is the fourth
contradiction of the "compound commands get sandboxed" theory (F-04) and the first with the
verbatim command captured. See the two-channel model §6.

**Control we did NOT run, and you should:** a bare non-allowlisted probe returning `EPERM` in the
same session, immediately before each gated step. Without it, *"the sandbox didn't block it"* and
*"the sandbox wasn't running"* are indistinguishable. We can report that attribution works; we
**cannot** report why.

---

## 5. Still untested — do not report these as new findings

- **Cross-file mixed commit** (human edits file X, agent edits file Y, one commit). Predicted
  mostly-OK: edge extension is per-file and cannot reach a file the AI never touched, so the
  human file should be **absent** from the note. Caveat: one recovery stage keys on file mtime
  inside the agent's shell windows and could claim a whole human file on a timestamp coincidence.
- **The `known_human` lever.** `git-ai checkpoint known_human` (or the IDE extension) is the only
  durable human claim. Bracketing the human edit with it is the candidate fix for the broken row.
  If it produces the first-ever `h_` + `s_` mixed note, the gap is closable; if not, the
  limitation stands and must be disclosed.

---

## 6. Restore

```bash
cp /tmp/cursor-config-snapshot/*.json ~/.cursor/    # and restart Cursor
```

Leaving a machine in a modified state after a run is its own defect. Ask what a restore
overwrites before running it — the snapshot is a point in time, not a merge.
