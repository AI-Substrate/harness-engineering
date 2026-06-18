# Repo Layouts

> **What lands in your repo, and what stays out.** For anyone who wants to see the footprint before (or after) adopting. ~6 min.

The harness keeps a deliberately small footprint. The **core** never enters your repo — it is the global CLI. Everything repo-specific lives under a single `.harness/` directory.

## Core vs. extensions

| | **Core** | **Extensions** |
|---|---|---|
| What | the `harness` CLI itself | your repo's own verbs (`boot`, …) |
| Lives | globally (installed via npm) — **never committed** | in your repo under `.harness/extensions/` — **committed** |
| Maintained by | the harness project (everyone inherits updates) | you / your team |
| Updated with | `harness update` | however you maintain your repo |

One shared, maintained heart; many local shapes. Core improvements reach every team that runs `harness update`; the parts unique to your codebase stay in your `.harness/`.

## The `.harness/` directory

A typical adopted repo:

```text
.harness/
├─ engineering-harness.md            # the governance / "how to operate me" doc      (committed)
├─ extensions/
│  └─ boot/                          # a verb you authored → `harness boot`
│     ├─ extension.ts                #   the entry point (or extension.js)
│     └─ instructions.md             #   the agent briefing for this verb
├─ records/                          # durable team memory                            (committed)
│  ├─ retro/                         #   retrospective records
│  └─ harness-change/                #   a log of changes to the harness
├─ reports/
│  └─ harnessability/                # the scout's report (appears once you run it)   (committed)
└─ temp/                             # scratch: the `harness observe` buffer, resume state   (gitignored)
```

## Committed vs. gitignored

| Path | Tracked? | Why |
|---|---|---|
| `.harness/engineering-harness.md` | ✅ committed | the operating contract — everyone needs it |
| `.harness/extensions/**` | ✅ committed | your repo's behaviour travels with the repo |
| `.harness/records/**` | ✅ committed | team memory is durable and shared |
| `.harness/reports/**` | ✅ committed | the harnessability scout's findings |
| `.harness/temp/**` | 🚫 gitignored | transient: the observe buffer, resume state |

The rule of thumb: **anything that should survive and be shared is committed; only the scratch in `temp/` is ignored.**

## A note on extensions
Each extension is a small package — an entry file (`extension.ts` or `.js`) plus an `instructions.md` that briefs an agent on the verb. They are discovered at runtime, so `harness help` and `harness doctor` always reflect what your repo actually has. Authoring one is [12 · Extending the Harness](12-extending-the-harness.md); the record types under `records/` are described in [`docs/how/record-and-record-types.md`](../how/record-and-record-types.md).

## Where next
- Many repos, one shared core → [07 · Multi-Repo & Org Rollout](07-multi-repo-and-org-rollout.md).
- The proof ladder your extensions plug into → [11 · Backpressure Patterns](11-backpressure-patterns.md).

---

<sub>[← Prev: Using an Existing Harness](05-using-an-existing-harness.md) · [↑ Start Here](README.md) · [Next: Multi-Repo & Org Rollout →](07-multi-repo-and-org-rollout.md)</sub>
