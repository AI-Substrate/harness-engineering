# Original ask — product-documentation-hierarchy

**Captured**: 2026-06-18T00:19:15Z  ·  **By**: /the-flow

Logged verbatim so the original wording always survives.

## Verbatim — turn 1 (the substantive ask)

> read this and this /Users/jordanknight/github/present/presentations/harness/missing-layer-101/missing-layer-101.md. presentations/harness/missing-layer-101/intro-to-harness.md. our documentation sucks. i need a new documentation struture. that starts with quick start, then goes throgh a range of areas. a documentation heirarcy separate to how which is more technical for this repo. docs/product-documentation or something. stuff - [ ] Documentation heirarchy. Quick start, adoption and repo layouts (including multi-repo), harness flow loops. Lots of words around helping enable learning loops, encoding in to deterministic layer etc. Not about taking over your existing workflows (unless you want to).  << these are examples. but we'd need the template "start here", move to quick start etc. each document linking hte next. vieable in github (wont have pages active, doesnt work in  our github, so just the github native ui) and written in markdown. Thoughts, what could the tree look like?

## Verbatim — turn 2 (the flow request)

> need a proper flow. it will unpick in detail the steps for onboarding too e.g. those seeen in /Users/jordanknight/github/present/presentations/harness/installing-the-harness/installing-the-harness.md

## Verbatim — turn 3 (routing)

> we will play along side that other flow

## Resolution notes

- Ordinal **025** (024 `first-class-flow-system` is the highest existing; next free is 025). Slug `product-documentation-hierarchy`.
- Routed as a **new flow**, deliberately separate from the active `023-documentation-updates` (which is onboarding-UX *mechanics* — durable `adopt-flow.json` state, porting coach devices into `eng-harness-flow`, CLI cold-start discoverability, plus a doc sweep). This flow is the **reader-facing product-documentation hierarchy** (information architecture + authored content). User: "we will play along side that other flow."
- Source material referenced: `missing-layer-101.md` (lived-experience deck), `intro-to-harness.md` (canonical first-principles deck), `installing-the-harness.md` (onboarding/adoption deck — the "unpick the onboarding steps" source).
- Constraints carried from the ask: GitHub-native rendering only (no Pages), markdown, "start here" → quick-start template with each document **linking the next**, a hierarchy **separate from `docs/how/`** (which is technical/this-repo), and a non-coercive stance ("not about taking over your existing workflows unless you want to").
