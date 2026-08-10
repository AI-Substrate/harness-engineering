# `createdFile: true` does not mean we created it — it means we could not see it

**Found 2026-08-10 during the first from-zero validation run on the Windows fixture.**
Joint: `pij-used-narwhal` (machine), `pij-respectable-clam` (source).
**This is a defect in code we ship**, not in git-ai.

---

## What happened

A bare `harness doctor` on a verified-clean box auto-installed the collector correctly — pinned
binary downloaded, SHA-256 verified, placed, daemon up, both pipes live, trace2 keys written, with
**zero user interaction**. Then it reported:

```
agentHooks {"action":"installed","detail":"agent hooks installed for cursor, github-copilot"}
```

**Cursor was not installed.** Measured three ways: `~/.cursor/hooks.json` was never written (mtime
unchanged from 25 minutes earlier), it contains neither `harness` nor `git-ai`, and **harness's own
`hooks status --json` reports cursor `installed: false`**. Copilot's file *was* written, so the
installer ran and can write.

The same payload also contained an **honest** row — the collector record saying *"no agent config
file was observed to change, so NO agent hook is evidenced by this run."* **One run, one row that
proved itself and one summary line that never had to.**

## The mechanism

`install-strategy-a.ts:432`:

```ts
const existing = fs.exists(path) ? fs.readText(path) : null;
const created  = existing === null;
```

`adapters/fs/node-fs.ts:39` — **`readText` swallows every error to `null`**:

```ts
readText(path) { try { return readFileSync(path, 'utf8') } catch { return null } }
```

**So `created` is true in two different worlds:** the file is **absent**, or the file **exists and
could not be read** — a lock, sharing violation, permissions, `EBUSY`. All of those are live on
Windows with the editor running. **The two are recorded identically.**

### Which world this was — evidenced, not inferred

Harness's **own backup manifest**, written four seconds before the install:

```json
{ "takenAt": "2026-08-10T08:35:49.452Z",
  "entries": [ { "source": "C:/Users/…/.cursor/hooks.json", "existed": true } ] }
```

**Harness read that exact path and recorded `existed: true`.** The file was never modified
afterwards — the live bytes are **hash-identical** to the backup and the mtime is untouched.

**Therefore `exists()` was not false. `readText()` returned null.** The swallowed-error path.

And the condition was present: **16 Cursor processes were running** on that box, which is exactly
the lock/sharing-violation case the swallow hides.

> A further check retired a bigger worry: `exists()` on that machine is **not** lying. Node's
> `existsSync` returns `true` now at the same forward-slashed string, `hooks status` agrees, a disk
> search including `VirtualStore` and `Packages` found no other config, and there is no second
> profile. **Our install-provenance model is not built on a divergent filesystem view.** That
> hypothesis was proposed, tested four ways, and is dead.

## Why it matters more than one missed hooks file

**`uninstall-strategy-a.ts:124` DELETES any path flagged `createdFile: true`:**

```ts
// A file WE created has no original bytes to return to: delete it.
if (deps.createdFiles?.has(path) === true) { deps.fs.deleteFile(path); … }
```

So a file that merely **could not be read at install time** is recorded as ours to destroy.

**It does not currently fire** — `:118` refuses first when the file is not *marked* as ours, and no
entry ever landed, so `marked` is false. **But that safety is incidental, not by design of the
record**: a different guard, checking a different fact, happens to stand in front of it. Land an
entry *and* misrecord `createdFile` together and the delete branch runs on a user's file.

> **A guard that protects by coincidence protects until someone changes the other fact — and
> nobody will know to check, because the guard's own tests still pass.**

## The fix

1. **Distinguish absent from unreadable at `:432`**, and treat unreadable as a **failure**, not as
   a create. A read that could not be made is not evidence of anything.
2. **Carry `change` into the report.** `hooks-verbs.ts:295` pushes every outcome into `installed`
   and drops the `InstallChange` value, so `hooks-verbs.ts:1104` renders an agent where nothing was
   written as *"agent hooks installed for X"*. `InstallChange`'s own docstring
   (`install-strategy-a.ts:200-209`) says it exists so the caller sees this *"instead of collapsing
   into a single installed"* — **the type is correct and its one consumer does not honour it.** A
   doctrine defeated at the consumption site, not at the definition.

## RESOLVED — the write did not land because the file was untouchable in that window

**Composed and fixed by `pij-immediate-newt` (`5ce3dac7`, `2a8702f8`).** This section previously
read *"still unexplained"*; it is superseded rather than deleted, because the shape of what two
agents could not determine from outside is itself part of the record.

The file was **readable at 18:35:49** — the backup captured it byte-identical — and **untouchable
at 18:35:53**. **Both installers refused it in that window**, ours and git-ai's, which is
consistent with what this box shows: neither wrote `hooks.json`, and 16 Cursor processes were
running.

**Two silent legs on our side, now named per-agent failures instead of successes:**

1. `readText` returning null recorded as **created** (this document's finding)
2. **`writeThroughSymlink` returning null ignored at commit** — the leg neither clam nor I could
   see from outside, and the direct answer to *why the write did not land without throwing*:
   it did not throw, it returned a value the caller discarded

`writeText` not swallowing was correct reasoning; the swallow was one layer further out, at the
call site that dropped the result. **The pattern held to the end: the check you trust is the one
nobody has tested.**

Also fixed alongside: a BOM no-op, and the `installed.push` collapse that dropped `InstallChange`
(§ *The fix*, item 2).

**The acceptance bar for the from-zero rerun** is now the honest one: it should either install
cursor's hooks **or say, by name, that it could not** — never claim it.

### The rerun happened, and the bar was met — 2026-08-10 19:16

Same fixture, same digest-pinned protocol, five predictions registered **before** the run. All
five passed:

| prediction | result |
|---|---|
| auto-install fires, binary verified and placed | pinned v1.6.21, daemon up, both pipes live |
| a digest-verified **copy** at `WindowsApps\git-ai.exe` | shim hash **==** real binary **==** pinned manifest; `linkType` empty, so a plain file with **no inode to strand** |
| collector row reads **healthy** | `binary-not-on-path` gone — the heal working, not the rung failing to fire |
| cursor hooks written **cleanly** | mtime moved, **BOM stripped** (`7B 0D 0A`), file parses, one entry per phase, `hooks status` reports `installed: true` |
| **the install record is honest** | **`createdFile: false` for cursor** — it pre-existed and was *read* this time — and `true` for copilot, which harness genuinely created |

**That last row is the fix for this document's finding, measured rather than asserted.** The record
now distinguishes *"we created it"* from *"we could not read it"*, so nothing false is carried
forward to the consumer that would act on it.

`git-ai` also resolves by bare name from a fresh shell — the condition absent all day — via a copy
placed in a directory already on the user PATH, so **no editor restart is required**.

> **Keeping the BOM was what made this a test rather than a formality.** The fixture's
> `hooks.json` retained its `EF BB BF` deliberately; the BOM-strip installer fix was therefore
> exercised against a genuine BOM, and the resulting file parses. A tidy-up that had rewritten
> that file would have left this run proving nothing.

**CLOSED — the `KnownHuman`-on-save leg confirmed, 19:23.** A save in Cursor produced **three
extension-originated `KnownHuman` checkpoints** on the fresh daemon (`4276.log`, 09:23:46–09:24:00Z,
all `status=ok`, 126–316ms) — the first checkpoints that daemon ever received — **with no editor
restart**, because the shim went into a directory already on the user PATH.

**The full chain is now measured end to end on a from-zero install:**

```
bare doctor -> auto-install -> digest-verified shim -> bare-name resolution -> save -> KnownHuman
```

Which closes the defect this plan opened with, at every layer: the checkpoint is recorded, the
recovery gate has a landed `h_` to find, and human-authored lines survive an agent-run commit.

## The pattern this belongs to

Fifth instance in this plan of *a step that completes, reports success, and does not do the thing* —
and the second inside code we ship, after the hook journal that could not record its own parse
failure.

**The sharpest version yet:** the install record is exactly the kind of evidence-bearing artifact
this plan spent a day praising — durable, machine-readable, written at the moment of action — and
here it carries a **false claim forward to a consumer that would act on it**. An artifact is only
as good as the question it actually answers, and this one answers *"could we read the file?"* while
being named for *"did we create it?"*
