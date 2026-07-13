# Capturing telemetry fixtures

How to capture a **real harness session** into the scrubbed telemetry **fixture
corpus** — so the telemetry adapters are tested against real bytes, not synthetic
guesses (plan 037).

> **Where docs live (for now):** user guides live under `docs/how/`. This guide is
> written standalone so it can be promoted/indexed without moving.

> ⚠️ **These fixtures land in a public repo, permanently in git history.** The
> capture path is built around one non-negotiable gate: a **manual "anything bad"
> review of the promoted `corpusDir/` bytes — the exact bytes git will track —
> before `git add`/commit** (step 5). It is **never skippable**; no automation
> replaces a human reading the bytes.

---

## The model in one minute

A captured session is **scrubbed** (machine paths / identity / secrets stripped)
while **prompts and tool calls stay verbatim** — that verbatim signal is the whole
point of the corpus. Capture runs through one in-repo dogfood extension,
`capture-fixtures` (`.harness/extensions/telemetry-fixtures/` — never ships to the
published CLI), which stages to a **gitignored `scratch/`** first, so nothing
reaches the corpus until a human has reviewed it.

```
capture --dry-run ──▶ scratch/ (gitignored)      promote (re-capture          MANUAL REVIEW
   scrub             ──▶ early review/diff   ──▶  + re-scrub → corpusDir/) ──▶ corpusDir/ bytes ──▶ commit
                                                                                (non-skippable)
```

> **Promotion re-captures — it does not copy the reviewed scratch bytes.** A run
> *without* `--dry-run` re-resolves the live sources and writes **freshly scrubbed**
> bytes to `corpusDir/`. For appendable logs / still-live sessions those bytes can
> differ from what you saw in `scratch/`. That is why the **binding** review (step 5)
> is on the promoted `corpusDir/` files, not on the scratch candidate.

Fixtures land under:

```
harness/cli/test/services/telemetry/fixtures/real/<surface>/<instance>/
  raw.<ext>              # the scrubbed real bytes (verbatim prompts/tools)
  expected-segment.json  # the golden: raw → adapter → serializeSegment (derived)
  invariants.json        # human-reviewed pinned values (derived; not every surface)
  meta.json              # provenance: surface, date, harness id, scrub categories, note
```

---

## Two guards — know what protects what

| Guard | Protects | Where |
|---|---|---|
| **`fixture-scrub` service** | strips machine paths / identity / secrets at capture | `harness/cli/src/services/telemetry/fixture-scrub.ts` |
| **`fixture-privacy-scan` byte-scan** | the SOLE automated guard on the committed `raw.*` bytes — auto-globs every artifact and asserts no `/Users/`, `C:\`, email, api-key, or identity token survives | `harness/cli/test/services/telemetry/fixture-privacy-scan.test.ts` |

The serializer's allowlist protects the *output* golden; the byte-scan protects the
*input* raw fixture. Neither replaces the **manual review** — the scrub can miss an
identity token no regex anticipated (see the git-handle lesson below).

---

## Step 1 — Capture (stages to `scratch/`)

```bash
harness capture-fixtures --surface <surface> [--session <id>] [--instance <id>] \
  [--log <path>] [--names "Person Name,git-handle"] [--note "<provenance>"] [--dry-run]
```

- `--surface` — `claude | copilot-cli | copilot-vscode | cursor`.
- `--session` — **per-surface** (see the table below).
- `--instance` — corpus dir name (default: derived from date + session). Must be a
  **safe slug** (start alphanumeric, then only `[A-Za-z0-9._-]`; no `/`, `\`, or `..`) —
  a path-like value is rejected before any write so capture can't escape `scratch/`.
- `--log` — copilot-cli only: explicit `process-*.log` path (else auto-discovered).
- `--names` — comma-separated person names / handles to scrub beyond paths+identity.
- `--note` — one-line provenance for `meta.json`.
- `--dry-run` — capture + scrub into `scratch/` only; **do not** promote. Use this for
  the first pass so you can review before anything is corpus-bound.

### Per-surface capture

| Surface | `--session` | On-disk source the extension reads |
|---|---|---|
| **claude** | optional (defaults to the sole session for this repo) | `~/.claude/projects/<mangle>/<session>.jsonl` |
| **copilot-cli** | **required** | `events.jsonl` + the filtered `process-*.log` (only this session's `assistant_usage` blocks are kept) |
| **copilot-vscode** | optional override (else resolved by cwd) | the VS Code Copilot SQLite store — projected in SQL to structural columns only (no message text crosses) |
| **cursor** | **required** — the conversation id | the on-disk transcript **and** the `cursorDiskKV` model/timing bubbles (see below) |

### Cursor — the on-disk path

Cursor keeps its agent transcript on disk at:

```
~/.cursor/projects/<mangled-cwd>/agent-transcripts/<conv>/<conv>.jsonl
```

where `<mangled-cwd>` = the repo path with the leading `/` stripped and every `/`
turned into `-` (e.g. `/Users/you/repo` → `Users-you-repo`). The transcript is kept
**verbatim** (prompts + tool names are the corpus payload, scrubbed only for paths /
identity); the `cursorDiskKV` bubbles are **projected** to model + timing only — their
raw form embeds git diffs, console logs, and file contents, so the projection is
mandatory. The model (`composer-2.5`, …) lives **only** in the bubbles; the segment's
model/timing comes from joining them onto the transcript turns. Find a conversation id
with a substantive walkthrough (avoid short stubs and self-redacted sessions).

---

## Step 2 — Scrub (automatic, inside capture)

The pure `fixture-scrub` service runs during capture: machine homes, Windows paths,
the `-Users-<user>-` mangle, emails, api-key shapes, and any `--names` tokens are
replaced; **prompts and tool calls are left verbatim**. You don't run this yourself —
but you must understand it so the manual review knows what *should* already be gone.

> **The git-handle lesson (don't skip `--names`).** The scrub derives the username
> from your HOME basename — but a **git handle** (e.g. `example-handle`) is a *separate*
> identity token that the home path never contains. A real capture leaked it through
> `gh auth status` output and the manual review caught it. **Always pass your git
> handle(s) via `--names`** at capture, and look for them again in review.

---

## Step 3 — Early review in `scratch/` (recommended first pass)

Open the scrubbed files in `scratch/` and read them — this is your cheap early check
to catch leaks and tune `--names` **before** you promote. It is *not* the binding gate
(promotion re-captures — step 5 is the gate), but it's where you'd notice you picked
the wrong session or missed a handle. Use the **leak scan + content sanity** checklist
in step 5 against the scratch bytes here too. If anything is wrong, **don't promote** —
re-capture with a better `--names` set or a different session.

The `scratch/` dir also holds the **unscrubbed originals** (`raw.unscrubbed.*`) beside
the scrubbed candidates, so you can `diff` them to confirm the scrub did its job.

---

## Step 4 — Promote (re-capture into the corpus)

Re-run the same `capture-fixtures` command **without `--dry-run`**. This **re-resolves
the live sources and writes freshly scrubbed bytes** to the corpus dir — it is a fresh
capture, **not** a copy of the scratch candidate:

```
harness/cli/test/services/telemetry/fixtures/real/<surface>/<instance>/
```

The promoted files are **uncommitted** — nothing is public until you `git add`/commit
(and push). The review that protects the public repo is the next step, on these bytes.

---

## Step 5 — Binding "anything bad" review on `corpusDir/` (NON-SKIPPABLE)

Open the **promoted** files (the exact bytes git will track) and read them end-to-end.
This is the mandatory gate — the corpus is public and permanent.

**Leak scan** (search each promoted `raw.*` — there must be **zero** hits):
- `/Users/`, `/home/`, `C:\` (any machine path)
- your username, your **git handle(s)**, your real name
- email addresses
- api-key / token shapes (`sk-…`, `ghp_…`, bearer tokens, etc.)

**Content sanity:**
- user prompts + assistant replies are innocuous — nothing private, nothing that would
  embarrass a person or a customer.
- **not self-referential** — a session that *discusses scrubbing or these very paths*
  will leak the discussed tokens and fail the byte-scan even when scrubbed correctly.
  Pick a different session.
- the vendor system prompt (copilot-cli) is redacted to a placeholder; **user content
  stays verbatim** (that's intended — confirm the redaction is only the vendor prompt).

Only once the promoted bytes are clean, run the guards and commit:

```bash
npm run check:telemetry-fixtures     # the goldens match the adapters (drift guard)
npx vitest run test/services/telemetry/fixture-privacy-scan   # byte-scan is clean (root-safe)
git add harness/cli/test/services/telemetry/fixtures/real/<surface>/<instance>/
git commit -m "test(telemetry): add real <surface> fixture (<instance>)"
```

If anything is wrong: **do not commit.** Delete the promoted `corpusDir/`, re-capture
with a better `--names` set or a different session. If you changed an adapter and the
goldens legitimately moved, regenerate them with `npm run gen:telemetry-fixtures` and
re-review the diff before committing.

---

## Regenerating goldens (not capture)

The committed goldens are **derived** — never hand-edited. To rebuild them from the
current adapters over the already-committed raw fixtures:

```bash
npm run gen:telemetry-fixtures      # rewrite every expected-segment.json + invariants.json
npm run check:telemetry-fixtures    # drift guard — fails non-zero if a golden is stale
```

This drives the two golden suites (`real-capture.e2e.test.ts` +
`copilot-vscode-sqlite.int.test.ts`, which own all four surfaces' raw→segment
construction) — there is no separate copy of that logic to drift. Goldens are
machine-independent by construction (the scrub normalizes every machine token), so the
check is deterministic across machines and in CI.

---

## See also

- `.harness/extensions/telemetry-fixtures/instructions.md` — the `capture-fixtures` verb reference.
- `harness/cli/test/services/telemetry/fixtures/real/README.md` — the corpus layout + guard model.
- `docs/project-rules/rules.md` § 9 — the Deviation Ledger entry that sanctions committing scrubbed session content.
