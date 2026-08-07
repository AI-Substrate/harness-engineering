# Original ask — vendor-builder-baked-skills
**Captured**: 2026-07-07  ·  **By**: /the-flow

> we need to vendor the flow from ~/github/tools/skills/SDD to this repo. it will live here now. it wil still live in ~/tools/github, but we will  make a note that it move here. Also we are going to rename it to "builder". finally we are going to bake skills in to our build. We will still use npx to install them using harness commadn as now, but you will not need access to remove github to call them. We will have a skill in our repo that is "the-flow" that just has a couple lines redirecting hte agent to builder. When we aer installing skils, i assume they will copy out to a local lcoation from a zip or osmehitng then then npx will do a local path install from there? need to see how a) include zip files during build (or just copy them in no zip, they are small anywya) and then get them to tmp and use the npx to install via harness cli as now. this means no need formore repos. Then during harness update, we will auto update skills based on teh *last* way they were installed, e.g. if just claude, just update claude. etc. If just local repo, then just do that too... need to scan what is installed in local repo using skills lock and follow that at execution time. Remember this is a publiched too this goes out to many installed machines that are not this one in a variet of repos, with differnt configs (codex, curosr etc)
>
> later the builder and eng-harness-flow will be bound in to one.
>
> need to do a proper flow please.
