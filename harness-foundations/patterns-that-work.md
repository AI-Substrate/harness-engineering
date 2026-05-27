# Patterns That Work

First principles describe what should stay true. Patterns describe moves that tend to work when a team is trying to make those principles real.

This is a field guide, not a maturity model. Start with the pattern that removes the most repeated friction from the next run.

Some patterns use guides and sensors language. Guides shape work before action. Sensors make outcomes visible after action. This phrasing follows Birgitta Böckeler’s [“Harness engineering for coding agent users”](https://martinfowler.com/articles/harness-engineering.html). In this repo, both belong to the engineering harness only when they improve the project-side loop for booting, interacting with, observing, validating, or improving the product.

## Pattern 1. Classify the failure before changing the model

When an agent run fails, do not start by assuming the model was too weak. First ask which layer of the harness failed.

A practical diagnosis separates task/spec failure, context failure, environment failure, verification failure, state or continuity failure, and genuine model capability gap. Most repeated failures in real codebases are not pure model failures. They happen because the task was underspecified, the repo did not reveal the right context, the product could not boot, the validation signal was too weak, or the session lost state.

The useful habit is to write the failure down in a form the harness can act on: what happened, what layer failed, what signal proved it, and what would prevent the next run from repeating it.

Minimal version: after every confusing failure, add one line to the review or retro that begins, “This failed because the harness did not yet make X clear or executable.”

Watch for: model-blame that prevents harness improvement, or harness-blame that excuses weak specification and review discipline.

## Pattern 2. Audit the harness by subsystem

Use the five-subsystem audit when a codebase feels agent-hostile but the cause is unclear.

The subsystems are Instructions, Tools, Environment, State, and Feedback. Instructions tell the agent what matters. Tools let it act. Environment lets the product run. State lets work resume. Feedback tells the agent and reviewer what happened.

A weak subsystem can make a strong model look unreliable. Good instructions do not help if the environment cannot boot. Good tools do not help if there is no feedback. Good feedback does not help if state disappears between sessions.

Minimal version: ask five questions. Does the agent know what to do? Can it safely act? Can the product run? Can the work resume? Can failure become a useful signal?

Watch for: adding more instructions when the actual problem is missing tools, broken setup, hidden state, or poor feedback.

## Pattern 3. Keep the common loop fast and the proof loop trustworthy

A harness should not make every small edit go through the slowest possible gate. It should also not let fast-loop success pretend to be final proof.

The common loop is the quick path used while developing: run a local command, exercise one route, inspect one log, fix one issue, rerun. The proof loop is the stronger path used before accepting work: clean setup, representative data, full validation, smoke or end-to-end checks, and durable evidence.

Both loops matter. If the common loop is too slow, people and agents bypass the harness. If the proof loop is too weak, the team accepts plausible work instead of proven behaviour.

Minimal version: name one fast command for iteration and one stronger command for acceptance. Make it clear which one is sufficient for exploration and which one is required for done.

Watch for: confusing convenience with correctness, or making correctness so expensive that nobody runs it.

## Pattern 4. Use instruction routing, not instruction dumping

A large instruction file can feel helpful at first, then become a source of context pressure and contradiction.

The root instruction file should act like a router. It should tell the agent what this project is, which rules are non-negotiable, where to find task-specific guidance, how to boot and validate, and what to do when instructions conflict. It should not try to hold every historical lesson the team has ever learned.

Topic-specific guidance belongs near the code or workflow it affects. Stale guidance should be deleted or encoded into commands, checks, templates, fixtures, or diagnostics. Critical rules should have clear applicability. If a rule only applies to one package, say so. If a rule exists because of a temporary migration, give it an expiry condition.

Minimal version: keep the entry file short enough that a fresh agent can read it at startup and know where to go next.

Watch for: instruction bloat, lost-in-the-middle effects, duplicated rules, and old warnings that nobody knows how to remove.

## Pattern 5. Engineer for amnesia

Long-running agent work should not depend on chat memory.

A useful harness assumes the next agent, next human, or next session may know nothing except what the repository and durable artefacts say. The remedy is not one giant transcript. The remedy is small durable state: progress, decisions, verification, current task, blocked items, and the next safe action.

A good clock-in routine reads the current progress, checks the repository state, verifies the product can still start, and chooses one next task. A good clock-out routine records what changed, what passed, what failed, what remains blocked, and what should happen first next time.

Reset should be cheap. If compaction or long conversation history is the only thing preserving the plan, the harness state is too weak.

Minimal version: maintain a progress note and a verification note for any task that spans more than one session.

Watch for: “we talked about it earlier” becoming the only source of truth.

## Pattern 6. Treat feature lists as harness state

A feature list is not just a planning note. It can be the state machine that controls scope, handoff, and completion.

A useful feature item names the behaviour, its current state, the command that proves it, the evidence location, and any dependency or blocker. The important move is that the feature does not become passing because an agent edits a status field. It becomes passing because the harness runs the required verification and records the result.

This gives the agent a clear scope surface. It also gives reviewers a way to see whether work is active, blocked, unstarted, or proven without reconstructing the story from chat.

Minimal version: for every active feature, record behaviour, state, verification command, evidence, and next action.

Watch for: status fields that drift away from reality, or feature lists that become wishlists without verification commands.

## Pattern 7. Route done to checks or human judgement

Agents are prone to premature victory. They often produce a plausible summary before the system has actually proven the behaviour.

A good termination gate is layered. Start with cheap checks such as format, lint, typecheck, and build. Then run targeted tests for the changed behaviour. Then prove startup still works. Then run a smoke or end-to-end scenario where the risk justifies it. Finally, capture evidence, update progress, clean up intentional artefacts, and leave the next session able to start.

The agent can report what it believes is complete, but its confidence is not the verdict. If the completion contract is executable, the harness should decide with checks. If the completion contract is not executable, the harness should route the unresolved judgement to a human with enough evidence to decide.

Minimal version: define a done command or checklist that separates executable checks from human judgement items, then require evidence for both.

Watch for: accepting summaries as evidence, pretending automation decided a non-executable product judgement, or treating unit tests as sufficient when the real failure mode is startup, integration, rendering, hydration, permissions, data, or side effects.

## Pattern 8. Observe the process, not only the product

Runtime observability explains what the software did. Process observability explains why the change should be accepted.

Runtime evidence includes logs, traces, screenshots, responses, health checks, database checks, console output, and event streams. Process evidence includes task trace, acceptance rationale, evaluator rubric, review notes, approval history, unresolved risks, and the reason a particular validation path was chosen.

Both matter for harness engineering. A change can run correctly but have a poor decision trail. A decision trail can look careful but fail to prove real product behaviour. The harness should make both inspectable.

Minimal version: every non-trivial change should leave an evidence note that says what was checked, why those checks were sufficient, and what remains unproven.

Watch for: beautiful logs with no acceptance rationale, or polished rationale with no runtime proof.

## Pattern 9. Promote repeated review feedback into the harness

If a reviewer gives the same comment three times, that comment is a harness candidate.

Some feedback should become documentation, but the stronger move is usually an executable guardrail. A repeated style correction might become a lint rule. A recurring architecture concern might become a boundary check. A missing test expectation might become a template or validation step. A confusing error might become a better diagnostic message.

This is how review becomes compounding rather than repetitive. The reviewer still exercises judgement, but the harness absorbs the boring, repeatable parts.

Minimal version: during review, tag repeated comments with “encode?” and decide whether the fix belongs in a rule, hook, test, CLI, template, diagnostic, or example.

Watch for: turning every preference into permanent law. Encode repeated pain, material risk, or clear team decisions.

## Pattern 10. Turn friction into encoded improvement

Friction only compounds when it enters a lifecycle.

A practical lifecycle is capture, bubble, harvest, prioritise, encode, and validate. Capture friction while it is fresh. Bubble it at a natural pause so it does not interrupt flow. Harvest entries periodically so repeated pain becomes visible. Prioritise by recurrence, severity, and age. Encode the chosen fix into the harness. Validate that a later run is actually better.

The magic-wand question is a simple trigger: “What one concrete command, flag, output field, fixture, diagnostic, template, sensor, check, or workflow change would make the next run easier, safer, or better proven?” Pair it with: “What did the agent or reviewer have to infer that the harness should have proved?”

Minimal version: ask the magic-wand and back-pressure questions at the end of meaningful agent runs and convert the best answers into small harness tasks.

Watch for: retrospectives becoming diaries. The value is not the number of notes. The value is how many recurring frictions become encoded fixes or stronger sensors.

## Pattern 11. Make the CLI explorable

CLIs work unusually well as harness surfaces because agents already know how to inspect and operate them.

A good CLI documents what is possible without forcing the agent to load a large manual into context. Command names, help text, subcommands, flags, examples, exit codes, and non-interactive modes let an agent discover the safe path incrementally. The CLI becomes a navigable surface: ask for help, choose a command, run a dry run, read the result, then move to the next supported action.

This does not mean the harness is only a CLI. The harness still includes fixtures, docs, checks, state, workflows, observability, and review paths. The CLI is often the best front door because it makes those pieces callable and discoverable.

The CLI also does not need to reimplement the world. It can wrap existing build scripts, test runners, package commands, seed scripts, diagnostics, and deployment checks. Its job is to make the supported path easy to find and run, not to replace every tool already working underneath it.

Minimal version: provide one top-level command with useful help text, obvious subcommands, and examples for boot, validate, doctor, seed, and status.

Watch for: hiding important capability in prose-only docs, or making agents guess raw shell sequences that a supported command could expose safely.

## Pattern 12. Return structured evidence, not logs to scrape

A CLI is one of the best harness surfaces because both humans and agents can call it. But a CLI that only prints vague logs still forces interpretation work back onto the operator.

Useful harness commands return clear status, stable exit codes, structured data where appropriate, typed errors, and remediation guidance. They distinguish hard failure from degraded-but-usable states. They make it easy to attach evidence to a pull request, issue, run record, or handoff.

This does not mean every command needs heavy JSON ceremony. It means the command should have a predictable contract and should not require the agent to guess whether the result is acceptable.

Minimal version: every important command should say what it checked, whether it passed, what failed, and what to do next.

Watch for: agents scraping brittle log text, or commands that fail loudly without explaining the failed layer.

## Pattern 13. Make diagnostics fix-forward

A good doctor command is executable orientation.

It should check the layers in the order an operator would need them: prerequisites, environment variables, dependencies, ports, services, product startup, health endpoint, seed data, and validation surface. It should stop at the most useful failing layer and prescribe the next action.

Diagnostics should not merely say red. They should explain what was expected, what happened, why that layer matters, and which command or file is likely to fix it.

Minimal version: build a doctor command that checks prerequisites and product reachability, then prints the next recommended action for each failure.

Watch for: dumping raw stack traces without guidance, or hiding the command that would repair the problem.

## Pattern 14. Seed the first real scenario

A product that boots empty is still hard to understand.

Seed data is part of the harness because it makes meaningful interaction possible. The first real scenario should exercise a behaviour the team cares about, not merely prove that a server process exists. For a UI product, that might mean a seeded user, project, invoice, workflow, or document. For a service, it might mean a realistic request and known expected response.

The goal is to make the first useful interaction obvious to a fresh human or agent.

Minimal version: provide one command that creates or resets a safe development fixture, then document one interaction that proves the seeded state works.

Watch for: demo data that rots, fixtures that require tribal setup, or seed commands that cannot be rerun safely.

## Pattern 15. Measure the loop, not the person

Harness measurement should help the team improve the development loop. It should not become productivity theatre.

Separate facts from interpretation. Facts include commands run, checks passed, failures observed, time to evidence, repeated friction, review outcomes, and encoded fixes. Interpretation asks what those facts mean and should stay humble about causality.

The useful measures are ease of entry, safety of change, speed of proof, and compounding. Did the next run start faster? Did it avoid a known trap? Did validation catch the real risk? Did a repeated friction become a command, check, fixture, template, or diagnostic?

Minimal version: track recurring friction and encoded fixes. That is usually more honest than ranking individual output.

Watch for: measuring activity volume, retro volume, or individual productivity as if those were harness value.

## Pattern 16. Change one harness variable at a time when learning

When testing whether a harness improvement helped, avoid changing everything at once.

Keep the task type similar, hold the agent/tooling as steady as practical, and change one harness surface: instructions, tool, environment, state, feedback, validation, or interface. Then compare whether the next run became easier to start, safer to change, faster to prove, or clearer to review.

This does not need to be scientific theatre. It is simply a discipline for avoiding vibes. If a new model, new prompt, new validation command, and new task all change together, the team cannot tell what mattered.

Minimal version: when making a harness change, write the intended effect in one sentence and check for that effect on the next comparable run.

Watch for: attributing every improvement to the model, or every failure to the agent, when the harness changed at the same time.

## Pattern 17. Build a guides-and-sensors matrix

Recurring failures usually need either a guide, a sensor, or both.

A guide shapes the work before action. Examples include task specs, repo instructions, templates, architecture maps, examples, seed scenarios, and command recipes. A sensor makes the result visible after action. Examples include tests, lint, typecheck, health checks, doctor diagnostics, logs, traces, smoke checks, end-to-end checks, review evidence, and process artefacts.

For each repeated failure, ask whether the agent needed better feedforward guidance, better feedback after acting, or a tighter connection between the two. A missing instruction might need a guide. A missed regression might need a sensor. A recurring misuse of a command might need both clearer guidance and a validation check.

Minimal version: make a two-column table for one repeated failure: what guide would have prevented it, and what sensor would have caught it?

Watch for: adding guidance where only a sensor can prove the outcome, or adding sensors where the agent still lacks enough context to make a good first attempt.

## Pattern 18. Tier computational and inferential controls

Not every check should be an AI review, and not every judgement can be reduced to a script.

Computational controls are deterministic checks: tests, type checks, linters, schema validation, dependency rules, architecture rules, health probes, and scripted smoke checks. They are usually cheaper, faster, and more repeatable. Inferential controls are judgement checks: AI-assisted review, evaluator rubrics, semantic assessment, product judgement, accessibility nuance, and human review.

Run computational controls early and often where the contract is expressible. Use inferential controls when meaning, intent, quality, risk, or tradeoff cannot be captured reliably by deterministic tooling. When judgement remains unresolved, the harness should route the question to a human with evidence.

Minimal version: label each validation step as computational, inferential, or human judgement, then make sure cheap deterministic checks run before expensive judgement checks.

Watch for: using an LLM review to compensate for missing tests, or pretending a deterministic check has answered a product judgement question.

## Pattern 19. Regulate one quality dimension at a time

A harness is clearer when it names what kind of quality it is trying to regulate.

Maintainability concerns include style, readability, duplication, dependency hygiene, generated-file boundaries, and ordinary code health. Architecture fitness concerns include boundaries, layering, public contracts, dependency direction, ownership, and coupling. Behaviour concerns include user outcomes, system workflows, domain correctness, runtime side effects, and acceptance examples.

Different dimensions need different guides, sensors, and proof strategies. A linter might regulate maintainability. A dependency rule might regulate architecture. A seeded end-to-end scenario might regulate behaviour. One check rarely proves all three.

Minimal version: before adding a harness check, write which dimension it protects: maintainability, architecture fitness, behaviour, or something else.

Watch for: calling everything validation without saying what risk the validation actually addresses.

## Pattern 20. Approve behavioural scenarios before trusting generated tests

A green generated test suite is not the same as behavioural proof.

For important behaviour, the trusted artefact should be the scenario, fixture, contract, or acceptance example that expresses what the product must actually do. An agent can help draft it, but a human or established product contract should approve the behavioural target before the team trusts generated implementation or generated tests.

This fits naturally with spec-driven development. Put judgement into the expected behaviour first. Then let agents implement, test, and iterate against that approved target.

Minimal version: for any high-risk behaviour, review the scenario or acceptance example before reviewing the code that satisfies it.

Watch for: tests that only prove the implementation matches the agent's assumptions, not the user's required behaviour.

## Pattern 21. Regression-test the harness

A harness is not good because it exists. It is good when it catches known risks and improves future runs.

Keep a small set of known-bad examples, synthetic tasks, stale-instruction cases, broken fixtures, or intentionally failing scenarios. Use them to check whether the harness catches the risks it claims to catch after changes to instructions, tools, validation, docs, fixtures, or workflows.

This is especially useful when sensors appear quiet. No failures might mean the code is good. It might also mean the harness has gone blind.

Minimal version: keep three known-bad cases and rerun them when changing a major guide, sensor, or validation flow.

Watch for: measuring harness value by the number of files or checks instead of whether it catches meaningful failures.

## Pattern 22. Garbage-collect stale harness assumptions

Harnesses decay because projects, teams, models, dependencies, and workflows change.

Periodically scan for stale instructions, duplicated rules, dead fixtures, flaky checks, obsolete commands, drifted docs, noisy warnings, weak sensors, unused templates, and old workarounds that have become folklore. Some items should be deleted. Some should be promoted into executable checks. Some should be rewritten as routing guidance. Some should be retired because the product or toolchain changed.

Garbage collection is not a cleanup chore separate from harness engineering. It is how the harness remains trustworthy and low ceremony.

Minimal version: during a regular review, ask which harness rule, check, fixture, or document no longer earns its keep.

Watch for: treating every accumulated lesson as permanent law. A harness should compound value, not compound clutter.
