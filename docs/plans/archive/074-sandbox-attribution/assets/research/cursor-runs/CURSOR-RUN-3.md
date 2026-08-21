# Cursor run — collaborative diagnostic

You are helping diagnose why commits made from inside Cursor's agent sandbox lose their
authorship attribution. **You are a collaborator here, not a test subject** — your observations
matter more than the commit itself, and if you notice something the steps below don't ask about,
write it down.

Paste the block between the rules into Cursor's agent. Re-runnable: it picks a fresh function
name each time and writes a numbered report.

---

You are collaborating on a diagnostic. Another agent (Claude Code, running **outside** Cursor's
sandbox) will read your report and reply in the same file. Be precise, quote raw output verbatim,
and say "unknown" rather than guessing.

**Background you need:** git-ai attributes commits by receiving git's trace2 event stream over a
unix socket. Commits made from inside this sandbox arrive with no attribution, and we are trying
to find out exactly which link in the chain breaks. Unix-socket `connect()` is treated as a
network operation by macOS Seatbelt, so our leading theory is that the socket is unreachable from
your shell — but two config workarounds have already failed to fix it, so the theory may be wrong.

**Step 1 — make a normal change and commit it.**
Add one more small pure function to `calc.mjs` — any simple arithmetic helper whose name isn't
already defined there. Add tests in `calc.test.mjs` including an edge case, run `node --test`,
then `git add` and `git commit` as you normally would. Note the commit SHA.

**Step 2 — commit again, this time buffering trace2 to a file.**
Make one more trivial edit, then commit with the trace2 target redirected:

```
GIT_TRACE2_EVENT="$PWD/.trace2-events.jsonl" git commit -am "diagnostic: buffered trace2"
```

Then report whether the file exists and how big it is: `wc -c .trace2-events.jsonl`

**Step 3 — probe the collector socket from your shell.**

```
node relay.mjs --probe-only
```

**Step 4 — describe your own environment.**

```
env | grep -iE 'sandbox|cursor|^HOME=' | sort
ls -l ~/.git-ai/internal/daemon/trace2.sock
```

**Step 5 — write your report** to `reports/run-<N>.md`, where `<N>` is one higher than the
highest existing file in `reports/` (start at 1 if empty). Use this structure:

```markdown
# Cursor run <N>

## What I did
<commit SHAs, what each contained>

## Step 2 — trace2 buffered to a file
<exact output of wc -c, or "file not created">

## Step 3 — socket probe
<full verbatim output of relay.mjs>

## Step 4 — environment
<verbatim output of both commands>

## Anything I noticed
<approval prompts? commands that failed or were rewritten? anything that surprised you?
 Did any command get run differently than you asked? Say so here — this section is the
 most valuable part of the report.>

## Questions for Claude
<anything you want to know or want tested from outside the sandbox>
```

Do not edit `relay.mjs`. Do not run any git-ai commands. Do not try to fix the attribution
problem — we are diagnosing, not repairing, and a repair attempt invalidates the run.

---

## For the outside agent (Claude Code)

After the run:

```bash
cd ~/temp/gitai-allowlist-test
ls reports/                                     # newest report
wc -c .trace2-events.jsonl 2>/dev/null          # did the buffer fill?
node relay.mjs                                  # drain it
git notes --ref=ai list | wc -l                 # did a note appear?
```

Reply to Cursor by appending a `## Reply from Claude` section to the same report file.

### Design constraint discovered 2026-08-07

`trace2.eventTarget` in **repo-local** git config is ignored — git reads trace2 settings from
system and global config only. The producing side must therefore set **`GIT_TRACE2_EVENT`** in the
agent's environment, or the global config must be changed. This rules out a quiet per-repo opt-in
and is a real constraint on the harness relay design.
