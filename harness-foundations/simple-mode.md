# Harness engineering, the simple version

There's been a lot of chatter around harness engineering recently, and I think the industry is starting to converge on some genuinely useful ideas.

Birgitta Böckeler's [Harness engineering for coding agent users](https://martinfowler.com/articles/harness-engineering.html) and Moss Banay's [Don't waste your back pressure](https://banay.me/dont-waste-your-backpressure/) are two of the more interesting public reads right now. There are more, and there will be more — this is a space that's actively shaping itself.

This post is my take. More importantly, it's a tangible way to get a harness going in your own codebase. It's short on theory and long on practical moves you can try today. There will be more developments over time, but here is a simple starting point for understanding the concept and trying some of it out in your repo.

## The problem

There are a couple of core problems that harness engineering is trying to address. One is that we need to reduce the time it takes for an agent to "close the loop" and get real feedback from your codebase on the work its been doing. The second is that we're working hard to increase the quality and trustability of the loop by intentionally working towards more deterministic validation flows. We aim to turn these two things (and more) in to first class concepts in your codebase.

I'm sure you've all felt the frustration. You've implemented a feature. You had the perfect plan. The tests are green. Everything has passed. The agent is telling you it's complete. And then you go and look at it, and there is something obviously wrong.

An architectural boundary has been breached. A shared helper got reinvented instead of reused. A "done" that does not survive the first real user flow.

Or the other version of the same frustration: the agent did finish, but somewhere in the middle of the run it spent twenty-five minutes cycling on how to run up the code and validate that the endpoint was actually working.

The art of harness engineering is keeping track of these frictions the agent hits as it works, and the discoveries it makes along the way, and making sure we encode those discoveries — and the fixes for those frictions — back into the engineering harness.

As a gift to our future selves.

Whilst doing this, we should be as deterministic as possible. Encode it in the CLI. Avoid, wherever possible, writing code in markdown.

## The idea

Harness engineering is the practice of productising the development loop so a human or agent can move from intent to evidence, and then encode what they learn into the next run.

Before we get too much in to it, it's important that you don't conflate an agent harness with an engineering harness. The **agent harness** is the runtime that drives the model: Copilot, Claude Code, Codex, Cursor, Cline, pi, or whatever you use.

The **engineering harness** is the project-side loop helps the agent work *on* your codebase. That helps the agent prove the software works: build, boot, seed, run, observe, validate, improve.

The agent harness drives. The engineering harness proves.

**Back pressure** is the signal that tells the agent its work is wrong: build failures, type errors, tests, lint, runtime failures, smoke checks, architecture checks and more besides.

If those signals are weak, the loop becomes overdependent on the human as the source of back pressure, catching the same mistakes over and over by hand.

## The simple version

I'll pop a simple version of this here with a more expanded take below.

An engineering harness can start out as such a simple idea. A few simple rules and you can start building out the beginnings of a harness. Over time this will snowball. You could of course attempt to encode all these [principles](https://github.com/AI-Substrate/harness-engineering/blob/main/harness-foundations/first-principles.md) but in reality, you can start small in your experiments and get some hands on time with the concept.

1. Create a tiny CLI.
2. Tell the agent this CLI is the project harness.
3. Tell the agent to keep a record of friction it encounters as it works.
4. At the end of the run, ask the agent "if you had a magic wand, what would you improve about your environment". Ask it to provide a retrospective of it's experience of working with the codebase and the harness.
5. After human review, encode the best improvement into the harness. Prefer executable checks over instructions in markdown.

## Why a tiny CLI is the right starting point

Every new agent session is a fresh developer onboarding into your codebase.

If the only way to operate your repo is scattered `AGENTS.md` paragraphs, half-remembered package scripts, tribal setup steps, and a Miro page from last quarter, the agent has to infer too much. Sometimes it infers well. Sometimes it hallucinates confidence. Either way, you are paying for the inference.

A CLI gives the harness a front door. Agents are unreasonably good at using them. They get verbs, help text, stable arguments, exit codes, examples, and structured output. They can ask `--help` instead of guessing. They can probe before acting. They can read a clean error and decide what to do.

Your first version does not need to be clever. It can wrap things you already have:

- `harness build`
- `harness test`
- `harness lint`
- `harness doctor`
- `harness boot`
- `harness smoke`
- `harness seed`

The point is not to reinvent your toolchain. The point is to make the supported path obvious, both for humans joining the team and for every agent session that starts cold.

## The five rules

### Rule 1. Make the harness the front door

Once the CLI exists, prompt your agent that the CLI is the engineering harness, and that the harness is the preferred path. Bake that into `AGENTS.md`, your skill files, or whatever your agent harness uses for project-level instructions, so your whole team gets the same behaviour.

The CLI does not need to do everything from day one. It needs to be the **one obvious place** to look (and fix if things are missing or wrong). It's a focal point. 

### Rule 2. Encode the fix, not the memory

If the agent discovers the app only starts after three obscure setup steps, do not just add another paragraph to `AGENTS.md` explaining the dance.

Ask whether the harness can do the dance.

If the agent keeps forgetting a migration step, add a preflight check. If it keeps misreading an architecture rule, add an architecture check. If it keeps needing the same seed data, add a seed command. If it keeps misusing an internal API, add a lint rule or a typed wrapper.

Documentation can orient. But the highest-value harness knowledge is executable. Markdown explains the trap. Code prevents you falling in it.

This is the rule that quietly does the most work. The instinct is always to write a new doc. Resist it. "Coding in markdown" is how harnesses stay stuck.

I like to think of this as "instead of documenting how to work the problem, just fix it properly". Don't tell, do (when it makes sense!). 

### Rule 3. Prefer deterministic validation over agent inference

Do not ask the agent to infer whether it is done when the repo can prove it.

A prompt that says *"follow our architecture"* is a start. A deterministic architecture check that fails when the rule is violated is much better.

A prompt that says *"make sure the app still works"* is risky. A `harness boot` and a smoke check is much better.

A prompt that says *"do high quality work"* is not particularly useful. A validation path that catches the specific failure modes your team actually sees in production is much better.

The agent can say it is done. The harness should decide whether that claim is supported by evidence.

This is where back pressure stops being a human review habit and becomes part of the repo. Compilers, type systems, schemas, linters, tests, architecture checks, boot probes, and smoke tests can all refuse weak work directly, without needing the agent to remember a rule. Unit tests matter, but they are one sensor, not the whole harness. Aim for checks that catch the failures your team experiences, not just the failures that are easy to write tests for.

This rule is the one most teams underinvest in. It is also the one that earns the most trust over time.

### Rule 4. Treat agent friction as harness feedback

Agents are useful because they expose the rough edges that humans have learned to ignore.

Humans accumulate tribal knowledge. Agents do not, at least not across sessions. So when the agent gets stuck, that is not just an agent failure. It is often **usability research on your engineering harness**.

When something goes wrong, ask:

- Was the setup unclear?
- Was a command missing?
- Was the error message useless?
- Was seed data absent?
- Was validation too weak to catch the real failure mode?
- Was the supported path harder than the shortcut?

Each of those is a fixable harness defect. The agent stumbling is the signal. 

Prompting the agent to provide a retro of the harness after it's completed its work is highly effective I've found. 

### Rule 5. Ask the magic-wand question, then close the loop

At the end of any meaningful agent run, ask:

> If you had a magic wand, what one command, flag, output field, fixture, diagnostic, template, or workflow change would make the next run easier, safer, or higher quality?

The answer has to be concrete enough to encode.

Then review it. Some answers will be bad. Some will be too expensive. Some will be gold. The point is not to collect lessons. The point is to make the next run better. That means encoding the good answers into the harness: a new command, a new check, a new fixture, a new diagnostic, a new default, a new validation path.

Without that final encoding step, you do not have a compounding harness. You just have a chat transcript full of insights nobody will read next time.

## The compounding part

The first few harness improvements are usually basic. A clearer doctor check. A reproducible seed command. A pre-commit wrapper. A smoke test. A better error message. None of them feel like a big deal individually.

But after a few iterations, something quietly shifts.

The next agent session starts faster. The next human has less tribal knowledge to recover. The next validation run is more deterministic. The next review has better evidence. The next time someone hits the same friction, the harness catches it before a human has to. Developer onboarding is shorter. 

That is the whole idea. Do not just use agents to write code. Use agents to improve the loop that the agents themselves use to write your product and prove the code works. That's my take on the simple version of harness engineering.

---

**Further reading**

- Birgitta Böckeler, [Harness engineering for coding agent users](https://martinfowler.com/articles/harness-engineering.html)
- Moss Banay, [Don't waste your back pressure](https://banay.me/dont-waste-your-backpressure/)