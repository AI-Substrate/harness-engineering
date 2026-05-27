# Harness engineering, the simple version

There's been a lot of chatter around harness engineering recently, and I think the industry is starting to converge on some genuinely useful ideas.

Birgitta Böckeler's [Harness engineering for coding agent users](https://martinfowler.com/articles/harness-engineering.html) and Moss Banay's [Don't waste your back pressure](https://banay.me/dont-waste-your-backpressure/) are two of the more interesting public reads right now. There are more, and there will be more again — this is a space that's actively shaping itself. Broadly speaking, "self-improving AI loops" are so hot right now, and done right they can be put to work in the world of harness engineering too. All this work is in the name of delivering more value and quality, at the same time as building more trust in the agentic engineering experience in teams.

This post is my take. More importantly, it's a tangible way to get an engineering harness going in your own codebase. There will be more developments over time, but here is a simple starting point for understanding the concept and trying some of it out in your repo, even just as a learning experience for you and your teams.

Before we get too much into it however, it's important that you don't conflate an agent harness with an engineering harness. The **agent harness** is the runtime that drives the model: Copilot, Claude Code, Codex, Cursor, Cline, pi, or whatever you use. [Check out](https://code.visualstudio.com/blogs/2026/05/15/agent-harnesses-github-copilot-vscode) this article on the Github Copilot agent harness (coding harness).

The **engineering harness** is the project-side loop that helps the agent work *on* your codebase. That helps the agent prove the software works: build, boot, seed, run, observe, validate, improve.

## The problem

There are a couple of core problems that harness engineering is trying to address. One is that we need to reduce the time it takes for an agent to "close the loop" and get real feedback from your codebase on the work it's been doing. The second is that we're working hard to increase the quality and trustability of the loop by intentionally working towards more deterministic validation flows. We aim to turn these two things (and more) into first-class concepts in your codebase.

I'm sure you've all felt the frustration. You've implemented a feature. You had the perfect plan. The tests are green. Everything has passed. The agent is telling you it's complete. And then you go and look at it, and there is something obviously wrong. It can be really hard to trust that the agent is going to do a good job. Folks who are new to AI engineering will definitely experience this doubt — the first few tries at producing a quality outcome can result in frustration at the agent's inability to "just know" what good looks like.

You'll see things like an architectural boundary has been breached or a shared helper got reinvented instead of reused (multiple ways to log to console anyone?). The agent says it's "done" but when you go try it out it does not survive the first real user flow. Ever caught yourself asking the agent "did you even try to run this?"

Or the other version of the same frustration: the agent did finish, but somewhere in the middle of the run it spent twenty-five minutes cycling on how to run up the code and validate that the endpoint was actually working. Burned tokens and time.

A secret art of harness engineering is keeping track of these frictions the agent hits as it works, the discoveries it makes along the way, and the signals it needed but did not have. Then we encode those discoveries, fixes, and missing sensors back into the engineering harness. We track our work, we learn from the friction, and we look to feed it back in as data for the next iteration. But how we feed it is important.

The goal here is that we take all this hard work figuring out **how** to work on our codebase, fix it for good and pay it forward as a gift to our future selves.

A rule to lock away nice and early as you think about how to approach this - our "fixes" should be as deterministic as possible. Why tell the agent how to fix it by extending our prompts, SKILLS.md and AGENT.md files when we can just fix it properly and encode it in the CLI. Wherever possible, avoid writing code in markdown.

## The idea

Harness engineering is the practice of productising the development loop so a human or agent can move from intent to evidence and then encode what they learn into the next run.

The agent harness drives the LLM. The engineering harness helps the agent prove the work that was done is good, and it also helps save us a bunch of tokens and time while doing it.

**Back pressure** is the signal that tells the agent how it's truly doing (not inferred but deterministically wherever possible): build failures, type errors, tests, lint, runtime failures, smoke checks, architecture checks and more besides are some of the more common things.

If those signals are weak, the loop becomes overdependent on the human as the source of back pressure, catching the same mistakes over and over by hand.

## The simple version

The core concept is so simple you could realistically prompt an engineering harness nucleus into your own codebase in a few minutes. Below this section is a more detailed take.

As I said earlier, an engineering harness can start out as such a simple idea. A few simple rules and you can start building out the beginnings of a harness. Over time this will snowball. You could of course attempt to encode all these [principles](https://github.com/AI-Substrate/harness-engineering/blob/main/harness-foundations/first-principles.md) but in reality, you can start small in your experiments and get some hands-on time with the concept with very little initial setup time. Try this:

1. Have your agent create a tiny CLI. I like doing them in node because a lot of the agentic harness stuff seems to work with it well.
2. Tell the agent this CLI is the project's engineering harness, and it must try to use it wherever possible.
3. Tell the agent to keep a record of friction it encounters as it works. Then start doing some work on your codebase.
4. At the end of the run, ask the agent "if you had a magic wand, what would you improve about your environment". Also ask: "what did you have to infer that the harness should have proved?" Ask it to provide a retrospective of its experience of working with the codebase and the harness.
5. After human review, encode the best improvement into the harness. Prefer executable checks, sensors, smoke flows, and evidence capture over instructions in markdown.
6. Repeat.

That's basically it. Obviously, we encode all this in SKILLS.md or a similar concept, but the bones of it are the loop above.

## Why a tiny CLI is the right starting point

Every new agent session is basically a fresh developer onboarding into your codebase.

If the only way to operate your repo is scattered `AGENTS.md` paragraphs, half-remembered package scripts, tribal setup steps, and a Miro page from last quarter, the agent has to infer too much. Sometimes it infers well. Sometimes it hallucinates confidence. Either way, you are paying for the inference.

A CLI gives the harness a front door. Agents are very good at using them. They get verbs, help text, stable arguments, exit codes, examples, and structured output. They can ask `--help` instead of guessing. They can probe before acting. They can read a clean error and decide what to do.

Your first version does not need to be clever. It can wrap things you already have:

- `harness build`
- `harness test`
- `harness lint`
- `harness doctor`
- `harness boot`
- `harness smoke-test`
- `harness seed`

The point is not to reinvent your toolchain. The point is to make the supported path obvious, both for humans joining the team and for every agent session that starts cold.

Sure these examples might seem a little pedestrian, but they are just the start. I've seen some really fantastic additions to the harness come out of just... using the harness.

## The five rules

### Rule 1. Make the harness the front door

Once the CLI exists, prompt your agent that the CLI is the engineering harness, and that the harness is the preferred path. Bake that into `AGENTS.md`, your skill files, or whatever your agent harness uses for project-level instructions, so your whole team gets the same behaviour.

The CLI does not need to do everything from day one. It needs to be the **one obvious place** to look (and fix if things are missing or wrong). It's a focal point.

### Rule 2. Encode the fix, not the memory

If the agent discovers the app only starts after three obscure setup steps, do not just add another paragraph to `AGENTS.md` explaining the dance. Ask whether the harness can do the dance.

If the agent keeps forgetting a migration step, add a preflight check. If it keeps misreading an architecture rule, add an architecture check. If it keeps needing the same seed data, add a seed command. If it keeps misusing an internal API, add a lint rule or a typed wrapper.

Documentation can orient but the highest-value harness knowledge is executable. Markdown explains the trap; code prevents you falling into it.

This encode-the-fix-not-the-memory idea is the rule that quietly does the most work. The instinct is always to write a new doc. Resist it. "Coding in markdown" is how you stay stuck.

I like to think of this as "instead of documenting how to work the problem, just fix it properly". Don't tell, do (when it makes sense!).

### Rule 3. Prefer deterministic validation over agent inference

Do not ask the agent to infer whether it is done when the repo can prove it.

A prompt that says *"follow our architecture"* is a start. A deterministic architecture check that fails when the rule is violated is much better.

A prompt that says *"make sure the app still works and you can build it"* can burn more tokens than required. A `harness boot` and a smoke check is much better.

A prompt that says *"do high quality work"* is not particularly useful. A validation path that catches the specific failure modes your team actually catches is much better.

The agent can say it is done. The harness should decide whether that claim is supported by evidence.

This is where back pressure stops being a human review habit and becomes part of the repo. Compilers, type systems, schemas, linters, tests, architecture checks, boot probes, and smoke tests can all refuse weak work directly, without needing the agent to remember a rule. Unit tests matter, but they are one dimension, not the whole harness. Aim for checks that catch the failures your team experiences, not just the failures that are easy to write tests for.

This rule is one that could be easy to underinvest in. It is also the one that earns the most trust over time.

### Rule 4. Treat agent friction as harness feedback

Agents are useful because they expose the rough edges that humans have learned to ignore.

Humans accumulate tribal knowledge. Agents do not, at least not across sessions. So, when the agent gets stuck, that is not just an agent failure. It is often actually performing **usability research on your engineering harness**.

When something goes wrong, ask:

- Was the setup unclear?
- Was a command missing?
- Was the error message useless?
- Was seed data absent?
- Was validation too weak to catch the real failure mode?
- Was the supported path harder than the shortcut?

Each of those is a fixable harness defect. The agent stumbling is the signal. Sometimes the fix is a smoother command or clearer error. Sometimes the fix is new back pressure: a smoke test, architecture check, runtime probe, CodeQL query, schema check, or evidence artifact.

Prompting the agent to provide a retro of the harness after it's completed its work is highly effective I've found.

### Rule 5. Ask the magic-wand question, then close the loop

At the end of any meaningful agent run, ask:

> If you had a magic wand, what one command, flag, output field, fixture, diagnostic, template, sensor, check, or workflow change would make the next run easier, safer, or higher quality?

Then ask the companion back-pressure question:

> What did you have to infer that the harness should have proved?

The answer has to be concrete enough to encode.

Then review it. Some answers will be bad. Some will be too expensive. Some will be gold. The point is not to collect lessons. The point is to make the next run better. That means encoding the good answers into the harness: a new command, a new check, a new fixture, a new diagnostic, a new default, a new validation path, or a stronger sensor.

Without that final encoding step, you do not have a compounding harness.

## The compounding part

The first few harness improvements are usually basic things like a clearer doctor check or a reusable seed command. A pre-commit wrapper. A smoke test. A better error message. None of them feel like a big deal individually — they may even feel a little obvious.

But after a few iterations, something quietly shifts.

The next agent session starts faster with less preamble figuring out the codebase. The next validation run is more deterministic. The next time someone hits the same friction, the harness catches it before a human has to.

That is the whole idea. Do not just use agents to write code. Use agents to improve the loop that the agents themselves use to write your product and prove the code works. That's my take on the simple version of harness engineering.

### Some further points

One other thing I would add is that whilst the engineering harness concept is not predicated on any particular workflow in an engineering team, I would highly suggest that teams have a very clear understanding of their AI driven workflow and importantly be self-evaluating and improving their flows via retrospectives etc. Teams that use something like Spec Driven Development will be in a good place to take their engineering process to the next level. That evaluation of value delivery in your teams loop is important, so then you can track and improve the entire process, including your shiny new engineering harness.

On the topic of evaluation and value delivery - be aware that the engineering loop, the actual AI coding bit is just a small slice of where teams spend their time. A new engineering harness will not be a silver bullet, but for teams that measure metrics like DORA or similar should be tracking that overall quality goes up as the harness evolves over time and helps teams delivery more quality results.

---

**Further reading**

- Birgitta Böckeler, [Harness engineering for coding agent users](https://martinfowler.com/articles/harness-engineering.html)
- Moss Banay, [Don't waste your back pressure](https://banay.me/dont-waste-your-backpressure/)