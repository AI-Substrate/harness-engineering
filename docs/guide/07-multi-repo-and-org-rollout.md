# Multi-Repo & Org Rollout

> **Many repos, one shared core.** For anyone rolling the harness out beyond a single project. ~6 min.

The harness is built for more than one repo. The model is simple, and the honest edges are marked.

## The shipped model
- **One core, installed once.** The CLI is a global npm package. Install it on a machine (or in CI) and it is available in every repo. There is no per-repo core to vendor or maintain.
- **Each repo adopts independently.** Every repo gets its own `.harness/` — its own governance doc, its own extensions, its own records. A repo's behaviour travels with that repo. ([06 · Repo Layouts](06-repo-layouts.md) shows the tree.)
- **Improvements to the core are shared by upgrading it.** When the core gets better, every repo inherits that by running `harness update` — one maintained heart, many local shapes. What is *shared* is the **core**; what is *local* is each repo's extensions.

## Monorepos
A monorepo is just one repo: keep a single `.harness/` at the root. Extensions can wrap commands scoped to individual apps or packages (for example, a `boot` that starts the service you are working on). Start with one root harness and grow extensions as packages need them.

## Org rollout today
1. Make the core available to your engineers (and CI) — `npm install -g @ai-substrate/engineering-harness`.
2. Adopt repo by repo ([04 · Adopting the Harness](04-adopting-the-harness.md)), highest-traffic repos first.
3. Keep everyone converged by upgrading the shared core (`harness update`).

That gets you a consistent, centrally-improved core across the org, with each repo tuned to itself.

## Where next
- The single-repo footprint these build on → [06 · Repo Layouts](06-repo-layouts.md).
- What the harness is, in one read → [`README.md`](../../README.md).

---

<sub>[← Prev: Repo Layouts](06-repo-layouts.md) · [↑ Start Here](README.md) · [Next: Fitting Your Workflow →](08-fitting-your-workflow.md)</sub>
