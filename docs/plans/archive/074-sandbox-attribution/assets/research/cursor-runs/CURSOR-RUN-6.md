# Cursor run 6 — isolate command shape

Run 5 identified the variable: **standalone `git commit` is attributed, chained `git commit` is
not**. This run isolates that and nothing else. Four empty commits, identical in every way except
the shape of the command line.

Read `reports/run-5.md` including the `## Reply from Claude` at the bottom first.

Paste the block between the rules.

---

Read `reports/run-5.md` first, including the `## Reply from Claude` section.

We believe Cursor's `terminalAllowlist` matches **simple commands only**, so a compound command
(`&&` chains, command substitution, heredocs) cannot be verified as a whole and falls back to the
sandbox — where git's connection to the collector socket is denied and trace2 silently disables
itself.

This run tests exactly that. Run these **four commands, each as its own separate terminal
invocation**, in this order. Do not merge them, do not add `&&`, do not wrap any of them in a
subshell or a loop, and do not add a `git status` afterwards — the shape of each command line **is**
the experiment.

**A — standalone (expected: attributed)**

```
git commit --allow-empty -m "run6-A standalone"
```

**B — trailing chain (expected: not attributed)**

```
git commit --allow-empty -m "run6-B trailing" && echo done
```

**C — leading other command (expected: not attributed)**

```
echo starting && git commit --allow-empty -m "run6-C leading"
```

**D — command substitution in the message (expected: not attributed)**

```
git commit --allow-empty -m "run6-D $(echo substituted)"
```

Then collect the four SHAs:

```
git log --oneline -4
```

**Write your report** to `reports/run-6.md` with: the four SHAs mapped to A/B/C/D, the verbatim
output of each command, and an **Anything I noticed** section. In particular:

- Did any of the four prompt for approval, or show a sandbox-related message, when the others
  did not? That asymmetry is the most valuable thing you can observe.
- Were any of the commands rewritten, merged, or reshaped before execution? If a command did not
  run exactly as written, say so — that would invalidate the comparison and we need to know.

Do not edit `relay.mjs`. Do not run git-ai commands. Do not try to fix anything.

---

## What we expect

| | shape | prediction |
|---|---|---|
| A | `git …` | attributed |
| B | `git … && echo` | not attributed |
| C | `echo && git …` | not attributed |
| D | `git … "$(…)"` | not attributed |

**A ✅ with B/C/D ❌** confirms the diagnosis and closes the investigation.

**All four ✅** means the allowlist handles compound commands fine and something about run 5's
specific commands (the heredoc, or `git add` preceding) is the real trigger.

**All four ❌** means empty commits behave differently again and the variable is still not isolated.

---

## Step E — the harness-extension simulation

After A–D, run this **one command** and quote its full output:

```
node commit.mjs "run6-E via single entrypoint"
```

This stands in for a proposed `harness commit` verb. `node` is already in the allowlist, so if the
"simple commands only" theory is right, this whole operation — stage, commit, verify — runs
unsandboxed as one allowlisted invocation, and the commit should be attributed **even though it
does internally exactly what the failing chained commands did**.

Report its verbatim output, especially the final `verify :` line, and the SHA it prints.
