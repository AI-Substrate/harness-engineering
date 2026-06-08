



# Sound familiar?

- The agent says "done" — you take a look and wonder what it was up to the whole time. (→ backpressure)
- How many times has your team solved the same setup problem? (→ tokens / pay it forward)
- Tests are green, everything passed… first real run, instantly broken. (→ evidence)
- "Did you even try to run this?" (→ backpressure)
- Can your agent even run and interact with your project? (→ harnessability)
- 25 minutes of the agent looping just to boot the app and hit one endpoint. (→ tokens)

## Speaker Notes



The agent is confident, the tests look green, and then you actually open it and something obvious is wrong. Or it did finish, but burned twenty-five minutes mid-run cycling on how to start the app and check an endpoint. Burned tokens and time.

each of these is a fixable harness defect, not just "the agent being dumb". The agent stumbling is usability research on your engineering environment. We'll spend the rest of the session on how to capture that and pay it forward.

And here's the thing — you've probably already fixed some of these. Maybe all of them. Maybe the fix lived in a script someone wrote, or a message in a thread. Most likely its in instructions in a markdown file.  An engineering harness takes that instinct — encoding the answer so the problem never bites again — and makes it a first-class concept: it gives it a defined home. discoverable, runnable, and shared with everyone (and every agent) on the repo. 

It is the productisation of the engineering environment. 

# Agenda

- Framing the problem: what an engineering harness actually is
- Backpressure, and why the deterministic kind wins
- Do as much work deterministically as possible
- Tokens are expensive
- Harnessability: shaping the codebase for agents
- The focal point
- Recap: the layers
- The harness in your development flow
- Retrospective and the magic wand
- Installing the harness







# Framing the problem

- Why do we need an engineering harness at all? What is it?
- An engineering harness is the productisation of your engineering environment.
  - Turning a diffuse concept (scripts, documentation etc) into a first-class concept that is easy to discover, understand, and creates a focal point for improvement.
- Two main reasons (there are more), but these two matter most:
  - a) Create the best possible environment for agents and humans to work together, and to encode learnings and structure back into the engineering environment.
  - b) Systemise deterministic backpressure to raise quality and speed — the easiest way to encode tribal knowledge into the environment so the agent can use it as "backpressure".

## Speaker Notes

Why do we need an engineering harness at all? What is it?

Really an engineering harness is the productisation of your engineering environment. It is turning what is sometimes a diffuse concept (scripts, documentation etc) into a first-class concept that is easy to discover, understand and, importantly, creates a focal point for improvement.

Two main reasons (there are more) but these two are the most important. a) We want to create the best possible engineering environment for agents and humans to work together - we want the best possible way to encode learnings and structure back into our engineering environment and b) we want to systemise the creation and use of deterministic backpressure in our engineering system to raise quality and speed - e.g. create the best possible and easiest way to encode tribal knowledge into the core engineering environment so the agent can use it as "backpressure"

# Encoding your team project memory

- The engineering harness is about building the thing that builds the thing.
- Creating and encoding team/project memory as deterministic code where possible, with markdown as fallback.
- Encoding learnings and fixing friction.
- Pushing for creative, innovative ways to create deterministic back-pressure in the codebase.
- The harness is the focal point for this team memory — your engineering environment.

## Speaker Notes

The engineering harness is about building the thing that builds the thing.

The engineering harness is about creating and encoding team/project memory as deterministic code where possible, with markdown as fallback. It is about encoding learnings, and fixing friction etc.

It is about pushing for creative and innovative ways to create deterministic back-pressure in the codebase. The engineering harness gives a focal point for this team memory - this engineering environment. It creates the focal point for this activity we see here.



# Engineering Harness vs Agent Harness
- The harness word is hot right now, probably overused.
- We mean engineering harnesses here, not agent harnesses.
- Don't conflate the two:
  - Agent harness: the runtime that drives the model (Copilot, Claude Code, Codex, Cursor).
  - Engineering harness: the project-side loop it drives.
- Highly cohesive: a better engineering harness means better agent outcomes, whatever runtime you use. Invest in the loop, not just the model.

## Speaker Notes

The harness word is certainly hot right now, probably overused.

We are talking about engineering harnesses here, not agent harnesses.

Don't conflate the two harnesses. The agent harness is the runtime that drives the model (Copilot, Claude Code, Codex, Cursor). The engineering harness is the project-side loop it drives. Different things.

Highly cohesive: a better engineering harness means better agent outcomes, whatever agent runtime you use. Invest in the loop, not just the model.




# Backpressure
- The agent says it's done — but did it even run the code? That review reflex is back pressure, the human kind.
- There are many kinds of back-pressure, some more reliable than others:
  - Inferred / LLM-driven: e.g. "do a code review" — non-deterministic, even with an advanced prompt that checks architecture.
  - Deterministic: the best kind.
- Deterministic back pressure, from obvious to advanced:
  - Unit tests — the most obvious form; agents are very good at red/green TDD. But won't validate architecture (linters help).
  - CodeQL or .NET Roslyn — encode architecture rules into a command the agent runs: yes/no, no guessing.
  - Closing the loop (middle of the road): a harness command to build, host, and connect a Playwright browser so the agent physically tests the shiny new button it just added.
- The point: move as much back pressure from the inferred world to the deterministic world.
- We should push as much as possible on creating creative and innovating ways to create backpressure we can trust

## Speaker Notes

The agent has said it's done. You take a look and wonder if it's even run the code.

Ever started reviewing an agent's work, only to find yourself dropping back into chat going "hey that's not right at all! why did you do that?" That is back pressure, the human kind.

There are many kinds of back-pressure, some more reliable than others.

Another kind of back pressure is "do a code review". This is non-deterministic. Even if you have an advanced code review prompt, and you ask it to double check architectures etc it is still non-deterministic. It is LLM driven, inferred. Unless...

Deterministic back pressure is the best kind. Unit tests are perhaps the most obvious form of deterministic back pressure. Agents are very good at doing red/green TDD for example.

But that will not validate the architecture properly. Linters can help etc.

Other things are using tech like CodeQL or .NET Roslyn to encode deterministic architecture rules into a command that the agent can run - straight up no guessing - yes or no this is correct.

There are also middle of the road ones between deterministic and inferred, that all form up under the umbrella of closing the loop -> for example you might create a harness command that makes it super easy to build, host and then connect a Playwright browser to the running app so the agent can physically test the shiny new button that it just added.

The point is, we should strive to move as much back pressure from inferred world to deterministic world.


# Do as much work deterministically as possible. 

- Deterministic = code and scripts: something runnable as code, probably idempotent, and can have unit tests.
- Tokens are expensive — the more we do in code, the better our token usage.
- Deterministic processes are more trustable, and when they break you get an obvious target to fix — and everyone on the repo gets the fix too.
  - We used to write scripts for hard or arcane processes; these days it's too easy to just update an agents file. Choose what goes where wisely, but lean deterministic.
- If the agent loops 20 turns to get something going, encode that into a script / CLI. Don't tell me how to fix it — just fix it.

## Speaker Notes

Deterministic pretty much = code and scripts. Something that is runnable as code. It's probably idempotent, and can have unit tests.

First, tokens are expensive. The more we can do in code, then the better our token usage. More on that soon.

Deterministic processes are inherently more trustable. And... if they are not working properly when you use them, you have a really obvious target to fix... and of course, everyone else who is working on the repo gets the fix too. This was obvious in the past - a hard process or something arcane, we would write a script to help us, our peers and the CI process. These days, it's become too easy to just update an agents file or similar. We must choose what goes where wisely, but lean to deterministic.

As you are working with the agent it is going to work things out. It might loop for 20 turns trying to get something going, why not just encode that into a script / CLI? Rather than write the learning in a file, just build the actual learning as a fix or feature. Don't tell me how to fix it, just fix it.


# Tokens are expensive
- Tokens are expensive — make sure you never have to re-discover something twice (even on different developer machines).
- If something loops 20 times to figure something out, that's a strong signal the engineering environment needs improvement.

## Speaker Notes

Tokens are expensive, how can we make sure we ensure that we never have to re-discover something twice (even on different developer machines)?

Again, if something loops 20 times to figure something out, that is a strong signal the engineering environment needs improvement.

# Harnessability
- The engineering environment isn't the only thing to improve — your codebase may need to change so agents can operate more freely.
- Agent onboarding: how easy is it to run your system?
  - Peak: an environment fully set up in an isolated CI run, where an agent pulls a PR and just works — with all the deterministic backpressure and tools you'd get on a local machine. It just works.
- What does your codebase need so it can be fully stood up locally? Fakes / mocks, databases, easily editing/creating DB tables, creating records — the whole shebang.
- If the engineering environment is stretched thin by the codebase, maybe it's time to update the codebase.

## Speaker Notes

The engineering environment is not the only thing that might need to be improved to enable the best agentic coding experience.

Your codebase may need to be modified to allow agents to operate more freely.

Agent onboarding is one thing. How easy is it to run your system? One way I like to think about it is at the top of the castle is an environment that can be fully set up in an isolated CI run, and an agent could pull a PR and just work on it with all the deterministic backpressure and tools that you would get on a local machine. This would be peak onboarding experience - i.e. it just works.

What does your codebase need to have done to it to make it able to be fully stood up locally? Fakes / mocks, databases. What about easily being able to edit / create db tables for example. Create new records - the whole shebang is up for grabs.

If the engineering environment is being stretched thin by the codebase, maybe it's time to think about updating the codebase.

# Focal Point
- Reduce diffuse information to a single focal point:
  - a) make the features of your engineering environment as discoverable as possible.
  - b) give a target for improvement — something that would have made it easier next time? Add it to the harness. A deterministic check not working as expected? Fix it.
- Pre-check work: "if we do this work, how will the system deterministically validate it?" The harness gives this question far more context and affordance, and the team gathers the concept quickly.

## Speaker Notes

We want to reduce as much diffuse information to a single focal point.

a) To make the features of our engineering environment as discoverable as possible.

b) Give a target for improvement. Identify something that would have made it way easier next time? Add it to the harness... Some deterministic check not working as expected, fix it.

You can also pre-check things. "If we do this work, how will the system deterministically validate it?" The engineering harness platform gives this question far more context and affordance. Folks on the team will gather the concept quickly.

# CLI as the front door
- CLI is a great focal-point mechanism — agents understand them.
- --help lets the agent explore commands as needed, without polluting context with documentation from md files.
- Every session is a cold onboarding — wrap what you already have (build/test/lint/doctor/boot/smoke/seed) to give a front door.
- If it's designed well, pointing the agent at the CLI is *almost* enough to get started.

## Speaker Notes

CLI works as a great focal point mechanism. Agents understand them.

CLI has --help. Doesn't pollute the context with documentation from md files etc, can explore commands as needed.

Every session is a cold onboarding, so wrap what you already have (build/test/lint/doctor/boot/smoke/seed) to give a front door.

If it's designed well, pointing the agent at the CLI is *almost* enough to get started.

# Recap: The layers

- Assume friction will happen.
- Give the repo one focal operating surface: CLI.
- Instruct the agent to use the CLI, not guess around it.
- Strive to make the agent use deterministic means for backpressure
- Capture friction as improvement feedback. Ask what the agent had to infer that the harness should have proved.
- Human chooses what matters.
- Encode the chosen fix into the engineering environment (via harness)
- Repeat.

[CLI focal point + required agent use of said CLI] + [deterministic back pressure] + [friction capture] + [human-selected encoding] = engineering harness nucleus.

# Engineering harness in your development flow. 
- A good engineering harness adapts to your existing environment and flows, shaping to your repo and process as you build. Your flows should only adapt a little.
- The harness has a loop of its own that lives inside your existing flow (spec-driven development flows are best).
- Canonical flow: boot → backpressure check → do-work and observe → retro → encode → repeat.
  - Boot
  - Backpressure check
  - Do-work and observe
  - Retro
  - Encode

## Speaker Notes

A good engineering harness will adapt to your existing environment and flows. It will support them and shape to your repo and process as you build. Your flows should only have to be adapted in a small way.

Harness has a loop of its own that can live inside your existing flow (spec driven development flows are best). The canonical flow is boot, validate back-pressure is viable, do-work and observe, retro, encode, repeat.

Boot: the agent asks the harness to boot, which checks the environment is ready for work, it also ensures the agent is reminded how to use the harness effectively.

Backpressure check: a skill will take the planned work and perform a series of checks to prove to the human that it will be striving to use deterministic back pressure where possible, and highlight options for improvement. Sometimes this step may mean stopping work for a moment and actually doing some other engineering work to ensure backpressure is valid (don't worry, that extra work will save a bunch of effort (and tokens!) over time!).

During the do-work portion where the agent is coding and such, the agent will take notes. How is it going in the environment? It will note any frictions, places where it got stuck, or thin confidence that it can validate the work properly etc. During dev, the agent is using the harness and the environment to capture real evidence, logs, health, smoke test responses, screenshots and artifacts etc. This is physical real evidence. If it's light, then the environment should be improved.

When the work is done, the agent will retro the work. It will collate findings and difficulties. It will also ask the question "if I had a magic wand, what would I improve about the engineering environment". This might include improvements to the harness, or maybe even to the codebase itself to make it easier to work on.

The human will review the suggestions, and then if deemed appropriate will encode them back into the engineering environment / harness.
 
# Retrospective and Magic Wand and the compounding pay off

- The magic-wand question really is magic — well-prompted, the agent makes great suggestions. I've re-encoded some fantastic ones.
- After even a few iterations in the team, the payoffs start to compound.

## Speaker Notes

Just calling out the magic wand concept in more detail. It really is magic, when prompted well the agent can make some really great suggestions. I've seen some really fantastic suggestions pop out that I've re-encoded.

After even just a few iterations in the team you will start to see the payoffs compound.

# Installing the harness. 

- Two parts:
  - Core — installed via NPX, upgradeable.
  - Extensions — created per repo, gathered at runtime.
- On install it's minimal — almost no features, just the will to improve and take the shape your environment needs.
- Super easy to install in any repo — no ceremony, just install it.
- The installation skill runs an initial harnessability survey and recommends first extensions (test, build, lint etc), plus more skills to assist with the harness loop.

## Speaker Notes

The harness is in two parts. The core, installed via NPX. Upgradeable. Extensions, created per repo, and gathered at runtime.

Upon installation it will be minimal, almost no features other than the will to improve and take the shape needed to support your engineering environment in the best way.

This means it's super easy to install a harness CLI in any repo, no need for ceremony, just install it.

Installation skill will do an initial harnessability survey and make recommendations for first extensions (test, build, lint etc). Installation skill will also suggest more skills to install to assist with the harness loop.
