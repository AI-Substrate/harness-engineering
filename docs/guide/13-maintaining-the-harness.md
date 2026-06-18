# Maintaining the Harness

> **Keep the core and skills current.** For whoever owns the harness in a repo. ~5 min.

The harness is a living product. Two things drift over time — the **core** CLI and the **skills** — and both have a one-command refresh.

## Update the core
```bash
harness update            # update the global CLI from the registry
```
The core is shared and centrally maintained, so updating it is how your repo inherits everyone's improvements ([07 · Multi-Repo & Org Rollout](07-multi-repo-and-org-rollout.md)). Run it periodically, or when you hear a new version landed.

## Update the skills
```bash
harness skills update --target claude-code
```
Skills evolve alongside the core. `harness skills update` reconciles the installed skills in your agent with the current set. After updating, reload skills in your agent (often `/skills reload`) so it picks up the changes.

## When something looks stale
- `harness doctor` is your health read — it reports which extensions loaded, failed, or conflicted. Start there.
- Because the harness is discovered at runtime, `harness doctor` and `harness help` always show the current reality — they never go stale on you.

## The canonical guide
Keeping a harness healthy over its lifecycle — versions, reconciliation, and the edge cases — is covered in one place:
- [`docs/how/keeping-the-harness-up-to-date.md`](../how/keeping-the-harness-up-to-date.md).

## Where next
- What to measure as the harness matures → [14 · Metrics & Measures](14-metrics-and-measures.md).

---

<sub>[← Prev: Extending the Harness](12-extending-the-harness.md) · [↑ Start Here](README.md) · [Next: Metrics & Measures →](14-metrics-and-measures.md)</sub>
