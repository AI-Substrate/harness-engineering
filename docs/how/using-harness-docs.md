# Using harness docs

How to discover and read the harness's curated documentation straight from the
CLI — **offline**, no network, no `cat`-ing files — with `harness docs`.

> **Where docs live (for now):** user guides live under `docs/how/`. The
> `harness docs` command surfaces a **curated subset** of them, bundled into the
> CLI so they ship with `npx` and read the same on any machine. This guide is
> itself one of those bundled docs.

---

## The model in one minute

The harness bundles a small, **curated** set of human/agent-facing guides. The
CLI is the front door to them, mirroring the dogfood rule the rest of the
harness follows: ask the CLI, don't go spelunking through files.

```bash
harness docs            # list the curated docs (id + title + summary)
harness docs <id>       # print one doc's full markdown to stdout
```

The set is **explicitly curated**, not a blind directory glob — governance and
internal documents (`AGENTS.md`, plan artifacts, `scratch/`) are deliberately
excluded so nothing half-baked or private leaks into the published surface.

---

## List the docs

`harness docs` lists every bundled doc. In a human terminal it prints a table;
piped or with `--json` it emits the structured Envelope.

```bash
$ harness docs
extend-the-harness   Extend the harness   Add a new `harness <verb>` command …
using-harness-docs   Using harness docs   Discover and read the bundled docs …
authoring-verbs      Authoring a harness verb   The extension-author contract …
cli-readme           harness CLI README   Overview of the harness CLI …
```

```bash
$ harness docs --json
{"command":"docs","status":"ok","timestamp":"…","data":{"docs":[
  {"id":"extend-the-harness","title":"Extend the harness","summary":"…","audience":"both"},
  …
]}}
```

Each entry carries an `id` (the argument you pass to read it), a `title`, a
one-line `summary`, and an `audience` (`human` / `agent` / `both`).

---

## Read a doc

`harness docs <id>` prints that document's **full markdown to stdout**, exactly
as authored — ready to pipe into a pager, a file, or an agent's context window.

```bash
harness docs extend-the-harness            # print the guide
harness docs extend-the-harness | less     # page it
harness docs authoring-verbs > verbs.md    # save it
```

Because the body is written straight to stdout (not wrapped in an Envelope),
it composes cleanly with Unix tools and is safe to pipe into a `head`/`less`
that closes the pipe early.

---

## Exit codes

Exit codes are part of the contract:

| Code | Meaning |
|------|---------|
| `0`  | ok — the list was emitted, or the requested doc was printed |
| `1`  | error — no doc is registered under that id (`E160 DOC_NOT_FOUND`) |

```bash
$ harness docs no-such-doc
harness docs: no curated doc with id "no-such-doc"   # → E160, exit 1
  → Run `harness docs` to see the available ids.
```

---

## Offline by design

The docs are **bundled into the CLI build**, not read from your working tree at
runtime. A consumer running `harness docs` (from the registry-installed
`@ai-substrate/engineering-harness`) gets the same content with no repo checkout
and no network — the docs travel with the binary.

Under the hood, a build step inlines each curated `.md` into a generated module
that `tsc` compiles into `dist`. You never edit that generated module; you edit
the source `.md`, and a drift check keeps the two in lock-step.

---

## For tool authors: the `DocsService` seam

`harness docs` is a thin CLI act over a **pure** `DocsService`
(`listDocs()` / `getDoc(id)`) that operates only over the bundled doc data —
no filesystem, no `cwd`, no CLI coupling. That purity is deliberate: a future
**MCP server** for the harness can expose `docs_list` / `docs_get` tools by
importing the *same* `DocsService`, with zero changes to the doc surface. The
CLI and a future MCP server are two front doors onto one curated corpus.
