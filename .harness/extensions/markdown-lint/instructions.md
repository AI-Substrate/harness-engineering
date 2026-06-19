# `harness markdown-lint` — agent briefing

This verb is **deterministic markdown back pressure**: instead of eyeballing docs
(or prompting "keep the markdown tidy and check the diagrams render"), it proves —
yes or no — that the repo's **authored** markdown lints clean, that its in-repo
links and heading anchors resolve, and that its mermaid fences are syntactically
parseable. Run it after any change that touches authored docs. `just fft` runs it
too, so the same answer gates the loop and your local check.

It wraps three third-party tools behind **one honest envelope** (P8 "wrap, don't
rebuild") — the verb only owns the glue (scope, fence extraction, the envelope
decision), each unit-tested under `lib/`.

## What it computes — and the proof boundary

Over the frozen **authored-docs scope** (`lib/scope.ts` — the single source of
truth; it filters `git ls-files '*.md'`), it runs three checks and aggregates:

| Check | Tool | Proves |
|---|---|---|
| markdown lint | markdownlint-cli2 (`.markdownlint-cli2.jsonc`) | style/structure rules hold |
| in-repo links & anchors | remark-validate-links (`.remarkrc.json`) | relative file links + heading anchors resolve on disk |
| mermaid syntax | headless `mermaid.parse()` subprocess (`lib/mermaid-runner.mjs`) | each ` ```mermaid ` fence parses |

**Does not prove**: that mermaid diagrams *render* visually (syntax only — no
Chromium/mmdc); that **external** `http(s)` URLs are reachable (in-repo links
only); anything in the **excluded** dirs (generated/transient: `docs/plans/**`,
`.harness/**`, `agents/**`, `docs/retros/**`, `**/tasks/**`, `**/reviews/**`,
`**/the-flow.md`, `**/*.fltplan.md`); markdown prose *quality*. A disabled lint
rule (see `.markdownlint-cli2.jsonc`) stays silently green by design.

## Outcome states

| Condition | `status` | exit | what to do |
|---|---|---|---|
| 0 findings across all three checks | `ok` | 0 | nothing — authored markdown is clean |
| ≥1 finding (lint / link / mermaid) | `degraded` | 0 | **launch posture** — review `data.checks[]`; visible but non-blocking |
| a tool/config missing | `unconfigured` | 2 | `next_action` says what to install/restore (usually `npm install` at the repo root) |
| unexpected crash | `error` | 1 | backstop — `error.details` + the raw commands to reproduce |

`data` always carries `checks[]` (per-check `outcome`, `findings`, `examined`,
`summary`) and `totals` (`findings`, `filesLinted`, `linksFilesChecked`,
`fencesParsed`) — real evidence counts, never a bare `ok` (P9).

**Launch posture (warn-launch)**: findings land as `degraded`/exit 0 so the verb
is visible but never blocks `just fft` while the authored-doc backlog is worked
down. Promote to blocking later by tightening the gate — never by widening the
ignore set to dodge a finding.

## What to do on a finding

1. Read `data.checks[]`. Each check's `summary` quotes the first finding with its
   `path:line`; `findings` is the count; `examined` is the evidence count.
2. **markdown lint** → fix the doc, or (if it's a genuine repo-wide convention)
   disable the rule in `.markdownlint-cli2.jsonc` **with a one-line rationale**.
   Never add a rule; re-enable a disabled one as the docs are cleaned.
3. **links** → fix the relative path or the `#anchor` (anchors are GitHub-slug
   style). The target is resolved on disk from the linking file's directory.
4. **mermaid** → open `path:line` and fix the diagram syntax; `harness markdown-lint`
   re-validates headless.

## Gotchas

- **Run from the repo root.** Scope (`git ls-files`), the local bins, and the
  configs all resolve against the invocation cwd; remark also shells `git remote -v`,
  so it needs the git work tree.
- **Scope is frozen in code** (`lib/scope.ts`), not in the tool configs — all
  three checks share it so they can't drift (AC-04). Don't add scope to the
  configs; don't widen the ignore set to silence a finding.
- **mermaid needs a DOM shim**: the subprocess sets up `jsdom` before importing
  mermaid — bare `mermaid.parse()` throws `DOMPurify.addHook is not a function`
  on any *labeled* diagram (a label-less `A-->B` spike misleadingly passes). This
  is still headless (jsdom is pure JS, not a browser).
- **Don't trust child exit codes**: markdownlint issues go to **stderr**; the verb
  parses output, not just `.code`. remark `--frail` exits 1 on findings; the verb
  distinguishes a link finding (`remark-validate-links:` label) from a processing
  failure ("Cannot process file").

## Evidence

No durable files are written (P9): counts and per-check detail live in the
envelope `data`. Capture it if you need a record: `harness markdown-lint --json > out.json`.
Scope a run with `--dir <path>` (e.g. `harness markdown-lint --dir docs/how`).
