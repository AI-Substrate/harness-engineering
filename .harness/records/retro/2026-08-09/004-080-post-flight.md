---
schema_version: "1.2"
retro_id: "2026-08-09T08:52:00Z-agent-080pf"
agent: agent
plan_id: "080-dd-consume-upgrade"
started_at: "2026-08-09T08:38:42.831Z"
ended_at: "2026-08-09T08:52:00Z"
summary: "post-flight drain + terminal harvest for plan 080 (3 post-drain captures; harvest over 3 records / 16 entries)"
entries:
  - id: DL-001
    kind: difficulty
    description: "A proof-of-absence is only proof if the command reports its denominator. While correcting a vacuous 'markdown-lint: 0 findings' claim (measured while the file was untracked, so the gate never opened it), my first re-measurement ran 'remark --quiet --no-stdout': silent, exit 0 — which cannot distinguish clean from unexamined either. Same defect class, walked into while fixing it. Encodable: probes must print what they examined (markdownlint-cli2's 'Linting: N file(s)'), and a quiet exit 0 must never be accepted as evidence something was checked."
    suggested_encoding: "every gate/probe reports its EXAMINED denominator alongside findings - the markdown-lint unexamined check is the shipped exemplar; extend the convention across harness checks legs"
    fp: "00a998f9b3a3"
    disposition: task
    system:
      compound:
        status: suggested
        source: agent-self
        first_seen_at: "2026-08-09T08:38:42.831Z"
  - id: DL-002
    kind: difficulty
    description: "When you learn a mechanism, re-read your own prior claims that the mechanism touches. I annotated a log sentence to explain how its number could mislead, and did not notice the sentence was already vacuous for a DIFFERENT reason (docs/plans/** is in markdown-lint's IGNORE_GLOBS, so the claim 'the findings do not include this log' was guaranteed by scope, never a result). New evidence gets read for what it adds, not for what it kills — and the annotation pass is exactly when you are least likely to re-audit, because you feel you have just handled the file. Companion to the denominator rule: a denominator must count the population the claim covers, or it is a more confident way of being wrong."
    suggested_encoding: "annotation-pass rule: when you learn a mechanism, re-read your own prior claims that mechanism touches - the annotation pass is when you are least likely to"
    fp: "bd55cbd30bf8"
    disposition: kept
    system:
      compound:
        status: suggested
        source: agent-self
        first_seen_at: "2026-08-09T08:42:41.929Z"
  - id: INS-001
    kind: insight
    description: "A global rename produces TWO casualty classes and a grep for one cannot find the other: (a) sites where the OLD name was the SUBJECT get wrongly rewritten (consuming-dd.md told readers the standalone dd CLI was removed - the opposite of the truth, and the only runnable route); (b) sites the pattern MISSED keep the old name where it is now wrong (docs/how/dd/README.md:307 still called a page 'the complete harness dd command family'). Terra found one instance of (a); only enumerating BOTH directions with denominators (24 files / 154 occurrences swept, surviving occurrences listed as a population not a sample) found (b). Encodable: a rename task's done_when must require both sweeps, and a doc claiming 'X is gone, Y works' needs a live control for EACH half"
    target: harness-itself
    suggested_encoding: "rename-task authoring rule: both-direction sweep with denominators + a live control per claim-half"
    fp: "632bc4d1646f"
    disposition: task
    system:
      compound:
        status: suggested
        source: agent-self
        first_seen_at: "2026-08-09T08:46:12.612Z"
system:
  compound:
    bubble_action: "all-save"
---

# Post-flight — plan 080 (dd consume-upgrade)

## The drain (3 captures made after the phase-3 drain closed)

All three are the same family and they arrived *while correcting each other* — which is
the finding. See the harvest below.

## The harvest — `harness retro insights --plan 080-dd-consume-upgrade`

```
records 3 · entries 16 · 2026-08-09 -> 2026-08-09
status: 8 open · 6 suggested · 2 encoded · 0 wontfix · 0 stale
top clusters:
  1. [difficulty/harness-itself]  n=4   proof gap: TRUE
  2. [difficulty/tooling]         n=2   proof gap: false
  3. [win]                        n=1
  4. [insight]                    n=1
```

## The single highest-leverage improvement

**Every gate and probe should report the population it examined, not just what it
found.** That one change would have caught, in a single day and in this one plan:

| the "clean" result | what it actually examined |
|---|---|
| `tsc --noEmit` green over a type-level test assertion | `src/` only — no test file is ever typechecked (shipped a HIGH) |
| `remark --quiet` exit 0 as proof a doc lints | unknown; a quiet exit cannot distinguish clean from unexamined |
| `git grep -rn …` returning nothing | nothing — `-r` is not a git-grep flag; the failure vanished behind a pipe |
| `markdown-lint` green over a broken document | tracked files only; the document was never a candidate |
| a `done_when` reading "validate shows zero absent sections" | nothing — `dd validate` does not report that class at all |
| `npm view` E404 as "never published" | one lagging proxy — a superset of the claim |

The exemplar already exists in this repo, shipped by another seat today: markdown-lint's
new `unexamined` check publishes `examined` as a denominator *specifically* so a reader
can tell "the gate looked and found nothing" from "the gate did not look". The
improvement is to make that a convention across `harness checks` legs rather than one
check's good idea.

**And the sharper form, from this plan's coder, earned over four instances in one day**
(terra's two F001 sites vs a 24-file/154-occurrence sweep that found a reverse-direction
miss; a six-file `211` population correcting a two-file assumption; a whole-population
listing of surviving `harness dd` references):

> **State the population and its size — a claim with a denominator invites the
> correction that a claim without one hides.**

Two caveats worth carrying with it, both learned the same day: a denominator that counts
the **wrong population** is a more confident way of being wrong (prime), and **absent is
not zero** — a missing row means "cannot tell", never "clean".

## Offer

None of this is encoded yet beyond the one shipped check. The concrete next step is a
`harness checks` convention (each leg reports `examined` alongside `findings`), which is
a separate plan's worth of work and is **offered, not assumed** — plan 080 ships without
it.
