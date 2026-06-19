# Fix Tasks: Plan 032 — eng-harness-flow flight plans

Apply in order. Re-run the review verb after fixes (`/the-flow 7 review --plan "docs/plans/032-eng-harness-flow-flight-plans/eng-harness-flow-flight-plans-plan.md"`).

Source review: `docs/plans/032-eng-harness-flow-flight-plans/reviews/review.md` · Commit under review: `3e57753`.

## Critical / High Fixes

### FT-001: Idempotency guarantee is false on the R-1 set-node flagging path (AC-07/AC-11/AC-13)
- **Severity**: HIGH
- **File(s)**:
  - /Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/flow/flow-mutations.ts (`setNode`, ~427-456)
  - /Users/jordanknight/substrate/harness-engineering/skills/eng-harness-flow/references/flight-plan-ops.md (R-1 reinjection procedure)
  - /Users/jordanknight/substrate/harness-engineering/scripts/score-flow-coexist.sh (Gate 2)
  - /Users/jordanknight/substrate/harness-engineering/docs/plans/032-eng-harness-flow-flight-plans/eng-harness-flow-flight-plans-plan.md (AC-07 wording) + execution.log.md (reconcile the claim)
- **Issue**: `setNode` unconditionally restamps `modified_at` and appends a `node-updated` event, so re-flagging an already-correct chore is **not** byte-idempotent. AC-07 promises "re-run → byte-identical node set". The committed retro `docs/retros/flow-coexist-eval.md` records `idempotent=false` (modified_at churn), contradicting execution.log's "byte-identical / ALL 5 PASS". The coexist scorer's Gate 2 only proxies idempotency via dedup count — it never byte-diffs — so the guarantee is also ungated.
- **Fix** (choose A or B; A is the eval agent's own magicWand and preferred):
  - **A — make the write idempotent**: in `setNode`, when every requested field already equals the node's current value (notably `chore.kind`, `chore.importance`, `command`), return the doc unchanged — no `modified_at` restamp, no `node-updated` event. Keep validation (badChore/badZone) before the no-op check. Then re-run flow-coexist-eval and add a real byte-diff idempotency gate to `score-flow-coexist.sh` (supply the second snapshot and assert byte-identical node set).
  - **B — re-scope the guarantee**: change AC-07/AC-11 to "dedup-idempotent — re-injection adds no duplicate nodes; metadata timestamps (`modified_at`) may churn", update `flight-plan-ops.md` + the eval prompt accordingly, and keep Gate 2's dedup-count proxy (but make the scorer assert *no new nodes*, not byte-identity).
  - Either way: **reconcile execution.log.md** with the committed retro (the "byte-identical PASS" line is inaccurate as written), and fix the eval-prompt "exact same injection commands" wording so it exercises the found-node path without colliding on node IDs.
- **Patch hint** (option A):
  ```diff
    export function setNode(doc, nodeId, fields, deps) {
      const next = clone(doc);
      const node = findNode(next, nodeId);
      if (node === undefined) return nodeNotFound(nodeId);
      // ... badZone / badChore validation unchanged ...
  +   // Idempotent no-op: if every requested field already matches, don't restamp/emit.
  +   const unchanged = Object.entries(fields).every(
  +     ([k, v]) => k === 'id' || JSON.stringify(node[k]) === JSON.stringify(v),
  +   );
  +   if (unchanged) return { ok: true, doc };
      const applied: string[] = [];
      for (const [key, value] of Object.entries(fields)) {
        if (key === 'id') continue;
        node[key] = value;
        applied.push(key);
      }
      node.modified_at = deps.clock.nowIso();
      next.events.push(buildBuiltinEvent('node-updated', { node: nodeId, fields: applied }, next.events, deps.clock));
      return { ok: true, doc: next };
    }
  ```

### FT-002: Shipped agent schema leaks a personal home / agent-harness path
- **Severity**: HIGH
- **File(s)**: /Users/jordanknight/substrate/harness-engineering/agents/flow-coexist-eval/input-schema.json:15
- **Issue**: `"default": "/Users/jordanknight/.claude/skills/the-flow/references/flight-plan.schema.json"` — commits the author's personal `$HOME` **and** the `.claude` agent-harness location into tracked, shippable content (constitution P12 / AGENTS.md publication boundary), and breaks for any other user.
- **Fix**: Replace with a neutral, portable default — e.g. resolve at runtime in the prompt (`git rev-parse --show-toplevel` + the in-repo skill path `skills/eng-harness-flow/...` or the bundled schema), or use a documented placeholder like `<agent-harness-root>/skills/the-flow/references/flight-plan.schema.json`. Never hardcode `/Users/<name>` or `.claude`.
- **Patch hint**:
  ```diff
  - "default": "/Users/jordanknight/.claude/skills/the-flow/references/flight-plan.schema.json"
  + "default": ""   // resolved at runtime; prompt derives it from the repo root / installed skill path
  ```

## Medium / Low Fixes

### FT-003: New retros commit personal absolute `runDir` paths
- **Severity**: MEDIUM
- **File(s)**: /Users/jordanknight/substrate/harness-engineering/docs/retros/flow-coexist-eval.md:5; /Users/jordanknight/substrate/harness-engineering/docs/retros/loop-flow-eval.md:5
- **Issue**: `runDir: /Users/jordanknight/...` leaks the author's home/identity into tracked public content.
- **Fix**: Rewrite to repo-relative (`agents/<slug>/runs/<runId>`). Consider sanitizing the retro emitter so future runs never write absolute home paths. (Systemic: the same pattern pre-exists in other tracked retros — a repo-wide sweep is warranted but out of this phase's scope.)

### FT-004: Plan Gate Matrix wrongly marks G2/G3 as N/A
- **Severity**: MEDIUM
- **File(s)**: /Users/jordanknight/substrate/harness-engineering/docs/plans/032-eng-harness-flow-flight-plans/eng-harness-flow-flight-plans-plan.md (Gate Matrix)
- **Issue**: G2 Constitution and G3 Architecture are marked N/A "file does not exist", but `docs/project-rules/constitution.md` and `architecture.md` both exist. Skipping the constitution gate let FT-002/FT-003 through.
- **Fix**: Correct the matrix — run G2 against constitution.md (publication boundary catches FT-002/003) and record G3 architecture as PASS (no layer violation found).

### FT-005: Coexist scorer Gate 4 scans repo root
- **Severity**: MEDIUM
- **File(s)**: /Users/jordanknight/substrate/harness-engineering/scripts/score-flow-coexist.sh (Gate 4)
- **Issue**: `find "$EVAL_DIR" . -maxdepth 4 -name 'loop.flow.json'` scans the repo root; once standalone-loop mode commits the **tracked** `.harness/loop.flow.json` (T104/D-05), a correct coexist run will false-fail.
- **Fix**: Restrict the search to the eval run's scratch/output directory, or snapshot before/after and fail only if the coexist run **creates** a new standalone loop file.
- **Patch hint**:
  ```diff
  - if find "$EVAL_DIR" . -maxdepth 4 -name 'loop.flow.json' 2>/dev/null | grep -q .; then
  + if find "$EVAL_DIR" -maxdepth 4 -name 'loop.flow.json' 2>/dev/null | grep -q .; then
  ```

### FT-006: AC-09 adopt eval only adapted, full probe deferred
- **Severity**: MEDIUM
- **File(s)**: /Users/jordanknight/substrate/harness-engineering/agents/validate-harness-flow/** ; execution.log.md
- **Issue**: `validate-harness-flow` gained an `adoptFlow` block but the full clone-onboarding dogfood probe was deferred, so AC-09's "emits verdict + dual-layer retro" is not delivered by a run.
- **Fix**: Run the adapted probe and commit/summarize its verdict + dual-layer retro, **or** explicitly de-scope AC-09's run requirement in the plan (the adopt shape is otherwise covered by `harness-flows.test.ts` + golden fixtures + CLI dogfood).

### FT-007: New durable tests lack mandated Test Doc blocks
- **Severity**: MEDIUM
- **File(s)**: /Users/jordanknight/substrate/harness-engineering/harness/cli/test/services/flow/harness-flows.test.ts
- **Issue**: rules.md §6.3 (:64) is a MUST — every promoted test carries a Test Doc block (Why / Contract / Usage Notes / Quality Contribution / Worked Example). The 209-line suite has a file-level docblock but no per-test blocks.
- **Fix**: Add Test Doc blocks to each promoted test (Given-When-Then naming is already mostly followed).

### FT-008: Non-neutral publication wording in research-dossier
- **Severity**: MEDIUM
- **File(s)**: /Users/jordanknight/substrate/harness-engineering/docs/plans/032-eng-harness-flow-flight-plans/research-dossier.md
- **Issue**: "internal-substrate work" / internal-source labels read as private-source provenance rather than neutral public-safe synthesis (AGENTS.md).
- **Fix**: Reword to neutral public language (e.g. "a local repository/source review").

### FT-009: Two retro docs absent from the Domain Manifest
- **Severity**: LOW
- **File(s)**: plan Domain Manifest; docs/retros/{flow-coexist-eval,loop-flow-eval}.md
- **Fix**: Add the retro docs to the manifest, or add a manifest note that eval runs emit retros under `docs/retros/`.

### FT-010: score-loop-eval Gate 2 not strict on exact spine
- **Severity**: LOW
- **File(s)**: /Users/jordanknight/substrate/harness-engineering/scripts/score-loop-eval.sh (Gate 2)
- **Fix** (optional): Assert the exact 7-node spine order + absence of cycles (currently checked only via fixtures/tests).

## Re-Review Checklist

- [ ] FT-001 applied (set-node idempotent **or** AC-07 re-scoped + byte-diff/no-dupe gate added; execution.log reconciled with retro)
- [ ] FT-002 applied (no personal/`.claude`/home path in any shipped/tracked file)
- [ ] FT-003 applied (retro runDirs sanitized)
- [ ] FT-004–FT-008 applied
- [ ] `just test` green; `flow-fixtures --check` / `check:flows` pass; biome clean
- [ ] flow-coexist-eval re-run with the byte-diff gate → idempotency proven (or re-scoped guarantee proven)
- [ ] Re-run the review verb and achieve zero HIGH/CRITICAL
