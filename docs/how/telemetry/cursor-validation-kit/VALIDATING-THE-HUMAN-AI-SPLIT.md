# Validating the human/AI split in Cursor — the A → human → B → validate method

**What this measures:** whether a commit containing BOTH human-typed and agent-written lines
attributes each to the right author in `refs/notes/ai`.

**Why it needs its own method:** the obvious run — human edits, agent edits, agent commits — is
the one that fails, and it fails *quietly*. You get a note, it looks plausible, and human lines
are inside the agent's ranges. You cannot see it without comparing the note against a ground
truth written down **before** the note is read.

This is the runbook for that comparison. It is agent-neutral in principle; the paths and prompts
below are Cursor's.

---

## The method in one line

```
A. agent edits, then STOPS  →  human edits  →  B. agent commits everything  →  score
```

The stop is the point. It closes the agent's checkpoint window before the human touches the file,
so the two contributions are separable in principle. If they still come out merged, that is a
real finding rather than an artifact of the agent and human writing in one interleaved burst.

## 0. Preconditions

```bash
harness doctor                    # gitai-collector row must not say hooks-incomplete
git-ai await                      # daemon reachable and idle
harness hooks status --json       # your agent: binaryState "resolves", commandState "accepted"
```

**Know which binary your hooks point at, and write it down.** `harness hooks status --json`
reports `configuredBinary`. If it points into a worktree somebody is actively building in, your
run is not attributable to a version — rebuild it under you and the parser changes silently. Pin
a checkout, install from there, record the path in your notes.

**Restart the agent after any config change.** A config file is not the running configuration.

## 1. Arm

```bash
# FROM the harness tree, pointing AT the repo under test — not the other way round
harness validate-attribution --begin --repo /path/to/probe-repo
```

It refuses if more than one hook entry could send a commit signal. If one of them is yours and
harmless, declare it: `--acknowledge <substring>`. The declaration is recorded in the evidence.

Keep the printed baseline: journal cursor, HEAD, and the **binary stamp** — `--end` re-checks it,
so a rebuild mid-run invalidates the run rather than silently changing it.

## 2. Part A — the agent edits and STOPS

Paste a prompt that does exactly this, and no more:

- run the in-shell sandbox probe and paste its output
- **append ONE identifiable line** to a file
- **STOP. Commit nothing. Stage nothing.** Report the line number and stop.
- report **which edit mechanism it used** — targeted append or whole-file rewrite — and whether
  it rewrote any line it did not author

That last question matters: if the agent's tool rewrites a region, its checkpoint legitimately
covers lines it did not write, and the attribution would be *correct about what it observed*.
Ask it directly rather than inferring it afterwards.

**Put these instructions FIRST.** An instruction placed after a numbered procedure reads as
background — measured twice: an agent honestly reported *"existing unrelated changes remain
uncommitted"* and left the human's work alone, and both runs passed on the easy case.

## 3. The human edits

Type into the file **yourself, in the editor**. Two rules:

- edit **away from** the agent's line — different region, not the next line down
- **write down what you typed, by line number, before anything else happens**

Self-describing content (`humanOne`, `humanTwo`…) is convenient and is **evidence, not
adjudication**. A human must still confirm it, or you are treating your own construction as the
measurement.

## 4. Part B — the agent commits everything

Same chat, so it stays one agent session. The prompt must say, unmissably:

- commit **everything outstanding**, including files and lines it did not write
- do not reformat, tidy or "fix" anything it did not author
- afterwards `git status --short` must be **empty**
- declare in `.harness-attribution-truth.json` **only the lines it personally wrote**

Two commit shapes are worth running separately, because they differ enormously:

| shape | measured effect |
|---|---|
| `git add -A` | hands the recovery ladder every unwitnessed file in the tree; **9 of 10 trace ids minted** in one run, including files written on another machine |
| `harness commit "<msg>" <explicit paths>` | **0 of 1 minted** in the comparable run — same defect class, far smaller blast radius |

Explicit pathspecs do **not** fix the split. They contain what the ladder can reach.

## 5. Score

```bash
harness validate-attribution --end --repo /path/to/probe-repo
git-ai await                              # ALWAYS before reading notes
git notes --ref=ai show <sha>             # read it yourself as well
```

**`validate-attribution` PASS is one-directional.** It verifies the note **covers** the agent's
declared lines. It does **not** verify the note claims **nothing beyond** them — a one-line and a
three-line over-claim both returned PASS. **Read the note and compare in both directions.**

Then the diagnostic that separates observed from invented:

```bash
ls .git/ai/working_logs/                                   # archived per parent sha
# for each trace id in the note, is it in the archived checkpoint log?
```

**Match trace ids only after `::`.** A bare `t_[0-9a-f]+` also matches inside `git_ai_version`,
producing a phantom id that appears in both note and log and scores as *observed*.

And read the **checkpoint kinds** in that log — this is the reading that explains results nothing
else does:

| kind | meaning |
|---|---|
| `AiAgent` | the agent's observed work |
| `Human` | a **diff base, not an attestation** — it can be present, correct, and contribute nothing to the note |
| `KnownHuman` | a **durable human claim**; this is what produces an `h_` range |

## 6. Reading the outcome

| what you see | what it means |
|---|---|
| `h_` ranges for the human, `s_` for the agent, both in one note | the split worked — record the checkpoint kinds that produced it |
| agent claims lines the human typed, **no `h_` anywhere** | no durable human attestation existed; the ladder assigned unwitnessed lines to the only session it knew |
| human lines **unclaimed** — not `h_`, not agent | a third shape: not stolen, not attested. **Unclaimed is not human.** |
| note claims a file the agent never opened | commit scope reached it; re-run with explicit pathspecs and compare |

## 7. What is established, and what is not

**Established across macOS and Windows:**

- a plain `Human` checkpoint is a diff base, not an attestation — observed correctly, contributed
  nothing, three times on two platforms
- commit **scope** is the only variable that moved the minted-vs-observed ratio
- `h_` and `s_` **can** coexist in one note (macOS, agent-run commit) — so agent-present does not
  by itself preclude human attribution
- the recovery ladder reaches **across files**, including files the agent never opened

**Not established — do not report these as settled:**

- **the mechanism.** Windows measured *who runs the commit* as decisive; macOS produced correct
  human attribution on an agent-run commit where a `KnownHuman` checkpoint existed. The unifying
  candidate is *whether a `KnownHuman` attestation exists for those lines*, with committing it
  yourself being one route to one. **Unverified.**
- whether git-ai's IDE extension is the source of `KnownHuman` on macOS — one probe, not yet run
- whether the daemon acts on the six synthetic relay events, as opposed to merely accepting them

## 8. Practical guidance while the mechanism is open

- **Commit your own work yourself**, from the editor, rather than asking the agent to sweep it in.
- If the agent commits, have it use **explicit pathspecs** — smaller blast radius, not a fix.
- Treat **unclaimed as unclaimed**. It is not evidence of human authorship.
- Attribution remains trustworthy at **commit granularity**: separate commits attribute correctly
  in both directions.
