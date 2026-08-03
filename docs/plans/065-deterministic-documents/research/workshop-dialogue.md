# 065 — Workshop dialogue record (Jordan ↔ silkworm, 2026-08-03)

Verbatim-where-quoted record of the concept Q&A that produced decisions D1–D11 and open items W1–W9 in `../workshop-notes.md`. Jordan's words are quoted as typed (including typos); agent positions are summarised. Sequence is chronological.

## Setup

- Jordan directed a review of the builder deterministic spine (`the-flow.json`), the harness's role, and backpressure's evidence discipline, then a deep review of plan 063 (plan ACs, backpressure artifact, spine receipts).
- An Opus 5 subagent surveyed 7 further recent plans (see `survey-recent-plans.md`) in the context of "we are going to be making more changes to how the flow spine carries requirements deterministically."
- Jordan's brief was pasted and converted to `../initial-brief.md`. Four Opus 5 thinkers developed slices of the concept (see `thinker-*.md`).
- Landing/authoring logistics: worktree s065 allocated by prime (`pij-massive-meadowlark`); Jordan ruled "ah koala will be pm, but not yet - you will work on this html briefing first"; prime recorded the ruling (government spine Seq 542) with koala stood off; silkworm sole writer, plan folder only.

## Q&A rulings

**Q1 — Write posture (CLI-only vs hand-editable):**
Jordan: "they can edit if they like, just need to paass validation."
→ **D1**: DD is a validated file format, not a mediated store. Deliberate divergence from the-flow's CLI-only single-writer.

**Q2 — Evidence shape (opened as field-vs-append-only-trail; agent offered an option ladder: prose blob → typed record → typed kinds → re-runnable → staleness → countersigning):**
Jordan: "so normally ac woudl be just check it off, and write some information / maybe link 1 or more dd sections etc... or link to code files in a blob of text. what else coudl we consider?" then, after the ladder:
"what if we had the AC desc, the checkbox, id etc. then had a text area, then a link to evidence detail, which will be off to the execution log. execution log to be converted over to a dd itself. ac might also need a nother link to the back-pressure dd which explain what to be done and how to do it. so dd link to back-pressure describing the pressure needed, and ddl ink to log or osmehting showing how it done. the actual dd row that is being used by plan / navication node is signpost and validation point, but does nto have to carry all this."
→ **D2** (signpost AC rows: note + prescriptive pressure link + demonstrative discharge link) and **D3** (execution log becomes an append-only DD). Same message: "looks liek we're building a nice graph here - dd cli (in harness) shoudl have some kind of way to explore / traverse graphs / visualise them and also additional check their linkages are intact via dr commands." → **D6**.

**Q3 — Human decline semantics (waived vs deferred):**
Jordan: "yeah we should have some extra status on things like this thats more than just checked ot not checked. so boolean is not good enough. maybe it needs checked, not checked, blocked, human-skipped or something? this means dd can have boolean type, or more complex schema types that mean we need a good way to render them too - how will our render adatpors work for these custom types (inbuildts are fine, but what if hte user want sto add more complex tpes in tehir own custom dds! somethig to workshop later, make a note - and something to consider in our stic html overview / info)"
→ **D4** (completion is a state, vocabulary TBD → W2) and **W1** (render adapters for custom types — flagged for its own workshop and for the infographic).

**Spine linkage confirmation:**
Jordan: "AC in plan signposts + can carry it own stuff, teh plan spine in the-flow will link to an ac via the stable address/id, so its links on links etc, graph style." → **D5**.

**Q4 — Section renames:**
Jordan: "yep dd rename-section first class to help wit htis." → **D8**. Same message set the title: "Our html doc will be called 'AI Substrate presents - Determinitic Documents' (a new way to <you figured osmething out>." → **D10**; agent supplied the tagline "a new way to write documents that machines can verify and humans can read."

**Q5 — Basis pins (agent explained windows-vs-citations plainly at Jordan's request; Jordan probed "how woudl the linked doc be 'told' and what would read that information / do anyting abou tit?" — answered: nothing is told; doctor/orient/render compute the pin mismatch at read time):**
Jordan then proposed the render-freshness half himself: "I think if you edit a plan that has an ac in it, and other dds link, then their md shoudl be auto re-generated. When a dd.md is generated, the dd.json file will collate the hash of all input docs and store in a contributors section or what ever, so dr can go - hey a file changed and your contuibs are old, regen."
→ **D9**: contributors ledger + cascade regeneration, kept distinct from citation basis pins (opposite refresh rules: views auto-refresh eagerly; pins never auto-refresh — re-verify / re-point / contest only).

## Post-queue ideation

**Two-way links:**
Jordan: "i wonder if docs that are being referencd by other docs have the outgoing link stored so dd can update downstreams too, so two way links.. this might reduce linkgatge at expense of some complexity in renameing and small data cost? thoughts?"
Agent position (accepted, pending formal confirm): two-way *navigation* yes, two-way *storage* no — a derived reverse index (sha churn on citation, hub-doc merge conflicts, and lying caches are the three arguments against stored back-links). → **D11**.

**`dd build`:**
Jordan: "i wonder if there is alike a dd build verb thta takes an input doc and builds out x-deep links. will warn if more depth in graph." → **W7** (composed view to depth N; honest frontier warning; ephemerality fork open — agent lean: ephemeral by default, persisted builds governed as renders).

**Validate radius:**
Jordan: "and i wonder if dd validate will do same, it will check docs are correct (incase of manual edits) and also check some depth (configuratbel) to see if rebuilds needed, ohter docs in the immeidate graph have formatting isues etc." → **W8** (validate/doctor as one engine with a radius dial; finding owned by the file that must change to fix it).

**File-level invocation:**
Jordan: "i dont think build/validate would need to e linekd to an sub-addres like that - yhou would just run it on the file. this will be cheap to run." → recorded into W7/W8 (invocation unit is the file).

**Addressing workshop:**
Jordan: "but i do love the first class addressing ssytem - we shoudl get a good solid workshop done on adrressing when ready." → **W9**.

**Portability steer (two messages):**
Jordan: "with dd concept, dont jus tlock it in to harnes feature, i think it would be awesome to have it work as a lib that many projects can use, as well as a standalone CLI (OOS for now) but we could talk as if its portable concet and maybe show otehr ways it can be used too."
Jordan: "remember this could be used for standalone docuemnts in a git repo or file system, or can be more deeplpy integrated in to concepts with SDK - just like our harness is with plans (remember later we will mek this stand alone ,so even know shoudl be pretty separrate lib insdie harnes though for now, no need to fully split - its hte ocnecpts that are improtant"
→ **D7** including the three-depth adoption spectrum and the separate-lib-inside-harness build posture.

## Outstanding at time of record

- Formal confirms pending from Jordan: D11 (derived reverse index) and W7's ephemerality fork.
- Open workshops: W1 (render adapters), W2 (state vocabulary), W3 (log entry kinds), W6 (schema-in-file depth), W7 (`dd build`), W8 (validate radius), W9 (addressing grammar).
