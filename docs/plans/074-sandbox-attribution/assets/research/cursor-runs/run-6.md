# Cursor run 6

## SHAs
| Case | SHA | Subject |
| --- | --- | --- |
| A | `f9b52c8` | `run6-A standalone` |
| B | `26480ec` | `run6-B trailing` |
| C | `16e6f2f` | `run6-C leading` |
| D | `13d95aa` | `run6-D substituted` |

`git commit --allow-empty -m "run6-A standalone"`
```text
[main f9b52c8] run6-A standalone
```

`git commit --allow-empty -m "run6-B trailing" && echo done`
```text
[main 26480ec] run6-B trailing
done
```

`echo starting && git commit --allow-empty -m "run6-C leading"`
```text
starting
[main 16e6f2f] run6-C leading
```

`git commit --allow-empty -m "run6-D $(echo substituted)"`
```text
[main 13d95aa] run6-D substituted
```

`git log --oneline -4`
```text
13d95aa run6-D substituted
16e6f2f run6-C leading
26480ec run6-B trailing
f9b52c8 run6-A standalone
```

## Step E — single entrypoint
`node commit.mjs "run6-E via single entrypoint"`
```text
nothing staged — no commit made.
```

No SHA or `verify :` line was printed because the entrypoint made no commit.

## Anything I noticed
All four A–D commands were run as separate terminal invocations and were passed unchanged. No approval prompt appeared.

The execution environment reported A as outside the sandbox. It reported B, C, and D as sandboxed. This matches the predicted distinction between a standalone `git` command and compound/substituted command shapes.

The E command was standalone and completed outside the sandbox, but it did not stage or commit anything because there were no tracked or untracked changes at that point.
