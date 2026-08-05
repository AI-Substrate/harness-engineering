# DE — Documentation & Evolution Historian

**Lens scope.** Trace the evolution that led to the `Engineering Harness Setup` skill brief
(`docs/plans/002-engineering-harness-setup-skill/source-prompt.md`, ~2236 lines), map each major
section of the brief to its philosophical source in `harness-foundations/`, and flag drift +
new material that the skill author must reconcile.

**Method.** Read all eight foundation files in full (notes.md, notes2.md, notes3.md, directives.md,
first-principles.md, patterns-that-work.md, simple-mode.md) and the full brief; cross-walked
brief sub-sections to numbered principles / patterns / directives; flagged wording drift across
the canonical phrases.

---

### Finding DE-01: Evolution timeline — simple-mode.md is the *latest* file and the closest match to the skill

**Evolution stage**: raw notes → directives → patterns → principles (May 19) → measurement notes (May 20) → brief (May 22 10:39) → simple-mode (May 22 11:00)

**Evidence** (`ls -la harness-foundations/`):
- `directives.md` — May 19 13:08
- `source-notes/notes2.md` — May 19 13:08
- `source-notes/notes.md` — May 19 13:31
- `first-principles.md` — May 19 13:31
- `patterns-that-work.md` — May 19 13:23
- `source-notes/notes3.md` — May 20 12:06
- `docs/plans/002-engineering-harness-setup-skill/source-prompt.md` — May 22 10:39
- `simple-mode.md` — May 22 11:00 *(most recent)*

**Description**. The intellectual progression is: (a) raw research synthesis from S001–S004
private sources → (b) two distillation layers landed on May 19 — directives.md (six commitments)
co-emerges with notes2.md, then patterns-that-work.md (22 patterns) → first-principles.md (58 numbered
principles) with notes.md as the rich companion synthesis. (c) On May 20, notes3.md adds the
measurement/proof-level/event-model layer (M001–M003). (d) On May 22 morning the user drafted the
authoring brief, then ~21 minutes later finalised `simple-mode.md` — a public-blog-shaped “simple
version” distilling exactly five rules + the “tiny CLI” pitch. Simple-mode.md is therefore
**the most recent canonical statement** and is structurally one-to-one with brief Section 1
(1.1–1.7 ≈ simple-mode Rules 1–5 + the boundary preamble).

**Why it matters for authoring**. When the brief and foundations disagree, simple-mode.md should
win on wording; first-principles.md should win on rigour and numbered citation. The brief sits
between the two and inherits drift from both directions.

**Recommendation**. Treat simple-mode.md as the *prose voice* the skill should echo, and
first-principles.md as the *citation backbone* every templated file should link to.

---

### Finding DE-02: Brief Section 1 ↔ foundations cross-map (1.1–1.8)

**Evolution stage**: principles + directives + simple-mode → brief Section 1

**Evidence**. Brief sub-section → foundation citation table:

| Brief | Title | Directive | First-principles | Pattern | Simple-mode |
|---|---|---|---|---|---|
| 1.1 | Keep the harness boundary clear | `directives.md` D1 (L7–15) | #1 (L5–7), #2 (L9–11), #3 (L13–15) | — | preamble (L33–41) |
| 1.2 | Productise the development loop | D2 (L17–23) | #10–17 (L36–66): #10 loop, #11+11a/b/c boot, #12 health, #13 interact, #14 observe, #15 validate, #16 improve, #17 loop time | — | preamble + Rule 1 framing (L33–47) |
| 1.3 | Make the paved path easier than the shortcut | D3 (L25–31) | #19 (L98), #55 (L226) | P11 (L130–141) | Rule 1 (L66–72) |
| 1.4 | Encode the fix, not the memory | D4 (L33–39) | #18 (L94) | P9 (L86–92), P10 (L93–103) | Rule 2 (L78–92) |
| 1.5 | Prefer deterministic validation over agent inference | — | #27 (L135), #28 (L139), #29 (L143) | P7 (L74–82), P18 (L195–204) | Rule 3 (L94–108) |
| 1.6 | Treat agent friction as harness feedback | D5 (L41–47) | #44 (L199), #45 (L202), #46 (L205) | P1 (L21–31), P10 (L93–103) | Rule 4 (L110–122) |
| 1.7 | Ask the magic-wand question, then close the loop | — | #46 (L205), #47 (L212) | P10 (L93–103) | Rule 5 (L124–136) |
| 1.8 | Keep the initial harness practical and low ceremony | — | #51 (L222), #55 (L226), #56 (L228) | P22 (L259–272) | implicit in “tiny CLI” pitch (L52–64) |

**Description**. Brief Section 1 is the cleanest derivative section in the document — every
sub-heading has a direct ancestor. The structure of Section 1 is closer to simple-mode.md’s
five rules than to directives.md’s six directives: 1.1 is the boundary preamble; 1.3–1.7 map
1-to-1 onto simple-mode Rules 1–5; 1.2 / 1.4 / 1.8 add framing material.

**Why it matters for authoring**. The skill author can lift Section 1 of the brief verbatim
into `SKILL.md` § “Principles” without re-deriving anything, but each principle should carry
a citation link back to first-principles.md so a future maintainer can follow provenance.

**Recommendation**. In the skill’s `SKILL.md`, emit each of the eight principles with an inline
foundation citation (`harness-foundations/first-principles.md#N`). Add an explicit
`See also: harness-foundations/simple-mode.md` link in the principles preface.

---

### Finding DE-03: Brief Section 8 install flow ↔ patterns cross-map (Steps 1–11)

**Evolution stage**: patterns → brief Section 8

**Evidence**. Brief step → pattern citation:

| Step | Brief action | Pattern | First-principles |
|---|---|---|---|
| 1 | Orient (explain boundary) | P1 classify-the-failure framing (L21–31) | #1, #2 |
| 2 | Inspect repo, summarise signals as table | P13 fix-forward diagnostics (L156–164); doctor-style preflight | #22 |
| 3 | Ask required decisions (grouped) | — (matches repo `AGENTS.md` *Clarification batching preference*) | — |
| 4 | Create files (read before overwrite, patch-style summary) | P22 garbage-collect + safe-modify habits (L259–272) | #50 |
| 5 | Populate `harness/config.json` | D4 (encode-don’t-document); embodies “executable knowledge beats remembered knowledge” (notes2 §4) | #18, #21 |
| 6 | Create CLI skeleton | P11 explorable CLI (L130–141), P12 structured evidence (L143–154) | #20, #21 |
| 7 | Create root `HARNESS.md` | P4 routing not dumping (L52–61) | #24, #39 |
| 8 | Patch `AGENTS.md` (router only) | P4 explicitly (L57–60: “the root instruction file should act like a router”) | #39 give-a-map-not-a-manual |
| 9 | Create onboarding guide | P5 engineer-for-amnesia (L63–72) | #38, #40 |
| 10 | Validate (help, doctor, validate --dry-run) | P3 fast vs proof loop (L42–50) | #15, #27, #30 |
| 11 | Magic-wand close | P10 turn-friction-into-encoded-improvement (L93–103) | #46, #47 |

**Description**. Every install step has a clean pattern ancestor. The strongest moves are
Steps 7 + 8 (P4): the brief is unusually disciplined about NOT dumping the harness manual into
`AGENTS.md` — it explicitly says “The root agent file should be a router, not a dumping ground”
(brief L685–687), which is almost a direct quote of P4 “the root instruction file should act
like a router” (`patterns-that-work.md` L57).

**Why it matters for authoring**. The skill `SKILL.md` should annotate each install step with
its driving pattern so the *purpose* of the step survives any future copy-paste rewrite. If a
future maintainer asks “do we still need Step 9?” the answer should be visible: “yes, P5
engineer-for-amnesia”.

**Recommendation**. In the skill’s install-flow section, add a one-line `Why:` field to each
step citing the relevant pattern. Example: `Step 8 — Patch AGENTS.md. Why: P4 routing, not
dumping.`

---

### Finding DE-04: Brief Section 22 (long-running boot) ↔ first-principles #11c, #36, #37

**Evolution stage**: principles → brief Section 22

**Evidence**:
- `first-principles.md` #11c (L52–54): “A composite command should build or install if needed,
  start the product, wait for readiness, and prove the loop with a health endpoint or smoke
  route.”
- `first-principles.md` #36 (L163): “Clean state is part of done.”
- `first-principles.md` #37 (L167): “Cleanup must be idempotent.”
- Brief Section 22 (L1163–1183): describes the long-running-boot careful path: ask permission,
  capture logs, wait for readiness signal, call health, terminate cleanly, report exit status,
  avoid orphaned processes.

**Description**. Section 22 is essentially the principled “if you do the harder thing”
expansion of #11c with #36/#37 cleanup hygiene attached. The brief explicitly defers full
boot-and-validate to a “planned next harness improvement” (L1181–1183) because doing it badly
traps the session. This is consistent with the brief’s overall “first useful version, not
finished product” framing.

**Why it matters for authoring**. The skill must:
1. **Encode** the run command in `config.json` (brief Section 12).
2. **Refuse** to auto-execute it unless explicitly approved.
3. **Defer** real boot-and-validate to a documented next improvement.

This is a place where the skill could over-build (writing a process-supervising harness on day
one) and break the “low ceremony” directive. The brief gets the trade-off right; the skill must
preserve it.

**Recommendation**. In the Python and Node CLI skeletons (brief §13/§14), keep the `run`
command as a plain wrapper (already done). Do NOT add boot-supervision in the first skill
version. Mention #11c, #36, #37 in the `harness/state/known-difficulties.md` seed text so the
next agent session knows the upgrade path.

---

### Finding DE-05: Brief Section 27 improvement loop ↔ Pattern 10 full lifecycle

**Evolution stage**: notes2 retro-lifecycle → first-principles #47 → patterns P10 → brief Section 27

**Evidence**:
- `notes2.md` §7 (L60–70): defines the five-stage lifecycle (setup → track → bubble → harvest → encode).
- `first-principles.md` #47 (L212): “Retrospectives need a lifecycle” — “captured, bubbled,
  harvested, prioritised, encoded, and later validated.”
- `patterns-that-work.md` P10 (L93–103): canonical six-step lifecycle: *capture → bubble →
  harvest → prioritise → encode → validate*.
- Brief Section 27 (L1990–2025): describes four phases — during work (capture), at natural
  pauses (bubble), at session end (magic-wand close), during harness maintenance (harvest +
  prioritise + encode/dismiss/promote/convert).

**Description**. Brief Section 27 covers all six lifecycle stages but compresses them into
four operational phases. **One stage is implicit rather than explicit: `validate`** (i.e., did
the encoded fix actually make the next run better?). P10 names it; #47 names it (“later
validated”); notes2 implies it; the brief drops the explicit verb and instead encodes it as
“Measure value by encoded improvements, not by the number of logged notes” (L2024) — which
covers the spirit but loses the closing-the-loop verb.

**Why it matters for authoring**. The skill installs the *lifecycle infrastructure*
(`friction-log.md`, magic-wand prompt, harvest review cadence) but does not yet install a
*validate* step. A future skill agent could read Section 27 and think the loop ends at “encode”.

**Recommendation**. Add an explicit sixth phase to brief Section 27 (and to
`harness/state/friction-log.md` template): **After encoding, validate** — when the same
trigger appears in a later run, confirm the encoded fix prevented or short-circuited the
friction; if not, reopen the entry. One-line fix to brief: append a fifth bullet to the
“During harness maintenance” list: `- validate that an earlier encoded fix actually held up.`

---

### Finding DE-06: Drift — “Encode the fix, not the memory” has three different canonical phrasings

**Evolution stage**: directives → first-principles → notes2 → simple-mode → brief

**Evidence**:
- `directives.md` D4 (L33): “Encode the **solution**, not just the **lesson**.”
- `first-principles.md` #18 (L94): “Encode, do not merely **document**.”
- `notes2.md` §4 (L31): “Encode, do not merely **document**.”
- `simple-mode.md` Rule 2 (L78): “Encode the **fix**, not the **memory**.”
- Brief §1.4 heading (L67): “Encode the **fix**, not the **memory**.”
- Brief §9 HARNESS.md template, Rule 2 (~L731): “Encode the **fix**, not the **memory**.”

**Description**. Three sibling phrasings exist for the same idea. The May 19 foundation files
use *solution/lesson* (D4) and *encode/document* (#18, notes2 §4). The May 22 files
(simple-mode.md and the brief) converge on *fix/memory*. This is not a contradiction — the
idea is identical — but a reader scanning foundations and brief will see three different
headlines for what should be the marquee rule.

**Why it matters for authoring**. The skill’s `HARNESS.md` template, `AGENTS.md` snippet,
`SKILL.md` principles list, and onboarding guide will all reference this rule. If they pick
different phrasings, every future user gets a slightly different mental model.

**Recommendation**. **Canonical headline for the skill: “Encode the fix, not the memory.”**
(simple-mode + brief agree, and it’s the most recent.) Foundation files keep their original
phrasings for traceability; the skill cites #18 / D4 underneath the canonical headline as
provenance. One-line note for the skill author: every template file should use this exact
phrase as the rule header; expanded prose may paraphrase.

---

### Finding DE-07: Drift — magic-wand question wording varies across brief sections

**Evolution stage**: first-principles #46 → P10 → simple-mode Rule 5 → brief multiple sections

**Evidence**:
- `first-principles.md` #46 (L205–207): “…what one concrete command, flag, output field,
  fixture, diagnostic, or workflow change would help…” *(no template, no “next run easier”)*
- `patterns-that-work.md` P10 (L102): “What one concrete command, flag, output field, fixture,
  diagnostic, template, or workflow change would make the next run easier?” *(adds “template”,
  ends at “easier”)*
- `simple-mode.md` Rule 5 (L126–128): “If you had a magic wand, what one command, flag, output
  field, fixture, diagnostic, template, or workflow change would make the next run **easier,
  safer, or higher quality**?” *(no “faster”)*
- Brief §1.7 (L125–127): adds **faster** — “easier, safer, faster, or higher quality”
- Brief §9 HARNESS.md template Rule 5 (~L750): “easier, safer, faster, or higher quality” ✓
- Brief §17 friction-log template (~L1015): “easier, safer, faster, or higher quality” ✓
- Brief §24 final report (~L1310): “easier, safer, faster, or higher quality” ✓
- **Brief §8 Step 11 (~L617): DIFFERENT wording** — “If you had a magic wand, what one
  command, **check**, fixture, diagnostic, output field, or workflow change would make this
  harness **more useful for the next session**?” *(drops “flag”, drops “template”, replaces
  closing phrase, reorders list)*

**Description**. The skill brief uses three slightly different magic-wand phrasings:
1. The brief’s own consistent in-template wording (§1.7, §9, §17, §24).
2. simple-mode.md, missing “faster”.
3. brief §8 Step 11, with a substituted list AND a substituted closing phrase.

**Why it matters for authoring**. This is the most-quoted single sentence in the entire skill.
Future agent sessions will paste it verbatim into reports. If the skill ships with three
versions, agents will reproduce one at random, and the magic-wand question becomes a wobbling
artefact instead of a reusable contract.

**Recommendation**. **Single canonical form for the skill** (matches §1.7 / §9 / §17 / §24):

> If you had a magic wand, what one command, flag, output field, fixture, diagnostic,
> template, or workflow change would make the next run easier, safer, faster, or higher quality?

One-line fixes:
- Update brief §8 Step 11 to use the canonical form verbatim.
- Update `simple-mode.md` Rule 5 to add **“faster, ”** (or accept the simpler form there and
  document the split as “simple-mode = blog voice; skill = canonical template”).
- Add a `harness/templates/magic-wand-prompt.md` single-source-of-truth file the CLI’s
  `magic-wand` subcommand reads from, so all future drift is structurally prevented.

---

### Finding DE-08: New material in brief not in foundations — and it does not contradict

**Evolution stage**: foundations → brief (new operational layers)

**Evidence**. Brief sections that introduce material absent from foundations:

| Brief section | New material | Compatible with foundations? |
|---|---|---|
| §4 skill package structure | `engineering-harness-setup-skill/SKILL.md`, `templates/*`, `cli-python-harness.py`, etc. | ✓ — purely the artifact spec; foundations don’t prescribe artifact format |
| §5 target file tree | Specific paths: `harness/bin/`, `harness/skills/`, `harness/state/`, `harness/proofs/`, `harness/templates/` | ✓ — concrete realisation of foundations §1.8 “small harness folder”; consistent with #38 “repo is the system of record” |
| §12 `harness/config.json` schema | `schema_version`, commands.install/build/test/lint/format_check/run/smoke, health.url/timeout_seconds, validation.quick/proof | ✓ — embodies #18 encode-don’t-document and #21 “the CLI is the API”; but uses **different command vocabulary** than notes3 (see DE-09) |
| §13/14 CLI skeletons | Python + Node skeletons with `doctor`, `build`, `test`, `lint`, `format_check`, `run`, `health`, `smoke`, `validate`, `onboard`, `magic-wand` | ✓ — embodies P11 explorable, P12 structured evidence, P13 fix-forward; one drift point — naming (see DE-09) |
| §29 fast vs proof loop | `validation: { fast, quick, proof }` JSON keys | ✓ — direct realisation of P3 (L42–50) |
| §30 integrate with existing workflows | “The harness is a façade over trusted project operations, not a rewrite of the toolchain.” | ✓ — direct realisation of #4 (“the harness can wrap existing scripts”) and P11 (“It can wrap existing build scripts…”) |
| §31 brownfield / partial setup | “The first harness often starts by making incompleteness visible.” | ✓ — direct realisation of #6 (harnessability is a property of the codebase) and notes.md “accessibility beats rewrite-or-freeze” |

**Description**. All new operational material in the brief either *realises* an existing
foundation principle or *fills a gap* the foundation explicitly leaves to implementation. I
found no place where the brief contradicts a numbered principle, directive, or pattern. The
brief is therefore safe to lift into a skill without renegotiating philosophy — only wording
drift (DE-06, DE-07) and one vocabulary mismatch (DE-09) need fixing.

**Why it matters for authoring**. The skill author should not feel pressure to “shrink” the
brief to fit foundations — the new material is *the artifact*. Treat foundations as the *why*,
brief §4–§24 as the *what*, and brief §25–§37 as the *how*.

**Recommendation**. In the skill `SKILL.md`, include a one-section provenance block:
“Foundations: `harness-foundations/{directives,first-principles,patterns-that-work,simple-mode}.md`.
Brief: `docs/plans/002-engineering-harness-setup-skill/source-prompt.md`. New operational
material introduced by this skill: file tree (§5), config schema (§12), CLI skeletons (§13–14),
brownfield handling (§31).”

---

### Finding DE-09: Drift — CLI command vocabulary differs between brief and notes3

**Evolution stage**: notes3 measurement vocabulary (May 20) → brief CLI vocabulary (May 22)

**Evidence**:
- `notes3.md` §“Harness CLI instrumentation” (L213–222): proposes minimum command set
  **`doctor`, `boot`, `seed` or `reset`, `prove`, `evidence`, `handoff`, `friction` or `retro`**.
- Brief §13/§14 CLI skeletons: command set is
  **`doctor`, `build`, `test`, `lint`, `format_check`, `run`, `health`, `smoke`, `validate`,
  `onboard`, `magic-wand`**.

**Description**. Two non-overlapping CLI vocabularies. Notes3 is measurement-focused
(`boot`, `prove`, `evidence`, `handoff`, `friction`); brief is build-cycle-focused (`build`,
`test`, `lint`, `format_check`, `run`, `health`, `smoke`). Overlap: only `doctor`. The brief
**collapses** `boot+health+smoke` into `run + health + smoke` and replaces `prove + evidence`
with `validate`. `seed/reset`, `handoff`, and `friction/retro` are missing from the brief CLI.

This is not a contradiction — it’s a different opening move. The brief deliberately chooses
the “first useful version” vocabulary that maps onto common build-tool conventions; notes3
describes the more mature measurement-instrumented vocabulary.

**Why it matters for authoring**. If the skill ships only the brief vocabulary, future
sessions will not have a natural CLI verb for `seed`, `handoff`, `friction record`, or
`evidence`. The friction log will exist as a markdown file with no CLI front door, weakening
P11 (explorable) and #21 (CLI is the API).

**Recommendation**. In the skill CLI skeletons, **keep the brief’s vocabulary as default**
(it’s the right opening move) but **add stub subcommands for the notes3 vocabulary** that
print “planned next harness improvement”:

```text
harness seed       # prints "unconfigured — see harness/state/known-difficulties.md"
harness handoff    # prints handoff template; writes to harness/proofs/<ts>.md
harness friction   # appends a stub entry to harness/state/friction-log.md
```

This preserves the brief’s low-ceremony opening while making the maturity path visible.
Document the mapping in `harness/templates/cli-command-contract.md` (brief §20).

---

### Finding DE-10: External research gaps the skill author should be aware of before publishing

**Evolution stage**: foundations + brief → publishable skill package

**Evidence**. The brief is internally consistent and well-grounded in `harness-foundations/`,
but the skill package will be published into an ecosystem the foundations do not survey.

**Description**. External context the skill author should fetch before finalising templates:

1. **Skill format conventions.** Anthropic “Claude Skills”, OpenAI custom-GPT skill files,
   Cursor `.cursorrules`, GitHub Copilot custom instructions, Cline rules. Brief §4 specifies
   a `SKILL.md` + `templates/` package structure but does not confirm it survives any
   particular agent-harness runtime’s skill discovery rules.
2. **Reference “engineering harness setup” skills in the wild.** If Birgitta Böckeler’s
   Martin Fowler article links to an exemplar bundle, or if any public repo (e.g.
   `AI-Substrate/*`, `aisubstrate/*`) ships a sibling skill, names and file layouts should
   be aligned to reduce confusion.
3. **`AGENTS.md` adoption status.** The brief assumes `AGENTS.md` is the canonical agent-instruction
   file (with `.cursorrules`, `CLAUDE.md` listed as variants in §30). A quick survey of which
   tools currently honour `AGENTS.md` vs `.github/copilot-instructions.md` vs `.cursor/rules/`
   would let the skill route correctly without overpromising.
4. **CLI install conventions.** `uvx`, `pipx`, `npx`, `pnpm dlx`, `bun x`, `deno run`, `go install`.
   Brief §5 lists invocations but doesn’t commit to one; the skill should test which forms
   actually work cross-platform.
5. **Long-running process supervision idioms** (deferred per DE-04). When the skill upgrades
   to a real `harness boot-and-validate`, public references for readiness probes
   (`wait-for-it.sh`, `dockerize`, `tini`, `concurrently`, `npm-run-all`) would help.
6. **Public measurement frameworks.** `notes3.md` cites DORA / SPACE / Accelerate / ESSP; the
   skill itself doesn’t need to ship measurement, but the `harness/state/friction-log.md`
   template could link to the Accelerate capability list for context.

**Why it matters for authoring**. The skill is portable by design (brief §3 explicitly says
the skill must not overfit Node or Python). External gaps determine whether the skill is
*usable* in the wild, not just *correct* against this repo’s foundations.

**Recommendation**. Before final publish, the skill author should:
- Run a one-pass perplexity / web search for “engineering harness setup skill” and “AGENTS.md
  routing pattern” to confirm vocabulary alignment.
- Test the produced `harness.py` + `harness.mjs` on at least one repo per major ecosystem
  (Node, Python, Go, .NET) to validate the “first useful version” heuristic from brief §7.2.
- Include a short `README.md` next to `SKILL.md` that says which agent-harness runtimes the
  skill has been verified against.

---

## One-paragraph summary

The skill brief (`source-prompt.md`, May 22 10:39) is the second-newest file in the foundations
plus brief corpus; only `simple-mode.md` (May 22 11:00) is more recent, and it is the
five-rules public distillation that maps almost one-to-one onto brief Section 1. The evolution
ran: notes2 + directives (May 19 13:08) → patterns (13:23) → notes + first-principles (13:31)
→ measurement notes3 (May 20) → brief → simple-mode. The brief is internally consistent and
every section has a clean ancestor in `harness-foundations/` (DE-02, DE-03), with new
operational material — skill package layout, file tree, `config.json` schema, CLI skeletons,
brownfield handling — that *realises* rather than *contradicts* the foundation (DE-08).
The three drift points worth fixing before authoring are: (1) “Encode the fix, not the memory”
has three sibling phrasings across files — pick the May 22 form as canonical (DE-06); (2) the
magic-wand question wording diverges across §1.7, §8 Step 11, §17, §24 and `simple-mode.md`
Rule 5 — normalise to the “easier, safer, faster, or higher quality” form and ship a
single-source-of-truth template file (DE-07); (3) the brief’s CLI vocabulary
(`doctor/build/test/run/health/validate`) is build-cycle-focused while `notes3.md` proposes a
measurement vocabulary (`boot/seed/prove/evidence/handoff/friction`) — keep the brief default
and add stub subcommands that signal the maturity path (DE-09). Brief Section 22 (long-running
boot) and Section 27 (improvement loop) are good but each leaves one principle implicit (#11c
deferral and P10’s `validate` stage respectively) — surface both explicitly in skill templates
(DE-04, DE-05). External gaps — agent-harness skill format conventions, `AGENTS.md` adoption
status, CLI install idioms — should be closed by a single perplexity/web pass before publish
(DE-10). Overall: the skill is ready to author from the brief verbatim, provided the four
wording-drift one-liners are reconciled and the new operational material carries inline
foundation citations.
