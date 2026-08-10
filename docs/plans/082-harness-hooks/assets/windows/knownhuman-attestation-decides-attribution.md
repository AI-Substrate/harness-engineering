# A human line survives only if a KnownHuman attestation exists for it

**Run**: Windows VM, `C:\src\cursor`, 2026-08-10 · **git-ai**: 1.6.21 daemon
**Hook build**: `46b0dd00` + the `index-was-not-clean` removal (`ee64aac9`)
**Agent**: Cursor 3.15.6, `gpt-5.6-terra`

> **This finding originally shipped as "WHO RUNS THE COMMIT DECIDES THE ATTRIBUTION."**
> **That headline was FALSIFIED before shipping** by a macOS counterexample from
> `pij-respectable-clam` (§3). It was true of every run measured on Windows and it was **not the
> mechanism**. The corrected claim is the title above. The practical guidance is unchanged — §5 —
> but it is now framed as *one way to produce an attestation*, not as the rule itself.

---

## 1. The mechanism

git-ai records three checkpoint kinds. Only two are durable claims:

| kind | meaning |
|---|---|
| `AiAgent` (`s_…::t_…`) | a durable agent claim |
| **`KnownHuman` (`h_…`)** | **a durable human attestation** |
| `Human` | **a DIFF BASE, not an attestation** (`post_commit.rs:50`) |

**A human line is attributed to the human only if a `KnownHuman` attestation exists for it.**
Without one, commit-time recovery assigns unwitnessed lines to the only session it knows about —
which, in an agent-run commit, is the agent's.

A plain `Human` checkpoint does **not** save you. Across four Windows runs the archived working
log held a `Human` checkpoint covering the human's file, correctly typed and correctly scoped, and
**in every agent-committed run that trace id appears nowhere in the note.**

## 2. The Windows evidence

Three commits, four minutes apart, one repository:

| commit | who ran the commit | result |
|---|---|---|
| `c3f2118` | **agent** (`git add -A` + `git commit`) | `jordan6.md` — a human-authored file the agent **never opened** — claimed in full for the agent session. No `h_` |
| `2302af8` | **human**, manually in the Cursor UI | **correct `h_c6c79ed115e5e7`** on `jordan7.md` 1–7 and `seed.mjs` 24 |
| `bc52299` | **human**, manually, after the agent had also edited | agent's lines 46–49 correct; the human's line 24 **unclaimed** — not stolen, not attested |

**`2302af8` is the first correct human attribution observed in this investigation.** The
human-attribution machinery exists and works; git-ai is not incapable of identifying human work.

### The measurement that explains the difference

```
checkpoints on this Windows box: 28 total
  Human:      11
  AiAgent:    17
  KnownHuman:  0      <- NEVER, not once
```

**No `KnownHuman` attestation has ever been recorded on this machine.** The ladder never had
anything to fall back to.

## 3. THE macOS COUNTEREXAMPLE — why "who commits" is not the mechanism

Measured by `pij-respectable-clam`, macOS commit `0a7ed68857603ba711c6d5b775e8ec203707b5cf`:

```
seed.mjs
  h_9e71e8b09f7cf2                    18-26    <- the human, typed by hand
  s_1b36c35afd9ad7::t_11364b1a20d774  47-48    <- the Cursor agent
```

**Same file, same commit, both prefixes — and the AGENT ran the commit** (`git add -A`, sweeping
in six paths it did not write). That is the exact configuration the "who commits" headline
predicted must fail, and it did not.

Checkpoint kinds side by side:

| platform | checkpoints | `h_` in the note? |
|---|---|---|
| macOS (agent committed) | `AiAgent` 3 · `Human` 1 · **`KnownHuman` 1** | **YES — correct** |
| Windows (agent committed) | `AiAgent` · `Human` · **`KnownHuman` 0** | no |

**The discriminator is the presence of a `KnownHuman` attestation, not who typed the git
command.** Two routes reach the same outcome:

1. **The human runs the commit** — the commit itself carries human attribution (`2302af8`)
2. **Something records `KnownHuman` while the human types** — the attestation exists regardless of
   who later commits (`0a7ed688`)

## 4. What produces a `KnownHuman` attestation — NARROWED, NOT SOLVED

The obvious hypothesis was git-ai's VS Code extension, active in Cursor on the Mac and absent on
Windows. **Measured, and that is not it:**

```
C:\Users\<user>\.cursor\extensions\git-ai.git-ai-vscode-0.1.21-universal   <- INSTALLED
```

The extension **is installed on Windows**, and it ships `known-human-checkpoint-manager.js` which
references `known_human` three times. **It is present and it never fires here** — 0 of 28
checkpoints.

So the difference is not *extension installed vs not*. It is that **the extension's KnownHuman
path does not fire on Windows**, and why is unknown. That is now the highest-value open question,
and it has a familiar shape: a component installed, believed active, and silently doing nothing —
the same class as the UTF-8 BOM defect that opened this investigation.

`git-ai checkpoint known_human` is the other documented route and was never exercised here.

## 5. Practical guidance — unchanged, and still correct

1. **On Windows, commit your own work yourself from the Cursor UI.** No `KnownHuman` attestation
   is being produced on that platform, so committing it yourself is currently the only reliable
   way for your lines to be attributed to you.
2. **If the agent commits, use explicit pathspecs** — `harness commit "<msg>" -- <paths>` rather
   than `git add -A`. It does **not** fix attribution, but it collapses the blast radius: one
   measured pair went from **9 of 10** claims minted by recovery to **0 of 1**.
3. **Unclaimed is not human.** An absent claim is silence, not attestation.

## 6. What was eliminated by measurement

| candidate | test | result |
|---|---|---|
| our hook not firing | journal every run | fires on every tool call, `strippedBom: true` |
| our relay not reaching the daemon | **killed the daemon** | pipe vanishes from the namespace, connect → `ENOENT`, relay → `failed: absent`. Restart → `CONNECTED` / `emitted`. **The signal is real** |
| our relay staying silent | removed `index-was-not-clean` (`ee64aac9`) | now emits on the same shape — **attribution unchanged in either direction** |
| the Cursor sandbox | ran with it off | **unchanged** |
| edit ordering | agent first, then human | **still absorbed** |
| adjacency | human edited 13+ lines away | **still absorbed** |
| the agent's edit mechanism | agent's own claim is narrow and exact | targeted append, not a region rewrite |
| same-file mixing being the issue | human wrote a **separate new file** | **still claimed in full** |

### The cross-file result kills a documented prediction

The validation kit predicted cross-file mixing would be mostly-OK because *"edge extension is
per-file and cannot reach a file the AI never touched."* **It reached it.** `jordan6.md` was new,
separate, and never opened by the agent, and all seven lines were claimed for the agent session.

**Trace-id accounting** (match only after `::` — a bare `t_[0-9a-f]+` also matches inside
`git_ai_version`):

| commit | commit path | trace ids | minted by recovery |
|---|---|---|---|
| `d35a2c6` | `git add -A` | 10 | **9** |
| `39106e0` | `harness commit -- seed.mjs` | 1 | 0 |
| `d47c86a` | `git add -A` | 7 | 6 |

**Commit scope is the strongest lever we control.**

## 7. The boundary — what is ours

**Ours, and measured working end-to-end on Windows for the first time:** hook fires → UTF-8 BOM
stripped → payload parsed → repo resolved → commit classified → written to a **live** daemon →
note produced. It also fails *honestly* (`failed: absent`) when the daemon is stopped.

**Not ours:** the attribution semantics above are git-ai's commit-time recovery and its
attestation model. Nothing on our side changed any outcome — proven by removing our strongest
guard and measuring no difference in either direction.

## 8. Open

- **Why the extension's `KnownHuman` path never fires on Windows.** Highest value: one component,
  two boxes, different behaviour.
- **`bc52299`'s unclaimed-but-not-stolen shape** was seen once; stability unknown.
- **Whether the daemon ACTS on our six synthetic events.** They reach a live listener; we have not
  shown one produced a note git's own trace2 could not have.
- **`validate-attribution`** cannot load in the guest (`E149`) and its parser drops `unparseable`.
