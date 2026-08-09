# s081 design constraints (pre-plan)

Collected from Jordan's pre-amble (2026-08-09) and cross-stream coordination.
Labels: RULED = Jordan's pre-amble ruling · COORD = agreed with another stream · MEASURED = verified against artifact.

## From the pre-amble (RULED)

- **No plan-validate in `checks`.** Builder is one SDD flavour among several (e.g. OpenSpec);
  a repo-wide gate would punish legitimate non-builder streams. The enforcement seam is
  pij's, not this repo's gate.
- **pij workteam** (renamed from "pair"/"fleet") **verbs + skill will mandate builder** in
  workteam context and will call **harness verbs** — pij never composes internals itself.
- **Nudge is out of scope** for s081 — deferred until the prompting-in-skills experiment runs.
- **Deliverable**: new deterministic harness verb ("does this stream have a flight plan AND
  does its plan validate"), built RED first against pij wave streams 098/099, plus a written
  contract and a handoff/collaboration offer to ermine (who will wire pij using their own
  workteam).
- Verb name, input contract, error codes, exact artifact span: mine to settle in the plan.
- **Bundle `flight-plan` as a first-class harness flow type** (fixes the E304 friction);
  pij depending on harness is sanctioned — "pij can rely on harness".
- **Missing flight plan is a WARNING by default, even in the new verb** ("no its a warning
  still") — 072's advisory posture extends; any teeth are opt-in, never default.

## From s080 / koala (COORD, 2026-08-09)

- `harness plan validate|ready|new|render` **survive** the dd extraction — same verbs,
  envelope, exit semantics. Only `harness dd *` is removed (ratified D-2). Behaviour drift
  in `plan validate` across s080's phases is a defect report koala wants.
- **Do not couple to**: `harness/cli/src/services/dd/**`, `src/acts/dd/**` (deleted in their
  phase 3); no imports from `services/dd/plan` (moving phase 2); **no edits to
  `acts/plan/index.ts`** without routing through koala or prime; `scaffold.ts` is #119's.
- **Seam: consume the CLI envelope, not internals** — spawn `harness plan validate <t> --json`
  or `plan ready <t>` (koala suggests `ready` is the verb I actually want: validates AND
  actionable, returns `basis_sha256` to cache against). CLI-is-the-API is constitution P4.
  In-process seam only AFTER their phase 2, by coordination, if shelling is too slow.

## From dogfood friction (MEASURED)

- `flight-plan` is not a bundled flow type: #140's proposed brief one-liner fails `E304`;
  the real invocation needs `--path/--schema/--template/--agent` resolved from the builder
  skill (see `../friction-log.md` F1). The pij-facing contract must either carry the full
  invocation or s081 bundles `flight-plan` as a first-class type — open design question.
