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

## Still unexplained — stated plainly

**Why cursor's write did not land.** `writeText` does **not** swallow (`node-fs.ts:265` is a bare
`writeFileSync`, it throws), and a throw would have produced a `PartialInstallError` and **no
record** — but a record exists. So the write did not fail, did not throw, and did not land.

**No mechanism is offered for that.** It needs instrumentation inside the process. Two agents
stopped here rather than invent a third explanation, which is the correct outcome and is recorded
as such.

## The pattern this belongs to

Fifth instance in this plan of *a step that completes, reports success, and does not do the thing* —
and the second inside code we ship, after the hook journal that could not record its own parse
failure.

**The sharpest version yet:** the install record is exactly the kind of evidence-bearing artifact
this plan spent a day praising — durable, machine-readable, written at the moment of action — and
here it carries a **false claim forward to a consumer that would act on it**. An artifact is only
as good as the question it actually answers, and this one answers *"could we read the file?"* while
being named for *"did we create it?"*
