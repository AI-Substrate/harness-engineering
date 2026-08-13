# RUNBOOK — deploy the hook fix to the Windows VM and prove it

**Staged 2026-08-10 by `pij-used-narwhal`, before the fix exists**, so the moment a diff lands
this is four commands, not an hour of reconstruction.

**Status when written:** coder `pij-fashionable-ostrich` dispatched on
`s077/hook-parse-observable`; working tree had only two modified *test* files and no
`hook-payload.ts` change. **There is no diff to ship yet.**

---

## The trap this runbook is built around

**The package version does not change with the fix.** It is `0.13.0` before and `0.13.0` after,
so `harness --version` proves *nothing* about whether the fixed code is installed. Every step
below verifies by **behaviour**, never by a version string — the same "version identity is not
path identity" discipline `just verify-global-link` already enforces on the Mac.

---

## 0. On the Mac — pack the fixed build

**These are clam's actual commands, not a reconstruction.**

```bash
cd <the coder's worktree>            # s077-parse-observable, once the fix is committed
npm ci --no-audit --no-fund
npm run build                        # NOT `just build` - the npm script is what was used
npm pack --pack-destination /Users/jordanknight/substrate/harness-engineering/scratch/win/
mv scratch/win/ai-substrate-engineering-harness-0.13.0.tgz scratch/win/harness-fix.tgz
```

> **BUILD BEFORE PACK, ALWAYS.** ~~`package.json` ships `harness/cli/dist`, and `npm pack` does
> **not** build.~~ A stale `dist` packs **silently** — you install yesterday's code carrying
> today's version number, and since the version cannot tell you apart (see the trap above), the
> deception is total. This is why step 1 verifies by behaviour.
>
> **CORRECTED 2026-08-13 — THE ADVICE IS RIGHT, THE MECHANISM IS WRONG.** `npm pack` **does**
> build in this repo: `package.json` declares `prepare: npm run build`, npm runs `prepare`
> before `pack`, and `npm pack --dry-run` shows it firing (`> prepare` → `> build` → `tsc`).
> There is no `prepack`/`prepublishOnly`. So a stale `dist` does **not** pack silently via a
> plain `npm pack`.
>
> It still can if the lifecycle is bypassed — `npm pack --ignore-scripts`, or any path that
> skips lifecycle scripts — and the underlying hazard is real and recorded elsewhere: three
> different builds answered `0.13.0` this week, so a tarball's version tells you nothing about
> its contents. **Keep building first; it costs nothing and removes a class of doubt.** Just do
> not carry the reason, because it is false and it propagates: this paragraph is where the
> claim was inherited from on 2026-08-13, repeated verbatim into peer instructions before it
> was checked. (Release is independent either way — `.github/workflows/release.yml` runs
> `npm ci` then `npm run build` explicitly.)

## 1. Install into the guest, and PROVE it is the fixed code

**The registry line is not optional and must come first.** That box has **no route to
`registry.npmjs.org`** — a default npm config **hangs rather than failing fast**, so a missing
registry line looks like a slow install, not a broken one.

```powershell
npm config set registry https://packagefeedproxy.microsoft.io/npm/
Copy-Item '\\Mac\Home\...\scratch\win\harness-fix.tgz' C:\src\harness.tgz -Force
npm install -g C:\src\harness.tgz
```

Then the verification:

```bash
prlctl exec "Windows 11" --current-user powershell -NoProfile -ExecutionPolicy Bypass \
  -File \\\\Mac\\Home\\substrate\\harness-engineering\\scratch\\win\\deploy-fix.ps1
```

`deploy-fix.ps1` does a **before/after functional A/B on the same machine**:

| step | expectation |
|---|---|
| BOM payload → journal, **before** install | `DELTA=0` (broken) |
| install the tgz | npm exit 0 |
| BOM payload → journal, **after** install | `DELTA>=1` (fixed) |
| garbage (no BOM) → journal | `DELTA=1`, an `unparseable` record |

**A `PASS` here proves the fix without involving Cursor at all.** The `INCONCLUSIVE` branch
exists for the case where the before-state already recorded — which would mean the build was
already fixed or the payload is wrong, and either way the run proves nothing.

The garbage case is the guard on clam's reversal: a scan-to-first-brace fix would swallow it
silently, and the whole point of defect (b) is that it must not.

> **Timing:** `npm install -g` took ~1 minute as the user, and `prlctl` round trips are 20–90s.
> **Background it. A quiet minute is not a hang.**

---

## ⚠ DO NOT RUN `harness doctor` ON THAT BOX UNTIL THE ACCEPTANCE TEST IS DONE

`npm install -g` does **not** rewrite `hooks.json` — this package has no postinstall that touches
agent configs. **The danger is what you run afterwards.**

**A bare `harness doctor` auto-installs the collector and can re-run the hook installer**, which
would rewrite the very config the acceptance test is measuring. There would be no error and no
warning — the test would simply be measuring a different configuration than the one you set up.

`doctor` is safe again *after* step 4.

---

## 2. Prepare the end-to-end run

```bash
prlctl exec "Windows 11" --current-user powershell -NoProfile -ExecutionPolicy Bypass \
  -File \\\\Mac\\Home\\substrate\\harness-engineering\\scratch\\win\\accept-prep.ps1
```

Restores `hooks.json` from `.pre-wrap` — **dropping the diagnostic wrapper on purpose.** The fix
makes the journal the instrument, so the wrapper is redundant, and keeping it would test a
configuration we do not ship. Then archives and clears the journal, so **the baseline is empty
and anything present afterwards came from the run.**

## 3. Jordan's part — one read-only Cursor turn

Restart Cursor (config is read at startup), then in `C:\src\cursor`:

> *"Run `git status --short` and report its output verbatim. Change no files, commit nothing."*

Read-only is sufficient: the hook fires on **every tool call**, so no write and no commit is
needed — which also means `C:\src\cursor` keeps its continuity with every prior run and its
recorded-head state is perturbed no further.

## 4. Read the result

```bash
prlctl exec "Windows 11" --current-user powershell -NoProfile -ExecutionPolicy Bypass \
  -File \\\\Mac\\Home\\substrate\\harness-engineering\\scratch\\win\\accept-verify.ps1
```

**PASS = `fires.jsonl` exists and has grown.** That single fact is the thing three sessions and
~58 hook invocations could not establish.

> **PASS is that one fact and nothing more — deliberately.** Whether a `strippedBom` field
> appears is recorded as a **separate observation**, not a gate. Its name has been approved but
> not yet seen implemented, and a run that *proved the journal works* must not be failed by the
> absence of a field. Record it as evidence; do not let it fail the run.

## 5. Second turn — the attribution question (this thread's, not F009's)

F009's contract ends at *"the hook records what happened"*. Whether a commit produces a **correct
note** is the attribution question — this thread's, and it still has an open finding: **6 of 8
trace ids in the earlier run were minted by commit-time recovery, not observed by any
checkpoint.**

So after the read-only turn passes, run a second turn that writes a file and commits:

```bash
git-ai await          # ALWAYS FIRST - otherwise you race the daemon and "no note" reads as loss
git notes --ref=ai show <sha>
```

**Score it against the recorded run so the comparison is like-for-like** — same repo, same
prompt shape, so the only variable is the fix.

---

## What PASS does NOT prove — state this when reporting

- **It does not prove attribution is correct.** A journal entry proves *our hook ran and
  recorded*. Whether the resulting note claims the right lines is a separate exercise that
  belongs to the validation kit.
- **A FAIL with an absent journal is ambiguous**: "hook ran and recorded nothing" and "Cursor
  never invoked it" are different failures and the journal cannot separate them. Re-instrument
  with the wrapper to tell them apart.

## Open questions for clam before step 0 — ANSWERED 2026-08-10

1. ~~Exact pack/install commands~~ — **answered, and step 0 now carries clam's actual commands.**
2. ~~Install-time traps~~ — **answered**: `--current-user` mandatory; **registry line first or it
   hangs**; build before pack or you ship a stale `dist`; version cannot verify the build.
3. ~~Does `npm install -g` rewrite `hooks.json`?~~ — **No.** No postinstall touches agent configs.
   **But `harness doctor` does** — see the warning above. Verify rather than assume: check
   `hooks.json` mtime after installing.

## Machine state this runbook assumes

- `C:\src\p-bom.json` and `p-clean.json` exist (staged by `bom-test.ps1`). If the VM is reset,
  run `bom-test.ps1` first.
- **The box currently routes our hook entries through clam's diagnostic wrapper
  (`C:\src\hookwrap.ps1`). `hooks.json.pre-wrap` IS THE WAY BACK.** If anything goes sideways
  mid-deploy, restoring that file returns the machine to the shipped configuration. Step 2 refuses
  to guess without it.
- `C:\src\cursor` is unperturbed by any hand fire; all diagnostic fires went to
  `C:\src\parseprobe`.
