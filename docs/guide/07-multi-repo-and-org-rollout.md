# Multi-Repo Products

> **One product, several repos — where does the harness live?** For anyone whose product is not a single repo. ~6 min.

Plenty of products span more than one repo: a frontend and a backend, a service and its client SDK, a handful of microservices. The harness works across all of them — the only real decision is *where the harness lives*. There are two main shapes, plus the monorepo special case.

Two things are true in **every** shape first:

- **The CLI is one global install.** `npm install -g @ai-substrate/engineering-harness`, once per developer machine (and in CI). It is never vendored into a repo, so "multi-repo" never means "multiple copies of the core." `harness update` keeps everyone on the same version.
- **Skills install per machine, not per repo.** Each developer installs the skills once (`npx skills@latest add … -g`, or project-local if they prefer). Skills are the choreography agents drive; they are not committed into your product repos.

So the only question is where the `.harness/` substrate — governance doc, extensions, records — lives.

## Option A — a harness in each repo

Give every repo its own `.harness/`. Each repo adopts independently ([04 · Adopting the Harness](04-adopting-the-harness.md)), proves itself, and carries its own boot, extensions, and records. Behaviour travels *with* the repo. ([06 · Repo Layouts](06-repo-layouts.md) shows the per-repo tree.)

Best when the repos are fairly independent — separately built, deployed, and owned. A developer working in one repo gets exactly that repo's harness and nothing else to think about. The trade-off: a cross-repo workflow (boot the backend *and* the frontend together) has no single home — each repo only knows itself.

## Option B — a dedicated harness repo

Create a new repo — say `your-product-harness` — install the `.harness/` substrate *there*, and have it reach out to the product repos. That repo becomes the single operating front door for the whole product; you treat it a bit like a monorepo over your other repos.

Two ways to bring the other repos into reach:

- **git submodules** — add each product repo as a submodule, so they check out *inside* the harness repo at known paths. Extensions can then boot, build, and test across them from one place. Submodules pin a commit, which is either welcome (reproducible) or a chore (you bump them) depending on your taste.
- **plain references** — don't vendor them at all; have your extensions reference the other repos by path (cloned alongside, or wherever your team keeps them). Lighter, but you own keeping the paths valid.

If a developer needs to *see and edit* all that code at once, a **multi-root workspace** (VS Code, Cursor, and similar) lets you open many repo paths in one window — the harness repo plus each product repo — so the front door and the code it operates are all in view.

Best when the repos are tightly coordinated as one product and you want a single place to boot, prove, and improve the whole thing.

## Monorepos

A monorepo is the easy case: it is just one repo, so keep a single `.harness/` at the root. Extensions can wrap commands scoped to individual apps or packages (for example, a `boot` that starts only the service you are working on). Start with one root harness and grow extensions as packages need them.

## Which should I pick?

| Your situation | Shape |
|---|---|
| Repos are independent — separately built, deployed, owned | **Option A** — a harness in each repo |
| Repos are one product, tightly coordinated, want one front door | **Option B** — a dedicated harness repo |
| It is already one repo | **Monorepo** — a single `.harness/` at the root |

You can also start with Option A and graduate to Option B later — the per-repo harnesses are not wasted; a product harness can call into them.

The same "one core, many repos" model scales up to a whole org, too: install the core once per machine, adopt the highest-traffic repos first, and keep everyone converged with `harness update`.

## Where next
- The single-repo footprint these build on → [06 · Repo Layouts](06-repo-layouts.md).
- What the harness is, in one read → [`README.md`](../../README.md).

---

<sub>[← Prev: Repo Layouts](06-repo-layouts.md) · [↑ Start Here](README.md) · [Next: Fitting Your Workflow →](08-fitting-your-workflow.md)</sub>
