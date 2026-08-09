# Original ask — dd-consume-upgrade

**Captured**: 2026-08-09T01:30:00Z  ·  **By**: /the-flow (recorded at Jordan's direction: "include our entire pre-amble context as the original ask")

## The ask, verbatim (assembled across the pre-amble conversation)

> "then when its done ou will work on taking that sdk and getting harness upgraded to use it instead of the impl in harness now. We need to be careful of using npm, cause our npm proxy settings mean we must use a npm server that is 1 week delayed (because supply chain attaks) so we need to find a differnt way (at least locally) of takin the dep on the other repo."

> "yep get that done, but is up to /builder stage with flow roughted in then we can do our pre-amble to figure out how to attack this work thanks."

> "you may comms direct with crab btw thoughout your work to iterate on the SDK. i tcan make fixes rapidly. we will source sdk from its branch to get this done fast"

> "yep, we should start with a litel POC first, make sure the SDK is consuable before we start the owrk in earnest"

> "get your builder flow in and perofrm the explore step, then report on if we need to do any workshops. include our entire pre-amble context as the oiginal ask"

## Pre-amble context (the state of play when the flow started)

- dd was extracted from harness into standalone **`@ai-substrate/dd`** (CLI + SDK), repo
  `github.com/AI-Substrate/dd`, developed on a work branch (main has diverged — never
  probe the bare clone; name the sha).
- **The consume route is settled and POC-proven**: `npm install
  github:AI-Substrate/dd#<full-sha>` — packs on install, proxy never touched, sha carries
  provenance. Current pin `7e570bccdd34fddd275cfa35b38fde438f76a55b`; POC green
  (install/pack/exports/injection/A-2/D7/tsc).
- **Jordan's ruling on sourcing**: from the *branch*, re-pin shas as fixes land; direct
  PM-to-PM channel with dd's `pij-certain-crab` is standing for all of 080.
- **OQ-2 held** (Jordan verbatim "held please"): dd's `./plan` subpath stays unpublished;
  it closes on *this plan's* trial verdict — are dd's public primitives sufficient to
  re-implement plan semantics in harness (round 3, the deciding round, with the dated
  prediction + per-primitive falsifier discipline).
- **Two trial rounds already run**: round 1 (tarball, bare consumer, 22/31 symbols
  reachable, `fr-0010` found+fixed) and round 2 (two files rewired, tsc exit 0, 423
  tests green).
- **Four pre-amble decisions were put to Jordan and are open at flow start**:
  1. delete `acts/dd` or only rewire (rec: full removal, staged behind its own gate);
  2. fate of the `harness dd *` verbs (user-facing — his call);
  3. the pre-decided answer if primitives are insufficient — dd exports more (wait on
     dd's cycle) vs harness keeps ~1,090 duplicated lines (rec: dd exports; must be
     chosen BEFORE the trial);
  4. accept or replace the retired flow→dd architecture boundary (all existing guards
     skip package specifiers).
- **Coordination**: prime `pij-massive-meadowlark` holds `fr-0002/6/7` + `#119` unstaffed
  until this plan names its touch set. `#119` is settled as NOT in scope (collides by
  file, not subject).
